import { geoGraticule, geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LatLon } from '../../shared/types';
import { useSize } from '../lib/hooks';
import { loadLand, type Land } from '../lib/world';

export interface ChartApi {
  project: (p: LatLon) => [number, number] | null;
  projection: GeoProjection;
  k: number;
  width: number;
  height: number;
}

interface View {
  k: number;
  x: number;
  y: number;
}

const FRAME = 14;
const MIN_K = 1;
const MAX_K = 14;
const BOUNDS = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-180, -60],
        [180, -60],
        [180, 74],
        [-180, 74],
        [-180, -60],
      ],
    ],
  },
};

function step(k: number): number {
  if (k >= 8) return 2;
  if (k >= 4) return 5;
  if (k >= 2) return 10;
  return 15;
}

/**
 * A nautical chart: Mercator (as real charts are), buff land with shallow-water
 * bands along every coast, a graticule, and a neatline frame with alternating
 * latitude/longitude scale bars. Wheel or pinch to zoom, drag to pan.
 */
export function ChartMap({
  children,
  onPick,
  focus,
  className,
  ariaLabel,
  initialView,
  minHeight = 320,
}: {
  children?: (api: ChartApi) => ReactNode;
  onPick?: (p: LatLon) => void;
  /** When set, the chart glides to centre this point. */
  focus?: { p: LatLon; k: number } | null;
  className?: string;
  ariaLabel: string;
  initialView?: View;
  minHeight?: number;
}) {
  const [wrapRef, { width, height }] = useSize<HTMLDivElement>();
  const [land110, setLand110] = useState<Land | null>(null);
  const [land50, setLand50] = useState<Land | null>(null);
  const [view, setView] = useState<View>(initialView ?? { k: 1, x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    loadLand('110m').then(setLand110);
  }, []);
  useEffect(() => {
    if (view.k >= 2.5 && !land50) loadLand('50m').then(setLand50);
  }, [view.k, land50]);

  const W = Math.max(0, width - FRAME * 2);
  const H = Math.max(0, height - FRAME * 2);

  const base = useMemo(() => {
    const p = geoMercator().fitSize([W || 1, H || 1], BOUNDS);
    return { s: p.scale(), t: p.translate() as [number, number] };
  }, [W, H]);

  const clampView = useCallback(
    (v: View): View => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
      const slackX = W * 0.15;
      const slackY = H * 0.15;
      const x = Math.min(slackX, Math.max(W - W * k - slackX, v.x));
      const y = Math.min(slackY, Math.max(H - H * k - slackY, v.y));
      return { k, x, y };
    },
    [W, H],
  );

  const projection = useMemo(
    () =>
      geoMercator()
        .scale(base.s * view.k)
        .translate([base.t[0] * view.k + view.x, base.t[1] * view.k + view.y])
        .clipExtent([
          [0, 0],
          [W, H],
        ]),
    [base, view, W, H],
  );

  // Glide to a focus point.
  useEffect(() => {
    if (!focus || !W) return;
    const unit = geoMercator().scale(base.s).translate(base.t);
    const b = unit([focus.p.lon, focus.p.lat]);
    if (!b) return;
    const k = focus.k;
    setView(clampView({ k, x: W / 2 - k * b[0], y: H / 2 - k * b[1] }));
  }, [focus, base, W, H, clampView]);

  const path = useMemo(() => geoPath(projection), [projection]);
  const land = view.k >= 2.5 && land50 ? land50 : land110;
  const landD = useMemo(() => (land ? (path(land) ?? '') : ''), [land, path]);
  const grat = useMemo(() => {
    const s = step(view.k);
    return (
      path(
        geoGraticule()
          .step([s, s])
          .extentMajor([
            [-180, -80],
            [180, 80.0001],
          ])(),
      ) ?? ''
    );
  }, [path, view.k]);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - FRAME, y: e.clientY - r.top - FRAME };
  };

  const zoomAt = useCallback(
    (mx: number, my: number, factor: number) => {
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
        const f = k / v.k;
        return clampView({ k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f });
      });
    },
    [clampView],
  );

  // Non-passive wheel listener so the page doesn't scroll while zooming the chart.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toLocal(e);
      zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      drag.current = null;
      return;
    }
    drag.current = { sx: p.x, sy: p.y, ox: view.x, oy: view.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toLocal(e);
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = (pinch.current.k * d) / pinch.current.d;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / view.k);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved) setView((v) => clampView({ k: v.k, x: d.ox + dx, y: d.oy + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && onPick && e.button === 0) {
      const p = toLocal(e);
      const ll = projection.invert?.([p.x, p.y]);
      if (ll && Math.abs(ll[1]) < 80) onPick({ lat: ll[1], lon: ((ll[0] + 540) % 360) - 180 });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pan = 60;
    const keys: Record<string, () => void> = {
      '+': () => zoomAt(W / 2, H / 2, 1.4),
      '=': () => zoomAt(W / 2, H / 2, 1.4),
      '-': () => zoomAt(W / 2, H / 2, 1 / 1.4),
      ArrowLeft: () => setView((v) => clampView({ ...v, x: v.x + pan })),
      ArrowRight: () => setView((v) => clampView({ ...v, x: v.x - pan })),
      ArrowUp: () => setView((v) => clampView({ ...v, y: v.y + pan })),
      ArrowDown: () => setView((v) => clampView({ ...v, y: v.y - pan })),
      '0': () => setView({ k: 1, x: 0, y: 0 }),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };

  const api: ChartApi = {
    projection,
    k: view.k,
    width: W,
    height: H,
    project: (p) => {
      const xy = projection([p.lon, p.lat]);
      if (!xy || xy[0] < -20 || xy[1] < -20 || xy[0] > W + 20 || xy[1] > H + 20) return null;
      return xy as [number, number];
    },
  };

  // Neatline scale bars: alternating ink/paper segments every `s` degrees.
  const s = step(view.k);
  const latBands: Array<{ y0: number; y1: number; i: number; lat: number }> = [];
  const lat0 = -Math.floor(80 / s) * s;
  for (let lat = lat0, i = 0; lat < 80; lat += s, i++) {
    const a = projection([0, lat]);
    const b = projection([0, lat + s]);
    if (!a || !b) continue;
    const y0 = Math.max(0, Math.min(H, b[1]));
    const y1 = Math.max(0, Math.min(H, a[1]));
    if (y1 - y0 > 0.5) latBands.push({ y0, y1, i, lat });
  }
  const lonBands: Array<{ x0: number; x1: number; i: number; lon: number }> = [];
  for (let lon = -180, i = 0; lon < 180; lon += s, i++) {
    const a = projection([lon, 0]);
    const b = projection([lon + s, 0]);
    if (!a || !b) continue;
    const x0 = Math.max(0, Math.min(W, a[0]));
    const x1 = Math.max(0, Math.min(W, b[0]));
    if (x1 - x0 > 0.5) lonBands.push({ x0, x1, i, lon });
  }
  const labelEvery = s * 2;

  return (
    <div ref={wrapRef} className={`chartmap ${className ?? ''}`} style={{ minHeight }}>
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="application"
          aria-label={`${ariaLabel}. Use arrow keys to pan, plus and minus to zoom, 0 to reset.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            const p = toLocal(e);
            zoomAt(p.x, p.y, 2);
          }}
          style={{ touchAction: 'none', cursor: onPick ? 'crosshair' : 'grab' }}
        >
          <defs>
            <clipPath id="chart-clip">
              <rect width={W} height={H} />
            </clipPath>
            <pattern
              id="sea-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--grat)" strokeWidth="1" />
            </pattern>
          </defs>
          <g transform={`translate(${FRAME},${FRAME})`}>
            <rect width={W} height={H} fill="var(--sea-1)" />
            <g clipPath="url(#chart-clip)">
              <path d={grat} fill="none" stroke="var(--grat)" strokeWidth="1" />
              {/* Shallow-water bands: the coast drawn wide, then narrower, under the land. */}
              <path
                d={landD}
                fill="none"
                stroke="var(--sea-2)"
                strokeWidth={Math.min(26, 10 + view.k * 2)}
                strokeLinejoin="round"
              />
              <path
                d={landD}
                fill="none"
                stroke="var(--sea-3)"
                strokeWidth={Math.min(12, 4 + view.k)}
                strokeLinejoin="round"
              />
              <path
                d={landD}
                fill="var(--land)"
                stroke="var(--land-line)"
                strokeWidth="0.7"
                strokeLinejoin="round"
              />
              <path d={landD} fill="url(#sea-hatch)" opacity="0.6" />
              {children?.(api)}
            </g>
          </g>
          {/* Neatline frame */}
          <g aria-hidden="true">
            <rect
              x={FRAME - 0.5}
              y={FRAME - 0.5}
              width={W + 1}
              height={H + 1}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1"
            />
            <rect
              x="0.5"
              y="0.5"
              width={width - 1}
              height={height - 1}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1"
            />
            {latBands.map((b) => (
              <g key={`lat${b.lat}`}>
                <rect
                  x={2}
                  y={FRAME + b.y0}
                  width={FRAME - 4}
                  height={b.y1 - b.y0}
                  fill={b.i % 2 ? 'var(--ink)' : 'var(--panel)'}
                />
                <rect
                  x={FRAME + W + 2}
                  y={FRAME + b.y0}
                  width={FRAME - 4}
                  height={b.y1 - b.y0}
                  fill={b.i % 2 ? 'var(--ink)' : 'var(--panel)'}
                />
              </g>
            ))}
            {lonBands.map((b) => (
              <g key={`lon${b.lon}`}>
                <rect
                  x={FRAME + b.x0}
                  y={2}
                  width={b.x1 - b.x0}
                  height={FRAME - 4}
                  fill={b.i % 2 ? 'var(--ink)' : 'var(--panel)'}
                />
                <rect
                  x={FRAME + b.x0}
                  y={FRAME + H + 2}
                  width={b.x1 - b.x0}
                  height={FRAME - 4}
                  fill={b.i % 2 ? 'var(--ink)' : 'var(--panel)'}
                />
              </g>
            ))}
            {latBands
              .filter((b) => b.lat % labelEvery === 0 && b.y1 < H - 8 && b.y1 > 8)
              .map((b) => (
                <text
                  key={`latl${b.lat}`}
                  x={FRAME + 4}
                  y={FRAME + b.y1 - 3}
                  className="chart-label"
                >
                  {Math.abs(b.lat)}°{b.lat >= 0 ? 'N' : 'S'}
                </text>
              ))}
            {lonBands
              .filter((b) => b.lon % (labelEvery * 2) === 0 && b.x0 > 8 && b.x0 < W - 30)
              .map((b) => (
                <text
                  key={`lonl${b.lon}`}
                  x={FRAME + b.x0 + 3}
                  y={FRAME + H - 4}
                  className="chart-label"
                >
                  {Math.abs(b.lon)}°{b.lon >= 0 ? 'E' : 'W'}
                </text>
              ))}
          </g>
        </svg>
      )}
      <div className="chart-zoom" role="group" aria-label="Zoom">
        <button
          className="btn btn-sm btn-icon"
          onClick={() => zoomAt(W / 2, H / 2, 1.5)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="btn btn-sm btn-icon"
          onClick={() => zoomAt(W / 2, H / 2, 1 / 1.5)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="btn btn-sm btn-icon"
          onClick={() => setView({ k: 1, x: 0, y: 0 })}
          aria-label="Reset view"
          title="Reset view"
        >
          ⌂
        </button>
      </div>
      <div className="chart-scale mono" aria-hidden="true">
        ×{view.k.toFixed(1)} · MERCATOR · WGS84
      </div>
    </div>
  );
}
