import type { Session } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';

/** Scrubber over machine time, from 0 to the furthest point reached on this timeline branch. */
export function Timeline({ session: x }: { session: Session }) {
  const s = useStore();
  const max = Math.max(1, x.maxT);
  const pct = (t: number) => (t / max) * 100;
  const go = (t: number) => s.act((y) => y.scrub(t));
  return (
    <div className="timeline">
      <span className="timeline-end">0</span>
      <div className="timeline-track">
        <div className="timeline-fill" style={{ width: `${pct(x.t)}%` }} />
        {x.firstDivergence !== null && <span className="timeline-tick bad" style={{ left: `${pct(x.firstDivergence)}%` }} title={`Engines diverged at t = ${x.firstDivergence}`} />}
        {x.flips.map((f) => (
          <span key={f.t} className="timeline-tick flip" style={{ left: `${pct(f.t)}%` }} title={`Direction flipped at t = ${f.t}`} />
        ))}
        <input type="range" min={0} max={max} value={x.t} onChange={(e) => go(Number(e.target.value))} aria-label="Machine time" disabled={!x.loaded} />
      </div>
      <span className="timeline-end">{x.maxT}</span>
      <span className="timeline-dir" data-dir={x.direction}>
        {x.direction === 1 ? '▶ forward' : '◀ inverse'}
      </span>
    </div>
  );
}
