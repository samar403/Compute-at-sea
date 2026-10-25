import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FLEET } from '../../shared/fleet';
import { METROS } from '../../shared/geo';
import { PALETTES, type Palette } from '../lib/theme';
import { NAV } from './Shell';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  setPalette,
  openOfficer,
}: {
  open: boolean;
  onClose: () => void;
  setPalette: (p: Palette) => void;
  openOfficer: (prompt?: string) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(
    () => [
      ...NAV.map((n) => ({
        id: `nav:${n.to}`,
        group: 'Go to',
        label: n.label,
        hint: n.blurb,
        run: () => navigate(n.to),
      })),
      ...FLEET.map((v) => ({
        id: `v:${v.id}`,
        group: 'Vessels',
        label: `${v.name} · ${v.callsign}`,
        hint: `${v.cls} · ${v.berthName}`,
        run: () => navigate(`/bridge?v=${v.id}`),
      })),
      ...METROS.map((m) => ({
        id: `m:${m.name}`,
        group: 'Find a berth near',
        label: m.name,
        hint: m.country,
        run: () => navigate(`/berth?near=${encodeURIComponent(m.name)}`),
      })),
      ...PALETTES.map((p) => ({
        id: `p:${p.id}`,
        group: 'Bridge lighting',
        label: `${p.label} palette`,
        hint: p.hint,
        run: () => setPalette(p.id),
      })),
      {
        id: 'ask',
        group: 'Bridge Officer',
        label: 'Ask the Bridge Officer…',
        hint: 'AI assistant',
        run: () => openOfficer(),
      },
      {
        id: 'ask:storm',
        group: 'Bridge Officer',
        label: 'Which vessel is in the roughest sea?',
        run: () => openOfficer('Which vessel is in the roughest sea right now?'),
      },
      {
        id: 'ask:carbon',
        group: 'Bridge Officer',
        label: 'Where is the cleanest compute right now?',
        run: () => openOfficer('Which vessel has the lowest carbon intensity right now?'),
      },
    ],
    [navigate, setPalette, openOfficer],
  );

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands.filter((c) => c.group !== 'Find a berth near').slice(0, 24);
    return commands
      .map((c) => {
        const hay = `${c.label} ${c.hint ?? ''} ${c.group}`.toLowerCase();
        const idx = hay.indexOf(t);
        const words = t.split(/\s+/).every((w) => hay.includes(w));
        return { c, score: idx === 0 ? 0 : idx > 0 ? 1 : words ? 2 : 99 };
      })
      .filter((r) => r.score < 99)
      .sort((a, b) => a.score - b.score)
      .slice(0, 30)
      .map((r) => r.c);
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="cmdk panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search vessels, metros, pages…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(results[active]);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <ul id="cmdk-list" ref={listRef} className="cmdk-list" role="listbox">
          {results.length === 0 && <li className="empty">Nothing on the chart by that name.</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="cmdk-group eyebrow">{header}</div>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  className="cmdk-item"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="faint">{c.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="cmdk-foot mono faint">↑↓ navigate · ↵ select · esc close</div>
      </div>
    </div>
  );
}
