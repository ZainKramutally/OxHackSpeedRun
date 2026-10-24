// Machine state and the reference semantics of SPEC section 6 (forward and its exact inverse).
// Every check happens before any write, so a fault leaves state unchanged.
import { FB_BASE, FB_WORDS, IN_BASE, Op, SP_REG, STACK_BASE } from '../../spec/vm_api.ts';
import { decode, type Instr } from '../isa/isa.ts';

export const STACK_WORDS = 0x10000;
export const DATA_WORDS = 0x10000;
export const IN_WORDS = 0x10000;

export type StepResult = 'ok' | 'halted' | { fault: string };

/** Receives the old value of everything a step overwrites (used by the logging VM). */
export interface Recorder {
  reg(i: number, old: number): void;
  mem(addr: number, old: number): void;
}

export interface InputEvent {
  t: number;
  value: number;
}

export class MachineState {
  regs = new Uint32Array(16);
  pc = 0;
  entry = 0;
  code: Uint32Array = new Uint32Array(0);
  data = new Uint32Array(DATA_WORDS);
  stack = new Uint32Array(STACK_WORDS);
  fb = new Uint32Array(FB_WORDS);
  events: InputEvent[] = [];

  reset(code: Uint32Array, data: Uint32Array, entry: number) {
    this.code = code;
    this.entry = entry;
    this.pc = entry;
    this.regs.fill(0);
    this.regs[SP_REG] = STACK_BASE;
    this.data.fill(0);
    this.data.set(data.subarray(0, DATA_WORDS));
    this.stack.fill(0);
    this.fb.fill(0);
  }

  /** The RW array and index backing a data-space address, or null if not RW. */
  rw(addr: number): [Uint32Array, number] | null {
    if (addr < STACK_BASE) return [this.data, addr];
    if (addr < STACK_BASE + STACK_WORDS) return [this.stack, addr - STACK_BASE];
    if (addr >= FB_BASE && addr < FB_BASE + FB_WORDS) return [this.fb, addr - FB_BASE];
    return null;
  }

  /** Read any mapped word; the input window is computed for machine time `win`. Null = unmapped. */
  read(addr: number, win: number): number | null {
    const loc = this.rw(addr);
    if (loc) return loc[0][loc[1]];
    if (addr >= IN_BASE && addr < IN_BASE + IN_WORDS) {
      const off = addr - IN_BASE;
      if (off === 0) return win >>> 0;
      let count = 0;
      while (count < this.events.length && this.events[count].t <= win) count++;
      if (off === 1) return count;
      const k = off - 2;
      return k < count ? this.events[k].value >>> 0 : 0;
    }
    return null;
  }
}

const rotl = (v: number, k: number) => (k === 0 ? v >>> 0 : ((v << k) | (v >>> (32 - k))) >>> 0);

export function cond(s: MachineState, I: Instr): boolean {
  const a = s.regs[I.ra], b = s.regs[I.rb];
  switch (I.cc) {
    case 0: return true;
    case 1: return a === b;
    case 2: return a !== b;
    default: return (a | 0) < (b | 0);
  }
}

const fault = (msg: string): StepResult => ({ fault: msg });
const hex = (v: number) => '0x' + (v >>> 0).toString(16).toUpperCase();

export class Core {
  rec: Recorder | null = null;

  constructor(readonly s: MachineState) {}

  private setReg(i: number, v: number) {
    this.rec?.reg(i, this.s.regs[i]);
    this.s.regs[i] = v >>> 0;
  }

  private setMem(loc: [Uint32Array, number], addr: number, v: number) {
    this.rec?.mem(addr, loc[0][loc[1]]);
    loc[0][loc[1]] = v >>> 0;
  }

  private fetch(pc: number): Instr | null {
    return pc < this.s.code.length ? decode(this.s.code[pc]) : null;
  }

  /**
   * Apply the data effect of a self-inverse or invertible data op. `inverse` selects the Inverse
   * column. Returns null on success or a fault message. Does not touch the PC.
   */
  private dataOp(I: Instr, inverse: boolean, win: number): string | null {
    const R = this.s.regs;
    switch (I.op) {
      case Op.NOP: case Op.PROC: case Op.LND: case Op.BR:
        return null;
      case Op.ADD: case Op.SUB: {
        if (I.ra === I.rb) return `${I.op === Op.ADD ? 'add' : 'sub'} with equal registers is not reversible`;
        const plus = (I.op === Op.ADD) !== inverse;
        this.setReg(I.ra, plus ? R[I.ra] + R[I.rb] : R[I.ra] - R[I.rb]);
        return null;
      }
      case Op.ADDI:
        this.setReg(I.ra, inverse ? R[I.ra] - I.simm : R[I.ra] + I.simm);
        return null;
      case Op.XOR:
        if (I.ra === I.rb) return 'xor with equal registers is not reversible';
        this.setReg(I.ra, R[I.ra] ^ R[I.rb]);
        return null;
      case Op.XORI:
        this.setReg(I.ra, R[I.ra] ^ I.imm18);
        return null;
      case Op.NOT:
        this.setReg(I.ra, ~R[I.ra]);
        return null;
      case Op.SWAP: {
        const a = R[I.ra], b = R[I.rb];
        this.setReg(I.ra, b);
        this.setReg(I.rb, a);
        return null;
      }
      case Op.ROLI: {
        const k = I.imm18 & 31;
        this.setReg(I.ra, rotl(R[I.ra], inverse ? (32 - k) % 32 : k));
        return null;
      }
      case Op.XLD: {
        if (I.ra === I.rb) return 'xld with equal registers is not reversible';
        const addr = (R[I.rb] + I.simm) >>> 0;
        const v = this.s.read(addr, win);
        if (v === null) return `xld from unmapped address ${hex(addr)}`;
        this.setReg(I.ra, R[I.ra] ^ v);
        return null;
      }
      case Op.XST: {
        const addr = (R[I.rb] + I.simm) >>> 0;
        const loc = this.s.rw(addr);
        if (!loc) return `xst to ${this.s.read(addr, win) === null ? 'unmapped' : 'read-only'} address ${hex(addr)}`;
        this.setMem(loc, addr, loc[0][loc[1]] ^ R[I.ra]);
        return null;
      }
      case Op.CSWAP: {
        if (I.rc === I.ra || I.rc === I.rb) return 'cswap control register overlaps a swapped register';
        if (R[I.rc] !== 0) {
          const a = R[I.ra], b = R[I.rb];
          this.setReg(I.ra, b);
          this.setReg(I.rb, a);
        }
        return null;
      }
      case Op.TOFF:
        if (I.ra === I.rb || I.ra === I.rc) return 'toff target overlaps a control register';
        this.setReg(I.ra, R[I.ra] ^ (R[I.rb] & R[I.rc]));
        return null;
      default:
        return `cannot execute opcode ${I.op} as data op`;
    }
  }

  /** One step with d = +1. */
  forward(win: number): StepResult {
    const s = this.s, R = s.regs;
    const pc = s.pc;
    const I = this.fetch(pc);
    if (!I) return fault(`PC ${hex(pc)} is outside the code`);
    switch (I.op) {
      case Op.HLT:
        return 'halted';
      case Op.BR:
        s.pc = cond(s, I) ? I.target : pc + 1;
        return 'ok';
      case Op.CALL: {
        const T = this.fetch(I.target);
        if (!T || T.op !== Op.PROC) return fault(`call target ${hex(I.target)} is not a proc`);
        const loc = s.rw(R[SP_REG]);
        if (!loc) return fault(`stack pointer ${hex(R[SP_REG])} is not writable`);
        this.setMem(loc, R[SP_REG], loc[0][loc[1]] ^ (pc + 1));
        this.setReg(SP_REG, R[SP_REG] + 1);
        s.pc = I.target;
        return 'ok';
      }
      case Op.RET: {
        const addr = (R[SP_REG] - 1) >>> 0;
        const loc = s.rw(addr);
        if (!loc) return fault(`ret: stack address ${hex(addr)} is not writable`);
        const v = loc[0][loc[1]];
        this.setMem(loc, addr, 0);
        this.setReg(SP_REG, addr);
        s.pc = v;
        return 'ok';
      }
      default: {
        const err = I.op > Op.RET ? `undefined opcode ${I.op}` : this.dataOp(I, false, win);
        if (err) return fault(err);
        s.pc = pc + 1;
        return 'ok';
      }
    }
  }

  /** Exact inverse of `forward` (SPEC section 6 `backward`, minus the t == 0 check). */
  backward(win: number): StepResult {
    const s = this.s, R = s.regs;
    const q = s.pc;
    const I = this.fetch(q);
    if (!I) return fault(`PC ${hex(q)} is outside the code`);
    if (I.op === Op.LND && cond(s, I)) {
      s.pc = I.target;
      return 'ok';
    }
    if (I.op === Op.PROC) {
      const addr = (R[SP_REG] - 1) >>> 0;
      const loc = s.rw(addr);
      if (!loc) return fault(`undo call: stack address ${hex(addr)} is not writable`);
      const ret = loc[0][loc[1]];
      this.setMem(loc, addr, 0);
      this.setReg(SP_REG, addr);
      s.pc = ret - 1;
      return 'ok';
    }
    if (q === 0) return fault('no instruction before address 0 to undo');
    const J = decode(s.code[q - 1]);
    if (J.op === Op.CALL) {
      const P = this.fetch(J.target);
      if (!P || P.op !== Op.PROC) return fault(`undo ret: ${hex(J.target)} is not a proc`);
      const loc = s.rw(R[SP_REG]);
      if (!loc) return fault(`undo ret: stack pointer ${hex(R[SP_REG])} is not writable`);
      this.setMem(loc, R[SP_REG], loc[0][loc[1]] ^ q);
      this.setReg(SP_REG, R[SP_REG] + 1);
      s.pc = P.target;
      return 'ok';
    }
    if (J.op === Op.HLT || J.op === Op.RET || J.op > Op.RET) {
      return fault(`cannot reach ${hex(q)} by falling through the instruction before it`);
    }
    const err = this.dataOp(J, true, win);
    if (err) return fault(err);
    s.pc = q - 1;
    return 'ok';
  }
}
