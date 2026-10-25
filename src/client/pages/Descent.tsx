import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { tco, TCO_DEFAULTS } from '../../shared/economics';
import { CashChart } from '../components/CashChart';
import { OceanCanvas } from '../components/OceanCanvas';
import { VesselCutaway } from '../components/VesselCutaway';
import { api, ApiError } from '../lib/api';
import { useFleet } from '../lib/fleet';
import { compact, fmt, int } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

const MAX_DEPTH = 80;

/** Each section sits at a depth; the page darkens as you descend. */
function Layer({
  depth,
  id,
  children,
  className = '',
}: {
  depth: number;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const d = depth / MAX_DEPTH;
  return (
    <section
      id={id}
      className={`layer ${d > 0.62 ? 'is-deep' : ''} ${className}`}
      style={{ '--depth': d } as CSSProperties}
      data-depth={depth}
      aria-labelledby={`${id}-h`}
    >
      <div className="layer-depth mono" aria-hidden="true">
        −{depth} m
      </div>
      <div className="layer-inner">{children}</div>
    </section>
  );
}

function DepthGauge() {
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setDepth(max > 0 ? (window.scrollY / max) * MAX_DEPTH : 0);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      cancelAnimationFrame(raf);
    };
  }, []);
  const marks = [0, 10, 20, 30, 40, 50, 60, 70, 80];
  return (
    <div className="depth-gauge" aria-hidden="true">
      <div className="depth-scale">
        {marks.map((m) => (
          <span key={m} style={{ top: `${(m / MAX_DEPTH) * 100}%` }}>
            {m}
          </span>
        ))}
        <div className="depth-needle" style={{ top: `${(depth / MAX_DEPTH) * 100}%` }}>
          <b className="mono">−{depth.toFixed(0)} m</b>
        </div>
      </div>
    </div>
  );
}

function LiveStrip() {
  const { snapshot, link } = useFleet();
  const t = snapshot?.totals;
  const items = t
    ? [
        ['Vessels', String(snapshot!.vessels.length)],
        ['IT load', `${fmt(t.itLoadMW, 0)} MW`],
        ['GPUs working', int(t.activeGpus)],
        ['Fleet PUE', fmt(t.avgPue, 3)],
        ['Carbon', `${fmt(t.avgCarbon, 0)} g/kWh`],
        ['Freshwater not evaporated', `${compact(t.freshwaterSavedLph)} L/h`],
      ]
    : [];
  return (
    <div className="livestrip" aria-live="off">
      <span className={`livestrip-tag mono ${link === 'live' ? 'is-live' : ''}`}>
        <span className="dot" /> {link === 'live' ? 'Live fleet' : 'Connecting'}
      </span>
      <div className="livestrip-items">
        {items.map(([k, v]) => (
          <span key={k}>
            <span className="faint">{k}</span> <b className="num">{v}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Waitlist() {
  const [form, setForm] = useState({ email: '', company: '', mw: 10, useCase: 'training' });
  const [state, setState] = useState<{
    kind: 'idle' | 'busy' | 'done' | 'error';
    msg?: string;
    pos?: number;
  }>({ kind: 'idle' });
  const [stats, setStats] = useState<{ count: number; mw: number } | null>(null);
  useEffect(() => {
    api
      .get<{ count: number; mw: number }>('/waitlist/stats')
      .then(setStats)
      .catch(() => {});
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ kind: 'busy' });
    try {
      const r = await api.post<{
        position: number;
        duplicate: boolean;
        stats: { count: number; mw: number };
      }>('/waitlist', form);
      setStats(r.stats);
      setState({
        kind: 'done',
        pos: r.position,
        msg: r.duplicate ? 'You were already aboard.' : 'Signal received.',
      });
    } catch (err) {
      setState({
        kind: 'error',
        msg:
          err instanceof ApiError
            ? (err.details?.[0]?.message ?? err.message)
            : 'Could not reach the bridge.',
      });
    }
  };
  if (state.kind === 'done')
    return (
      <div className="waitlist-done panel ticked">
        <div className="eyebrow">Charter waitlist</div>
        <h3>
          {state.msg} You are number <span className="num">{state.pos}</span> in the queue.
        </h3>
        <p className="muted">
          We allocate berths in order of commitment. While you wait, try the{' '}
          <Link to="/charter">charter desk</Link> to price a reservation, or route a job on the{' '}
          <Link to="/router">tide router</Link>.
        </p>
      </div>
    );
  return (
    <form className="waitlist panel ticked" onSubmit={submit} noValidate>
      <div className="waitlist-grid">
        <label className="field">
          <span>Work email</span>
          <input
            className="input"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Company</span>
          <input
            className="input"
            required
            autoComplete="organization"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            Capacity needed · <b className="num">{form.mw} MW</b>
          </span>
          <input
            type="range"
            min={1}
            max={200}
            value={form.mw}
            style={{ '--fill': `${(form.mw / 200) * 100}%` } as CSSProperties}
            onChange={(e) => setForm({ ...form, mw: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Workload</span>
          <select
            className="input"
            value={form.useCase}
            onChange={(e) => setForm({ ...form, useCase: e.target.value })}
          >
            <option value="training">Frontier training</option>
            <option value="inference">Inference near a metro</option>
            <option value="sovereign">Sovereign / regulated</option>
            <option value="research">Research & batch</option>
          </select>
        </label>
      </div>
      <div className="waitlist-foot">
        <button className="btn btn-primary" disabled={state.kind === 'busy'}>
          {state.kind === 'busy' ? 'Signalling…' : 'Reserve a place in the queue'}
        </button>
        {state.kind === 'error' && (
          <span className="field-error" role="alert">
            {state.msg}
          </span>
        )}
        {stats && stats.count > 0 && (
          <span className="faint mono">
            {stats.count} teams · {fmt(stats.mw, 0)} MW requested
          </span>
        )}
      </div>
    </form>
  );
}

export default function Descent() {
  useDocumentTitle('The grid is full. The ocean isn’t.');
  const teaser = useMemo(() => tco(TCO_DEFAULTS), []);
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div className="descent">
      <DepthGauge />
      <header className="hero" ref={heroRef}>
        <OceanCanvas className="hero-canvas" />
        <div className="hero-copy">
          <p className="eyebrow">Offshore floating data-centre vessels</p>
          <h1 className="hero-title">
            The grid is full.
            <br />
            <em>The ocean isn’t.</em>
          </h1>
          <p className="hero-sub">
            Compute at Sea moors AI data centres on ships — cooled by the sea beneath them, powered
            by the wind above it, and energised in about fourteen months instead of waiting years
            for a grid connection.
          </p>
          <div className="hero-cta">
            <Link to="/bridge" className="btn btn-primary">
              Open the live bridge
            </Link>
            <Link to="/charter" className="btn">
              Charter GPUs
            </Link>
            <a href="#bottleneck" className="btn btn-ghost">
              Descend ↓
            </a>
          </div>
        </div>
        <LiveStrip />
      </header>

      <Layer depth={8} id="bottleneck">
        <p className="eyebrow">The bottleneck</p>
        <h2 id="bottleneck-h" className="layer-title">
          AI isn’t short of chips.
          <br />
          It’s short of <em>energised megawatts</em>.
        </h2>
        <div className="stats">
          <div className="stat">
            <b>3–7 yrs</b>
            <span>
              to connect a large new load to a congested grid. Interconnection queues, not GPUs, now
              set the pace of AI build-outs.
            </span>
          </div>
          <div className="stat">
            <b>~1.8 L</b>
            <span>
              of freshwater evaporated per kWh by a typical evaporatively-cooled land data centre —
              in towns already rationing it.
            </span>
          </div>
          <div className="stat">
            <b>130 kW</b>
            <span>
              in a single liquid-cooled AI rack today — roughly ten cloud racks of a decade ago. The
              heat has to go somewhere.
            </span>
          </div>
        </div>
        <p className="footnote faint">
          Ranges are indicative of public industry reporting (2024–26) and vary by market.
        </p>
      </Layer>

      <Layer depth={18} id="thesis">
        <p className="eyebrow">The thesis</p>
        <h2 id="thesis-h" className="layer-title">
          Move the computer to the energy
          <br />
          and the cold — <em>not the other way round.</em>
        </h2>
        <div className="pillars">
          <article className="pillar">
            <span className="pillar-n mono">01</span>
            <h3>Cold water, free</h3>
            <p>
              Seawater drawn from 30 m stays cool for most of the year at temperate berths. Titanium
              exchangers carry rack heat straight into it: PUE around <b>1.03–1.09</b>, no chillers,
              zero freshwater evaporated.
            </p>
          </article>
          <article className="pillar">
            <span className="pillar-n mono">02</span>
            <h3>Wind at the berth</h3>
            <p>
              Each vessel ties into the offshore wind farm beside it — buying power that would
              otherwise be curtailed or wait for its own export cable — with batteries and
              green-methanol gensets for the calm days.
            </p>
          </article>
          <article className="pillar">
            <span className="pillar-n mono">03</span>
            <h3>Shipyards, not substations</h3>
            <p>
              A hull is converted in a yard on a fixed schedule, towed to a surveyed berth and
              plugged into a short export cable. About <b>14 months</b> to power — and if demand
              moves, so do we.
            </p>
          </article>
        </div>
      </Layer>

      <Layer depth={30} id="anatomy" className="layer-wide">
        <p className="eyebrow">Anatomy of a Leviathan</p>
        <h2 id="anatomy-h" className="layer-title">
          A 330-metre hull, rebuilt <em>around the heat.</em>
        </h2>
        <p className="layer-lede muted">
          Hover or tab through the nine systems. Everything here is modelled in the live fleet
          simulation.
        </p>
        <VesselCutaway />
      </Layer>

      <Layer depth={45} id="why-now">
        <p className="eyebrow">Why now</p>
        <h2 id="why-now-h" className="layer-title">
          Four currents, <em>running the same way.</em>
        </h2>
        <ol className="currents">
          <li>
            <h3>Power became the binding constraint</h3>
            <p>
              Training runs are planned around where megawatts can be energised, not where GPUs can
              be bought.
            </p>
          </li>
          <li>
            <h3>Racks went liquid</h3>
            <p>
              100 kW+ racks need direct liquid cooling anyway. Once the heat is in water, the ocean
              is the best heat sink on Earth.
            </p>
          </li>
          <li>
            <h3>Offshore wind needs buyers</h3>
            <p>
              Wind farms face curtailment and their own grid delays. A floating load next door is a
              customer that arrives early.
            </p>
          </li>
          <li>
            <h3>Hulls and yards are ready</h3>
            <p>
              Ageing tankers and yards fluent in floating-production conversions have done this kind
              of work for oil for decades.
            </p>
          </li>
        </ol>
      </Layer>

      <Layer depth={58} id="model">
        <p className="eyebrow">How it makes money</p>
        <h2 id="model-h" className="layer-title">
          Same 40 MW. <em>Two timelines.</em>
        </h2>
        <div className="model-grid">
          <ul className="revenue">
            <li>
              <b>Reserved charters</b>
              <span>1–36 month GPU capacity, priced per GPU-hour with term discounts.</span>
            </li>
            <li>
              <b>Tide spot pool</b>
              <span>
                Batch jobs routed to whichever vessel has wind, calm water and free racks.
              </span>
            </li>
            <li>
              <b>Sovereign berths</b>
              <span>Capacity inside one nation’s EEZ — flag, crew and audit to match.</span>
            </li>
            <li>
              <b>Surplus energy</b>
              <span>When the wind out-produces the racks, the export cable sells it ashore.</span>
            </li>
          </ul>
          <div className="panel ticked model-chart">
            <div className="panel-head">
              <h3>Cumulative cash, $M</h3>
              <span className="mono faint">
                sea pays back m{teaser.seaPaybackMonth ?? '—'} · land m
                {teaser.landPaybackMonth ?? '—'}
              </span>
            </div>
            <div className="panel-body">
              <CashChart result={teaser} height={220} />
              <p className="muted" style={{ marginTop: 10 }}>
                Energising {teaser.monthsOfComputeGained} months sooner is worth{' '}
                <b className="num">{compact(teaser.extraGpuHours)}</b> extra GPU-hours.{' '}
                <Link to="/ledger">Change every assumption →</Link>
              </p>
            </div>
          </div>
        </div>
      </Layer>

      <Layer depth={70} id="risks">
        <p className="eyebrow">What could sink us</p>
        <h2 id="risks-h" className="layer-title">
          The hard parts, <em>and the plan for each.</em>
        </h2>
        <div className="risks">
          {[
            [
              'Storms',
              'Load follows a motion envelope from Hs 5.5 m; storm mode at 9 m keeps priority work alive on the battery reserve, and spot jobs fail over to sister vessels.',
            ],
            [
              'Salt & fouling',
              'Sealed, positive-pressure halls with dried air; cathodic protection on the hull; screened, UV-treated intakes.',
            ],
            [
              'Marine life',
              'Fish-safe intake velocities and diffusers that hold the plume within +1 K at 100 m, enforced by the dispatcher and reported.',
            ],
            [
              'Jurisdiction',
              'Berths inside an exclusive economic zone under coastal-state licence. Regulated data never sits on the high seas.',
            ],
            [
              'Latency',
              'Berths 20–80 km out on dual, diverse cables: 1–4 ms round trip to the metro — closer than many suburban campuses.',
            ],
            [
              'Security',
              '500 m safety zone under radar and AIS watch, crew on board around the clock, tamper-evident racks, encryption at rest.',
            ],
          ].map(([h, p]) => (
            <article key={h} className="risk">
              <h3>{h}</h3>
              <p>{p}</p>
            </article>
          ))}
        </div>
      </Layer>

      <Layer depth={80} id="seabed" className="layer-seabed">
        <p className="eyebrow">Seabed · −80 m</p>
        <h2 id="seabed-h" className="layer-title">
          Lay a cable <em>to us.</em>
        </h2>
        <p className="layer-lede">
          We’re booking the first charters on the reference fleet. Tell us how many megawatts you
          need and what you’ll run.
        </p>
        <Waitlist />
        <div className="seabed-links">
          <Link to="/bridge" className="btn">
            Watch the fleet live
          </Link>
          <Link to="/berth" className="btn">
            Score your own berth
          </Link>
          <Link to="/router" className="btn">
            Route a training run
          </Link>
        </div>
      </Layer>
    </div>
  );
}
