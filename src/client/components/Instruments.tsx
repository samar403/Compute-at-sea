import { useId } from 'react';
import { clamp } from '../../shared/math';
import type { PowerMix, VesselStatus } from '../../shared/types';
import { fmt } from '../lib/format';

/** Minimal line chart with a soft fill and a live end-point. */
export function Sparkline({
  values,
  width = 220,
  height = 44,
  color = 'var(--ink)',
  min,
  max,
  label,
  format = (v: number) => fmt(v, 1),
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  min?: number;
  max?: number;
  label: string;
  format?: (v: number) => string;
}) {
  const id = useId();
  if (values.length < 2)
    return (
      <div style={{ height }} className="faint mono">
        —
      </div>
    );
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - 3 - ((v - lo) / span) * (height - 6),
  ]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: latest ${format(values[values.length - 1])}, range ${format(Math.min(...values))} to ${format(Math.max(...values))}`}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

/** A 240° dial, with a redline band, like an engine-room gauge. */
export function Dial({
  value,
  min,
  max,
  label,
  unit,
  digits = 1,
  redFrom,
  size = 132,
  invertRed = false,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  unit: string;
  digits?: number;
  redFrom?: number;
  size?: number;
  invertRed?: boolean;
}) {
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const a0 = (-210 * Math.PI) / 180;
  const a1 = (30 * Math.PI) / 180;
  const ang = (v: number) => a0 + clamp((v - min) / (max - min)) * (a1 - a0);
  const pt = (a: number, rr = r) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const arc = (from: number, to: number, rr = r) => {
    const [x0, y0] = pt(from, rr);
    const [x1, y1] = pt(to, rr);
    const large = to - from > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${rr},${rr} 0 ${large} 1 ${x1},${y1}`;
  };
  const ticks = Array.from({ length: 11 }, (_, i) => a0 + (i / 10) * (a1 - a0));
  const needle = ang(value);
  const [nx, ny] = pt(needle, r - 14);
  const inRed = redFrom !== undefined && (invertRed ? value <= redFrom : value >= redFrom);
  return (
    <figure className="dial" style={{ width: size }}>
      <svg
        width={size}
        height={size - 12}
        viewBox={`0 0 ${size} ${size - 6}`}
        role="img"
        aria-label={`${label}: ${fmt(value, digits)} ${unit}`}
      >
        <path d={arc(a0, a1)} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
        {redFrom !== undefined && (
          <path
            d={invertRed ? arc(a0, ang(redFrom), r - 3) : arc(ang(redFrom), a1, r - 3)}
            fill="none"
            stroke="var(--warn)"
            strokeWidth="5"
            opacity="0.7"
          />
        )}
        <path
          d={arc(a0, needle, r - 3)}
          fill="none"
          stroke={inRed ? 'var(--warn)' : 'var(--accent)'}
          strokeWidth="5"
        />
        {ticks.map((a, i) => {
          const [x0, y0] = pt(a, r + 2);
          const [x1, y1] = pt(a, r + (i % 5 === 0 ? 8 : 5));
          return (
            <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink-2)" strokeWidth="1" />
          );
        })}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ transition: 'all .8s var(--ease)' }}
        />
        <circle cx={cx} cy={cy} r="4" fill="var(--ink)" />
        <text x={cx} y={cy + 22} textAnchor="middle" className="dial-value">
          {fmt(value, digits)}
        </text>
      </svg>
      <figcaption>
        <span className="eyebrow">{label}</span> <span className="faint mono">{unit}</span>
      </figcaption>
    </figure>
  );
}

export const MIX_COLORS: Record<string, string> = {
  wind: 'var(--wind)',
  battery: 'var(--battery)',
  cable: 'var(--cable)',
  genset: 'var(--genset)',
};

/** Where this minute's megawatts come from. Negative flows (charging, export) shown below the axis. */
export function MixBar({ mix, facilityMW }: { mix: PowerMix; facilityMW: number }) {
  const parts = [
    { key: 'wind', label: 'Offshore wind', v: mix.windMW },
    { key: 'battery', label: 'Battery', v: Math.max(0, mix.batteryMW) },
    { key: 'cable', label: 'Shore cable', v: Math.max(0, mix.cableMW) },
    { key: 'genset', label: 'Methanol gensets', v: mix.gensetMW },
  ];
  const total = Math.max(facilityMW, 0.001);
  const charging = Math.max(0, -mix.batteryMW);
  const exporting = Math.max(0, -mix.cableMW);
  return (
    <div className="mixbar">
      <div
        className="mixbar-track"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${fmt(p.v)} MW`).join(', ')}
      >
        {parts.map((p) =>
          p.v > 0.05 ? (
            <span
              key={p.key}
              style={{ width: `${(p.v / total) * 100}%`, background: MIX_COLORS[p.key] }}
              title={`${p.label}: ${fmt(p.v)} MW`}
            />
          ) : null,
        )}
      </div>
      <ul className="mixbar-legend">
        {parts.map((p) => (
          <li key={p.key} className={p.v > 0.05 ? '' : 'faint'}>
            <i style={{ background: MIX_COLORS[p.key] }} />
            {p.label}
            <b className="num">{fmt(p.v)} MW</b>
          </li>
        ))}
        {charging > 0.05 && (
          <li>
            <i style={{ background: 'var(--battery)', opacity: 0.5 }} />
            Charging battery<b className="num">{fmt(charging)} MW</b>
          </li>
        )}
        {exporting > 0.05 && (
          <li>
            <i style={{ background: 'var(--export)' }} />
            Exporting to shore<b className="num">{fmt(exporting)} MW</b>
          </li>
        )}
        {mix.curtailedMW > 0.05 && (
          <li className="faint">
            <i style={{ background: 'var(--line-strong)' }} />
            Curtailed<b className="num">{fmt(mix.curtailedMW)} MW</b>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Roll and pitch as an aircraft-style attitude indicator, gently animated. */
export function Horizon({
  roll,
  pitch,
  heave,
  size = 132,
}: {
  roll: number;
  pitch: number;
  heave: number;
  size?: number;
}) {
  const id = useId();
  const r = size / 2 - 4;
  const shift = clamp(pitch / 12, -1, 1) * r * 0.6;
  return (
    <figure className="dial horizon" style={{ width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Vessel motion: roll ${fmt(roll)} degrees, pitch ${fmt(pitch)} degrees, heave ${fmt(heave)} metres`}
      >
        <defs>
          <clipPath id={id}>
            <circle cx={size / 2} cy={size / 2} r={r} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id})`}>
          <g
            className="horizon-roll"
            style={{
              ['--roll' as string]: `${roll}deg`,
              transformOrigin: `${size / 2}px ${size / 2}px`,
            }}
          >
            <rect
              x={-size}
              y={-size}
              width={size * 3}
              height={size * 1.5 + shift}
              fill="var(--sea-3)"
              opacity="0.35"
            />
            <rect
              x={-size}
              y={size / 2 + shift}
              width={size * 3}
              height={size * 2}
              fill="var(--info)"
              opacity="0.4"
            />
            <line
              x1={-size}
              x2={size * 2}
              y1={size / 2 + shift}
              y2={size / 2 + shift}
              stroke="var(--ink)"
              strokeWidth="1.5"
            />
            {[-10, -5, 5, 10].map((d) => (
              <line
                key={d}
                x1={size / 2 - (d % 10 ? 8 : 16)}
                x2={size / 2 + (d % 10 ? 8 : 16)}
                y1={size / 2 + shift - d * 3}
                y2={size / 2 + shift - d * 3}
                stroke="var(--ink-2)"
                strokeWidth="1"
              />
            ))}
          </g>
        </g>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" />
        {/* Hull symbol stays level: it is the reference. */}
        <path
          d={`M${size / 2 - 30},${size / 2} h18 l6,6 h12 l6,-6 h18`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx={size / 2} cy={size / 2} r="2" fill="var(--accent)" />
      </svg>
      <figcaption>
        <span className="eyebrow">Motion</span>{' '}
        <span className="faint mono">
          R{fmt(roll)}° P{fmt(pitch)}° H{fmt(heave)}m
        </span>
      </figcaption>
    </figure>
  );
}

export function StatusChip({ status }: { status: VesselStatus }) {
  const label = {
    operational: 'Operational',
    'storm-mode': 'Storm mode',
    transit: 'Under way',
    degraded: 'Degraded',
  }[status];
  return (
    <span className={`chip status-${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/**
 * Plan-view vessel glyph. Leviathans are long hulls, Tidewaters square semis, Petrels slim.
 * A status ring pulses when the vessel is constrained.
 */
export function VesselGlyph({
  x,
  y,
  cls,
  heading = 0,
  status,
  selected,
  label,
  scale = 1,
}: {
  x: number;
  y: number;
  cls: string;
  heading?: number;
  status: VesselStatus;
  selected?: boolean;
  label?: string;
  scale?: number;
}) {
  const s = scale;
  const hull =
    cls === 'Tidewater' ? (
      <rect x={-5 * s} y={-5 * s} width={10 * s} height={10 * s} rx={1.5 * s} />
    ) : cls === 'Petrel' ? (
      <path
        d={`M0,${-8 * s} L${3 * s},${-3 * s} L${3 * s},${7 * s} L${-3 * s},${7 * s} L${-3 * s},${-3 * s} Z`}
      />
    ) : (
      <path
        d={`M0,${-10 * s} L${4 * s},${-5 * s} L${4 * s},${9 * s} L${-4 * s},${9 * s} L${-4 * s},${-5 * s} Z`}
      />
    );
  return (
    <g
      transform={`translate(${x},${y})`}
      className={`vessel-glyph status-${status} ${selected ? 'is-selected' : ''}`}
    >
      {(status === 'storm-mode' || status === 'degraded') && (
        <circle r={16 * s} className="vessel-pulse" />
      )}
      {selected && <circle r={18 * s} className="vessel-ring" />}
      <circle r={12 * s} className="vessel-halo" />
      <g transform={`rotate(${heading})`} className="vessel-hull">
        {hull}
      </g>
      {label && (
        <text x={14 * s} y={4} className="vessel-label">
          {label}
        </text>
      )}
    </g>
  );
}
