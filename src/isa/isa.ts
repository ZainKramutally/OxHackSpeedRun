// Instruction encoding, decoding and human-readable descriptions (spec/SPEC.md sections 3-4).
import { COND, Op } from '../../spec/vm_api.ts';

export const MNEMONICS = [
  'nop', 'hlt', 'add', 'sub', 'addi', 'xor', 'xori', 'not', 'swap', 'roli',
  'xld', 'xst', 'cswap', 'toff', 'br', 'lnd', 'call', 'proc', 'ret',
] as const;

export interface Instr {
  word: number;
  op: number;
  ra: number;
  rb: number;
  rc: number;
  imm18: number;
  /** imm18 sign-extended. */
  simm: number;
  cc: number;
  target: number;
}

export function decode(word: number): Instr {
  const w = word >>> 0;
  const imm18 = w & 0x3ffff;
  return {
    word: w,
    op: w >>> 26,
    ra: (w >>> 22) & 15,
    rb: (w >>> 18) & 15,
    rc: (w >>> 14) & 15,
    imm18,
    simm: (imm18 << 14) >> 14,
    cc: (w >>> 16) & 3,
    target: w & 0xffff,
  };
}

export function encodeR(op: Op, ra: number, rb: number, imm18: number): number {
  return ((op << 26) | (ra << 22) | (rb << 18) | (imm18 & 0x3ffff)) >>> 0;
}

export function encode3(op: Op, ra: number, rb: number, rc: number): number {
  return ((op << 26) | (ra << 22) | (rb << 18) | (rc << 14)) >>> 0;
}

export function encodeB(op: Op, ra: number, rb: number, cc: number, target: number): number {
  return ((op << 26) | (ra << 22) | (rb << 18) | ((cc & 3) << 16) | (target & 0xffff)) >>> 0;
}

export const regName = (r: number) => `r${r}`;

export const hex = (v: number, digits = 8) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');

function signed(v: number) {
  return v < 0 ? `-${-v}` : `${v}`;
}

/** Disassemble one instruction. `label` maps a code address to a name when one is known. */
export function disassemble(I: Instr, label?: (addr: number) => string | undefined): string {
  const r = regName;
  const tgt = (a: number) => label?.(a) ?? hex(a, 4);
  const mem = () => `[${r(I.rb)}${I.simm >= 0 ? '+' : ''}${signed(I.simm)}]`;
  switch (I.op) {
    case Op.NOP: return 'nop';
    case Op.HLT: return 'hlt';
    case Op.ADD: case Op.SUB: case Op.XOR: case Op.SWAP:
      return `${MNEMONICS[I.op]} ${r(I.ra)}, ${r(I.rb)}`;
    case Op.ADDI: return `addi ${r(I.ra)}, ${signed(I.simm)}`;
    case Op.XORI: return `xori ${r(I.ra)}, ${hex(I.imm18, 1)}`;
    case Op.NOT: return `not ${r(I.ra)}`;
    case Op.ROLI: return `roli ${r(I.ra)}, ${I.imm18 & 31}`;
    case Op.XLD: return `xld ${r(I.ra)}, ${mem()}`;
    case Op.XST: return `xst ${r(I.ra)}, ${mem()}`;
    case Op.CSWAP: return `cswap ${r(I.rc)}, ${r(I.ra)}, ${r(I.rb)}`;
    case Op.TOFF: return `toff ${r(I.ra)}, ${r(I.rb)}, ${r(I.rc)}`;
    case Op.BR: case Op.LND:
      return I.cc === 0
        ? `${MNEMONICS[I.op]} al, ${tgt(I.target)}`
        : `${MNEMONICS[I.op]} ${COND[I.cc]}, ${r(I.ra)}, ${r(I.rb)}, ${tgt(I.target)}`;
    case Op.CALL: return `call ${tgt(I.target)}`;
    case Op.PROC: return `proc ${tgt(I.target)}`;
    case Op.RET: return 'ret';
    default: return `.word ${hex(I.word)}`;
  }
}

const CC_SYM = ['', '==', '≠', '<'];

/**
 * What the instruction does to the data, as shown in the ALU. `forward` false gives the inverse
 * (what step-back computes), per the Inverse column of SPEC section 4.
 */
export function effectText(I: Instr, forward: boolean): string {
  const a = regName(I.ra), b = regName(I.rb), c = regName(I.rc);
  const addr = `MEM[${b}${I.simm >= 0 ? '+' : ''}${signed(I.simm)}]`;
  switch (I.op) {
    case Op.NOP: case Op.PROC: return 'no-op';
    case Op.HLT: return 'halt';
    case Op.ADD: return forward ? `${a} ← ${a} + ${b}` : `${a} ← ${a} − ${b}`;
    case Op.SUB: return forward ? `${a} ← ${a} − ${b}` : `${a} ← ${a} + ${b}`;
    case Op.ADDI: {
      const s = forward ? I.simm : -I.simm;
      return `${a} ← ${a} ${s >= 0 ? '+' : '−'} ${Math.abs(s)}`;
    }
    case Op.XOR: return `${a} ← ${a} ⊕ ${b}`;
    case Op.XORI: return `${a} ← ${a} ⊕ ${hex(I.imm18, 1)}`;
    case Op.NOT: return `${a} ← ¬${a}`;
    case Op.SWAP: return `${a} ⇄ ${b}`;
    case Op.ROLI: {
      const k = I.imm18 & 31;
      return `${a} ← rotl(${a}, ${forward ? k : (32 - k) % 32})`;
    }
    case Op.XLD: return `${a} ← ${a} ⊕ ${addr}`;
    case Op.XST: return `${addr} ← ${addr} ⊕ ${a}`;
    case Op.CSWAP: return `if ${c}≠0: ${a} ⇄ ${b}`;
    case Op.TOFF: return `${a} ← ${a} ⊕ (${b} ∧ ${c})`;
    case Op.BR:
      return I.cc === 0 ? 'jump' : `branch if ${a} ${CC_SYM[I.cc]} ${b}`;
    case Op.LND:
      return forward ? 'landing (no-op)' : I.cc === 0 ? 'undo jump' : `came by jump iff ${a} ${CC_SYM[I.cc]} ${b}`;
    case Op.CALL: return forward ? 'push PC+1, jump' : 'pop return, back to call';
    case Op.RET: return forward ? 'pop PC, return' : 'push return, back to ret';
    default: return '?';
  }
}

/** Short symbol drawn inside the ALU. */
export function aluSymbol(I: Instr, forward: boolean): string {
  switch (I.op) {
    case Op.ADD: case Op.ADDI: return forward ? '+' : '−';
    case Op.SUB: return forward ? '−' : '+';
    case Op.XOR: case Op.XORI: case Op.XLD: case Op.XST: return '⊕';
    case Op.NOT: return '¬';
    case Op.SWAP: case Op.CSWAP: return '⇄';
    case Op.ROLI: return '⟲';
    case Op.TOFF: return '∧⊕';
    case Op.BR: case Op.LND: return '?';
    case Op.CALL: case Op.RET: return '↕';
    default: return '·';
  }
}

export interface RegUse {
  reads: number[];
  writes: number[];
  /** Instruction touches data memory; address register and offset (CALL/RET use the stack). */
  mem: { write: boolean } | null;
}

export function regUse(I: Instr): RegUse {
  switch (I.op) {
    case Op.ADD: case Op.SUB: case Op.XOR: return { reads: [I.ra, I.rb], writes: [I.ra], mem: null };
    case Op.ADDI: case Op.XORI: case Op.NOT: case Op.ROLI: return { reads: [I.ra], writes: [I.ra], mem: null };
    case Op.SWAP: return { reads: [I.ra, I.rb], writes: [I.ra, I.rb], mem: null };
    case Op.XLD: return { reads: [I.ra, I.rb], writes: [I.ra], mem: { write: false } };
    case Op.XST: return { reads: [I.ra, I.rb], writes: [], mem: { write: true } };
    case Op.CSWAP: return { reads: [I.rc, I.ra, I.rb], writes: [I.ra, I.rb], mem: null };
    case Op.TOFF: return { reads: [I.ra, I.rb, I.rc], writes: [I.ra], mem: null };
    case Op.BR: case Op.LND: return { reads: I.cc === 0 ? [] : [I.ra, I.rb], writes: [], mem: null };
    case Op.CALL: case Op.RET: return { reads: [14], writes: [14], mem: { write: true } };
    default: return { reads: [], writes: [], mem: null };
  }
}
