import { useState } from 'react';
import type { TcoResult } from '../../shared/economics';
import { useSize } from '../lib/hooks';
import { usdCompact } from '../lib/format';

/** Cumulative cash, land vs sea, with energisation and payback markers. */
export function CashChart({
  result,
  height = 300,
  compact = false,
}: {
  result: TcoResult;
  height?: number;
  compact?: boolean;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const s = result.series;
  const pad = { l: compact ? 8 : 56, r: 12, t: 16, b: compact ? 18 : 30 };
  const W = Math.max(10, width - pad.l - pad.r);
  const H = height - pad.t - pad.b;
  const lo = Math.min(0, ...s.map((p) => Math.min(p.land, p.sea)));
  const hi = Math.max(1, ...s.map((p) => Math.max(p.land, p.sea)));
  const x = (m: number) => pad.l + ((m - 1) / (s.length - 1)) * W;
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * H;
  const line = (k: 'land' | 'sea') =>
    s.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const area = (k: 'land' | 'sea') => `${line(k)}L${x(s.length)},${y(0)}L${x(1)},${y(0)}Z`;
  const ticks = 5;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);
  const { input } = result;
  const h = hover !== null ? s[hover] : null;

  return (
    <div ref={ref} className="cashchart">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Cumulative cash over ${input.horizonMonths} months for ${input.mw} MW. Sea pays back at month ${result.seaPaybackMonth ?? 'never'}, land at month ${result.landPaybackMonth ?? 'never'}.`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const m = Math.round(((e.clientX - r.left - pad.l) / W) * (s.length - 1));
            setHover(m >= 0 && m < s.length ? m : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {!compact &&
            yTicks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={pad.l + W} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="axis-label">
                  {usdCompact(v * 1e6)}
                </text>
              </g>
            ))}
          <line x1={pad.l} x2={pad.l + W} y1={y(0)} y2={y(0)} stroke="var(--ink-2)" />
          {/* Build phases */}
          <rect
            x={x(1)}
            y={pad.t}
            width={x(input.seaMonthsToPower) - x(1)}
            height={H}
            fill="var(--accent)"
            opacity="0.06"
          />
          <rect
            x={x(1)}
            y={pad.t}
            width={x(Math.min(input.landMonthsToPower, input.horizonMonths)) - x(1)}
            height={H}
            fill="var(--ink)"
            opacity="0.04"
          />
          <path d={area('sea')} fill="var(--accent)" opacity="0.1" />
          <path
            d={line('land')}
            fill="none"
            stroke="var(--ink-2)"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          <path d={line('sea')} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          {[
            { m: input.seaMonthsToPower, label: 'Sea energised', c: 'var(--accent)' },
            { m: input.landMonthsToPower, label: 'Land energised', c: 'var(--ink-2)' },
          ]
            .filter((mk) => mk.m <= input.horizonMonths)
            .map((mk) => (
              <g key={mk.label}>
                <line
                  x1={x(mk.m)}
                  x2={x(mk.m)}
                  y1={pad.t}
                  y2={pad.t + H}
                  stroke={mk.c}
                  strokeDasharray="2 3"
                />
                {!compact && (
                  <text x={x(mk.m) + 4} y={pad.t + 12} className="axis-label" fill={mk.c}>
                    {mk.label} · m{mk.m}
                  </text>
                )}
              </g>
            ))}
          {result.seaPaybackMonth && (
            <circle
              cx={x(result.seaPaybackMonth)}
              cy={y(s[result.seaPaybackMonth - 1].sea)}
              r="5"
              fill="var(--accent)"
            />
          )}
          {result.landPaybackMonth && (
            <circle
              cx={x(result.landPaybackMonth)}
              cy={y(s[result.landPaybackMonth - 1].land)}
              r="5"
              fill="var(--panel)"
              stroke="var(--ink-2)"
              strokeWidth="2"
            />
          )}
          {!compact &&
            [12, 24, 36, 48, 60, 72, 84, 96, 108, 120]
              .filter((m) => m <= input.horizonMonths)
              .map((m) => (
                <text key={m} x={x(m)} y={height - 8} textAnchor="middle" className="axis-label">
                  {m === 12 ? 'Year 1' : `Y${m / 12}`}
                </text>
              ))}
          {h && (
            <g>
              <line
                x1={x(h.month)}
                x2={x(h.month)}
                y1={pad.t}
                y2={pad.t + H}
                stroke="var(--ink)"
                strokeWidth="0.5"
              />
              <circle cx={x(h.month)} cy={y(h.sea)} r="3.5" fill="var(--accent)" />
              <circle cx={x(h.month)} cy={y(h.land)} r="3.5" fill="var(--ink-2)" />
            </g>
          )}
        </svg>
      )}
      {h && (
        <div
          className="chart-tip mono"
          style={{ left: Math.min(width - 190, Math.max(0, x(h.month) + 10)) }}
        >
          <div>Month {h.month}</div>
          <div style={{ color: 'var(--accent)' }}>Sea {usdCompact(h.sea * 1e6)}</div>
          <div className="muted">Land {usdCompact(h.land * 1e6)}</div>
        </div>
      )}
    </div>
  );
}
