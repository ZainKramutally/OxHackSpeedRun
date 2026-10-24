import { useStore } from '../state/store.ts';

export function StatusBar() {
  const s = useStore();
  const f = s.active;
  const sess = s.session;
  const errors = f?.asm.errors.length ?? 0;
  return (
    <footer className="statusbar">
      {f ? (
        <>
          <span className="sb-item">{f.name}{f.source !== f.savedSource ? ' ●' : ''}</span>
          <button className={`sb-item sb-btn ${errors ? 'bad' : 'good'}`} onClick={() => s.setBottomTab('problems')}>
            {errors ? `✕ ${errors} problem${errors === 1 ? '' : 's'}` : `✓ ${f.asm.code.length} code · ${f.asm.data.length} data words`}
          </button>
          {s.stale && <span className="sb-item warn">edited since load: reassembles on next step</span>}
        </>
      ) : (
        <span className="sb-item">No file open: drop a .s file to start</span>
      )}
      <span className="sb-spacer" />
      {s.tab === 'visualiser' && f && <span className="sb-item">Ln {s.cursor.line}, Col {s.cursor.col}</span>}
      {s.tab === 'compare' && sess.loaded && (
        <span className={`sb-item ${sess.agree ? 'good' : 'bad'}`}>{sess.agree ? 'engines agree' : 'engines disagree'}</span>
      )}
      {s.tab === 'visualiser' && <span className="sb-item">{s.mode === 'classic' ? 'Classic' : 'Step-back'} · {s.engine} VM</span>}
      <span className="sb-item">{sess.statusText()}</span>
    </footer>
  );
}
