import { useStore, type Mode } from '../../state/store.ts';
import { DropPrompt } from '../DropTarget.tsx';
import { Toolbar } from './Toolbar.tsx';
import { Editor } from './Editor.tsx';
import { Timeline } from './Timeline.tsx';
import { BottomPanel } from './BottomPanel.tsx';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Run, step and breakpoints, forwards only' },
  { id: 'stepback', label: 'Step-back', hint: 'Time travel: step back, reverse run, timeline' },
];

export function Ide() {
  const s = useStore();
  return (
    <div className="ide">
      <div className="panel-header">
        <span className="panel-title">Assembly</span>
        <div className="segmented" role="radiogroup" aria-label="Debugger mode">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={s.mode === m.id} className={s.mode === m.id ? 'on' : ''} title={m.hint} onClick={() => s.setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <FileTabs />
      {s.active ? (
        <>
          <Toolbar variant={s.mode} />
          {s.mode === 'stepback' && <Timeline session={s.ide} />}
          <Editor />
        </>
      ) : (
        <DropPrompt />
      )}
      <BottomPanel />
    </div>
  );
}

function FileTabs() {
  const s = useStore();
  if (!s.files.length) return null;
  return (
    <div className="file-tabs" role="tablist" aria-label="Open files">
      {s.files.map((f) => {
        const dirty = f.source !== f.savedSource;
        const bad = f.asm.errors.length > 0;
        return (
          <div key={f.id} role="tab" aria-selected={f.id === s.activeId} className={`file-tab ${f.id === s.activeId ? 'on' : ''}`} onClick={() => s.setActive(f.id)} title={f.name}>
            <span className={`file-dot ${bad ? 'bad' : 'ok'}`} aria-hidden />
            <span className="file-name">{f.name}</span>
            <button
              className={`file-close ${dirty ? 'dirty' : ''}`}
              aria-label={`Close ${f.name}`}
              onClick={(e) => {
                e.stopPropagation();
                s.closeFile(f.id);
              }}
            >
              <span className="when-dirty">●</span>
              <span className="when-clean">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
