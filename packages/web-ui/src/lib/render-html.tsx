import { useEffect, useRef, useState } from 'react';

interface Props {
  content: string;
  title?: string;
}

/**
 * Render stored HTML inside a sandboxed iframe via srcDoc.
 * Deliberately omits `allow-scripts` — stored HTML is data, not code.
 *
 * Includes a toolbar with a fullscreen toggle. In fullscreen the iframe
 * fills the viewport (CSS `position: fixed; inset: 0`); ESC exits.
 */
export function HtmlDocFrame({ content, title }: Props) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Auto-height the iframe to match its body — only when NOT fullscreen.
  // In fullscreen mode CSS forces height: 100%, so JS resizing would fight it.
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    if (fullscreen) {
      iframe.style.height = '';
      return;
    }
    const resize = () => {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight;
        if (h && h > 0) iframe.style.height = `${Math.min(h + 16, 4000)}px`;
      } catch { /* cross-origin shouldn't happen with srcdoc, but be defensive */ }
    };
    iframe.addEventListener('load', resize);
    const t = window.setTimeout(resize, 100);
    return () => {
      iframe.removeEventListener('load', resize);
      window.clearTimeout(t);
    };
  }, [content, fullscreen]);

  // ESC exits fullscreen; lock body scroll so background page doesn't shift.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setFullscreen(false); }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  return (
    <div className={`doc-iframe-wrap${fullscreen ? ' fullscreen' : ''}`}>
      <div className="doc-iframe-toolbar">
        {fullscreen && <span className="fs-title">{title || 'document'}</span>}
        <button
          type="button"
          className="doc-iframe-btn"
          onClick={() => setFullscreen((f) => !f)}
          title={fullscreen ? 'exit fullscreen  ( esc )' : 'fullscreen'}
          aria-label={fullscreen ? 'exit fullscreen' : 'fullscreen'}
          aria-pressed={fullscreen}
        >
          <span className="icon">{fullscreen ? '✕' : '⛶'}</span>
          <span>{fullscreen ? 'close' : 'fullscreen'}</span>
        </button>
      </div>
      <iframe
        ref={ref}
        title="document"
        srcDoc={content}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="doc-iframe"
      />
    </div>
  );
}
