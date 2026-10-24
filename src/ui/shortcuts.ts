import { useEffect } from 'react';
import { store } from '../state/store.ts';

/** VS Code-style debugger keys, routed to the visible tab's session. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store;
      const timeTravel = s.tab === 'compare' || s.mode === 'stepback';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.save();
        return;
      }
      switch (e.key) {
        case 'F5':
          e.preventDefault();
          if (e.shiftKey && timeTravel) s.act((x) => (x.running === 'back' ? x.pause() : x.run('back')));
          else s.act((x) => x.togglePlay());
          break;
        case 'F9':
          e.preventDefault();
          s.toggleBreakpoint(s.cursor.line);
          break;
        case 'F10':
          e.preventDefault();
          if (e.shiftKey && timeTravel) s.act((x) => x.stepBack());
          else s.act((x) => x.stepOver());
          break;
        case 'F11':
          e.preventDefault();
          s.act((x) => x.stepForward());
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
