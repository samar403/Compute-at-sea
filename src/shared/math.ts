/** Small numeric helpers shared by the simulation, the server and the UI. */

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Integer hash → [0, 1). Deterministic, so the server, the UI and the tests agree. */
export function hash01(n: number): number {
  let x = Math.floor(n) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Stable string → integer seed. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Smooth 1-D value noise in [-1, 1].
 * `t` is in arbitrary units; one lattice step = one unit.
 */
export function noise1(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash01(seed * 7919 + i) * 2 - 1;
  const b = hash01(seed * 7919 + i + 1) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return lerp(a, b, u);
}

/** Fractal noise: three octaves, normalised to roughly [-1, 1]. */
export function fbm(seed: number, t: number): number {
  return (
    (noise1(seed, t) * 0.6 +
      noise1(seed + 101, t * 2.3) * 0.28 +
      noise1(seed + 211, t * 5.1) * 0.12) /
    1
  );
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = clamp(p) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lerp(sorted[lo], sorted[hi], idx - lo);
}

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
