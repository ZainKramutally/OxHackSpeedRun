// App state: open files (only ever added by drag-and-drop), live assembly, and two debugging
// sessions: the IDE's (one engine) and the Comparison tab's (logging and reversible in lockstep).
import { useSyncExternalStore } from 'react';
import type { VmKind } from '../../spec/vm_api.ts';
import { assemble, type AsmResult } from '../asm/assembler.ts';
import { buildProgram, Session, SPEEDS, type SessionHost } from './session.ts';

export type Mode = 'classic' | 'stepback';
export type Tab = 'visualiser' | 'compare';
export type BottomTab = 'problems' | 'registers' | 'memory' | 'callstack' | 'console';

export interface SourceFile {
  id: string;
  name: string;
  source: string;
  /** Text as last dropped or saved; the tab shows a dot when the editor differs. */
  savedSource: string;
  asm: AsmResult;
  breakpoints: Set<number>;
  handle?: FileSystemFileHandle;
}

export interface LogLine {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface DroppedFile {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
}

export const ACCEPTED = /\.(s|asm|rvs)$/i;
const MAX_BYTES = 1 << 20;
const LS_KEY = 'revvm.ui';

function loadPrefs(): Partial<{ mode: Mode; engine: VmKind; split: number; speed: number }> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

class Store {
  tab: Tab = 'visualiser';
  files: SourceFile[] = [];
  activeId: string | null = null;
  mode: Mode;
  engine: VmKind;
  split: number;
  speed: number;
  bottomTab: BottomTab = 'console';
  cursor = { line: 1, col: 1 };
  memBase: number | null = null;
  log: LogLine[] = [];
  /** Editor scroll/caret request (from Problems, etc.). */
  reveal: { line: number; seq: number } | null = null;

  readonly ide: Session;
  readonly cmp: Session;

  version = 0;
  private listeners = new Set<() => void>();
  private logId = 0;
  private nextFileId = 1;
  private assembleTimer: number | null = null;

  constructor() {
    const p = loadPrefs();
    this.mode = p.mode ?? 'stepback';
    this.engine = p.engine ?? 'reversible';
    this.split = p.split ?? 0.46;
    this.speed = Math.min(p.speed ?? 1, SPEEDS.length - 1);
    const host = (): SessionHost => ({
      emit: () => this.emit(),
      log: (level, text) => this.push(level, text),
      stepsPerSecond: () => SPEEDS[this.speed],
      breakpointAddrs: () => this.breakpointAddrs(),
    });
    this.ide = new Session([this.engine], host());
    this.cmp = new Session(['logging', 'reversible'], host());
    this.push('info', 'Drop a .s file anywhere to open it. Examples are in the examples/ folder.');
  }

  // --- subscription -------------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((f) => f());
  }
  private savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ mode: this.mode, engine: this.engine, split: this.split, speed: this.speed }));
    } catch {
      /* storage unavailable: preferences just don't persist */
    }
  }
  private push(level: LogLine['level'], text: string) {
    this.log = [...this.log.slice(-299), { id: ++this.logId, level, text }];
  }

  // --- files --------------------------------------------------------------------
  get active(): SourceFile | null {
    return this.files.find((f) => f.id === this.activeId) ?? null;
  }
  /** Session for the visible tab. */
  get session(): Session {
    return this.tab === 'compare' ? this.cmp : this.ide;
  }
  /** The editor text differs from what the VMs are running. */
  get stale(): boolean {
    const f = this.active;
    return !!f && !!this.ide.program && this.ide.program.fileId === f.id && this.ide.program.source !== f.source;
  }

  openFiles(dropped: DroppedFile[], rejected: string[]) {
    for (const name of rejected) this.push('warn', `Ignored ${name}: drop an assembly file (.s, .asm).`);
    let last: SourceFile | null = null;
    for (const d of dropped) {
      if (d.text.length > MAX_BYTES) {
        this.push('warn', `Ignored ${d.name}: larger than 1 MB.`);
        continue;
      }
      const existing = this.files.find((f) => f.name === d.name);
      const asm = assemble(d.text);
      if (existing) {
        Object.assign(existing, { source: d.text, savedSource: d.text, asm, handle: d.handle ?? existing.handle });
        last = existing;
      } else {
        last = { id: `f${this.nextFileId++}`, name: d.name, source: d.text, savedSource: d.text, asm, breakpoints: new Set(), handle: d.handle };
        this.files = [...this.files, last];
      }
      this.push(asm.ok ? 'info' : 'warn', asm.ok
        ? `Opened ${d.name}: ${asm.code.length} code words, ${asm.data.length} data words.`
        : `Opened ${d.name} with ${asm.errors.length} problem${asm.errors.length === 1 ? '' : 's'}.`);
    }
    if (last) {
      this.activeId = last.id;
      this.loadActive();
      if (!last.asm.ok) this.bottomTab = 'problems';
    }
    this.emit();
  }

  setActive(id: string) {
    if (id === this.activeId) return;
    this.activeId = id;
    this.loadActive();
    this.emit();
  }

  closeFile(id: string) {
    const i = this.files.findIndex((f) => f.id === id);
    if (i < 0) return;
    this.files = this.files.filter((f) => f.id !== id);
    if (this.activeId === id) {
      this.activeId = this.files[Math.min(i, this.files.length - 1)]?.id ?? null;
      this.loadActive();
    }
    this.emit();
  }

  /** Assemble the active file and load it into both sessions (t = 0). */
  private loadActive() {
    const f = this.active;
    this.memBase = null;
    if (!f) {
      this.ide.unload();
      this.cmp.unload();
      return;
    }
    if (!f.asm.ok) {
      this.ide.unload();
      this.cmp.unload();
      return;
    }
    const program = buildProgram(f.id, f.name, f.source, f.asm);
    this.ide.load(program);
    this.cmp.load(program);
  }

  setSource(text: string) {
    const f = this.active;
    if (!f) return;
    f.source = text;
    if (this.assembleTimer !== null) clearTimeout(this.assembleTimer);
    this.assembleTimer = window.setTimeout(() => {
      this.assembleTimer = null;
      f.asm = assemble(f.source);
      // Nothing loaded yet (the file never assembled): load as soon as it does.
      if (f.id === this.activeId && f.asm.ok && !this.ide.program) this.loadActive();
      this.emit();
    }, 150);
    this.emit();
  }

  /**
   * Make sure the VMs run the current editor text before an action. Reassembles and restarts at
   * t = 0 if the source changed. Returns false when there is nothing runnable.
   */
  ensureCurrent(): boolean {
    const f = this.active;
    if (!f) return false;
    if (this.ide.program?.fileId === f.id && this.ide.program.source === f.source) return true;
    f.asm = assemble(f.source);
    if (!f.asm.ok) {
      this.push('error', `${f.name} has ${f.asm.errors.length} problem${f.asm.errors.length === 1 ? '' : 's'}; fix them to run.`);
      this.bottomTab = 'problems';
      this.emit();
      return false;
    }
    this.loadActive();
    this.push('info', `Reassembled ${f.name}: restarted at t = 0.`);
    return true;
  }

  async save() {
    const f = this.active;
    if (!f) return;
    const text = f.source;
    try {
      if (f.handle && 'createWritable' in f.handle) {
        const w = await f.handle.createWritable();
        await w.write(text);
        await w.close();
        f.savedSource = text;
        this.push('info', `Saved ${f.name}.`);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: f.name });
        a.click();
        URL.revokeObjectURL(url);
        f.savedSource = text;
        this.push('info', `Downloaded ${f.name} (this browser can't write back to the dropped file).`);
      }
    } catch (e) {
      this.push('error', `Could not save ${f.name}: ${(e as Error).message}`);
    }
    this.emit();
  }

  // --- simple setters ---------------------------------------------------------------
  setTab(tab: Tab) {
    if (tab === this.tab) return;
    this.ide.pause();
    this.cmp.pause();
    this.tab = tab;
    this.emit();
  }
  setSplit(f: number) {
    this.split = Math.min(0.75, Math.max(0.25, f));
    this.savePrefs();
    this.emit();
  }
  setBottomTab(t: BottomTab) {
    this.bottomTab = t;
    this.emit();
  }
  setCursor(line: number, col: number) {
    if (line === this.cursor.line && col === this.cursor.col) return;
    this.cursor = { line, col };
    this.emit();
  }
  setSpeed(i: number) {
    this.speed = i;
    this.savePrefs();
    this.emit();
  }
  setMemBase(addr: number | null) {
    this.memBase = addr;
    this.emit();
  }
  revealLine(line: number) {
    this.reveal = { line, seq: (this.reveal?.seq ?? 0) + 1 };
    this.emit();
  }
  setMode(m: Mode) {
    this.ide.pause();
    this.mode = m;
    if (m === 'classic' && this.ide.direction === -1) this.ide.setDirection(1);
    this.push('info', m === 'classic' ? 'Classic debugger: forward execution only.' : 'Step-back debugger: time travel enabled.');
    this.savePrefs();
    this.emit();
  }
  setEngine(e: VmKind) {
    if (e === this.engine) return;
    this.ide.pause();
    this.engine = e;
    this.ide.setEngines([e]);
    this.push('info', e === 'logging'
      ? 'Engine: logging VM. Saves a delta every step and restores it to step back.'
      : 'Engine: reversible VM. Steps back by computing inverses, with no per-step history.');
    this.savePrefs();
    this.emit();
  }

  // --- breakpoints ------------------------------------------------------------------
  toggleBreakpoint(line: number) {
    const f = this.active;
    if (!f) return;
    const isCode = f.asm.lineToAddr.has(line);
    if (!isCode && !f.breakpoints.has(line)) return;
    const next = new Set(f.breakpoints);
    if (next.has(line)) next.delete(line);
    else next.add(line);
    f.breakpoints = next;
    this.emit();
  }
  breakpointAddrs(): Set<number> {
    const p = this.session.program;
    const f = p && this.files.find((x) => x.id === p.fileId);
    const out = new Set<number>();
    if (!p || !f) return out;
    for (const line of f.breakpoints) {
      const a = p.asm.lineToAddr.get(line);
      if (a !== undefined) out.add(a);
    }
    return out;
  }

  // --- debugger actions (IDE) ----------------------------------------------------------
  /** Run an action on the visible tab's session, reassembling first if the source changed. */
  act(fn: (s: Session) => void) {
    if (!this.ensureCurrent()) return;
    fn(this.session);
  }
  runToCursor() {
    this.act((s) => {
      const addr = s.program?.asm.lineToAddr.get(this.cursor.line);
      if (addr === undefined) {
        this.push('info', `Line ${this.cursor.line} has no instruction.`);
        this.emit();
        return;
      }
      s.runToAddr(addr);
    });
  }
}

export const store = new Store();

/** Re-render on any store change. */
export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

export type { Store };
