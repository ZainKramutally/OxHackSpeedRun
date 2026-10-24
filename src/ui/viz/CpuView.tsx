// CPU visualiser in the spirit of Peter Higginson's Little Man Computer: the machine's parts laid
// out as one diagram, with buses that light up and carry a token for each step.
import { useEffect, useRef } from 'react';
import { FB_BASE, SP_REG, STACK_BASE } from '../../../spec/vm_api.ts';
import { SPEEDS, type Session } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { fmtBytes, fmtHex, toSigned } from '../format.ts';
import { Display } from './Display.tsx';

type BusId = 'pcAddr' | 'fetch' | 'decode' | 'operands' | 'result' | 'memAddr' | 'memData' | 'log';

const CODE_ROWS = 10;
const CODE_ROW_H = 25;
const CODE_ROW_Y0 = 58;

function busPaths(fetchRowY: number): Record<BusId, string> {
  return {
    pcAddr: 'M 336 80 H 292',
    fetch: `M 292 ${fetchRowY} H 312 V 168 H 336`,
    decode: 'M 470 214 V 268',
    operands: 'M 660 300 H 552',
    result: 'M 470 380 V 414 H 820 V 322',
    memAddr: 'M 432 380 V 444',
    memData: 'M 900 322 V 444',
    log: 'M 322 378 H 360 V 342 H 399',
  };
}

const BUS_LABELS: { id: BusId; x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }[] = [
  { id: 'fetch', x: 318, y: 132, text: 'fetch', anchor: 'start' },
  { id: 'decode', x: 478, y: 246, text: 'decode', anchor: 'start' },
  { id: 'operands', x: 606, y: 292, text: 'operands', anchor: 'middle' },
  { id: 'result', x: 640, y: 428, text: 'result', anchor: 'middle' },
  { id: 'memAddr', x: 440, y: 432, text: 'address', anchor: 'start' },
  { id: 'memData', x: 908, y: 388, text: 'data', anchor: 'start' },
];

/** Tokens that run along the active buses, in fetch → execute → write-back order. */
function Tokens({ idPrefix, seq, buses, reversed, phase }: { idPrefix: string; seq: number; buses: { id: BusId; stage: number; backwards?: boolean }[]; reversed: boolean; phase: number }) {
  const g = useRef<SVGGElement>(null);
  useEffect(() => {
    g.current?.querySelectorAll<SVGAnimationElement>('animateMotion, animate').forEach((a) => {
      a.beginElementAt(Number(a.dataset.delay ?? 0));
    });
  }, [seq]);
  return (
    <g ref={g} key={seq} className={`tokens ${reversed ? 'rev' : 'fwd'}`}>
      {buses.map((b) => (
        <circle key={b.id} r={5.5} opacity={0} className="token">
          <animateMotion begin="indefinite" dur={`${phase}s`} data-delay={b.stage * phase} keyPoints={b.backwards ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" fill="remove">
            <mpath href={`#${idPrefix}-bus-${b.id}`} />
          </animateMotion>
          <animate attributeName="opacity" begin="indefinite" dur={`${phase}s`} data-delay={b.stage * phase} values="0;1;1;0" keyTimes="0;0.1;0.85;1" fill="remove" />
        </circle>
      ))}
    </g>
  );
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const EMPTY_REGS = (() => {
  const r = new Uint32Array(16);
  r[SP_REG] = STACK_BASE;
  return r;
})();

interface Props {
  session: Session;
  vmIndex: number;
  /** Unique per instance: SVG ids are document-global. */
  idPrefix: string;
  memBase: number | null;
  /** Comparison layout: no header or legend. */
  compact?: boolean;
}

export function CpuView({ session: x, vmIndex, idPrefix, memBase, compact }: Props) {
  const s = useStore();
  const vm = x.vms[vmIndex];
  const { regs, pc } = vm?.registers() ?? { regs: EMPTY_REGS, pc: 0 };
  const t = vm?.instructionCount ?? 0;
  const shown = x.shown[vmIndex] ?? null;
  const act = shown?.activity ?? null;
  const inverse = shown?.inverse ?? false;
  const engine = vm?.kind ?? x.engines[vmIndex];
  const logging = engine === 'logging';
  const code = x.program?.code ?? [];
  const direction = vm?.direction ?? 1;
  const fault = x.lastStatus[vmIndex] === 'fault' ? vm?.lastError : null;
  const P = (id: string) => `${idPrefix}-${id}`;

  // Code memory window around the PC.
  const first = Math.max(0, Math.min(pc - 3, code.length - CODE_ROWS));
  const rows = code.slice(first, first + CODE_ROWS);
  const rowY = (addr: number) => CODE_ROW_Y0 + (addr - first) * CODE_ROW_H;
  const irAddr = act ? act.addr : pc;
  const fetchY = Math.min(Math.max(rowY(irAddr) + 12, CODE_ROW_Y0 + 12), CODE_ROW_Y0 + CODE_ROWS * CODE_ROW_H - 12);
  const paths = busPaths(fetchY);

  // Which buses carry this step, and in which order.
  const buses: { id: BusId; stage: number; backwards?: boolean }[] = [];
  if (act) {
    buses.push({ id: 'pcAddr', stage: 0 }, { id: 'fetch', stage: 0 }, { id: 'decode', stage: 1 });
    if (act.reads.length) buses.push({ id: 'operands', stage: 1 });
    if (act.mem) buses.push({ id: 'memAddr', stage: 1 }, { id: 'memData', stage: 2, backwards: !act.mem.write });
    if (act.writes.length) buses.push({ id: 'result', stage: 2 });
    if (logging && (act.writes.length || act.mem)) buses.push({ id: 'log', stage: inverse ? 1 : 2, backwards: !inverse });
  }
  const active = new Set(buses.map((b) => b.id));
  const sps = SPEEDS[s.speed];
  const phase = x.running ? Math.min(0.3, 1 / (sps * 3.2)) : 0.3;
  const showTokens = act && !prefersReducedMotion() && (!x.running || sps <= 3);

  // Memory window: a 32-word page that follows the last access unless a region is pinned.
  const memFocus = memBase ?? x.followMem ?? 0;
  const memStart = memFocus - (memFocus % 32);
  const memWords = vm?.memory(memStart, 32) ?? new Uint32Array(32);
  const region = memStart >= FB_BASE ? 'display' : memStart >= STACK_BASE ? 'stack' : 'data';
  const touched = act?.mem?.addr;

  const historyBytes = vm?.historyBytes ?? 0;
  const historyMax = Math.max(256, x.historyPeak[vmIndex] ?? 0);
  const historyFrac = Math.min(1, historyBytes / historyMax);
  const irText = act ? act.instr : code[pc]?.text ?? (code.length ? '—' : 'no program');

  return (
    <div className={`cpu ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="panel-header">
          <span className="panel-title">CPU</span>
          <span className={`chip static ${act ? (inverse ? 'rev' : 'fwd') : ''}`}>{act ? (inverse ? '◀ undo' : '▶ execute') : 'idle'}</span>
          <span className="chip static">{logging ? 'logging VM' : 'reversible VM'}</span>
          {direction === -1 && <span className="chip static rev">program inverted</span>}
          <span className="tool-spacer" />
          <span className="cpu-status">{x.statusText(vmIndex)}</span>
        </div>
      )}
      {fault && <div className="cpu-fault">Fault: {fault}</div>}

      <div className="cpu-diagram">
        <svg viewBox="0 0 1000 660" preserveAspectRatio="xMidYMin meet" role="img" aria-label={`CPU diagram (${engine} VM)`}>
          <defs>
            {(Object.keys(paths) as BusId[]).map((id) => (
              <path key={id} id={P(`bus-${id}`)} d={paths[id]} />
            ))}
            <marker id={P('arrow')} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="arrowhead" />
            </marker>
          </defs>

          {(Object.keys(paths) as BusId[]).map((id) => (
            <use
              key={id}
              href={`#${P(`bus-${id}`)}`}
              className={`bus ${active.has(id) ? `active ${inverse ? 'rev' : 'fwd'}` : ''} ${id === 'log' && !logging ? 'off' : ''}`}
              markerEnd={`url(#${P('arrow')})`}
            />
          ))}
          {BUS_LABELS.map((l) => (
            <text key={l.id} x={l.x} y={l.y} textAnchor={l.anchor} className={`bus-label ${active.has(l.id) ? 'on' : ''}`}>
              {l.text}
            </text>
          ))}

          {/* Code memory */}
          <g>
            <rect x={20} y={20} width={272} height={300} rx={10} className="unit" />
            <text x={34} y={44} className="unit-title">CODE MEMORY</text>
            <text x={278} y={44} textAnchor="end" className="unit-sub">{code.length} words</text>
            {!code.length && <text x={156} y={180} textAnchor="middle" className="unit-sub">drop a .s file</text>}
            {rows.map((c) => {
              const isPc = c.addr === pc;
              const isIr = act && c.addr === act.addr;
              return (
                <g key={c.addr}>
                  {isPc && <rect x={26} y={rowY(c.addr)} width={260} height={CODE_ROW_H - 2} rx={5} className="code-row pc" />}
                  {!isPc && isIr && <rect x={26} y={rowY(c.addr)} width={260} height={CODE_ROW_H - 2} rx={5} className={`code-row ran ${inverse ? 'rev' : 'fwd'}`} />}
                  <text x={34} y={rowY(c.addr) + 16} className="code-addr">{fmtHex(c.addr, 4)}</text>
                  <text x={98} y={rowY(c.addr) + 16} className="code-text">{truncate(c.text, 22)}</text>
                  {isPc && <text x={280} y={rowY(c.addr) + 16} textAnchor="end" className="code-pc">PC</text>}
                </g>
              );
            })}
          </g>

          {/* Control unit */}
          <g>
            <rect x={320} y={20} width={300} height={210} rx={10} className="unit" />
            <text x={336} y={44} className="unit-title">CONTROL UNIT</text>
            <text x={604} y={44} textAnchor="end" className={`unit-sub dir ${direction === -1 ? 'rev' : 'fwd'}`}>
              {direction === 1 ? 'd = +1' : 'd = −1'}
            </text>
            <rect x={336} y={54} width={128} height={56} rx={7} className={`cell ${act ? 'hot' : ''}`} />
            <text x={346} y={72} className="cell-name">PC</text>
            <text x={400} y={98} textAnchor="middle" className="cell-value big">{fmtHex(pc, 4)}</text>
            <rect x={476} y={54} width={128} height={56} rx={7} className="cell" />
            <text x={486} y={72} className="cell-name">TIME t</text>
            <text x={540} y={98} textAnchor="middle" className="cell-value big">{t}</text>
            <rect x={336} y={122} width={268} height={92} rx={7} className={`cell ${act ? 'hot' : ''}`} />
            <text x={346} y={140} className="cell-name">IR · {act ? (inverse ? 'undoing' : 'executed') : 'next'}</text>
            <text x={470} y={170} textAnchor="middle" className="ir-text">{truncate(irText, 24)}</text>
            <text x={470} y={198} textAnchor="middle" className={`ir-effect ${inverse ? 'rev' : 'fwd'}`}>
              {act ? truncate(inverse ? (logging ? 'restore from history log' : act.inverse) : act.text, 34) : ''}
            </text>
          </g>

          {/* ALU */}
          <g>
            <polygon points="380,270 450,270 470,290 490,270 560,270 530,380 410,380" className={`alu ${act && (act.reads.length || act.writes.length || act.mem) ? `hot ${inverse ? 'rev' : 'fwd'}` : ''}`} />
            <text x={470} y={340} textAnchor="middle" className="alu-symbol">{act ? (inverse ? act.aluInverse : act.alu) : 'ALU'}</text>
            <text x={470} y={366} textAnchor="middle" className="alu-caption">{act ? (inverse ? (logging ? 'from log' : 'inverse') : 'forward') : ''}</text>
          </g>

          {/* History log */}
          <g>
            <rect x={20} y={336} width={302} height={86} rx={10} className={`unit ${logging ? '' : 'dim'}`} />
            <text x={34} y={358} className="unit-title">HISTORY</text>
            <text x={308} y={358} textAnchor="end" className="unit-sub">{logging ? 'delta per step' : 'none per step'}</text>
            <rect x={34} y={370} width={274} height={14} rx={7} className="meter-track" />
            <rect x={34} y={370} width={Math.max(historyFrac * 274, historyBytes ? 6 : 0)} height={14} rx={7} className={`meter-fill ${logging ? 'log' : 'rev'}`} />
            <text x={34} y={408} className="history-value">{fmtBytes(historyBytes)}</text>
            <text x={308} y={408} textAnchor="end" className="unit-sub">{logging ? 'grows with t' : '8 B per direction flip'}</text>
          </g>

          {/* Registers */}
          <g>
            <rect x={660} y={20} width={320} height={300} rx={10} className="unit" />
            <text x={674} y={44} className="unit-title">REGISTERS</text>
            {Array.from(regs, (v, i) => {
              const rx = 672 + (i % 4) * 76;
              const ry = 54 + Math.floor(i / 4) * 64;
              const wrote = act?.writes.includes(i) || (x.changedRegs[vmIndex]?.has(i) ?? false);
              const read = act?.reads.includes(i);
              return (
                <g key={i}>
                  <rect x={rx} y={ry} width={72} height={60} rx={7} className={`cell reg ${wrote ? `wrote ${inverse ? 'rev' : 'fwd'}` : ''} ${read && !wrote ? 'read' : ''}`} />
                  <text x={rx + 7} y={ry + 15} className="cell-name">{i === SP_REG ? 'r14 sp' : `r${i}`}</text>
                  <text x={rx + 36} y={ry + 36} textAnchor="middle" className={`cell-value ${v ? '' : 'zero'}`}>{v.toString(16).toUpperCase().padStart(8, '0')}</text>
                  <text x={rx + 36} y={ry + 52} textAnchor="middle" className="cell-dec">{toSigned(v)}</text>
                </g>
              );
            })}
          </g>

          {/* Data memory */}
          <g>
            <rect x={20} y={444} width={960} height={204} rx={10} className="unit" />
            <text x={34} y={466} className="unit-title">DATA MEMORY</text>
            <text x={966} y={466} textAnchor="end" className="unit-sub">{region} · {fmtHex(memStart, 5)}–{fmtHex(memStart + 31, 5)}</text>
            {Array.from(memWords, (v, k) => {
              const addr = memStart + k;
              const mx = 32 + (k % 8) * 118;
              const my = 476 + Math.floor(k / 8) * 42;
              return (
                <g key={addr}>
                  <rect x={mx} y={my} width={114} height={38} rx={6} className={`cell mem ${touched === addr ? `wrote ${inverse ? 'rev' : 'fwd'}` : ''}`} />
                  <text x={mx + 6} y={my + 12} className="mem-addr">{addr.toString(16).toUpperCase().padStart(5, '0')}</text>
                  <text x={mx + 108} y={my + 12} textAnchor="end" className="mem-char">
                    {region === 'data' && v >= 32 && v < 127 ? `'${String.fromCharCode(v)}'` : ''}
                  </text>
                  <text x={mx + 57} y={my + 30} textAnchor="middle" className={`cell-value ${v ? '' : 'zero'}`}>{v.toString(16).toUpperCase().padStart(8, '0')}</text>
                </g>
              );
            })}
          </g>

          {showTokens && shown && <Tokens idPrefix={idPrefix} seq={shown.seq} buses={buses} reversed={inverse} phase={phase} />}
        </svg>
      </div>

      <div className="cpu-footer">
        <Display fb={vm?.framebuffer() ?? null} />
        {!compact && (
          <div className="legend">
            <div className="legend-title">Legend</div>
            <div className="legend-row"><span className="swatch fwd" /> executing forwards</div>
            <div className="legend-row"><span className="swatch rev" /> undoing (inverse)</div>
            <div className="legend-row"><span className="swatch read" /> register read</div>
            <div className="legend-row"><span className="swatch pc" /> next instruction (PC)</div>
            <div className="legend-keys">F5 run · F11 step · Shift+F10 step back · F9 breakpoint · ⌘S save</div>
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
