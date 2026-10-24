import { useStore, type Tab } from '../state/store.ts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'visualiser', label: 'Visualiser' },
  { id: 'compare', label: 'Comparison' },
];

export function TopBar() {
  const s = useStore();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>⟲</span>
        <span className="brand-name">RevVM</span>
        <span className="brand-sub">reversible machine IDE</span>
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={s.tab === t.id}
            className={`tab ${s.tab === t.id ? 'active' : ''}`}
            onClick={() => s.setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
