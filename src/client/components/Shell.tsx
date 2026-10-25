import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useFleet } from '../lib/fleet';
import { logDate, logTime } from '../lib/format';
import { PALETTES, type Palette } from '../lib/theme';
import { Flag, type FlagLetter } from './Flag';

export const NAV: Array<{ to: string; label: string; flag: FlagLetter; blurb: string }> = [
  { to: '/', label: 'Descent', flag: 'A', blurb: 'The idea, from the surface to the seabed' },
  { to: '/bridge', label: 'Bridge', flag: 'H', blurb: 'Live fleet console' },
  { to: '/berth', label: 'Berth', flag: 'P', blurb: 'Score any patch of ocean' },
  { to: '/router', label: 'Router', flag: 'R', blurb: 'Place workloads on the tide' },
  { to: '/charter', label: 'Charter', flag: 'C', blurb: 'Quote & reserve GPUs' },
  { to: '/ledger', label: 'Ledger', flag: 'E', blurb: 'Land vs sea economics' },
];

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16 1v4M16 27v4M1 16h4M27 16h4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 17h16l-2.5 4.5h-11Z" fill="var(--accent)" />
      <path d="M11 17v-6h10v6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12.5 12.5h7M12.5 14.5h7" stroke="currentColor" strokeWidth="1" />
      <path
        d="M6 24.5c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function SimClock() {
  const { snapshot, link } = useFleet();
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const t = snapshot?.t ?? Date.now();
  return (
    <div
      className="simclock"
      title={`Simulated fleet time, running ×${snapshot?.simSpeed ?? 60} real time`}
    >
      <span className={`link-dot link-${link}`} aria-hidden="true" />
      <span className="mono">
        {logTime(t)} <span className="faint">{logDate(t)}</span>
      </span>
      <span className="sr-only">
        {link === 'live' ? 'Live telemetry connected' : 'Telemetry reconnecting'}
      </span>
    </div>
  );
}

function PaletteSwitch({
  palette,
  setPalette,
}: {
  palette: Palette;
  setPalette: (p: Palette) => void;
}) {
  return (
    <div className="palette-switch" role="radiogroup" aria-label="Bridge lighting">
      {PALETTES.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={palette === p.id}
          title={`${p.label} — ${p.hint}`}
          onClick={() => setPalette(p.id)}
          className={`palette-${p.id}`}
        >
          <span className="sr-only">{p.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Shell({
  children,
  palette,
  setPalette,
  onOpenPalette,
  onOpenOfficer,
}: {
  children: ReactNode;
  palette: Palette;
  setPalette: (p: Palette) => void;
  onOpenPalette: () => void;
  onOpenOfficer: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Compute at Sea — home">
          <Logo />
          <span className="brand-name">
            Compute <em>at</em> Sea
          </span>
        </Link>
        <nav className={`mainnav ${menu ? 'is-open' : ''}`} aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="navlink" title={n.blurb}>
              <Flag letter={n.flag} size={13} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-tools">
          <SimClock />
          <button
            className="btn btn-sm kbd-btn"
            onClick={onOpenPalette}
            aria-label="Open command palette"
            title="Command palette (Ctrl/⌘ K)"
          >
            <span className="mono">⌘K</span>
          </button>
          <PaletteSwitch palette={palette} setPalette={setPalette} />
          <button
            className="btn btn-sm btn-icon menu-btn"
            aria-expanded={menu}
            aria-label="Menu"
            onClick={() => setMenu((m) => !m)}
          >
            ☰
          </button>
        </div>
      </header>
      <main id="main">{children}</main>
      <button
        className="officer-fab"
        onClick={onOpenOfficer}
        aria-label="Signal the Bridge Officer (AI assistant)"
      >
        <Flag letter="K" size={18} />
        <span>Signal the bridge</span>
      </button>
      <footer className="footer">
        <div className="footer-inner">
          <div>
            <Link to="/" className="brand">
              <Logo size={24} />
              <span className="brand-name">
                Compute <em>at</em> Sea
              </span>
            </Link>
            <p className="faint" style={{ marginTop: 8, maxWidth: 420 }}>
              Offshore floating data-centre vessels. Telemetry on this site is a physics-based
              simulation of the reference fleet; prices are a transparent model, not an offer.
            </p>
          </div>
          <ul className="footer-links">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link to={n.to}>{n.label}</Link>
              </li>
            ))}
          </ul>
          <p className="mono faint footer-coords">
            53°51′N 003°18′E · CAS-01 HALCYON · ALL TIMES UTC
          </p>
        </div>
      </footer>
    </>
  );
}
