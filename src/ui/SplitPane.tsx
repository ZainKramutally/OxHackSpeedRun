import { useRef, type ReactNode } from 'react';

interface Props {
  left: ReactNode;
  right: ReactNode;
  /** Width of the left pane as a fraction of the whole. */
  fraction: number;
  onChange: (fraction: number) => void;
}

/** Two panes with a draggable divider (keyboard: arrow keys on the handle). */
export function SplitPane({ left, right, fraction, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = root.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => onChange((ev.clientX - rect.left) / rect.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onChange(fraction - 0.02);
    if (e.key === 'ArrowRight') onChange(fraction + 0.02);
  };

  return (
    <div className="split" ref={root} style={{ gridTemplateColumns: `${fraction}fr 10px ${1 - fraction}fr` }}>
      <section className="pane">{left}</section>
      <div
        className="split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(fraction * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onChange(0.46)}
        title="Drag to resize · double-click to reset"
      >
        <span className="split-grip" aria-hidden>⇔</span>
      </div>
      <section className="pane">{right}</section>
    </div>
  );
}
