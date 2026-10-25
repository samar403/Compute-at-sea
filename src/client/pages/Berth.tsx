import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BerthScore } from '../../shared/berth';
import { FLEET } from '../../shared/fleet';
import { formatLatLon, METROS } from '../../shared/geo';
import type { LatLon } from '../../shared/types';
import { ChartMap } from '../components/ChartMap';
import { VesselGlyph } from '../components/Instruments';
import { api, ApiError } from '../lib/api';
import { askBridge } from '../lib/ask';
import { fmt, pct } from '../lib/format';
import { useDocumentTitle, useStored } from '../lib/hooks';

const GRADE_COLOR: Record<BerthScore['grade'], string> = {
  A: 'var(--ok)',
  B: 'var(--info)',
  C: 'var(--caution)',
  D: 'var(--warn)',
  F: 'var(--warn)',
};

const ROSE_LABEL: Record<string, string> = {
  latency: 'RTT',
  wind: 'WIND',
  cooling: 'COOL',
  seastate: 'SEA',
  mooring: 'MOOR',
  jurisdiction: 'LAW',
};

/** Factor scores drawn as a compass rose: a petal per factor, length = score. */
function CompassRose({ score, size = 230 }: { score: BerthScore; size?: number }) {
  const c = size / 2;
  const R = size / 2 - 26;
  const n = score.factors.length;
  const petal = (i: number, v: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = (v / 100) * R;
    const w = (Math.PI / n) * 0.62;
    const p = (ang: number, rr: number) => `${c + Math.cos(ang) * rr},${c + Math.sin(ang) * rr}`;
    return `M${c},${c} L${p(a - w, r * 0.55)} L${p(a, r)} L${p(a + w, r * 0.55)} Z`;
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="rose"
      role="img"
      aria-label={score.factors.map((f) => `${f.label} ${Math.round(f.score)}`).join(', ')}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle
          key={f}
          cx={c}
          cy={c}
          r={R * f}
          fill="none"
          stroke="var(--line)"
          strokeDasharray={f === 1 ? undefined : '2 3'}
        />
      ))}
      {Array.from({ length: 32 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2;
        const l = i % 8 === 0 ? 10 : i % 4 === 0 ? 6 : 3;
        return (
          <line
            key={i}
            x1={c + Math.cos(a) * (R + 4)}
            y1={c + Math.sin(a) * (R + 4)}
            x2={c + Math.cos(a) * (R + 4 + l)}
            y2={c + Math.sin(a) * (R + 4 + l)}
            stroke="var(--ink-2)"
          />
        );
      })}
      {score.factors.map((f, i) => (
        <path
          key={f.key}
          d={petal(i, Math.max(4, f.score))}
          fill={i % 2 ? 'var(--ink)' : 'var(--accent)'}
          opacity={i % 2 ? 0.75 : 0.85}
          className="rose-petal"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
      {score.factors.map((f, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * (R + 20);
        const y = c + Math.sin(a) * (R + 20);
        return (
          <text key={f.key} x={x} y={y + 3} textAnchor="middle" className="axis-label">
            {ROSE_LABEL[f.key]}
          </text>
        );
      })}
      <circle cx={c} cy={c} r="3" fill="var(--ink)" />
    </svg>
  );
}

function ScoreCard({
  score,
  onSave,
  saved,
}: {
  score: BerthScore;
  onSave: () => void;
  saved: boolean;
}) {
  if (score.onLand)
    return (
      <div className="scorecard panel ticked">
        <div className="scorecard-top">
          <div className="grade" style={{ ['--g' as string]: GRADE_COLOR.F }}>
            —
          </div>
          <div>
            <p className="eyebrow">{formatLatLon(score.point)}</p>
            <h2>Dry land</h2>
            <p className="muted">{score.verdict}</p>
          </div>
        </div>
      </div>
    );
  const c = score.climate!;
  return (
    <div className="scorecard panel ticked">
      <div className="scorecard-top">
        <div
          className="grade"
          style={{ ['--g' as string]: GRADE_COLOR[score.grade] }}
          aria-label={`Grade ${score.grade}`}
        >
          {score.grade}
        </div>
        <div>
          <p className="eyebrow">{formatLatLon(score.point)}</p>
          <h2>
            <span className="num">{fmt(score.total, 0)}</span>
            <small className="faint">/100</small>
          </h2>
          <p className="muted">{score.verdict}</p>
        </div>
      </div>
      <div className="scorecard-body">
        <CompassRose score={score} />
        <ul className="factors">
          {score.factors.map((f) => (
            <li key={f.key}>
              <div className="factor-head">
                <span>{f.label}</span>
                <span className="mono faint">×{f.weight.toFixed(2)}</span>
                <b className="num">{fmt(f.score, 0)}</b>
              </div>
              <div className="factor-bar">
                <span style={{ width: `${f.score}%` }} />
              </div>
              <p className="faint">{f.detail}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="scorecard-cols">
        <dl className="kv">
          <dt>Zone</dt>
          <dd>{score.zone?.toUpperCase()}</dd>
          <dt>To coast</dt>
          <dd>{fmt(score.coastKm, 0)} km</dd>
          <dt>Expected PUE</dt>
          <dd>{fmt(score.expectedPue ?? 0, 3)}</dd>
          <dt>Wind CF</dt>
          <dd>{pct(c.capacityFactor)}</dd>
        </dl>
        <dl className="kv">
          <dt>Hs P50 / P90</dt>
          <dd>
            {fmt(c.hsP50)} / {fmt(c.hsP90)} m
          </dd>
          <dt>Year max Hs</dt>
          <dd>{fmt(c.hsMax)} m</dd>
          <dt>Rough / storm</dt>
          <dd>
            {pct(c.roughFraction, 1)} / {pct(c.stormFraction, 1)}
          </dd>
          <dt>SST mean / max</dt>
          <dd>
            {fmt(c.meanSst)} / {fmt(c.maxSst)} °C
          </dd>
        </dl>
      </div>
      <div className="scorecard-metros">
        {score.metros.map((m) => (
          <span key={m.name} className="chip">
            {m.name} <b className="num">{fmt(m.rttMs, 1)} ms</b>
          </span>
        ))}
      </div>
      <div className="scorecard-actions">
        <button className="btn btn-sm" onClick={onSave} disabled={saved}>
          {saved ? 'Logged as candidate' : 'Log as candidate'}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() =>
            askBridge(
              `Score a berth at ${score.point.lat.toFixed(2)}, ${score.point.lon.toFixed(2)} and tell me the main risk.`,
            )
          }
        >
          Ask the officer
        </button>
      </div>
    </div>
  );
}

interface Candidate {
  p: LatLon;
  total: number;
  grade: BerthScore['grade'];
  label: string;
}

export default function Berth() {
  useDocumentTitle('Berth planner');
  const [params, setParams] = useSearchParams();
  const [score, setScore] = useState<BerthScore | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ p: LatLon; k: number } | null>(null);
  const [survey, setSurvey] = useState<BerthScore[]>([]);
  const [metro, setMetro] = useState(params.get('near') ?? '');
  const [candidates, setCandidates] = useStored<Candidate[]>('cas.berths', []);

  const pick = useCallback(async (p: LatLon) => {
    setBusy(true);
    setError(null);
    try {
      setScore(
        await api.get<BerthScore>(`/berth/score?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Survey failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const runSurvey = useCallback(
    async (name: string) => {
      if (!name) return;
      setBusy(true);
      setError(null);
      setParams({ near: name }, { replace: true });
      try {
        const r = await api.get<{ metro: LatLon; best: BerthScore[] }>(
          `/berth/search?metro=${encodeURIComponent(name)}`,
        );
        setSurvey(r.best);
        setFocus({ p: r.metro, k: 9 });
        if (r.best[0]) setScore(r.best[0]);
        else setError('No open water within 150 km.');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Survey failed');
      } finally {
        setBusy(false);
      }
    },
    [setParams],
  );

  useEffect(() => {
    const near = params.get('near');
    if (near) void runSurvey(near);
    else void pick({ lat: 36.5, lon: -9.9 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saved =
    !!score &&
    candidates.some(
      (c) =>
        Math.abs(c.p.lat - score.point.lat) < 1e-3 && Math.abs(c.p.lon - score.point.lon) < 1e-3,
    );

  return (
    <div className="page berth">
      <header className="page-head">
        <div>
          <p className="eyebrow">Siting · click any water to survey it</p>
          <h1>Berth planner</h1>
        </div>
        <form
          className="survey-form"
          onSubmit={(e) => {
            e.preventDefault();
            void runSurvey(metro);
          }}
        >
          <label className="field">
            <span>Survey the best berths near</span>
            <select className="input" value={metro} onChange={(e) => setMetro(e.target.value)}>
              <option value="">Choose a coastal metro…</option>
              {METROS.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={!metro || busy}>
            Survey
          </button>
        </form>
      </header>

      <div className="berth-grid">
        <div className="panel chart-panel berth-chart">
          <ChartMap
            ariaLabel="Siting chart. Click on water to score a berth."
            onPick={pick}
            focus={focus}
            minHeight={520}
          >
            {(c) => (
              <>
                {FLEET.map((v) => {
                  const xy = c.project(v.berth);
                  return xy ? (
                    <VesselGlyph
                      key={v.id}
                      x={xy[0]}
                      y={xy[1]}
                      cls={v.cls}
                      status="operational"
                      label={c.k > 4 ? v.name : undefined}
                      scale={0.7}
                    />
                  ) : null;
                })}
                {candidates.map((cd, i) => {
                  const xy = c.project(cd.p);
                  return xy ? (
                    <g key={i} transform={`translate(${xy[0]},${xy[1]})`} className="cand-mark">
                      <rect x="-7" y="-7" width="14" height="14" transform="rotate(45)" />
                      <text y="3.5" textAnchor="middle">
                        {i + 1}
                      </text>
                    </g>
                  ) : null;
                })}
                {survey.map((s, i) => {
                  const xy = c.project(s.point);
                  return xy ? (
                    <g
                      key={`s${i}`}
                      transform={`translate(${xy[0]},${xy[1]})`}
                      className="survey-mark"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setScore(s)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Survey candidate ${i + 1}, grade ${s.grade}`}
                    >
                      <circle r="9" />
                      <text y="3.5" textAnchor="middle">
                        {s.grade}
                      </text>
                    </g>
                  ) : null;
                })}
                {score &&
                  (() => {
                    const xy = c.project(score.point);
                    return xy ? (
                      <g transform={`translate(${xy[0]},${xy[1]})`} className="pick-mark">
                        <circle r="16" className="pick-pulse" />
                        <path d="M-12 0 H-4 M4 0 H12 M0 -12 V-4 M0 4 V12" />
                        <circle r="3" />
                      </g>
                    ) : null;
                  })()}
              </>
            )}
          </ChartMap>
          {busy && (
            <div className="chart-busy">
              <span className="spinner" /> <span className="mono">Taking soundings…</span>
            </div>
          )}
        </div>
        <div className="berth-side">
          {error && (
            <div className="panel panel-body field-error" role="alert">
              {error}
            </div>
          )}
          {score ? (
            <ScoreCard
              score={score}
              saved={saved}
              onSave={() =>
                setCandidates((cs) => [
                  ...cs.slice(-7),
                  {
                    p: score.point,
                    total: score.total,
                    grade: score.grade,
                    label: score.metros[0] ? `near ${score.metros[0].name}` : 'open ocean',
                  },
                ])
              }
            />
          ) : (
            <div className="panel empty">Click any patch of water.</div>
          )}
          {candidates.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <h3>Candidate log</h3>
                <button className="btn btn-sm btn-ghost" onClick={() => setCandidates([])}>
                  Clear
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Position</th>
                    <th>Grade</th>
                    <th className="r">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {[...candidates]
                    .map((c, i) => ({ c, i }))
                    .sort((a, b) => b.c.total - a.c.total)
                    .map(({ c, i }) => (
                      <tr
                        key={i}
                        className="clickable"
                        onClick={() => {
                          void pick(c.p);
                          setFocus({ p: c.p, k: 6 });
                        }}
                      >
                        <td className="mono">{i + 1}</td>
                        <td>
                          <span className="mono">{formatLatLon(c.p)}</span>
                          <br />
                          <span className="faint">{c.label}</span>
                        </td>
                        <td>
                          <b style={{ color: GRADE_COLOR[c.grade] }}>{c.grade}</b>
                        </td>
                        <td className="r num">{fmt(c.total, 0)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <p className="page-note faint">
        Scores combine a year of modelled metocean statistics (wind, waves, sea temperature), fibre
        round-trip time to coastal metros, distance to shore from Natural Earth coastlines and
        UNCLOS zones. Weights: latency 24 %, wind 20 %, sea state 20 %, cooling 14 %, mooring 12 %,
        jurisdiction 10 %.
      </p>
    </div>
  );
}
