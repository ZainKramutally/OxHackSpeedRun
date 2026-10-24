// The two engines behind spec/vm_api.ts:
// - ReversibleVm steps back by computing inverses (SPEC section 6); it keeps no per-step history.
// - LoggingVm records a delta per step and restores it to step back. It is the correctness oracle:
//   it also asserts the BR/LND control-flow rules that the reversible VM has to trust.
import {
  FB_BASE, FB_WORDS, Op,
  type CreateVm, type Direction, type Registers, type RVM, type Status, type VmKind,
} from '../../spec/vm_api.ts';
import { decode } from '../isa/isa.ts';
import { Core, MachineState, cond, type InputEvent, type StepResult } from './core.ts';

const RVM_MAGIC = 0x314d5652; // "RVM1"
const TAPE_MAGIC = 0x544d5652; // "RVMT"

export interface ParsedImage {
  code: Uint32Array;
  data: Uint32Array;
  entry: number;
}

/** Parse and validate a .rvm image (spec/program_format.md). */
export function parseImage(image: Uint8Array): ParsedImage | { error: string } {
  if (image.byteLength < 32) return { error: 'image is shorter than the 32-byte header' };
  const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const u = (i: number) => dv.getUint32(i * 4, true);
  if (u(0) !== RVM_MAGIC) return { error: 'bad magic (expected RVM1)' };
  if (u(1) !== 1) return { error: `unsupported version ${u(1)}` };
  const entry = u(2), codeLen = u(3), dataLen = u(4), symLen = u(5);
  if (codeLen > 65536 || dataLen > 65536) return { error: 'code or data section too large' };
  if (32 + 4 * (codeLen + dataLen) + symLen > image.byteLength) return { error: 'sections run past the end of the file' };
  if (entry >= codeLen) return { error: 'entry point is outside the code' };
  const code = new Uint32Array(codeLen);
  const data = new Uint32Array(dataLen);
  for (let i = 0; i < codeLen; i++) {
    code[i] = u(8 + i);
    if (code[i] >>> 26 > Op.RET) return { error: `undefined opcode at ${i}` };
  }
  for (let i = 0; i < dataLen; i++) data[i] = u(8 + codeLen + i);
  return { code, data, entry };
}

abstract class BaseVm implements RVM {
  abstract readonly kind: VmKind;
  lastError = '';
  protected readonly s = new MachineState();
  protected readonly core = new Core(this.s);
  protected t = 0;
  protected flips: { t: number; d: Direction }[] = [];
  protected loaded = false;

  get instructionCount() {
    return this.t;
  }
  get direction(): Direction {
    return this.dirAt(this.t);
  }
  abstract get historyBytes(): number;

  /** Direction used by the step that starts at time t. */
  protected dirAt(t: number): Direction {
    let d: Direction = 1;
    for (const f of this.flips) if (f.t <= t) d = f.d;
    return d;
  }

  protected abstract onReset(): void;
  /** Program-forward step with d = +1. */
  protected abstract fwd(win: number): StepResult;
  /** Program-forward step with d = -1 (the program run as its own inverse). */
  protected abstract fwdInverted(win: number): StepResult;
  /** Undo the step from t-1 to t, which ran with direction dPrev. */
  protected abstract undo(dPrev: Direction, win: number): StepResult;

  loadProgram(image: Uint8Array): Status {
    const p = parseImage(image);
    if ('error' in p) {
      this.lastError = p.error;
      return 'bad_program';
    }
    this.s.reset(p.code, p.data, p.entry);
    this.s.events = [];
    this.t = 0;
    this.flips = [];
    this.loaded = true;
    this.lastError = '';
    this.onReset();
    return 'ok';
  }

  setInputTape(tape: Uint8Array): Status {
    const dv = new DataView(tape.buffer, tape.byteOffset, tape.byteLength);
    if (tape.byteLength < 8 || dv.getUint32(0, true) !== TAPE_MAGIC) {
      this.lastError = 'bad tape (expected RVMT header)';
      return 'bad_arg';
    }
    const n = dv.getUint32(4, true);
    if (8 + 8 * n > tape.byteLength) {
      this.lastError = 'tape is truncated';
      return 'bad_arg';
    }
    const events: InputEvent[] = [];
    for (let k = 0; k < n; k++) events.push({ t: dv.getUint32(8 + 8 * k, true), value: dv.getUint32(12 + 8 * k, true) });
    this.s.events = events;
    return 'ok';
  }

  /** A host action at time t starts a new branch: later flips and input events are dropped. */
  private branch() {
    this.flips = this.flips.filter((f) => f.t < this.t);
    this.s.events = this.s.events.filter((e) => e.t <= this.t);
  }

  pushInput(value: number): Status {
    if (!this.loaded) return this.noProgram();
    this.branch();
    this.s.events.push({ t: this.t, value: value >>> 0 });
    return 'ok';
  }

  setDirection(d: Direction): Status {
    if (!this.loaded) return this.noProgram();
    if (d !== 1 && d !== -1) {
      this.lastError = 'direction must be 1 or -1';
      return 'bad_arg';
    }
    this.branch();
    if (this.dirAt(this.t) !== d) this.flips.push({ t: this.t, d });
    return 'ok';
  }

  stepForward(): Status {
    if (!this.loaded) return this.noProgram();
    if (this.dirAt(this.t) === 1) return this.finish(this.fwd(this.t), 1);
    if (this.s.pc === this.s.entry) return 'halted';
    return this.finish(this.fwdInverted(this.t), 1);
  }

  stepBack(): Status {
    if (!this.loaded) return this.noProgram();
    if (this.t === 0) return 'at_start';
    return this.finish(this.undo(this.dirAt(this.t - 1), this.t - 1), -1);
  }

  runTo(n: number): Status {
    if (!this.loaded) return this.noProgram();
    let st: Status = 'ok';
    while (this.t < n && st === 'ok') st = this.stepForward();
    while (this.t > n && st === 'ok') st = this.stepBack();
    return st;
  }

  registers(): Registers {
    return { regs: this.s.regs.slice(), pc: this.s.pc };
  }

  memory(addr: number, nwords: number): Uint32Array {
    const out = new Uint32Array(Math.max(0, nwords));
    for (let i = 0; i < out.length; i++) out[i] = this.s.read((addr + i) >>> 0, this.t) ?? 0;
    return out;
  }

  code(addr: number, nwords: number): Uint32Array {
    return this.s.code.slice(addr, addr + nwords);
  }

  framebuffer(): Uint32Array {
    return this.memory(FB_BASE, FB_WORDS);
  }

  private noProgram(): Status {
    this.lastError = 'no program loaded';
    return 'bad_arg';
  }

  private finish(r: StepResult, dt: 1 | -1): Status {
    if (r === 'ok') {
      this.t += dt;
      this.lastError = '';
      return 'ok';
    }
    if (r === 'halted') return 'halted';
    this.lastError = r.fault;
    return 'fault';
  }
}

export class ReversibleVm extends BaseVm {
  readonly kind = 'reversible' as const;

  get historyBytes() {
    return 8 * this.flips.length;
  }
  protected onReset() {}
  protected fwd(win: number) {
    return this.core.forward(win);
  }
  protected fwdInverted(win: number) {
    return this.core.backward(win);
  }
  protected undo(dPrev: Direction, win: number): StepResult {
    if (dPrev === 1) return this.core.backward(win);
    const r = this.core.forward(win);
    return r === 'halted' ? { fault: 'undo reached a hlt' } : r;
  }
}

interface Delta {
  pc: number;
  /** Pairs of (register index, old value). */
  regs: number[];
  /** Pairs of (address, old value). */
  mem: number[];
}

/** Bytes one delta would occupy in a compact log: old PC + 5 per register + 8 per memory word. */
const deltaBytes = (d: Delta) => 4 + (d.regs.length / 2) * 5 + (d.mem.length / 2) * 8;

export class LoggingVm extends BaseVm {
  readonly kind = 'logging' as const;
  private log: Delta[] = [];
  private bytes = 0;

  get historyBytes() {
    return this.bytes + 8 * this.flips.length;
  }
  protected onReset() {
    this.log = [];
    this.bytes = 0;
  }

  private record(step: () => StepResult, checkRules: boolean): StepResult {
    const d: Delta = { pc: this.s.pc, regs: [], mem: [] };
    this.core.rec = {
      reg: (i, old) => d.regs.push(i, old),
      mem: (a, old) => d.mem.push(a, old),
    };
    let r: StepResult;
    try {
      r = step();
    } finally {
      this.core.rec = null;
    }
    if (r === 'ok' && checkRules) {
      const err = this.checkArrival(d.pc);
      if (err) {
        this.restore(d);
        r = { fault: err };
      }
    }
    if (r === 'ok') {
      this.log.push(d);
      this.bytes += deltaBytes(d);
    }
    return r;
  }

  /** SPEC section 6 rules 1-2: jumps land on an LND, and an LND's condition matches how we arrived. */
  private checkArrival(from: number): string | null {
    const s = this.s;
    const to = s.pc;
    const B = decode(s.code[from]);
    const jumped = B.op === Op.BR && cond(s, B);
    const L = to < s.code.length ? decode(s.code[to]) : null;
    const hex = (a: number) => '0x' + a.toString(16).toUpperCase().padStart(4, '0');
    if (jumped && (!L || L.op !== Op.LND)) return `oracle: br at ${hex(from)} jumped to ${hex(to)}, which is not an lnd`;
    if (L && L.op === Op.LND) {
      const fromS = jumped && from === L.target;
      if (cond(s, L) !== fromS) {
        return fromS
          ? `oracle: lnd at ${hex(to)} says we did not jump here, but we came from the br at ${hex(from)}`
          : `oracle: lnd at ${hex(to)} says we jumped from ${hex(L.target)}, but we arrived from ${hex(from)}`;
      }
    }
    return null;
  }

  private restore(d: Delta) {
    for (let i = d.mem.length - 2; i >= 0; i -= 2) {
      const loc = this.s.rw(d.mem[i]);
      if (loc) loc[0][loc[1]] = d.mem[i + 1];
    }
    for (let i = d.regs.length - 2; i >= 0; i -= 2) this.s.regs[d.regs[i]] = d.regs[i + 1];
    this.s.pc = d.pc;
  }

  protected fwd(win: number) {
    return this.record(() => this.core.forward(win), true);
  }
  protected fwdInverted(win: number) {
    return this.record(() => this.core.backward(win), false);
  }
  protected undo(): StepResult {
    const d = this.log.pop();
    if (!d) return { fault: 'history log is empty' };
    this.restore(d);
    this.bytes -= deltaBytes(d);
    return 'ok';
  }
}

export const createVm: CreateVm = (kind: VmKind) => (kind === 'logging' ? new LoggingVm() : new ReversibleVm());
