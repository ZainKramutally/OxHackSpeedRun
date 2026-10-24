// Small stroke icons for the debugger toolbar (24x24 grid, currentColor).
const PATHS = {
  play: 'M7 5v14l11-7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stepInto: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M7 20h10',
  stepOver: 'M4 14a8 8 0 0 1 15-3.5M19 5v5.5h-5.5M10 20h4',
  stepBack: 'M18 6 10 12l8 6zM7 6v12',
  stepFwd: 'M6 6l8 6-8 6zM17 6v12',
  toStart: 'M6 5v14M19 5 9 12l10 7z',
  toEnd: 'M18 5v14M5 5l10 7-10 7z',
  reverse: 'M17 5v14L6 12z',
  restart: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5',
  cursor: 'M5 12h10M11 7l5 5-5 5M19 5v14',
  flip: 'M7 7h11l-3-3M17 17H6l3 3',
} as const;

export type IconName = keyof typeof PATHS;

const FILLED: IconName[] = ['play', 'pause', 'stepBack', 'stepFwd', 'toStart', 'toEnd', 'reverse'];

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = FILLED.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
