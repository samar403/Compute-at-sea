import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { FLEET, GPU_MODELS } from '../../shared/fleet';
import { METROS } from '../../shared/geo';
import type { Job, Placement, Plan } from '../../shared/scheduler';
import type { ForecastHour } from '../../shared/types';
import { spotGpus } from '../../shared/vessel';
import { api, ApiError } from '../lib/api';
import { compact, fmt, int, pct } from '../lib/format';
import { useDocumentTitle, useSize } from '../lib/hooks';

const HUES = [14, 200, 152, 280, 42, 330, 100, 236];
const jobColor = (i: number) => `hsl(${HUES[i % HUES.length]} 62% 52%)`;

interface PlanResponse {
  jobs: Job[];
  plan: Plan;
  forecasts: Record<string, ForecastHour[]>;
}

/** Merge consecutive hourly segments into runs for drawing. */
function runs(p: Placement): Array<{ from: number; to: number; gpus: number }> {
  const out: Array<{ from: number; to: number; gpus: number }> = [];
  for (const s of p.segments) {
    const last = out[out.length - 1];
    if (last && last.to === s.hour) {
      last.to = s.hour + 1;
      last.gpus = Math.max(last.gpus, s.gpus);
    } else out.push({ from: s.hour, to: s.hour + 1, gpus: s.gpus });
  }
  return out;
}

function TidePlan({
  data,
  colorOf,
  onHover,
  hoverJob,
}: {
  data: PlanResponse;
  colorOf: (id: string) => string;
  onHover: (id: string | null) => void;
  hoverJob: string | null;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const hours = data.plan.hours;
  const labelW = 110;
  const W = Math.max(100, width - labelW - 30);
  const hw = W / hours;
  const laneH = 14;

  const rows = FLEET.map((v) => {
    const ps = data.plan.placements
      .filter((p) => p.vesselId === v.id)
      .sort((a, b) => a.startHour - b.startHour);
    const lanes: number[] = [];
    const placed = ps.map((p) => {
      let lane = lanes.findIndex((end) => end <= p.startHour);
      if (lane === -1) {
        lanes.push(0);
        lane = lanes.length - 1;
      }
      lanes[lane] = p.finishHour;
      return { p, lane };
    });
    return { v, placed, lanes: Math.max(1, lanes.length) };
  });

  let y = 22;
  const layout = rows.map((r) => {
    const h = Math.max(38, r.lanes * (laneH + 3) + 14);
    const top = y;
    y += h;
    return { ...r, top, h };
  });
  const height = y + 8;

  return (
    <div ref={ref} className="tideplan">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Tide plan: jobs placed on each vessel over the planning horizon"
        >
          {Array.from({ length: Math.floor(hours / 12) + 1 }, (_, i) => i * 12).map((h) => (
            <g key={h}>
              <line
                x1={labelW + h * hw}
                x2={labelW + h * hw}
                y1={16}
                y2={height - 6}
                stroke="var(--line)"
              />
              <text x={labelW + h * hw + 3} y={12} className="axis-label">
                {h === 0 ? 'now' : `+${h}h`}
              </text>
            </g>
          ))}
          {layout.map(({ v, placed, top, h }) => {
            const f = data.forecasts[v.id] ?? [];
            const residual = data.plan.residual[v.id] ?? [];
            const cap = Math.max(1, ...f.map((x) => spotGpus(v, x)));
            return (
              <g key={v.id}>
                <text x={0} y={top + 14} className="tide-vessel">
                  {v.name}
                </text>
                <text x={0} y={top + 26} className="axis-label">
                  {GPU_MODELS[v.gpuModel].label}
                </text>
                {/* Remaining spot capacity: darker water = more free GPUs. */}
                {residual.map((r, i) => (
                  <rect
                    key={i}
                    x={labelW + i * hw}
                    y={top + 2}
                    width={hw + 0.3}
                    height={h - 6}
                    fill="var(--wind)"
                    opacity={0.04 + 0.26 * (r / cap)}
                  />
                ))}
                {f.map((x, i) =>
                  x.motionCap < 1 ? (
                    <rect
                      key={`m${i}`}
                      x={labelW + i * hw}
                      y={top + h - 6}
                      width={hw + 0.3}
                      height={3}
                      fill="var(--warn)"
                      opacity={1 - x.motionCap}
                    />
                  ) : null,
                )}
                <g className="tide-bars">
                  {placed.map(({ p, lane }) =>
                    runs(p).map((r, k) => (
                      <rect
                        key={`${p.jobId}${k}`}
                        x={labelW + r.from * hw + 0.5}
                        y={top + 5 + lane * (laneH + 3)}
                        width={Math.max(1.5, (r.to - r.from) * hw - 1)}
                        height={laneH}
                        rx="2"
                        fill={colorOf(p.jobId)}
                        opacity={hoverJob && hoverJob !== p.jobId ? 0.25 : 0.92}
                        onMouseEnter={() => onHover(p.jobId)}
                        onMouseLeave={() => onHover(null)}
                      >
                        <title>{`${data.jobs.find((j) => j.id === p.jobId)?.name}: ${int(r.gpus)} GPUs, h${r.from}–${r.to}`}</title>
                      </rect>
                    )),
                  )}
                </g>
                <line
                  x1={labelW}
                  x2={labelW + W}
                  y1={top + h - 1}
                  y2={top + h - 1}
                  stroke="var(--line)"
                />
              </g>
            );
          })}
        </svg>
      )}
      <div className="outlook-legend mono">
        <span>
          <i style={{ background: 'var(--wind)', opacity: 0.4 }} /> free spot capacity
        </span>
        <span>
          <i style={{ background: 'var(--warn)' }} /> sea-state load cap
        </span>
        <span>bars = job runs (preemptible by hour, pinned to one vessel)</span>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  name: '',
  gpuHours: 20000,
  maxGpus: 1024,
  deadlineHours: 48,
  priority: 2,
  latencyMetro: '',
  maxRttMs: 5,
  carbonCapG: '' as number | '',
};

function JobForm({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/jobs', {
        name: f.name || `job-${Math.random().toString(36).slice(2, 7)}`,
        gpuHours: Number(f.gpuHours),
        maxGpus: Number(f.maxGpus),
        deadlineHours: Number(f.deadlineHours),
        priority: f.priority,
        latencyMetro: f.latencyMetro || null,
        maxRttMs: f.latencyMetro ? Number(f.maxRttMs) : null,
        carbonCapG: f.carbonCapG === '' ? null : Number(f.carbonCapG),
      });
      setF(EMPTY_FORM);
      onCreated();
    } catch (e2) {
      setErr(
        e2 instanceof ApiError
          ? (e2.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? e2.message)
          : 'Could not file the job',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="jobform panel ticked" onSubmit={submit}>
      <div className="panel-head">
        <h3>File a job</h3>
        <span className="mono faint">
          ≈ {fmt(f.gpuHours / Math.max(1, f.maxGpus), 0)} h at full width
        </span>
      </div>
      <div className="panel-body jobform-grid">
        <label className="field span2">
          <span>Name</span>
          <input
            className="input"
            placeholder="llm-finetune-v3"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            maxLength={80}
          />
        </label>
        <label className="field">
          <span>GPU-hours</span>
          <input
            className="input num"
            type="number"
            min={8}
            step={1000}
            value={f.gpuHours}
            onChange={(e) => setF({ ...f, gpuHours: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Max GPUs</span>
          <input
            className="input num"
            type="number"
            min={1}
            step={64}
            value={f.maxGpus}
            onChange={(e) => setF({ ...f, maxGpus: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Deadline · {f.deadlineHours} h</span>
          <input
            type="range"
            min={6}
            max={96}
            value={f.deadlineHours}
            style={{ '--fill': `${((f.deadlineHours - 6) / 90) * 100}%` } as CSSProperties}
            onChange={(e) => setF({ ...f, deadlineHours: Number(e.target.value) })}
          />
        </label>
        <div className="field">
          <span>Priority</span>
          <div className="segmented" role="group" aria-label="Priority">
            {[1, 2, 3].map((p) => (
              <button
                type="button"
                key={p}
                aria-pressed={f.priority === p}
                onClick={() => setF({ ...f, priority: p })}
              >
                {['Low', 'Normal', 'Urgent'][p - 1]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Pin near metro</span>
          <select
            className="input"
            value={f.latencyMetro}
            onChange={(e) => setF({ ...f, latencyMetro: e.target.value })}
          >
            <option value="">Anywhere in the fleet</option>
            {METROS.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Max RTT (ms)</span>
          <input
            className="input num"
            type="number"
            min={1}
            max={200}
            step={0.5}
            disabled={!f.latencyMetro}
            value={f.maxRttMs}
            onChange={(e) => setF({ ...f, maxRttMs: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Carbon cap (g/kWh)</span>
          <input
            className="input num"
            type="number"
            min={10}
            max={1000}
            placeholder="none"
            value={f.carbonCapG}
            onChange={(e) =>
              setF({ ...f, carbonCapG: e.target.value === '' ? '' : Number(e.target.value) })
            }
          />
        </label>
        <div className="span2 jobform-foot">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Routing…' : 'Route it'}
          </button>
          {err && (
            <span className="field-error" role="alert">
              {err}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}

export default function Router() {
  useDocumentTitle('Tide router');
  const [data, setData] = useState<PlanResponse | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<PlanResponse>('/plan?hours=96'));
      setError(null);
    } catch {
      setError('Could not reach the router.');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const colorIdx = useMemo(() => new Map(data?.jobs.map((j, i) => [j.id, i])), [data]);
  const colorOf = (id: string) => jobColor(colorIdx.get(id) ?? 0);

  const stats = useMemo(() => {
    if (!data) return null;
    const placed = data.plan.placements;
    const gh = placed.reduce((s, p) => s + p.segments.reduce((a, g) => a + g.gpus, 0), 0);
    const energy = placed.reduce((s, p) => s + p.energyMWh, 0);
    const ci = gh
      ? placed.reduce((s, p) => s + p.avgCarbon * p.segments.reduce((a, g) => a + g.gpus, 0), 0) /
        gh
      : 0;
    return { placed: placed.length, unplaced: data.plan.unplaced.length, gh, energy, ci };
  }, [data]);

  return (
    <div className="page router">
      <header className="page-head">
        <div>
          <p className="eyebrow">Workload placement · 96-hour horizon</p>
          <h1>Tide router</h1>
          <p className="muted page-lede">
            Batch AI jobs ride the spot pool — capacity beyond reserved charters — and follow the
            wind and calm water across the fleet. Priority first, then earliest deadline; each job
            lands on the vessel that finishes it soonest.
          </p>
        </div>
        {stats && (
          <div className="kpis">
            <div className="kpi">
              <span className="eyebrow">Placed</span>
              <b className="num">
                {stats.placed}
                <small> / {stats.placed + stats.unplaced}</small>
              </b>
            </div>
            <div className="kpi">
              <span className="eyebrow">GPU-hours</span>
              <b className="num">{compact(stats.gh)}</b>
            </div>
            <div className="kpi">
              <span className="eyebrow">Spot used</span>
              <b className="num">{pct(data!.plan.utilization, 1)}</b>
            </div>
            <div className="kpi">
              <span className="eyebrow">Energy</span>
              <b className="num">
                {fmt(stats.energy, 0)}
                <small> MWh</small>
              </b>
            </div>
            <div className="kpi">
              <span className="eyebrow">Carbon</span>
              <b className="num">
                {fmt(stats.ci, 0)}
                <small> g/kWh</small>
              </b>
            </div>
          </div>
        )}
      </header>
      {error && (
        <div className="panel panel-body field-error" role="alert">
          {error}
        </div>
      )}
      <div className="panel">
        <div className="panel-head">
          <h3>Tide plan</h3>
          <button className="btn btn-sm btn-ghost" onClick={() => void load()}>
            Re-plan
          </button>
        </div>
        <div className="panel-body">
          {data ? (
            <TidePlan data={data} colorOf={colorOf} onHover={setHover} hoverJob={hover} />
          ) : (
            <div className="empty">Reading the tide tables…</div>
          )}
        </div>
      </div>

      <div className="router-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Manifest</h3>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await api.post('/jobs/reset');
                void load();
              }}
            >
              Reset to sample jobs
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th className="r">GPU-h</th>
                  <th className="r">Width</th>
                  <th>Constraints</th>
                  <th>Placement</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.jobs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      The manifest is empty. File a job to route it.
                    </td>
                  </tr>
                )}
                {data?.jobs.map((j) => {
                  const p = data.plan.placements.find((x) => x.jobId === j.id);
                  const u = data.plan.unplaced.find((x) => x.jobId === j.id);
                  return (
                    <tr
                      key={j.id}
                      onMouseEnter={() => setHover(j.id)}
                      onMouseLeave={() => setHover(null)}
                      className={hover === j.id ? 'is-hover' : ''}
                    >
                      <td>
                        <span className="job-swatch" style={{ background: colorOf(j.id) }} />
                        <b>{j.name}</b>
                        <br />
                        <span className="faint mono">
                          P{j.priority} · due +{j.deadlineHours}h
                        </span>
                      </td>
                      <td className="r num">{compact(j.gpuHours)}</td>
                      <td className="r num">{int(j.maxGpus)}</td>
                      <td className="mono faint">
                        {j.latencyMetro ? `≤${j.maxRttMs}ms ${j.latencyMetro}` : 'any berth'}
                        <br />
                        {j.carbonCapG ? `≤${j.carbonCapG} g/kWh` : 'no carbon cap'}
                      </td>
                      <td>
                        {p ? (
                          <>
                            <b>{FLEET.find((v) => v.id === p.vesselId)?.name}</b>{' '}
                            <span className="mono faint">
                              h{p.startHour}→{p.finishHour}
                            </span>
                            <br />
                            <span className="mono faint">
                              {fmt(p.avgCarbon, 0)} g/kWh
                              {p.rttMs !== null ? ` · ${fmt(p.rttMs, 1)} ms` : ''}
                            </span>
                          </>
                        ) : (
                          <span className="lvl-warning">{u?.reason ?? 'Unplaced'}</span>
                        )}
                      </td>
                      <td className="r">
                        <button
                          className="btn btn-sm btn-ghost"
                          aria-label={`Remove ${j.name}`}
                          onClick={async () => {
                            await api.del(`/jobs/${j.id}`);
                            void load();
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <JobForm onCreated={load} />
      </div>
    </div>
  );
}
