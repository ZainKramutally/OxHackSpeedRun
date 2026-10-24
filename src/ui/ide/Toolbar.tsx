import { SPEEDS } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { Icon, type IconName } from '../Icon.tsx';

function Btn({ icon, label, onClick, disabled, primary, kbd }: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  kbd?: string;
}) {
  return (
    <button className={`tool ${primary ? 'primary' : ''}`} onClick={onClick} disabled={disabled} title={kbd ? `${label} (${kbd})` : label} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}

/** Debugger controls. `compare` drives both engines of the Comparison tab together. */
export function Toolbar({ variant }: { variant: 'classic' | 'stepback' | 'compare' }) {
  const s = useStore();
  const x = variant === 'compare' ? s.cmp : s.ide;
  const go = (fn: (x: typeof s.ide) => void) => () => s.act(fn);
  const canRun = !!s.active && s.active.asm.ok;
  // While the source is stale we still allow actions: they reassemble and restart.
  const atEnd = !s.stale && x.atEnd;
  const atStart = !s.stale && x.atStart;
  const playing = x.running === 'fwd';

  return (
    <div className="toolbar">
      {variant === 'classic' ? (
        <div className="tool-group">
          <Btn icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Run'} kbd="F5" primary onClick={go((y) => y.togglePlay())} disabled={!canRun || (!playing && atEnd)} />
          <Btn icon="stepInto" label="Step into" kbd="F11" onClick={go((y) => y.stepForward())} disabled={!canRun || atEnd} />
          <Btn icon="stepOver" label="Step over" kbd="F10" onClick={go((y) => y.stepOver())} disabled={!canRun || atEnd} />
          <Btn icon="cursor" label="Run to cursor" onClick={() => s.runToCursor()} disabled={!canRun || atEnd} />
          <Btn icon="restart" label="Restart" onClick={go((y) => y.restart())} disabled={!canRun} />
        </div>
      ) : (
        <>
          <div className="tool-group transport">
            <Btn icon="toStart" label="Go to start (t = 0)" onClick={go((y) => y.toStart())} disabled={!canRun || atStart} />
            <Btn
              icon={x.running === 'back' ? 'pause' : 'reverse'}
              label={x.running === 'back' ? 'Pause' : 'Reverse run'}
              kbd="Shift+F5"
              onClick={go((y) => (y.running === 'back' ? y.pause() : y.run('back')))}
              disabled={!canRun || (!x.running && atStart)}
            />
            <Btn icon="stepBack" label="Step back" kbd="Shift+F10" onClick={go((y) => y.stepBack())} disabled={!canRun || atStart} />
            <Btn icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Run'} kbd="F5" primary onClick={go((y) => y.togglePlay())} disabled={!canRun || (!playing && atEnd)} />
            <Btn icon="stepFwd" label="Step forward" kbd="F11" onClick={go((y) => y.stepForward())} disabled={!canRun || atEnd} />
            <Btn icon="toEnd" label="Run to end" onClick={go((y) => y.runToEnd())} disabled={!canRun || atEnd} />
          </div>
          <button className="step-back-btn" onClick={go((y) => y.stepBack())} disabled={!canRun || atStart} title="Step back (Shift+F10)">
            Step back
          </button>
          <div className="segmented small" role="radiogroup" aria-label="Program direction">
            <button role="radio" aria-checked={x.direction === 1} className={x.direction === 1 ? 'on' : ''} onClick={go((y) => y.setDirection(1))} disabled={!canRun} title="Run the program normally">
              Forward
            </button>
            <button role="radio" aria-checked={x.direction === -1} className={x.direction === -1 ? 'on rev' : ''} onClick={go((y) => y.setDirection(-1))} disabled={!canRun} title="Run the program as its own inverse">
              Inverse
            </button>
          </div>
          {variant === 'stepback' && (
            <label className="select-wrap small" title="Which VM engine runs the program">
              <span className="sr-only">Engine</span>
              <select value={s.engine} onChange={(e) => s.setEngine(e.target.value as 'reversible' | 'logging')}>
                <option value="reversible">Reversible VM (no log)</option>
                <option value="logging">Logging VM (oracle)</option>
              </select>
            </label>
          )}
        </>
      )}
      <div className="tool-spacer" />
      <label className="speed" title="Run speed (steps per second)">
        <span className="speed-label">{SPEEDS[s.speed]}/s</span>
        <input type="range" min={0} max={SPEEDS.length - 1} value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} aria-label="Run speed" />
      </label>
      <div className="time-readout" aria-live="polite">
        <span className="time-label">Time</span>
        <span className="time-value">t = {x.t}</span>
      </div>
    </div>
  );
}
