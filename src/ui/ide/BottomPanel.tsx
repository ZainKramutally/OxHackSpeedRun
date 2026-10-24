import { useEffect, useRef } from 'react';
import { FB_BASE, SP_REG, STACK_BASE } from '../../../spec/vm_api.ts';
import { decode } from '../../isa/isa.ts';
import { useStore, type BottomTab } from '../../state/store.ts';
import { fmtHex, toSigned } from '../format.ts';

export function BottomPanel() {
  const s = useStore();
  const problems = s.active?.asm.errors.length ?? 0;
  const tabs: { id: BottomTab; label: string; count?: number }[] = [
    { id: 'problems', label: 'Problems', count: problems },
    { id: 'console', label: 'Console' },
    { id: 'registers', label: 'Registers' },
    { id: 'memory', label: 'Memory' },
    { id: 'callstack', label: 'Call stack' },
  ];
  return (
    <div className="bottom">
      <div className="bottom-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={s.bottomTab === t.id} className={s.bottomTab === t.id ? 'on' : ''} onClick={() => s.setBottomTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className={`count ${t.count ? 'bad' : ''}`}>{t.count}</span>}
          </button>
        ))}
        <span className="bottom-status">{s.ide.statusText()}</span>
      </div>
      <div className="bottom-body">
        {s.bottomTab === 'problems' && <Problems />}
        {s.bottomTab === 'console' && <Console />}
        {s.bottomTab === 'registers' && <Registers />}
        {s.bottomTab === 'memory' && <MemoryDump />}
        {s.bottomTab === 'callstack' && <CallStack />}
      </div>
    </div>
  );
}

function Problems() {
  const s = useStore();
  const f = s.active;
  if (!f) return <p className="empty">No file open.</p>;
  if (!f.asm.errors.length) return <p className="empty">No problems in {f.name}.</p>;
  return (
    <ul className="problems">
      {f.asm.errors.map((e, i) => (
        <li key={i}>
          <button onClick={() => s.revealLine(e.line)}>
            <span className="prob-icon" aria-hidden>✕</span>
            <span className="prob-msg">{e.message}</span>
            <span className="prob-where">{f.name}:{e.line}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Console() {
  const s = useStore();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [s.log.length]);
  return (
    <div className="console">
      {s.log.map((l) => (
        <div key={l.id} className={`log ${l.level}`}>{l.text}</div>
      ))}
      <div ref={end} />
    </div>
  );
}

function NoProgram() {
  return <p className="empty">No program loaded. Drop a .s file to start.</p>;
}

function Registers() {
  const s = useStore();
  const vm = s.ide.vm;
  if (!vm) return <NoProgram />;
  const { regs, pc } = vm.registers();
  const changed = s.ide.changedRegs[0] ?? new Set();
  const rows = [...Array.from(regs, (v, i) => ({ name: i === SP_REG ? 'r14 (sp)' : `r${i}`, v, i })), { name: 'pc', v: pc, i: -1 }];
  return (
    <table className="reg-table">
      <thead>
        <tr><th>reg</th><th>hex</th><th>unsigned</th><th>signed</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className={changed.has(r.i) ? 'changed' : ''}>
            <td className="name">{r.name}</td>
            <td className="mono">{fmtHex(r.v)}</td>
            <td className="mono num">{r.v >>> 0}</td>
            <td className="mono num">{toSigned(r.v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const REGIONS = [
  { label: 'Data', base: 0 },
  { label: 'Stack', base: STACK_BASE },
  { label: 'Display', base: FB_BASE },
];

function MemoryDump() {
  const s = useStore();
  const vm = s.ide.vm;
  if (!vm) return <NoProgram />;
  const base = s.memBase ?? s.ide.followMem ?? 0;
  const start = Math.max(0, (base & ~7) - 8);
  const words = vm.memory(start, 96);
  const touched = s.ide.shown[0]?.activity.mem?.addr;
  return (
    <div className="memdump">
      <div className="memdump-bar">
        {REGIONS.map((r) => (
          <button key={r.label} className={`chip ${s.memBase === r.base ? 'on' : ''}`} onClick={() => s.setMemBase(r.base)}>
            {r.label}
          </button>
        ))}
        <button className={`chip ${s.memBase === null ? 'on' : ''}`} onClick={() => s.setMemBase(null)} title="Follow the last memory access">
          Follow
        </button>
      </div>
      <table className="mem-table">
        <tbody>
          {Array.from({ length: 12 }, (_, r) => (
            <tr key={r}>
              <td className="addr">{fmtHex(start + r * 8, 5)}</td>
              {Array.from({ length: 8 }, (_, k) => {
                const a = start + r * 8 + k;
                const v = words[r * 8 + k];
                return (
                  <td key={k} className={`mono ${v ? '' : 'zero'} ${touched === a ? 'touched' : ''}`}>
                    {v.toString(16).toUpperCase().padStart(8, '0')}
                  </td>
                );
              })}
              <td className="ascii">
                {Array.from({ length: 8 }, (_, k) => {
                  const v = words[r * 8 + k];
                  return v >= 32 && v < 127 ? String.fromCharCode(v) : '·';
                }).join('')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Frames recovered from the stack: each slot holds a return address pushed by CALL. */
function CallStack() {
  const s = useStore();
  const vm = s.ide.vm;
  const p = s.ide.program;
  if (!vm || !p) return <NoProgram />;
  const { regs, pc } = vm.registers();
  const depth = Math.max(0, Math.min(256, regs[SP_REG] - STACK_BASE));
  const rets = Array.from(vm.memory(STACK_BASE, depth));
  const name = (addr: number) => p.asm.codeLabels.get(addr) ?? `0x${addr.toString(16)}`;
  const calleeOf = (ret: number) => {
    const w = vm.code(ret - 1, 1)[0];
    return w === undefined ? '?' : name(decode(w).target);
  };
  const entryName = name(p.asm.entry);
  const frames = [{ fn: depth ? calleeOf(rets[depth - 1]) : entryName, at: pc }];
  for (let k = depth - 1; k >= 0; k--) frames.push({ fn: k ? calleeOf(rets[k - 1]) : entryName, at: rets[k] - 1 });
  return (
    <ol className="callstack">
      {frames.map((fr, i) => (
        <li key={i} className={i === 0 ? 'on' : ''}>
          <button onClick={() => p.asm.addrToLine[fr.at] && s.revealLine(p.asm.addrToLine[fr.at])}>
            <span className="fn">{fr.fn}</span>
            <span className="where">line {p.asm.addrToLine[fr.at] ?? '?'} · {fmtHex(fr.at, 4)}{i > 0 ? ' (call site)' : ''}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
