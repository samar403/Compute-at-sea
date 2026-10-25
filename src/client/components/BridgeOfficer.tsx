import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { Flag } from './Flag';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  mode?: 'claude' | 'rules';
}

const SUGGESTIONS = [
  'Give me a fleet overview',
  'Which vessel is in the roughest sea?',
  'Where is the cleanest compute right now?',
  'What’s closest to Tokyo?',
  'Quote 2048 b200 for 24 months',
  'Score a berth at 36.5, -9.9',
];

/** Render the officer's restrained markdown: **bold**, _italic_ and "- " bullets. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length)
      blocks.push(
        <ul key={`u${blocks.length}`}>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
    bullets = [];
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) bullets.push(m[1]);
    else {
      flush();
      if (line.trim())
        blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

export function BridgeOfficer({
  open,
  onClose,
  seed,
}: {
  open: boolean;
  onClose: () => void;
  seed: { prompt: string; n: number } | null;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ai: boolean; model: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && !status)
      api
        .get<{ ai: boolean; model: string | null }>('/ask/status')
        .then(setStatus)
        .catch(() => {});
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history: Turn[] = [...turns, { role: 'user', content }];
    setTurns(history);
    setDraft('');
    setBusy(true);
    try {
      const r = await api.post<{
        answer: string;
        mode: 'claude' | 'rules';
        toolCalls: Array<{ name: string }>;
      }>('/ask', {
        messages: history.slice(-12).map(({ role, content }) => ({ role, content })),
      });
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: r.answer,
          tools: r.toolCalls.map((c) => c.name),
          mode: r.mode,
        },
      ]);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'The bridge did not answer. Check the connection and try again.';
      setTurns((t) => [...t, { role: 'assistant', content: `_${msg}_` }]);
    } finally {
      setBusy(false);
    }
  };

  // Seeded prompts from the command palette or other pages.
  useEffect(() => {
    if (seed && open) void send(seed.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  return (
    <aside
      className={`officer ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
      aria-label="Bridge Officer"
      inert={!open}
    >
      <header className="officer-head">
        <Flag letter="K" size={16} />
        <div>
          <h2>Bridge Officer</h2>
          <p className="mono faint">
            {status
              ? status.ai
                ? `Claude · ${status.model}`
                : 'Rules mode · set ANTHROPIC_API_KEY for Claude'
              : 'Raising the bridge…'}
          </p>
        </div>
        <button
          className="btn btn-sm btn-icon btn-ghost"
          onClick={onClose}
          aria-label="Close Bridge Officer"
        >
          ✕
        </button>
      </header>
      <div className="officer-log" ref={scrollRef} aria-live="polite">
        {turns.length === 0 && (
          <div className="officer-intro">
            <p>
              Officer of the watch here. I read the same live telemetry as the console. Ask about a
              vessel, the weather, latency, carbon, a berth or a charter price.
            </p>
            <div className="officer-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`turn turn-${t.role}`}>
            {t.role === 'assistant' ? <Markdown text={t.content} /> : <p>{t.content}</p>}
            {t.tools && t.tools.length > 0 && (
              <div className="turn-tools mono faint">
                {t.mode === 'claude' ? 'Claude used' : 'Read'}: {t.tools.join(' · ')}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="turn turn-assistant turn-busy">
            <span className="spinner" /> <span className="faint">Checking the instruments…</span>
          </div>
        )}
      </div>
      <form
        className="officer-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          className="input"
          placeholder="Signal the bridge…"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          aria-label="Message to the Bridge Officer"
        />
        <button className="btn btn-primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
