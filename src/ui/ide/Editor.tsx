import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../../state/store.ts';

const LINE_H = 20;
const PAD = 8;

function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "'" && line[i + 2] === "'") i += 2;
    else if (line[i] === ';') return i;
  }
  return line.length;
}

const TOKEN = /(^\s*[A-Za-z_.$][\w.$]*:)|(\.[A-Za-z]+)|('.')|(-?0x[0-9a-f_]+|-?\b\d+\b)|(\b(?:r1[0-5]|r[0-9]|sp)\b)|([A-Za-z_][\w.$]*)|(\s+)|(.)/gi;

/** Syntax-highlight one line of assembly. */
function highlight(line: string, key: number, error: boolean): ReactNode {
  const cut = commentStart(line);
  const code = line.slice(0, cut);
  const out: ReactNode[] = [];
  let seenMnemonic = false;
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) {
    const [tok, label, directive, chr, num, reg, ident] = m;
    let cls: string | undefined;
    if (label) cls = 'tk-label';
    else if (directive) {
      cls = 'tk-directive';
      seenMnemonic = true;
    } else if (chr || num) cls = 'tk-number';
    else if (reg) cls = 'tk-reg';
    else if (ident) {
      cls = seenMnemonic ? 'tk-ref' : 'tk-mnemonic';
      seenMnemonic = true;
    } else if (tok.trim()) cls = 'tk-punct';
    out.push(cls ? <span key={i++} className={cls}>{tok}</span> : tok);
  }
  if (cut < line.length) out.push(<span key={i++} className="tk-comment">{line.slice(cut)}</span>);
  return (
    <div key={key} className={`hl-line ${error ? 'err' : ''}`}>
      {out.length ? out : '​'}
    </div>
  );
}

export function Editor() {
  const s = useStore();
  const f = s.active!;
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const lines = f.source.split('\n');
  const errorsByLine = new Map<number, string[]>();
  for (const e of f.asm.errors) errorsByLine.set(e.line, [...(errorsByLine.get(e.line) ?? []), e.message]);
  const prog = s.ide.program;
  const live = prog && prog.fileId === f.id && !s.stale && s.ide.loaded;
  const pcLine = live ? prog.asm.addrToLine[s.ide.pc] || null : null;
  const inverse = s.ide.shown[0]?.inverse ?? false;
  const longest = lines.reduce((n, l) => Math.max(n, l.replace(/\t/g, '        ').length), 0);

  // Keep the current line in view while stepping or running.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pcLine) return;
    const top = PAD + (pcLine - 1) * LINE_H;
    if (top < el.scrollTop + LINE_H || top > el.scrollTop + el.clientHeight - 2 * LINE_H) {
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3) });
    }
  }, [pcLine]);

  // Jump to a line on request (Problems panel, etc.).
  useEffect(() => {
    const el = ta.current;
    if (!el || !s.reveal) return;
    const { line } = s.reveal;
    let pos = 0;
    for (let i = 1; i < line && pos >= 0; i++) pos = el.value.indexOf('\n', pos) + 1;
    el.focus();
    el.setSelectionRange(pos, pos);
    scroller.current?.scrollTo({ top: Math.max(0, PAD + (line - 1) * LINE_H - 80) });
  }, [s.reveal?.seq]);

  const updateCursor = () => {
    const el = ta.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const line = before.split('\n').length;
    s.setCursor(line, el.selectionStart - before.lastIndexOf('\n'));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.setRangeText('\t', e.currentTarget.selectionStart, e.currentTarget.selectionEnd, 'end');
      s.setSource(e.currentTarget.value);
    }
  };

  return (
    <div className="editor-wrap">
      {s.stale && (
        <div className="editor-banner">
          Edited since load. The next step or run reassembles and restarts at t = 0.
        </div>
      )}
      <div className="editor" ref={scroller}>
        <div className="editor-inner" style={{ height: lines.length * LINE_H + 2 * PAD }}>
          <div className="gutter" style={{ paddingTop: PAD }}>
            {lines.map((_, i) => {
              const line = i + 1;
              const bp = f.breakpoints.has(line);
              const errs = errorsByLine.get(line);
              const isCode = f.asm.lineToAddr.has(line);
              return (
                <div
                  key={i}
                  className={`gutter-line ${isCode ? 'code' : ''} ${line === pcLine ? 'pc' : ''} ${errs ? 'err' : ''}`}
                  onClick={() => s.toggleBreakpoint(line)}
                  title={errs ? errs.join('\n') : isCode ? (bp ? 'Remove breakpoint (F9)' : 'Add breakpoint (F9)') : undefined}
                >
                  <span className={`bp ${bp ? 'on' : ''} ${errs ? 'err' : ''}`} aria-label={bp ? 'breakpoint' : errs ? 'error' : undefined} />
                  <span className="ln">{line}</span>
                  <span className="pc-arrow" aria-hidden>{line === pcLine ? (inverse ? '◀' : '▶') : ''}</span>
                </div>
              );
            })}
          </div>
          <div className="code-layer" style={{ minWidth: `calc(${longest}ch + ${2 * PAD + 24}px)` }}>
            {pcLine && <div className={`pc-band ${inverse ? 'rev' : ''}`} style={{ top: PAD + (pcLine - 1) * LINE_H }} />}
            {[...f.breakpoints].map((l) => (
              <div key={l} className="bp-band" style={{ top: PAD + (l - 1) * LINE_H }} />
            ))}
            <pre className="hl" aria-hidden style={{ padding: PAD }}>
              {lines.map((l, i) => highlight(l, i, errorsByLine.has(i + 1)))}
            </pre>
            <textarea
              ref={ta}
              key={f.id}
              className="code-input"
              style={{ padding: PAD }}
              value={f.source}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              aria-label={`Source of ${f.name}`}
              onChange={(e) => {
                s.setSource(e.target.value);
                updateCursor();
              }}
              onKeyDown={onKeyDown}
              onKeyUp={updateCursor}
              onClick={updateCursor}
              onSelect={updateCursor}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
