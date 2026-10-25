import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GPU_MODELS, VESSEL_CLASSES } from '../../shared/fleet';
import { formatLatLon } from '../../shared/geo';
import { BEAUFORT_LABEL } from '../../shared/ocean';
import type { ForecastHour, LatLon, Telemetry, VesselSpec } from '../../shared/types';
import { spotGpus, vesselPosition } from '../../shared/vessel';
import { ChartMap } from '../components/ChartMap';
import {
  Dial,
  Horizon,
  MixBar,
  Sparkline,
  StatusChip,
  VesselGlyph,
} from '../components/Instruments';
import { Outlook } from '../components/Outlook';
import { api } from '../lib/api';
import { askBridge } from '../lib/ask';
import { useFleet } from '../lib/fleet';
import { compact, fmt, int, logTime, pct } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

interface HistoryPoint {
  t: number;
  it: number;
  pue: number;
  hs: number;
  wind: number;
  ci: number;
  soc: number;
  util: number;
}

function Kpis() {
  const { snapshot } = useFleet();
  const t = snapshot?.totals;
  const tiles = [
    { k: 'IT load', v: t ? `${fmt(t.itLoadMW, 1)}` : '—', u: 'MW' },
    { k: 'GPUs working', v: t ? int(t.activeGpus) : '—', u: '' },
    { k: 'Fleet PUE', v: t ? fmt(t.avgPue, 3) : '—', u: '' },
    { k: 'Carbon', v: t ? fmt(t.avgCarbon, 0) : '—', u: 'gCO₂/kWh' },
    { k: 'Renewable', v: t ? fmt(t.renewableShare * 100, 0) : '—', u: '%' },
    { k: 'Freshwater saved', v: t ? compact(t.freshwaterSavedLph) : '—', u: 'L/h' },
  ];
  return (
    <div className="kpis">
      {tiles.map((x) => (
        <div key={x.k} className="kpi">
          <span className="eyebrow">{x.k}</span>
          <b className="num">
            {x.v}
            {x.u && <small> {x.u}</small>}
          </b>
        </div>
      ))}
    </div>
  );
}

function Roster({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { specs, snapshot } = useFleet();
  const tm = new Map(snapshot?.vessels.map((v) => [v.vesselId, v]));
  return (
    <div className="roster panel">
      <div className="panel-head">
        <h3>Fleet roster</h3>
        <span className="mono faint">{specs.length} hulls</span>
      </div>
      <ul role="listbox" aria-label="Vessels">
        {specs.map((s) => {
          const t = tm.get(s.id);
          const load = t ? t.itLoadMW / s.itCapacityMW : 0;
          return (
            <li key={s.id}>
              <button
                role="option"
                aria-selected={selected === s.id}
                className={`roster-row ${selected === s.id ? 'is-selected' : ''}`}
                onClick={() => onSelect(s.id)}
              >
                <span className="roster-name">
                  <b>{s.name}</b>
                  <span className="mono faint">{s.callsign}</span>
                </span>
                {t && <StatusChip status={t.status} />}
                <span
                  className="roster-load"
                  title={`${fmt(t?.itLoadMW ?? 0)} of ${s.itCapacityMW} MW`}
                >
                  <span style={{ width: `${load * 100}%` }} />
                </span>
                <span className="num roster-num">{t ? fmt(t.pue, 3) : '—'}</span>
                <span className="num roster-num">{t ? `${fmt(t.sea.hs)}m` : '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="roster-cols mono faint" aria-hidden="true">
        <span>vessel</span>
        <span>status</span>
        <span>load</span>
        <span>PUE</span>
        <span>Hs</span>
      </div>
    </div>
  );
}

function VesselPanel({
  spec,
  tm,
  history,
  forecast,
}: {
  spec: VesselSpec;
  tm: Telemetry;
  history: HistoryPoint[];
  forecast: ForecastHour[];
}) {
  const cls = VESSEL_CLASSES[spec.cls];
  const gpu = GPU_MODELS[spec.gpuModel];
  const pos = vesselPosition(spec, tm.t);
  return (
    <section className="vpanel panel ticked" aria-label={`${spec.name} instruments`}>
      <header className="vpanel-head">
        <div>
          <p className="eyebrow">
            {spec.callsign} · {spec.cls} class · flag {spec.flag}
          </p>
          <h2>{spec.name}</h2>
          <p className="mono muted vpanel-pos">
            {formatLatLon(tm.position)} ·{' '}
            {pos.underway
              ? `under way → ${pos.legLabel} (${pct(pos.legProgress ?? 0)})`
              : spec.route
                ? `alongside ${pos.legLabel}`
                : spec.berthName}
          </p>
        </div>
        <StatusChip status={tm.status} />
      </header>

      <div className="vpanel-dials">
        <Dial value={tm.itLoadMW} min={0} max={spec.itCapacityMW} label="IT load" unit="MW" />
        <Dial value={tm.pue} min={1} max={1.25} label="PUE" unit="" digits={3} redFrom={1.12} />
        <Dial value={tm.sea.hs} min={0} max={12} label="Sea Hs" unit="m" redFrom={5.5} />
        <Horizon
          roll={tm.rollDeg * Math.sin(tm.t / 9000)}
          pitch={tm.pitchDeg * Math.cos(tm.t / 7000)}
          heave={tm.heaveM}
        />
      </div>

      <div className="vpanel-section">
        <div className="vpanel-sub">
          <h3>Power</h3>
          <span className="mono faint">
            facility {fmt(tm.facilityMW)} MW · battery {pct(tm.batterySoc)} ·{' '}
            {fmt(tm.carbonIntensity, 0)} gCO₂/kWh
          </span>
        </div>
        <MixBar mix={tm.mix} facilityMW={tm.facilityMW} />
      </div>

      <div className="vpanel-grid">
        <div>
          <h4 className="eyebrow">IT load · 8 h</h4>
          <Sparkline
            values={history.map((h) => h.it)}
            min={0}
            max={spec.itCapacityMW}
            color="var(--accent)"
            label="IT load, MW"
          />
        </div>
        <div>
          <h4 className="eyebrow">Wave height · 8 h</h4>
          <Sparkline
            values={history.map((h) => h.hs)}
            min={0}
            color="var(--info)"
            label="Significant wave height, m"
          />
        </div>
        <div>
          <h4 className="eyebrow">Carbon · 8 h</h4>
          <Sparkline
            values={history.map((h) => h.ci)}
            min={0}
            color="var(--genset)"
            label="Carbon intensity, g/kWh"
            format={(v) => fmt(v, 0)}
          />
        </div>
        <div>
          <h4 className="eyebrow">Battery · 8 h</h4>
          <Sparkline
            values={history.map((h) => h.soc * 100)}
            min={0}
            max={100}
            color="var(--battery)"
            label="Battery state of charge, %"
            format={(v) => fmt(v, 0)}
          />
        </div>
      </div>

      <div className="vpanel-cols">
        <dl className="kv">
          <dt>Sea surface</dt>
          <dd>{fmt(tm.sea.sst)} °C</dd>
          <dt>Intake (−30 m)</dt>
          <dd>{fmt(tm.sea.intakeTemp)} °C</dd>
          <dt>Coolant supply</dt>
          <dd>{fmt(tm.coolantSupplyC)} °C</dd>
          <dt>GPU hotspot</dt>
          <dd>{fmt(tm.gpuHotspotC)} °C</dd>
          <dt>Outfall ΔT</dt>
          <dd>+{fmt(tm.outfallDeltaK)} K</dd>
          <dt>Plume @100 m</dt>
          <dd className={tm.plumeDeltaK100m > 1 ? 'lvl-warning' : ''}>
            +{fmt(tm.plumeDeltaK100m, 2)} K
          </dd>
        </dl>
        <dl className="kv">
          <dt>Wind</dt>
          <dd>
            {fmt(tm.sea.wind)} m/s · {Math.round(tm.sea.windDir)}°
          </dd>
          <dt>Beaufort</dt>
          <dd>
            {tm.sea.beaufort} · {BEAUFORT_LABEL[tm.sea.beaufort]}
          </dd>
          <dt>Peak period</dt>
          <dd>{fmt(tm.sea.tp)} s</dd>
          <dt>Motion cap</dt>
          <dd>{pct(tm.motionCap)}</dd>
          <dt>GPUs active</dt>
          <dd>
            {int(tm.activeGpus)} / {int(spec.gpus)}
          </dd>
          <dt>RTT {spec.servesMetro}</dt>
          <dd>{fmt(tm.rttMs, 2)} ms</dd>
        </dl>
      </div>

      <div className="vpanel-section">
        <div className="vpanel-sub">
          <h3>72-hour outlook</h3>
          <span className="mono faint">spot pool = capacity beyond reserved charters</span>
        </div>
        <Outlook hours={forecast} spotOf={(f) => spotGpus(spec, f)} />
      </div>

      <footer className="vpanel-foot">
        <span className="mono faint">
          {gpu.label} · {cls.hull} · {cls.mooring}
        </span>
        <button
          className="btn btn-sm"
          onClick={() =>
            askBridge(`Give me a status report on ${spec.name} and its 48-hour outlook.`)
          }
        >
          Ask the officer about {spec.name}
        </button>
      </footer>
    </section>
  );
}

function ShipsLog({ filter }: { filter: string | null }) {
  const { snapshot, specs } = useFleet();
  const [mine, setMine] = useState(false);
  const alerts = (snapshot?.alerts ?? []).filter((a) => !mine || a.vesselId === filter);
  const name = (id: string) => specs.find((s) => s.id === id)?.name ?? id;
  return (
    <section className="shipslog panel" aria-label="Ship's log">
      <div className="panel-head">
        <h3>Ship’s log</h3>
        <label className="switch mono faint">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          this vessel only
        </label>
      </div>
      <ol className="log">
        {alerts.length === 0 && <li className="empty">All quiet. No notices on the watch.</li>}
        {alerts.map((a) => (
          <li key={a.id} className={`log-row lvl-${a.level}`}>
            <span className="mono faint">{logTime(a.t)}</span>
            <span className="log-level mono">{a.level}</span>
            <b>{name(a.vesselId)}</b>
            <span className="log-msg">{a.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Bridge() {
  useDocumentTitle('Bridge');
  const { specs, snapshot, byId } = useFleet();
  const [params, setParams] = useSearchParams();
  const selected =
    params.get('v') && specs.some((s) => s.id === params.get('v')) ? params.get('v')! : 'halcyon';
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [focus, setFocus] = useState<{ p: LatLon; k: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const select = (id: string) => {
    setParams({ v: id }, { replace: true });
    const s = byId(id);
    if (s) setFocus({ p: s.tm?.position ?? s.spec.berth, k: 3 });
  };

  useEffect(() => {
    let alive = true;
    api
      .get<{ history: HistoryPoint[] }>(`/fleet/${selected}`)
      .then((r) => alive && setHistory(r.history));
    const load = () =>
      api
        .get<{ hours: ForecastHour[] }>(`/fleet/${selected}/forecast?hours=72`)
        .then((r) => alive && setForecast(r.hours));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [selected]);

  // Append live samples to the local history as they stream in.
  const cur = byId(selected);
  const tm = cur?.tm;
  useEffect(() => {
    if (!tm) return;
    setHistory((h) => {
      if (h.length && h[h.length - 1].t >= tm.t) return h;
      const next = [
        ...h,
        {
          t: tm.t,
          it: tm.itLoadMW,
          pue: tm.pue,
          hs: tm.sea.hs,
          wind: tm.sea.wind,
          ci: tm.carbonIntensity,
          soc: tm.batterySoc,
          util: tm.utilization,
        },
      ];
      return next.length > 240 ? next.slice(-240) : next;
    });
  }, [tm]);

  const routes = useMemo(() => specs.filter((s) => s.route), [specs]);

  return (
    <div className="page bridge">
      <header className="page-head">
        <div>
          <p className="eyebrow">Fleet console · live simulation ×{snapshot?.simSpeed ?? 60}</p>
          <h1>The Bridge</h1>
        </div>
        <Kpis />
      </header>

      <div className="bridge-grid">
        <div className="bridge-left">
          <div className="panel chart-panel">
            <ChartMap ariaLabel="Fleet chart" focus={focus} minHeight={420}>
              {(c) => (
                <>
                  {routes.map((s) => {
                    const pts = s
                      .route!.waypoints.map((w) => c.project(w))
                      .filter(Boolean) as Array<[number, number]>;
                    return (
                      <polyline
                        key={s.id}
                        points={pts.map((p) => p.join(',')).join(' ')}
                        className="route-line"
                      />
                    );
                  })}
                  {specs.map((s) => {
                    const t = snapshot?.vessels.find((v) => v.vesselId === s.id);
                    const xy = c.project(t?.position ?? s.berth);
                    if (!xy) return null;
                    const pos = t ? vesselPosition(s, t.t) : null;
                    return (
                      <g
                        key={s.id}
                        className="vessel-hit"
                        role="button"
                        tabIndex={0}
                        aria-label={`${s.name}, ${t?.status ?? ''}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => select(s.id)}
                        onKeyDown={(e) => e.key === 'Enter' && select(s.id)}
                        onMouseEnter={() => setHover(s.id)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <VesselGlyph
                          x={xy[0]}
                          y={xy[1]}
                          cls={s.cls}
                          heading={pos?.underway ? pos.headingDeg : (t?.sea.windDir ?? 0)}
                          status={t?.status ?? 'operational'}
                          selected={selected === s.id}
                          label={
                            c.k > 1.6 || selected === s.id || hover === s.id ? s.name : undefined
                          }
                          scale={Math.min(1.4, 0.8 + c.k * 0.08)}
                        />
                      </g>
                    );
                  })}
                </>
              )}
            </ChartMap>
          </div>
          <Roster selected={selected} onSelect={select} />
        </div>
        <div className="bridge-right">
          {cur && tm ? (
            <VesselPanel spec={cur.spec} tm={tm} history={history} forecast={forecast} />
          ) : (
            <div className="panel empty">Raising telemetry…</div>
          )}
        </div>
      </div>
      <ShipsLog filter={selected} />
      <p className="page-note faint">
        Telemetry is a deterministic physics simulation of the reference fleet: metocean
        climatology, wind-turbine power curves, merit-order dispatch and seawater heat balance.{' '}
        <Link to="/">How it works →</Link>
      </p>
    </div>
  );
}
