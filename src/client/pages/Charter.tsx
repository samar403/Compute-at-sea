import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  quote,
  SLA_TIERS,
  TERM_DISCOUNTS,
  type QuoteInput,
  type SlaTier,
} from '../../shared/economics';
import { FLEET, GPU_MODELS, type GpuModel } from '../../shared/fleet';
import type { GpuModelId } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { compact, fmt, int, usd, usdCompact } from '../lib/format';
import { useDocumentTitle } from '../lib/hooks';

interface Charter {
  id: string;
  ref: string;
  company: string;
  contactEmail: string;
  vesselId: string | null;
  createdAt: number;
  status: 'reserved' | 'cancelled';
  quote: ReturnType<typeof quote>;
}

// GPU count slider is logarithmic: 8 → 16,384.
const toCount = (s: number) => Math.round(2 ** (3 + (s / 100) * 11) / 8) * 8;
const toSlider = (c: number) => ((Math.log2(c) - 3) / 11) * 100;

function GpuCard({ g, active, onPick }: { g: GpuModel; active: boolean; onPick: () => void }) {
  return (
    <button
      className={`gpucard ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onPick}
    >
      <span className="eyebrow">{g.vendor}</span>
      <b>{g.label}</b>
      <span className="mono faint">
        {g.memoryGB} GB · {fmt(g.bf16Pflops, 2)} PF · {fmt(g.kwPerGpu, 2)} kW
      </span>
      <span className="gpucard-price num">{usd(g.listPrice, 2)}/h list</span>
    </button>
  );
}

export default function CharterPage() {
  useDocumentTitle('Charter desk');
  const [input, setInput] = useState<QuoteInput>({
    gpuModel: 'gb300',
    gpuCount: 1024,
    termMonths: 12,
    sla: 'standard',
    burst: false,
  });
  const [vesselId, setVesselId] = useState<string>('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [charters, setCharters] = useState<Charter[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Priced instantly in the browser with the same model the server enforces.
  const q = useMemo(() => quote(input), [input]);
  const eligible = useMemo(
    () => FLEET.filter((v) => v.gpuModel === input.gpuModel),
    [input.gpuModel],
  );

  const load = useCallback(
    () =>
      api
        .get<Charter[]>('/charters')
        .then(setCharters)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (vesselId && !eligible.some((v) => v.id === vesselId)) setVesselId('');
  }, [eligible, vesselId]);

  const reserve = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const c = await api.post<Charter>('/charters', {
        company,
        contactEmail: email,
        vesselId: vesselId || null,
        quote: input,
      });
      setMsg({ kind: 'ok', text: `Reserved. Your charter reference is ${c.ref}.` });
      void load();
    } catch (err) {
      setMsg({
        kind: 'err',
        text:
          err instanceof ApiError
            ? (err.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? err.message)
            : 'Reservation failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) =>
    setInput((i) => ({ ...i, [k]: v }));
  const vessel = FLEET.find((v) => v.id === vesselId);

  return (
    <div className="page charter">
      <header className="page-head">
        <div>
          <p className="eyebrow">Reserved capacity · priced per GPU-hour</p>
          <h1>Charter desk</h1>
          <p className="muted page-lede">
            Configure a charter and the bill of lading updates as you go. Reservations are held for
            14 days while we confirm berth and delivery.
          </p>
        </div>
      </header>

      <div className="charter-grid">
        <div className="charter-config">
          <section className="panel">
            <div className="panel-head">
              <h3>1 · Accelerator</h3>
            </div>
            <div className="panel-body gpucards">
              {Object.values(GPU_MODELS).map((g) => (
                <GpuCard
                  key={g.id}
                  g={g}
                  active={input.gpuModel === g.id}
                  onPick={() => set('gpuModel', g.id as GpuModelId)}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>2 · Size & term</h3>
              <span className="mono faint">{fmt(q.itMW, 2)} MW of IT</span>
            </div>
            <div className="panel-body stack">
              <label className="field">
                <span>
                  GPUs · <b className="num">{int(input.gpuCount)}</b> · {compact(q.pflops)} PFLOPS
                  BF16
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={toSlider(input.gpuCount)}
                  style={{ '--fill': `${toSlider(input.gpuCount)}%` } as CSSProperties}
                  onChange={(e) => set('gpuCount', Math.max(8, toCount(Number(e.target.value))))}
                  aria-valuetext={`${input.gpuCount} GPUs`}
                />
                <div className="range-marks mono faint">
                  <span>8</span>
                  <span>128</span>
                  <span>1k</span>
                  <span>16k</span>
                </div>
              </label>
              <div className="field">
                <span>Term</span>
                <div className="segmented" role="group" aria-label="Term in months">
                  {Object.keys(TERM_DISCOUNTS).map((t) => {
                    const m = Number(t) as QuoteInput['termMonths'];
                    return (
                      <button
                        key={t}
                        aria-pressed={input.termMonths === m}
                        onClick={() => set('termMonths', m)}
                      >
                        {t} mo
                        {TERM_DISCOUNTS[m] ? ` · −${Math.round(TERM_DISCOUNTS[m] * 100)}%` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={input.burst}
                  onChange={(e) => set('burst', e.target.checked)}
                />
                Burst rights — scale to 2× on 6 hours’ notice (+25 %)
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>3 · Service tier</h3>
            </div>
            <div className="panel-body tiers">
              {(Object.keys(SLA_TIERS) as SlaTier[]).map((k) => {
                const t = SLA_TIERS[k];
                return (
                  <button
                    key={k}
                    className={`tier ${input.sla === k ? 'is-active' : ''}`}
                    aria-pressed={input.sla === k}
                    onClick={() => set('sla', k)}
                  >
                    <b>{t.label}</b>
                    <span className="mono">
                      {t.uptime} · ×{t.multiplier.toFixed(2)}
                    </span>
                    <span className="faint">{t.blurb}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>4 · Berth preference</h3>
              <span className="mono faint">
                {eligible.length} vessels carry {GPU_MODELS[input.gpuModel].label}
              </span>
            </div>
            <div className="panel-body">
              <select
                className="input"
                value={vesselId}
                onChange={(e) => setVesselId(e.target.value)}
                aria-label="Preferred vessel"
              >
                <option value="">Any vessel — fleet-wide placement</option>
                {eligible.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.berthName} (serves {v.servesMetro})
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>

        <aside className="lading panel ticked" aria-label="Bill of lading">
          <div className="lading-head">
            <p className="eyebrow">Bill of lading · indicative</p>
            <h2>
              <span className="num">{usd(q.ratePerGpuHour, 3)}</span>
              <small className="faint"> /GPU-h</small>
            </h2>
            <p className="mono faint">
              list {usd(q.listRate, 2)} · term −{fmt(q.discountPct, 0)}% ·{' '}
              {SLA_TIERS[input.sla].label.toLowerCase()} ×{SLA_TIERS[input.sla].multiplier}
              {input.burst ? ' · burst ×1.25' : ''}
            </p>
          </div>
          <dl className="lading-lines">
            <dt>Cargo</dt>
            <dd>
              {int(input.gpuCount)} × {q.gpuLabel}
            </dd>
            <dt>Berth</dt>
            <dd>{vessel ? `${vessel.name}, ${vessel.berthName}` : 'Fleet-wide'}</dd>
            <dt>Term</dt>
            <dd>{input.termMonths} months</dd>
            <dt>Monthly</dt>
            <dd className="num">{usd(q.monthly)}</dd>
            <dt>Charter total</dt>
            <dd className="num lading-total">{usd(q.total)}</dd>
          </dl>
          <div className="lading-compare">
            <div>
              <span className="eyebrow">vs land neocloud</span>
              <b className="num">−{fmt(q.savingsVsLandPct, 0)} %</b>
              <span className="faint mono">{usd(q.landEquivalentRate, 2)}/GPU-h modelled</span>
            </div>
            <div>
              <span className="eyebrow">Carbon / month</span>
              <b className="num">{int(q.carbonTPerMonth)} t</b>
              <span className="faint mono">vs {int(q.landCarbonTPerMonth)} t on land</span>
            </div>
            <div>
              <span className="eyebrow">Freshwater saved</span>
              <b className="num">{compact(q.freshwaterSavedM3PerMonth)} m³</b>
              <span className="faint mono">per month</span>
            </div>
            <div>
              <span className="eyebrow">Energy</span>
              <b className="num">{int(q.energyMWhPerMonth)} MWh</b>
              <span className="faint mono">per month at PUE 1.07</span>
            </div>
          </div>
          <form className="lading-form" onSubmit={reserve}>
            <label className="field">
              <span>Company</span>
              <input
                className="input"
                required
                minLength={2}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                autoComplete="organization"
              />
            </label>
            <label className="field">
              <span>Contact email</span>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Signing…' : `Reserve · ${usdCompact(q.total)}`}
            </button>
            {msg && (
              <p role="status" className={msg.kind === 'ok' ? 'ok-msg' : 'field-error'}>
                {msg.text}
              </p>
            )}
          </form>
          <p className="faint lading-note">
            Modelled pricing for illustration. No payment is taken; a reservation records intent.
          </p>
        </aside>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Reservations</h3>
          <span className="mono faint">
            {charters.filter((c) => c.status === 'reserved').length} active
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Company</th>
                <th>Cargo</th>
                <th>Berth</th>
                <th className="r">Rate</th>
                <th className="r">Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {charters.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No reservations yet. Your first charter will appear here.
                  </td>
                </tr>
              )}
              {charters.map((c) => (
                <tr key={c.id} className={c.status === 'cancelled' ? 'is-cancelled' : ''}>
                  <td className="mono">{c.ref}</td>
                  <td>{c.company}</td>
                  <td>
                    {int(c.quote.input.gpuCount)} × {c.quote.gpuLabel}
                    <br />
                    <span className="faint mono">
                      {c.quote.input.termMonths} mo · {c.quote.input.sla}
                    </span>
                  </td>
                  <td>{FLEET.find((v) => v.id === c.vesselId)?.name ?? 'Fleet-wide'}</td>
                  <td className="r num">{usd(c.quote.ratePerGpuHour, 3)}</td>
                  <td className="r num">{usdCompact(c.quote.total)}</td>
                  <td>
                    <span
                      className={`chip ${c.status === 'reserved' ? 'status-operational' : 'faint'}`}
                    >
                      <span className="dot" />
                      {c.status}
                    </span>
                  </td>
                  <td className="r">
                    {c.status === 'reserved' && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          await api.del(`/charters/${c.id}`);
                          void load();
                        }}
                      >
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
