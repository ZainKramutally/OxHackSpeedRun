import { useStore } from './state/store.ts';
import { TopBar } from './ui/TopBar.tsx';
import { SplitPane } from './ui/SplitPane.tsx';
import { DropTarget } from './ui/DropTarget.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Ide } from './ui/ide/Ide.tsx';
import { CpuView } from './ui/viz/CpuView.tsx';
import { Compare } from './ui/compare/Compare.tsx';
import { useShortcuts } from './ui/shortcuts.ts';

export function App() {
  const s = useStore();
  useShortcuts();
  return (
    <DropTarget>
      <div className="app">
        <TopBar />
        <main className="app-main">
          {s.tab === 'visualiser' ? (
            <SplitPane
              fraction={s.split}
              onChange={(f) => s.setSplit(f)}
              left={<Ide />}
              right={<CpuView session={s.ide} vmIndex={0} idPrefix="ide" memBase={s.memBase} />}
            />
          ) : (
            <Compare />
          )}
        </main>
        <StatusBar />
      </div>
    </DropTarget>
  );
}
