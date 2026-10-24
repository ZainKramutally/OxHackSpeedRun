// Assembler for spec/asm_syntax.md. Produces a .rvm image (spec/program_format.md) plus the
// source map and symbols the IDE needs. Enforces the operand and control-flow rules of SPEC section 4/6.
import { Op } from '../../spec/vm_api.ts';
import { decode, encode3, encodeB, encodeR } from '../isa/isa.ts';

export interface AsmError {
  /** 1-based source line. */
  line: number;
  message: string;
}

export interface AsmSymbol {
  name: string;
  value: number;
  kind: 'code' | 'data' | 'equ';
}

export interface AsmResult {
  ok: boolean;
  errors: AsmError[];
  code: Uint32Array;
  data: Uint32Array;
  entry: number;
  symbols: Map<string, AsmSymbol>;
  /** Code address -> 1-based source line. */
  addrToLine: number[];
  /** 1-based source line -> first code address on it. */
  lineToAddr: Map<number, number>;
  /** Code address -> label name (first label defined there). */
  codeLabels: Map<number, string>;
  image: Uint8Array;
}

const RVM_MAGIC = 0x314d5652;
const CODE_MAX = 65536;
const DATA_MAX = 65536;
const COND_NAMES = ['al', 'eq', 'ne', 'lt'];

type Section = 'code' | 'data';

interface Stmt {
  line: number;
  mnem: string;
  args: string[];
  addr: number;
}

class AsmFail extends Error {}

const fail = (msg: string): never => {
  throw new AsmFail(msg);
};

export function parseRegister(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (t === 'sp') return 14;
  const m = /^r(\d{1,2})$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 15 ? n : null;
}

function splitArgs(s: string): string[] {
  if (!s.trim()) return [];
  // Commas inside a char literal (',') must not split.
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && s[i + 2] === "'") {
      cur += s.slice(i, i + 3);
      i += 2;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Strip a `;` comment, ignoring semicolons inside char literals. */
function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "'" && line[i + 2] === "'") i += 2;
    else if (line[i] === ';') return line.slice(0, i);
  }
  return line;
}

export function assemble(source: string): AsmResult {
  const errors: AsmError[] = [];
  const symbols = new Map<string, AsmSymbol>();
  const codeLabels = new Map<number, string>();
  const codeStmts: Stmt[] = [];
  const dataStmts: Stmt[] = [];
  let entryName: { name: string; line: number } | null = null;
  let section: Section = 'code';
  let codePc = 0;
  let dataPc = 0;

  const lines = source.split(/\r?\n/);

  const evalExpr = (expr: string, allowForward = true): number => {
    const s = expr.trim();
    if (!s) fail('missing value');
    const tokens = s.match(/'.'|0x[0-9a-f_]+|0b[01_]+|\d[\d_]*|[A-Za-z_.$][\w.$]*|[+-]|\S/gi) ?? [];
    let i = 0;
    let total = 0;
    let sign = 1;
    let expectTerm = true;
    while (i < tokens.length) {
      const tok = tokens[i++];
      if (expectTerm) {
        if (tok === '+' || tok === '-') {
          if (tok === '-') sign = -sign;
          continue;
        }
        let v: number;
        if (/^'.'$/.test(tok)) v = tok.charCodeAt(1);
        else if (/^0x/i.test(tok)) v = parseInt(tok.slice(2).replace(/_/g, ''), 16);
        else if (/^0b/i.test(tok)) v = parseInt(tok.slice(2).replace(/_/g, ''), 2);
        else if (/^\d/.test(tok)) v = parseInt(tok.replace(/_/g, ''), 10);
        else if (/^[A-Za-z_.$]/.test(tok)) {
          if (parseRegister(tok) !== null) fail(`register '${tok}' where a value was expected`);
          const sym = symbols.get(tok);
          if (!sym) fail(allowForward ? `undefined symbol '${tok}'` : `'${tok}' must be defined before use here`);
          v = sym!.value;
        } else fail(`unexpected '${tok}'`);
        if (Number.isNaN(v!)) fail(`bad number '${tok}'`);
        total += sign * v!;
        sign = 1;
        expectTerm = false;
      } else {
        if (tok === '+') sign = 1;
        else if (tok === '-') sign = -1;
        else fail(`unexpected '${tok}' in expression`);
        expectTerm = true;
      }
    }
    if (expectTerm) fail('expression ends with an operator');
    return total;
  };

  const define = (name: string, value: number, kind: AsmSymbol['kind'], line: number) => {
    if (parseRegister(name) !== null) {
      errors.push({ line, message: `'${name}' is a register name and cannot be a label` });
      return;
    }
    if (symbols.has(name)) {
      errors.push({ line, message: `'${name}' is already defined` });
      return;
    }
    symbols.set(name, { name, value, kind });
    if (kind === 'code' && !codeLabels.has(value)) codeLabels.set(value, name);
  };

  // Pass 1: labels, sizes, directives.
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    try {
      let text = stripComment(raw).trim();
      const lab = /^([A-Za-z_.$][\w.$]*)\s*:/.exec(text);
      if (lab) {
        define(lab[1], section === 'code' ? codePc : dataPc, section, line);
        text = text.slice(lab[0].length).trim();
      }
      if (!text) return;
      const m = /^(\S+)\s*(.*)$/.exec(text)!;
      const mnem = m[1].toLowerCase();
      const args = splitArgs(m[2]);
      switch (mnem) {
        case '.code':
          section = 'code';
          return;
        case '.data':
          section = 'data';
          return;
        case '.equ': {
          if (args.length !== 2) fail('.equ needs NAME, value');
          define(args[0], evalExpr(args[1], false), 'equ', line);
          return;
        }
        case '.entry':
          if (args.length !== 1) fail('.entry needs a label');
          entryName = { name: args[0], line };
          return;
        case '.word':
        case '.space': {
          if (section !== 'data') fail(`${mnem} is only allowed in the .data section`);
          const size = mnem === '.word' ? args.length : evalExpr(args[0] ?? '', false);
          if (mnem === '.word' && size === 0) fail('.word needs at least one value');
          if (size < 0) fail('.space size must be positive');
          dataStmts.push({ line, mnem, args, addr: dataPc });
          dataPc += size;
          return;
        }
      }
      if (mnem.startsWith('.')) fail(`unknown directive '${mnem}'`);
      if (section !== 'code') fail('instructions belong in the .code section');
      codeStmts.push({ line, mnem, args, addr: codePc });
      codePc += mnem === 'neg' ? 2 : 1;
    } catch (e) {
      if (e instanceof AsmFail) errors.push({ line, message: e.message });
      else throw e;
    }
  });

  if (codePc > CODE_MAX) errors.push({ line: 1, message: `code is ${codePc} words; the limit is ${CODE_MAX}` });
  if (dataPc > DATA_MAX) errors.push({ line: 1, message: `data is ${dataPc} words; the limit is ${DATA_MAX}` });

  const code = new Uint32Array(Math.min(codePc, CODE_MAX));
  const data = new Uint32Array(Math.min(dataPc, DATA_MAX));
  const addrToLine: number[] = new Array(code.length).fill(0);
  const lineToAddr = new Map<number, number>();

  // Pass 2: data.
  for (const st of dataStmts) {
    try {
      if (st.mnem === '.word') {
        st.args.forEach((a, i) => {
          if (st.addr + i < data.length) data[st.addr + i] = evalExpr(a) >>> 0;
        });
      }
    } catch (e) {
      if (e instanceof AsmFail) errors.push({ line: st.line, message: e.message });
      else throw e;
    }
  }

  // Pass 2: code.
  const reg = (s: string | undefined) => {
    const r = s === undefined ? null : parseRegister(s);
    if (r === null) fail(`expected a register (r0-r15 or sp), got '${s ?? ''}'`);
    return r!;
  };
  const imm = (s: string | undefined, lo: number, hi: number, what: string) => {
    const v = evalExpr(s ?? '');
    if (v < lo || v > hi) fail(`${what} ${v} is out of range ${lo}..${hi}`);
    return v;
  };
  const sext18 = (s: string | undefined) => imm(s, -131072, 131071, 'immediate');
  const codeAddr = (s: string | undefined) => imm(s, 0, CODE_MAX - 1, 'code address');
  const cond = (s: string | undefined) => {
    const i = COND_NAMES.indexOf((s ?? '').trim().toLowerCase());
    if (i < 0) fail(`expected a condition (al, eq, ne, lt), got '${s ?? ''}'`);
    return i;
  };
  const memOperand = (s: string | undefined) => {
    const m = /^\[\s*([A-Za-z]\w*)\s*(?:([+-])\s*(.+?))?\s*\]$/.exec((s ?? '').trim());
    if (!m) fail(`expected a memory operand like [r1+4], got '${s ?? ''}'`);
    const rb = reg(m![1]);
    let off = 0;
    if (m![3] !== undefined) off = evalExpr(m![3]) * (m![2] === '-' ? -1 : 1);
    if (off < -131072 || off > 131071) fail(`offset ${off} is out of range -131072..131071`);
    return { rb, off };
  };
  const nargs = (st: Stmt, ...counts: number[]) => {
    if (!counts.includes(st.args.length)) {
      fail(`'${st.mnem}' takes ${counts.join(' or ')} operand${counts.length === 1 && counts[0] === 1 ? '' : 's'}, got ${st.args.length}`);
    }
  };
  const distinct = (st: Stmt, msg: string, ...rs: number[]) => {
    if (new Set(rs).size !== rs.length) fail(`${st.mnem}: ${msg} (an equal pair would not be reversible)`);
  };

  const encodeOne = (st: Stmt): number[] => {
    const a = st.args;
    switch (st.mnem) {
      case 'nop': nargs(st, 0); return [encodeR(Op.NOP, 0, 0, 0)];
      case 'hlt': nargs(st, 0); return [encodeR(Op.HLT, 0, 0, 0)];
      case 'ret': nargs(st, 0); return [encodeR(Op.RET, 0, 0, 0)];
      case 'add': case 'sub': case 'xor': case 'swap': {
        nargs(st, 2);
        const ra = reg(a[0]), rb = reg(a[1]);
        if (st.mnem !== 'swap') distinct(st, 'operands must be different registers', ra, rb);
        const op = { add: Op.ADD, sub: Op.SUB, xor: Op.XOR, swap: Op.SWAP }[st.mnem];
        return [encodeR(op, ra, rb, 0)];
      }
      case 'addi': nargs(st, 2); return [encodeR(Op.ADDI, reg(a[0]), 0, sext18(a[1]))];
      case 'subi': {
        nargs(st, 2);
        const v = evalExpr(a[1]);
        if (-v < -131072 || -v > 131071) fail(`immediate ${v} is out of range for subi`);
        return [encodeR(Op.ADDI, reg(a[0]), 0, -v)];
      }
      case 'xori': nargs(st, 2); return [encodeR(Op.XORI, reg(a[0]), 0, imm(a[1], 0, 0x3ffff, 'xori immediate (zero-extended)'))];
      case 'roli': nargs(st, 2); return [encodeR(Op.ROLI, reg(a[0]), 0, imm(a[1], 0, 31, 'rotate amount'))];
      case 'not': nargs(st, 1); return [encodeR(Op.NOT, reg(a[0]), 0, 0)];
      case 'neg': {
        nargs(st, 1);
        const ra = reg(a[0]);
        return [encodeR(Op.NOT, ra, 0, 0), encodeR(Op.ADDI, ra, 0, 1)];
      }
      case 'xld': case 'xst': {
        nargs(st, 2);
        const ra = reg(a[0]);
        const { rb, off } = memOperand(a[1]);
        if (st.mnem === 'xld') distinct(st, 'destination and base register must differ', ra, rb);
        return [encodeR(st.mnem === 'xld' ? Op.XLD : Op.XST, ra, rb, off)];
      }
      case 'cswap': {
        nargs(st, 3);
        const rc = reg(a[0]), ra = reg(a[1]), rb = reg(a[2]);
        if (rc === ra || rc === rb) fail('cswap: control register must differ from the swapped registers');
        return [encode3(Op.CSWAP, ra, rb, rc)];
      }
      case 'toff': {
        nargs(st, 3);
        const ra = reg(a[0]), rb = reg(a[1]), rc = reg(a[2]);
        if (ra === rb || ra === rc) fail('toff: target register must differ from both controls');
        return [encode3(Op.TOFF, ra, rb, rc)];
      }
      case 'br': case 'lnd': {
        nargs(st, 2, 4);
        const cc = cond(a[0]);
        const op = st.mnem === 'br' ? Op.BR : Op.LND;
        if (a.length === 2) {
          if (cc !== 0) fail(`'${st.mnem} ${a[0]}' needs two registers: ${st.mnem} ${a[0]}, ra, rb, label`);
          return [encodeB(op, 0, 0, 0, codeAddr(a[1]))];
        }
        return [encodeB(op, reg(a[1]), reg(a[2]), cc, codeAddr(a[3]))];
      }
      case 'call': nargs(st, 1); return [encodeB(Op.CALL, 0, 0, 0, codeAddr(a[0]))];
      case 'proc': nargs(st, 1); return [encodeB(Op.PROC, 0, 0, 0, codeAddr(a[0]))];
      default:
        return fail(`unknown instruction '${st.mnem}'`);
    }
  };

  for (const st of codeStmts) {
    try {
      const words = encodeOne(st);
      words.forEach((w, i) => {
        if (st.addr + i < code.length) {
          code[st.addr + i] = w;
          addrToLine[st.addr + i] = st.line;
        }
      });
      if (!lineToAddr.has(st.line)) lineToAddr.set(st.line, st.addr);
    } catch (e) {
      if (e instanceof AsmFail) errors.push({ line: st.line, message: e.message });
      else throw e;
    }
  }

  // Entry point.
  let entry = 0;
  const entryLabel: { name: string; line: number } | null = entryName ?? (symbols.has('start') ? { name: 'start', line: 1 } : null);
  if (entryLabel) {
    const sym = symbols.get(entryLabel.name);
    if (!sym || sym.kind !== 'code') errors.push({ line: entryLabel.line, message: `entry '${entryLabel.name}' is not a code label` });
    else entry = sym.value;
  }
  if (code.length === 0) errors.push({ line: 1, message: 'no instructions: add a .code section with a start: label' });
  else if (entry >= code.length) errors.push({ line: entryLabel?.line ?? 1, message: 'entry point is past the end of the code' });

  // Control-flow rules (SPEC section 6). Only meaningful if every instruction encoded.
  if (errors.length === 0) checkControlFlow(code, entry, addrToLine, errors);

  errors.sort((x, y) => x.line - y.line);
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    code,
    data,
    entry,
    symbols,
    addrToLine,
    lineToAddr,
    codeLabels,
    image: ok ? buildImage(code, data, entry, symbols) : new Uint8Array(0),
  };
}

function checkControlFlow(code: Uint32Array, entry: number, addrToLine: number[], errors: AsmError[]) {
  const at = (a: number) => (a < code.length ? decode(code[a]) : null);
  const err = (a: number, message: string) => errors.push({ line: addrToLine[a] || 1, message });
  for (let a = 0; a < code.length; a++) {
    const I = decode(code[a]);
    if (I.op > Op.RET) err(a, 'undefined opcode');
    if (I.op === Op.BR) {
      const T = at(I.target);
      if (!T || T.op !== Op.LND) err(a, 'br target must be an lnd (every jump lands on an lnd that names this br)');
      else if (T.target !== a) err(a, 'the lnd at this br\'s target names a different br; each br needs its own lnd');
      if (I.target === entry) err(a, 'the entry point must not be a jump target');
    }
    if (I.op === Op.LND) {
      const S = at(I.target);
      if (!S || S.op !== Op.BR || S.target !== a) err(a, 'lnd must name the br that jumps to it');
    }
    if (I.op === Op.CALL) {
      const T = at(I.target);
      if (!T || T.op !== Op.PROC) err(a, 'call target must be a proc');
      if (I.target === entry) err(a, 'the entry point must not be a call target');
    }
    if (I.op === Op.PROC) {
      const E = at(I.target);
      if (!E || E.op !== Op.RET) err(a, 'proc must name the address of its matching ret');
    }
    const noFallThrough = I.op === Op.RET || I.op === Op.HLT || (I.op === Op.BR && I.cc === 0);
    if (noFallThrough && a + 1 < code.length) {
      const N = decode(code[a + 1]);
      if (N.op !== Op.LND && N.op !== Op.PROC) {
        err(a + 1, `this instruction is unreachable: after ${['ret', 'hlt', 'br al'][I.op === Op.RET ? 0 : I.op === Op.HLT ? 1 : 2]} the next instruction must be an lnd or proc`);
      }
    }
  }
}

function buildImage(code: Uint32Array, data: Uint32Array, entry: number, symbols: Map<string, AsmSymbol>): Uint8Array {
  const enc = new TextEncoder();
  const syms: { addr: number; kind: number; name: Uint8Array }[] = [];
  for (const s of symbols.values()) {
    if (s.kind === 'equ') continue;
    syms.push({ addr: s.value, kind: s.kind === 'code' ? 0 : 1, name: enc.encode(s.name).slice(0, 255) });
  }
  const symLen = syms.reduce((n, s) => n + 6 + s.name.length, 0);
  const bytes = new Uint8Array(32 + 4 * (code.length + data.length) + symLen);
  const dv = new DataView(bytes.buffer);
  const header = [RVM_MAGIC, 1, entry, code.length, data.length, symLen, 0, 0];
  header.forEach((v, i) => dv.setUint32(i * 4, v, true));
  let off = 32;
  for (const w of code) { dv.setUint32(off, w, true); off += 4; }
  for (const w of data) { dv.setUint32(off, w, true); off += 4; }
  for (const s of syms) {
    dv.setUint32(off, s.addr, true);
    dv.setUint8(off + 4, s.kind);
    dv.setUint8(off + 5, s.name.length);
    bytes.set(s.name, off + 6);
    off += 6 + s.name.length;
  }
  return bytes;
}
