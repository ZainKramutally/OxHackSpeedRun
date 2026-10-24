import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_BASE, FB_BASE, FB_WORDS, STACK_BASE, type RVM } from '../../spec/vm_api.ts';
import { assemble } from '../asm/assembler.ts';
import { createVm, LoggingVm, ReversibleVm } from './vms.ts';

const EXAMPLES = join(__dirname, '../../examples');
const examples = readdirSync(EXAMPLES).filter((f) => f.endsWith('.s'));
const source = (f: string) => readFileSync(join(EXAMPLES, f), 'utf8');

/** Registers, PC and the RW memory a program can touch (data prefix, stack prefix, framebuffer). */
function state(vm: RVM) {
  const r = vm.registers();
  return {
    pc: r.pc,
    regs: Array.from(r.regs),
    data: Array.from(vm.memory(DATA_BASE, 64)),
    stack: Array.from(vm.memory(STACK_BASE, 16)),
    fb: Array.from(vm.memory(FB_BASE, FB_WORDS)).reduce((h, v, i) => (h * 31 + v * (i + 1)) >>> 0, 7),
  };
}

function load(kind: 'logging' | 'reversible', src: string) {
  const asm = assemble(src);
  expect(asm.errors).toEqual([]);
  const vm = createVm(kind) as RVM;
  expect(vm.loadProgram(asm.image)).toBe('ok');
  return vm;
}

describe('examples', () => {
  const good = examples.filter((f) => f !== 'bad-landing.s');

  it.each(examples)('%s assembles', (f) => {
    expect(assemble(source(f)).errors).toEqual([]);
  });

  it.each(good)('%s: both engines halt, agree at every t, and step back exactly', (f) => {
    const log = load('logging', source(f));
    const rev = load('reversible', source(f));
    const history = [state(rev)];
    for (let i = 0; i < 20000; i++) {
      const a = log.stepForward();
      const b = rev.stepForward();
      expect(b).toBe(a);
      if (a !== 'ok') {
        expect(a).toBe('halted');
        break;
      }
      expect(state(rev)).toEqual(state(log));
      history.push(state(rev));
    }
    expect(log.historyBytes).toBeGreaterThan(0);
    expect(rev.historyBytes).toBe(0);
    for (let t = history.length - 1; t > 0; t--) {
      expect(rev.stepBack()).toBe('ok');
      expect(log.stepBack()).toBe('ok');
      expect(state(rev)).toEqual(history[t - 1]);
      expect(state(log)).toEqual(history[t - 1]);
    }
    expect(rev.stepBack()).toBe('at_start');
    expect(log.historyBytes).toBe(0);
  });

  it.each(good)('%s: running the program as its own inverse returns to the start state', (f) => {
    for (const kind of ['reversible', 'logging'] as const) {
      const vm = load(kind, source(f));
      const start = state(vm);
      while (vm.stepForward() === 'ok');
      const end = state(vm);
      const tEnd = vm.instructionCount;
      expect(vm.setDirection(-1)).toBe('ok');
      while (vm.stepForward() === 'ok');
      expect(state(vm)).toEqual(start);
      // Time travel across the flip is still exact.
      expect(vm.runTo(tEnd)).toBe('ok');
      expect(state(vm)).toEqual(end);
    }
  });
});

describe('cipher', () => {
  it('encrypts in place and decrypts when inverted', () => {
    const vm = load('reversible', source('cipher.s'));
    const text = (m: Uint32Array) => String.fromCharCode(...m);
    expect(text(vm.memory(0, 8))).toBe('HELLO OX');
    while (vm.stepForward() === 'ok');
    expect(text(vm.memory(0, 8))).not.toBe('HELLO OX');
    vm.setDirection(-1);
    while (vm.stepForward() === 'ok');
    expect(text(vm.memory(0, 8))).toBe('HELLO OX');
  });
});

describe('oracle', () => {
  it('the logging VM faults on a wrong lnd that the reversible VM trusts', () => {
    const log = load('logging', source('bad-landing.s'));
    const rev = load('reversible', source('bad-landing.s'));
    // The xori falls through onto an lnd whose condition claims we jumped there.
    expect(log.stepForward()).toBe('fault');
    expect(log.lastError).toMatch(/oracle/);
    expect(log.instructionCount).toBe(0);
    expect(rev.stepForward()).toBe('ok');
    expect(rev.stepForward()).toBe('ok');
  });

  it('faults leave state unchanged', () => {
    const vm = load('reversible', '        .code\nstart:  xori r1, 0x3FFFF\n        roli r1, 12\n        xst r2, [r1+0]\n        hlt\n');
    vm.stepForward();
    vm.stepForward();
    const before = state(vm);
    expect(vm.stepForward()).toBe('fault');
    expect(vm.lastError).toMatch(/unmapped|read-only/);
    expect(state(vm)).toEqual(before);
  });
});

describe('assembler', () => {
  const errs = (src: string) => assemble(`        .code\nstart:  ${src}\n        hlt\n`).errors.map((e) => e.message).join(' | ');

  it('rejects equal registers where the op would not be reversible', () => {
    expect(errs('add r1, r1')).toMatch(/different registers/);
    expect(errs('xld r1, [r1+0]')).toMatch(/must differ/);
  });

  it('rejects a branch that does not land on an lnd', () => {
    expect(errs('br al, start')).toMatch(/lnd|entry/);
  });

  it('reports unknown instructions and symbols with line numbers', () => {
    const r = assemble('        .code\nstart:  mov r1, r2\n        xori r1, nope\n        hlt\n');
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('encodes the image header per program_format.md', () => {
    const r = assemble(source('multiply.s'));
    const dv = new DataView(r.image.buffer);
    expect(dv.getUint32(0, true)).toBe(0x314d5652);
    expect(dv.getUint32(12, true)).toBe(r.code.length);
  });
});

describe('api', () => {
  it('creates both kinds', () => {
    expect(createVm('logging')).toBeInstanceOf(LoggingVm);
    expect(createVm('reversible')).toBeInstanceOf(ReversibleVm);
  });
});
