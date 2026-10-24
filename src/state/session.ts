// A debugging session: one program loaded into one or more VMs that step in lockstep.
// The IDE uses one VM (the engine the user picked); the Comparison tab runs the classic logging VM
// and the reversible VM side by side and checks they agree.
import { Op, SP_REG, type Direction, type RVM, type Status, type VmKind } from '../../spec/vm_api.ts';
import type { AsmResult } from '../asm/assembler.ts';
import { aluSymbol, decode, disassemble, effectText, regUse } from '../isa/isa.ts';
import { createVm } from '../vm/vms.ts';

export interface CodeLine {
  addr: number;
  line: number;
  text: string;
  label?: string;
}

export interface Program {
  fileId: string;
  name: string;
  source: string;
  asm: AsmResult;
  code: CodeLine[];
}

export interface Activity {
  addr: number;
  instr: string;
  text: string;
  inverse: string;
  alu: string;
  aluInverse: string;
  reads: number[];
  writes: number[];
  mem: { addr: number; write: boolean } | null;
}

export interface ShownStep {
  activity: Activity;
  /** The step ran an instruction's inverse (stepping back, or the program running inverted). */
  inverse: boolean;
  seq: number;
}

export interface SessionHost {
  emit(): void;
  log(level: 'info' | 'warn' | 'error', text: string): void;
  stepsPerSecond(): number;
  breakpointAddrs(): Set<number>;
}

/** Steps per second for each speed setting. Tokens animate on the slower ones only. */
export const SPEEDS = [1, 3, 8, 30, 200, 2000] as const;
const ANIMATE_MAX_SPS = 8;
const TURBO_SLICE_MS = 12;

export function buildProgram(fileId: string, name: string, source: string, asm: AsmResult): Program {
  const label = (a: number) => asm.codeLabels.get(a);
  const code: CodeLine[] = Array.from(asm.code, (w, addr) => ({
    addr,
    line: asm.addrToLine[addr],
    text: disassemble(decode(w), label),
    label: label(addr),
  }));
  return { fileId, name, source, asm, code };
}

export class Session {
  vms: RVM[] = [];
  program: Program | null = null;
  /** Furthest t reached on the current timeline branch. */
  horizon = 0;
  flips: { t: number; d: Direction }[] = [];
  running: null | 'fwd' | 'back' = null;
  turbo = false;
  shown: (ShownStep | null)[] = [];
  changedRegs: Set<number>[] = [];
  lastStatus: (Status | null)[] = [];
  historyPeak: number[] = [];
  followMem: number | null = null;
  /** Comparison only: do the engines currently agree, and where did they first diverge. */
  agree = true;
  firstDivergence: number | null = null;

  private seq = 0;
  private timer: number | null = null;
  private lastTick = 0;
  private budget = 0;
  private until: (() => boolean) | null = null;

  constructor(public engines: VmKind[], private host: SessionHost) {}

  // --- state ----------------------------------------------------------------
  get loaded() {
    return this.vms.length > 0 && this.program !== null;
  }
  get vm(): RVM | undefined {
    return this.vms[0];
  }
  get t() {
    return this.vm?.instructionCount ?? 0;
  }
  get maxT() {
    return Math.max(this.horizon, ...this.vms.map((v) => v.instructionCount));
  }
  get direction(): Direction {
    return this.vm?.direction ?? 1;
  }
  get pc() {
    return this.vm?.registers().pc ?? 0;
  }
  /** At the end of the program in the current direction (HLT going forwards, entry going inverted). */
  get atEnd() {
    const vm = this.vm;
    if (!vm || !this.program) return true;
    const pc = vm.registers().pc;
    if (this.direction === -1) return pc === this.program.asm.entry;
    const w = vm.code(pc, 1)[0];
    return w === undefined || decode(w).op === Op.HLT || this.lastStatus[0] === 'fault';
  }
  get atStart() {
    return this.t === 0;
  }

  dirAt(t: number): Direction {
    let d: Direction = 1;
    for (const f of this.flips) if (f.t <= t) d = f.d;
    return d;
  }

  statusText(i = 0): string {
    const vm = this.vms[i];
    if (!vm) return 'No program';
    if (this.running) return this.running === 'fwd' ? 'Running…' : 'Running backwards…';
    const st = this.lastStatus[i];
    if (st === 'fault') return `Fault at t = ${vm.instructionCount}`;
    if (this.atEnd && this.direction === 1) return `Halted at t = ${vm.instructionCount}`;
    if (vm.instructionCount === 0) return 'Ready at t = 0';
    return `Paused at t = ${vm.instructionCount}`;
  }

  // --- loading ----------------------------------------------------------------
  load(program: Program) {
    this.stop();
    this.program = program;
    this.vms = this.engines.map((k) => createVm(k) as RVM);
    for (const vm of this.vms) {
      if (vm.loadProgram(program.asm.image) !== 'ok') {
        this.host.log('error', `Could not load ${program.name}: ${vm.lastError}`);
        this.vms = [];
        this.program = null;
        break;
      }
    }
    this.reset();
  }

  unload() {
    this.stop();
    this.program = null;
    this.vms = [];
    this.reset();
  }

  private reset() {
    this.horizon = 0;
    this.flips = [];
    this.shown = this.vms.map(() => null);
    this.changedRegs = this.vms.map(() => new Set());
    this.lastStatus = this.vms.map(() => null);
    this.historyPeak = this.vms.map(() => 0);
    this.followMem = null;
    this.agree = true;
    this.firstDivergence = null;
  }

  /** Swap engines, replaying to the same time and direction history. */
  setEngines(engines: VmKind[]) {
    const program = this.program;
    this.engines = engines;
    if (!program) return;
    const t = this.t;
    const flips = this.flips;
    const horizon = this.horizon;
    this.load(program);
    for (const f of flips) {
      this.vms.forEach((v) => {
        v.runTo(f.t);
        v.setDirection(f.d);
      });
    }
    this.vms.forEach((v) => v.runTo(t));
    this.flips = flips;
    this.horizon = horizon;
    this.notePeaks();
  }

  // --- stepping ---------------------------------------------------------------
  private describe(vm: RVM, before: { regs: Uint32Array; pc: number }, forwardSemantic: boolean): Activity | null {
    const after = vm.registers();
    const addr = forwardSemantic ? before.pc : after.pc;
    const w = vm.code(addr, 1)[0];
    if (w === undefined) return null;
    const I = decode(w);
    const use = regUse(I);
    let mem: Activity['mem'] = null;
    if (use.mem) {
      const a = I.op === Op.CALL || I.op === Op.RET
        ? Math.min(before.regs[SP_REG], after.regs[SP_REG])
        : (after.regs[I.rb] + I.simm) >>> 0;
      mem = { addr: a, write: use.mem.write };
    }
    return {
      addr,
      instr: this.program?.code[addr]?.text ?? disassemble(I),
      text: effectText(I, true),
      inverse: effectText(I, false),
      alu: aluSymbol(I, true),
      aluInverse: aluSymbol(I, false),
      reads: use.reads,
      writes: use.writes,
      mem,
    };
  }

  private notePeaks() {
    this.vms.forEach((v, i) => {
      this.historyPeak[i] = Math.max(this.historyPeak[i] ?? 0, v.historyBytes);
    });
  }

  /** One lockstep step of every VM. Returns the first VM's status. */
  private stepAll(back: boolean, animate: boolean): Status {
    const t0 = this.t;
    const forwardSemantic = back ? this.dirAt(t0 - 1) === -1 : this.dirAt(t0) === 1;
    const statuses = this.vms.map((vm, i) => {
      const before = vm.registers();
      const st = back ? vm.stepBack() : vm.stepForward();
      this.lastStatus[i] = st;
      if (st === 'ok') {
        const after = vm.registers().regs;
        const changed = new Set<number>();
        for (let r = 0; r < 16; r++) if (after[r] !== before.regs[r]) changed.add(r);
        this.changedRegs[i] = changed;
        if (animate) {
          const act = this.describe(vm, before, forwardSemantic);
          this.shown[i] = act ? { activity: act, inverse: !forwardSemantic, seq: ++this.seq } : null;
          if (act?.mem && i === 0) this.followMem = act.mem.addr;
        } else {
          this.shown[i] = null;
        }
      }
      return st;
    });
    this.horizon = Math.max(this.horizon, this.t);
    this.notePeaks();
    if (this.vms.length > 1) this.compareEngines(statuses);
    return statuses[0];
  }

  private compareEngines(statuses: Status[]) {
    const [a, b] = this.vms;
    const ra = a.registers(), rb = b.registers();
    const same =
      statuses[0] === statuses[1] &&
      a.instructionCount === b.instructionCount &&
      ra.pc === rb.pc &&
      ra.regs.every((v, i) => v === rb.regs[i]);
    if (!same && this.agree && this.firstDivergence === null) {
      this.firstDivergence = Math.min(a.instructionCount, b.instructionCount);
      const why = statuses[0] === 'fault' ? a.lastError : statuses[1] === 'fault' ? b.lastError : 'registers or PC differ';
      this.host.log('error', `Engines diverged at t = ${this.firstDivergence}: ${why}`);
    }
    this.agree = same;
  }

  /** Report a non-ok status from a manual step or a run. */
  private report(st: Status) {
    const vm = this.vms.find((_, i) => this.lastStatus[i] === 'fault') ?? this.vm!;
    switch (st) {
      case 'halted':
        this.host.log('info', this.direction === 1
          ? `Halted at t = ${this.t}.`
          : `Inverse run reached the entry point at t = ${this.t}: every step has been undone.`);
        break;
      case 'at_start':
        this.host.log('info', 'Reached t = 0.');
        break;
      case 'fault':
        this.host.log('error', `Fault at t = ${vm.instructionCount} (${vm.kind} VM): ${vm.lastError}`);
        break;
      case 'bad_arg':
      case 'bad_program':
        this.host.log('error', vm.lastError || st);
        break;
    }
  }

  stepForward() {
    if (!this.loaded) return;
    this.stop();
    const st = this.stepAll(false, true);
    if (st !== 'ok' || this.lastStatus.some((s) => s === 'fault')) this.report(this.lastStatus.includes('fault') ? 'fault' : st);
    this.host.emit();
  }

  stepBack() {
    if (!this.loaded) return;
    this.stop();
    const st = this.stepAll(true, true);
    if (st !== 'ok') this.report(st);
    this.host.emit();
  }

  /** Step over a CALL: run until it returns to the next instruction at the same stack depth. */
  stepOver() {
    const vm = this.vm;
    if (!vm || !this.loaded) return;
    const { pc, regs } = vm.registers();
    const w = vm.code(pc, 1)[0];
    if (w === undefined || decode(w).op !== Op.CALL || this.direction !== 1) return this.stepForward();
    const sp = regs[SP_REG];
    this.until = () => {
      const r = this.vm!.registers();
      return r.pc === pc + 1 && r.regs[SP_REG] === sp;
    };
    this.run('fwd');
  }

  runToAddr(addr: number) {
    this.until = () => this.pc === addr;
    this.run('fwd');
  }

  scrub(t: number) {
    if (!this.loaded) return;
    this.stop();
    const target = Math.max(0, Math.min(this.maxT, Math.round(t)));
    const before = this.vms.map((v) => v.registers().regs);
    this.vms.forEach((v, i) => {
      const st = v.runTo(target);
      this.lastStatus[i] = st;
    });
    this.vms.forEach((v, i) => {
      const after = v.registers().regs;
      this.changedRegs[i] = new Set([...after.keys()].filter((r) => after[r] !== before[i][r]));
      this.shown[i] = null;
    });
    if (this.vms.length > 1) this.compareEngines(this.lastStatus.map((s) => s ?? 'ok'));
    this.host.emit();
  }

  toStart() {
    this.scrub(0);
  }

  restart() {
    if (!this.program) return;
    this.load(this.program);
    this.host.log('info', 'Restarted at t = 0.');
    this.host.emit();
  }

  setDirection(d: Direction) {
    if (!this.loaded || d === this.direction) return;
    this.stop();
    const t = this.t;
    this.vms.forEach((v) => v.setDirection(d));
    this.flips = this.flips.filter((f) => f.t < t);
    if (this.dirAt(t) !== d) this.flips.push({ t, d });
    this.horizon = t;
    this.lastStatus = this.vms.map(() => null);
    this.host.log('info', d === -1
      ? `Direction flipped at t = ${t}: the program now runs as its own inverse.`
      : `Direction restored at t = ${t}: the program runs forwards again.`);
    this.host.emit();
  }

  // --- running ----------------------------------------------------------------
  run(dir: 'fwd' | 'back', turbo = false) {
    if (!this.loaded) return;
    this.stopTimer();
    this.running = dir;
    this.turbo = turbo;
    this.lastTick = performance.now();
    this.budget = 1;
    this.timer = requestAnimationFrame(this.tick);
    this.host.emit();
  }

  togglePlay() {
    if (this.running) this.pause();
    else this.run('fwd');
  }

  runToEnd() {
    this.run('fwd', true);
  }

  pause() {
    if (!this.running) return;
    this.stop();
    this.host.emit();
  }

  private stop() {
    this.stopTimer();
    this.running = null;
    this.turbo = false;
    this.until = null;
  }

  private stopTimer() {
    if (this.timer !== null) cancelAnimationFrame(this.timer);
    this.timer = null;
  }

  private tick = (now: number) => {
    if (!this.running) return;
    const back = this.running === 'back';
    const sps = this.host.stepsPerSecond();
    const animate = !this.turbo && sps <= ANIMATE_MAX_SPS;
    const bps = this.host.breakpointAddrs();
    const deadline = now + TURBO_SLICE_MS;
    if (!this.turbo) {
      this.budget += ((now - this.lastTick) / 1000) * sps;
      this.budget = Math.min(this.budget, sps / 10 + 1);
    }
    this.lastTick = now;

    while (this.turbo ? performance.now() < deadline : this.budget >= 1) {
      if (!this.turbo) this.budget -= 1;
      const st = this.stepAll(back, animate);
      const fault = this.lastStatus.includes('fault');
      if (st !== 'ok' || fault) {
        this.report(fault ? 'fault' : st);
        return this.finishRun();
      }
      if (this.until?.()) return this.finishRun();
      if (bps.has(this.pc)) {
        const line = this.program?.asm.addrToLine[this.pc];
        this.host.log('info', `Breakpoint at line ${line}, t = ${this.t}.`);
        return this.finishRun();
      }
    }
    this.host.emit();
    this.timer = requestAnimationFrame(this.tick);
  };

  private finishRun() {
    this.stop();
    this.host.emit();
  }
}
