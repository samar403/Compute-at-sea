import { useState } from 'react';
import type { ForecastHour } from '../../shared/types';
import { useSize } from '../lib/hooks';
import { fmt, hourLabel, int } from '../lib/format';

/**
 * The 72-hour "tide chart": spot GPUs available (bars) against significant wave
 * height (line) with the 5.5 m motion-envelope and 9 m storm thresholds.
 */
export function Outlook({
  hours,
  spotOf,
}: {
  hours: ForecastHour[];
  spotOf: (f: ForecastHour) => number;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 170;
  const pad = { l: 34, r: 34, t: 10, b: 22 };
  const W = Math.max(10, width - pad.l - pad.r);
  const H = height - pad.t - pad.b;
  if (!hours.length)
    return (
      <div ref={ref} style={{ height }} className="empty">
        Loading outlook…
      </div>
    );
  const maxSpot = Math.max(1, ...hours.map(spotOf));
  const maxHs = Math.max(10, ...hours.map((h) => h.hs));
  const bw = W / hours.length;
  const yHs = (v: number) => pad.t + (1 - v / maxHs) * H;
  const hsPath = hours
    .map((h, i) => `${i ? 'L' : 'M'}${pad.l + (i + 0.5) * bw},${yHs(h.hs)}`)
    .join('');
  const f = hover !== null ? hours[hover] : null;

  return (
    <div ref={ref} className="outlook">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`72 hour outlook. Peak wave height ${fmt(Math.max(...hours.map((h) => h.hs)))} metres; spot GPUs between ${int(Math.min(...hours.map(spotOf)))} and ${int(maxSpot)}.`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - pad.l) / bw);
            setHover(i >= 0 && i < hours.length ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {hours.map((h, i) => {
            const v = spotOf(h);
            const bh = (v / maxSpot) * H;
            return (
              <rect
                key={h.t}
                x={pad.l + i * bw + 0.5}
                y={pad.t + H - bh}
                width={Math.max(0.5, bw - 1)}
                height={bh}
                fill={h.carbonIntensity > 200 ? 'var(--genset)' : 'var(--wind)'}
                opacity={hover === i ? 0.9 : 0.42}
              />
            );
          })}
          {[5.5, 9].map((th) => (
            <g key={th}>
              <line
                x1={pad.l}
                x2={pad.l + W}
                y1={yHs(th)}
                y2={yHs(th)}
                stroke="var(--warn)"
                strokeDasharray="3 4"
                opacity={th === 9 ? 0.9 : 0.5}
              />
              <text x={pad.l + W + 4} y={yHs(th) + 4} className="axis-label" fill="var(--warn)">
                {th}m
              </text>
            </g>
          ))}
          <path d={hsPath} fill="none" stroke="var(--ink)" strokeWidth="1.8" />
          <text x={4} y={pad.t + 8} className="axis-label">
            {int(maxSpot / 1000)}k
          </text>
          <text x={4} y={pad.t + H} className="axis-label">
            0
          </text>
          {hours.map((h, i) =>
            i % 12 === 0 ? (
              <text key={h.t} x={pad.l + i * bw} y={height - 6} className="axis-label">
                {i === 0 ? 'now' : `+${i}h`}
              </text>
            ) : null,
          )}
          {hover !== null && (
            <line
              x1={pad.l + (hover + 0.5) * bw}
              x2={pad.l + (hover + 0.5) * bw}
              y1={pad.t}
              y2={pad.t + H}
              stroke="var(--ink)"
              strokeWidth="0.5"
            />
          )}
        </svg>
      )}
      <div className="outlook-legend mono">
        {f ? (
          <>
            <span>{hourLabel(f.t)}</span>
            <span>Hs {fmt(f.hs)} m</span>
            <span>wind {fmt(f.wind)} m/s</span>
            <span>spot {int(spotOf(f))} GPUs</span>
            <span>{fmt(f.carbonIntensity, 0)} g/kWh</span>
          </>
        ) : (
          <>
            <span>
              <i style={{ background: 'var(--wind)' }} /> spot GPUs (clean)
            </span>
            <span>
              <i style={{ background: 'var(--genset)' }} /> spot GPUs (&gt;200 g/kWh)
            </span>
            <span>
              <i style={{ background: 'var(--ink)', height: 2 }} /> wave height
            </span>
          </>
        )}
      </div>
    </div>
  );
}
