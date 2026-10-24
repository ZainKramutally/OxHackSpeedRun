import { useRef, useState, type ReactNode } from 'react';
import { ACCEPTED, store, type DroppedFile } from '../state/store.ts';

type HandleItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/** The only way into the app: drop assembly files anywhere on the window. */
export function DropTarget({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    // Grab files and (where supported) writable handles synchronously, before the event ends.
    const items = Array.from(e.dataTransfer.items).filter((i) => i.kind === 'file') as HandleItem[];
    const pending = items.map((item) => ({
      file: item.getAsFile(),
      handle: item.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null),
    }));
    const dropped: DroppedFile[] = [];
    const rejected: string[] = [];
    for (const p of pending) {
      if (!p.file) continue;
      if (!ACCEPTED.test(p.file.name)) {
        rejected.push(p.file.name);
        continue;
      }
      const [text, handle] = await Promise.all([p.file.text(), p.handle]);
      dropped.push({ name: p.file.name, text, handle: handle?.kind === 'file' ? (handle as FileSystemFileHandle) : undefined });
    }
    store.openFiles(dropped, rejected);
  };

  return (
    <div
      className="drop-root"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      {children}
      {over && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-card">
            <div className="drop-icon">⤓</div>
            <div className="drop-title">Drop to open</div>
            <div className="drop-sub">.s or .asm assembly files</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown wherever a program is needed but none is open. */
export function DropPrompt({ compact }: { compact?: boolean }) {
  return (
    <div className={`drop-prompt ${compact ? 'compact' : ''}`}>
      <div className="drop-prompt-box">
        <div className="drop-icon">⤓</div>
        <div className="drop-title">Drop an assembly file here</div>
        <div className="drop-sub">
          Drag a <code>.s</code> file from your computer onto this window. Try the ones in the
          <code>examples/</code> folder: <code>multiply.s</code>, <code>fibonacci.s</code>, <code>cipher.s</code>,
          <code>draw.s</code>, <code>procedures.s</code>, <code>bad-landing.s</code>.
        </div>
      </div>
    </div>
  );
}
