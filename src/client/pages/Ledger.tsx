import { useMemo, useState, type CSSProperties } from 'react';
import { LAND_PUE, SEA_PUE, tco, TCO_DEFAULTS, type TcoInput } from '../../shared/economics';
import { CashChart } from '../components/CashChart';
import { compact, fmt, usdCompact } from '../lib/format';
import { useDocumentTitle, useStored } from '../lib/hooks';

interface Knob {
  key: keyof TcoInput;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  group: 'Project' | 'Land' | 'Sea' | 'Market';
  hint: string;
}

const KNOBS: Knob[] = [
  {
    key: 'mw',
    label: 'IT capacity',
    min: 5,
    max: 200,
    step: 5,
    unit: 'MW',
    group: 'Project',
    hint: 'Critical IT load being built.',
  },
  {
    key: 'horizonMonths',
    label: 'Horizon',
    min: 24,
    max: 120,
    step: 12,
    unit: 'mo',
    group: 'Project',
    hint: 'How far the model looks.',
  },
  {
    key: 'discountRatePct',
    label: 'Discount rate',
    min: 0,
    max: 20,
    step: 1,
    unit: '%',
    group: 'Project',
    hint: 'Annual, for NPV.',
  },
  {
    key: 'landMonthsToPower',
    label: 'Time to power',
    min: 12,
    max: 84,
    step: 1,
    unit: 'mo',
    group: 'Land',
    hint: 'Permits + substation + interconnection queue.',
  },
  {
    key: 'landCapexPerMW',
    label: 'Capex',
    min: 6,
    max: 20,
    step: 0.1,
    unit: '$M/MW',
    group: 'Land',
    hint: 'Shell, power and cooling plant.',
  },
  {
    key: 'landEnergyPrice',
    label: 'Energy price',
    min: 30,
    max: 200,
    step: 1,
    unit: '$/MWh',
    group: 'Land',
    hint: `Applied at PUE ${LAND_PUE}.`,
  },
  {
    key: 'seaMonthsToPower',
    label: 'Time to power',
    min: 6,
    max: 36,
    step: 1,
    unit: 'mo',
    group: 'Sea',
    hint: 'Yard conversion + tow + hook-up.',
  },
  {
    key: 'seaCapexPerMW',
    label: 'Capex',
    min: 5,
    max: 20,
    step: 0.1,
    unit: '$M/MW',
    group: 'Sea',
    hint: 'Hull, conversion, moorings, export cable.',
  },
  {
    key: 'seaEnergyPrice',
    label: 'Energy price',
    min: 20,
    max: 200,
    step: 1,
    unit: '$/MWh',
    group: 'Sea',
    hint: `Blended wind PPA + backup, at PUE ${SEA_PUE}.`,
  },
  {
    key: 'seaOpexPremiumPct',
    label: 'O&M premium',
    min: 0,
    max: 80,
    step: 1,
    unit: '%',
    group: 'Sea',
    hint: 'Crew, marine insurance, mooring inspections.',
  },
  {
    key: 'revenuePerMWMonth',
    label: 'Revenue',
    min: 0.2,
    max: 1.6,
    step: 0.01,
    unit: '$M/MW·mo',
    group: 'Market',
    hint: '≈ GPUs per MW × price × utilisation.',
  },
];

export default function Ledger() {
  useDocumentTitle('Ledger');
  const [input, setInput] = useStored<TcoInput>('cas.tco', TCO_DEFAULTS);
  const [open, setOpen] = useState<Knob['group']>('Land');
  const r = useMemo(() => tco({ ...TCO_DEFAULTS, ...input }), [input]);

  const verdict =
    r.seaNpv > r.landNpv
      ? `At these assumptions the sea wins by ${usdCompact((r.seaNpv - r.landNpv) * 1e6)} of NPV.`
      : `At these assumptions land wins by ${usdCompact((r.landNpv - r.seaNpv) * 1e6)} of NPV — the sea’s edge is time-to-power; shrink the land queue and it disappears.`;

  return (
    <div className="page ledger">
      <header className="page-head">
        <div>
          <p className="eyebrow">Economics lab · every assumption is yours to change</p>
          <h1>The ledger</h1>
          <p className="muted page-lede">
            A deliberately simple model: capex drawn over the build, revenue from energisation,
            energy at each site’s PUE, and a fixed O&amp;M share. The point isn’t any one number —
            it’s that months-to-power dominates the outcome.
          </p>
        </div>
      </header>

      <div className="ledger-grid">
        <section className="panel ticked">
          <div className="panel-head">
            <h3>Cumulative cash · {input.mw} MW</h3>
            <span className="mono faint">
              <span style={{ color: 'var(--accent)' }}>━ sea</span> · <span>┅ land</span>
            </span>
          </div>
          <div className="panel-body">
            <CashChart result={r} height={340} />
          </div>
          <div className="ledger-kpis">
            <div className="kpi">
              <span className="eyebrow">Sea NPV</span>
              <b className="num">{usdCompact(r.seaNpv * 1e6)}</b>
            </div>
            <div className="kpi">
              <span className="eyebrow">Land NPV</span>
              <b className="num">{usdCompact(r.landNpv * 1e6)}</b>
            </div>
            <div className="kpi">
              <span className="eyebrow">Payback</span>
              <b className="num">
                {r.seaPaybackMonth ?? '—'}
                <small> vs {r.landPaybackMonth ?? '—'} mo</small>
              </b>
            </div>
            <div className="kpi">
              <span className="eyebrow">Compute gained</span>
              <b className="num">
                {r.monthsOfComputeGained}
                <small> mo · {compact(r.extraGpuHours)} GPU-h</small>
              </b>
            </div>
          </div>
          <p className="ledger-verdict">{verdict}</p>
        </section>

        <section className="panel knobs">
          <div className="panel-head">
            <h3>Assumptions</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => setInput(TCO_DEFAULTS)}>
              Reset
            </button>
          </div>
          <div className="knob-tabs" role="tablist">
            {(['Project', 'Land', 'Sea', 'Market'] as const).map((g) => (
              <button key={g} role="tab" aria-selected={open === g} onClick={() => setOpen(g)}>
                {g}
              </button>
            ))}
          </div>
          <div className="panel-body stack" role="tabpanel">
            {KNOBS.filter((k) => k.group === open).map((k) => {
              const v = input[k.key];
              return (
                <label key={k.key} className="field knob">
                  <span>
                    {k.label}
                    <b className="num">
                      {fmt(v, k.step < 1 ? (k.step < 0.1 ? 2 : 1) : 0)} {k.unit}
                    </b>
                  </span>
                  <input
                    type="range"
                    min={k.min}
                    max={k.max}
                    step={k.step}
                    value={v}
                    style={
                      { '--fill': `${((v - k.min) / (k.max - k.min)) * 100}%` } as CSSProperties
                    }
                    onChange={(e) => setInput({ ...input, [k.key]: Number(e.target.value) })}
                  />
                  <small className="faint">{k.hint}</small>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
