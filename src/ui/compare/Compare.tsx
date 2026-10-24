import { useStore } from '../../state/store.ts';
import { DropPrompt } from '../DropTarget.tsx';
import { fmtBytes } from '../format.ts';
import { Toolbar } from '../ide/Toolbar.tsx';
import { Timeline } from '../ide/Timeline.tsx';
import { CpuView } from '../viz/CpuView.tsx';

const SIDES = [
  {
    title: 'Classic',
    engine: 'logging VM',
    how: 'Saves what every step overwrites, and restores it to step back.',
  },
  {
    title: 'Reversible',
    engine: 'new VM',
    how: 'Keeps nothing: steps back by running each instruction’s inverse.',
  },
];

export function Compare() {
  const s = useStore();
  const x = s.cmp;
  const f = s.active;

  return (
    <div className="compare">
      <div className="panel-header">
        <span className="panel-title">Comparison</span>
        <span className="compare-file">{f ? f.name : 'no file'}</span>
        {x.loaded && (
          <span className={`chip static ${x.agree ? 'fwd' : 'bad'}`}>
            {x.agree
              ? x.firstDivergence === null ? '✓ identical state at every step' : `✓ agree now (diverged at t = ${x.firstDivergence})`
              : `✕ engines disagree${x.firstDivergence !== null ? ` since t = ${x.firstDivergence}` : ''}`}
          </span>
        )}
        {f && !f.asm.ok && <span className="chip static bad">{f.asm.errors.length} problems: fix them in the Visualiser tab</span>}
      </div>
      {x.loaded ? (
        <>
          <Toolbar variant="compare" />
          <Timeline session={x} />
          <div className="compare-grid">
            {SIDES.map((side, i) => {
              const vm = x.vms[i];
              const perStep = vm && vm.instructionCount ? vm.historyBytes / vm.instructionCount : 0;
              return (
                <section key={side.title} className="compare-col" aria-label={`${side.title} machine`}>
                  <header className="compare-head">
                    <div>
                      <div className="compare-title">
                        {side.title} <span className="compare-engine">{side.engine}</span>
                      </div>
                      <div className="compare-how">{side.how}</div>
                    </div>
                    <dl className="compare-stats">
                      <div><dt>t</dt><dd>{vm?.instructionCount ?? 0}</dd></div>
                      <div><dt>history</dt><dd className={i === 0 ? 'hist-log' : 'hist-rev'}>{fmtBytes(vm?.historyBytes ?? 0)}</dd></div>
                      <div><dt>per step</dt><dd>{perStep ? `${perStep.toFixed(1)} B` : '0 B'}</dd></div>
                      <div><dt>status</dt><dd className={x.lastStatus[i] === 'fault' ? 'bad' : ''}>{x.statusText(i)}</dd></div>
                    </dl>
                  </header>
                  <CpuView session={x} vmIndex={i} idPrefix={`cmp${i}`} memBase={s.memBase} compact />
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <DropPrompt />
      )}
    </div>
  );
}
