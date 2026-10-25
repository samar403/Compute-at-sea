/**
 * A compact, deterministic metocean model.
 *
 * It is not a forecast. It reproduces the climatology that matters for siting
 * floating compute — trade winds and westerlies, latitude-driven sea temperature
 * with seasonality, and storm statistics derived from wind (Pierson–Moskowitz) —
 * with smooth, seeded variability so every view of the app agrees on "the weather".
 */
import { clamp, DAY_MS, fbm, HOUR_MS, noise1, seedOf } from './math.js';
import type { LatLon, SeaState } from './types.js';

const RAD = Math.PI / 180;
const G = 9.81;

/** 0..1 through the year, 0 = 1 Jan. */
export function yearPhase(t: number): number {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (t - start) / (365.25 * DAY_MS);
}

/** +1 at local mid-winter, −1 at local mid-summer. */
export function winterness(lat: number, t: number): number {
  const northWinter = Math.cos(2 * Math.PI * (yearPhase(t) - 0.04));
  return lat >= 0 ? northWinter : -northWinter;
}

/** Climatological mean 10 m wind speed, m/s, by latitude and season. */
export function meanWind(lat: number, t: number): number {
  const a = Math.abs(lat);
  const doldrums = 4.1;
  const trades = 2.9 * Math.exp(-(((a - 15) / 8) ** 2));
  const westerlies = 4.0 * Math.exp(-(((a - 50) / 16) ** 2));
  // The Southern Ocean has no continents in the way.
  const roaring = lat < -38 ? 1.6 * Math.exp(-(((a - 50) / 9) ** 2)) : 0;
  const seasonal = 1 + 0.16 * winterness(lat, t) * clamp((a - 10) / 30);
  return (doldrums + trades + westerlies + roaring) * seasonal;
}

/** Climatological sea-surface temperature, °C. */
export function meanSst(lat: number, t: number): number {
  const c = Math.cos(lat * RAD);
  const base = -1.8 + 30.2 * Math.pow(c * c, 1.1);
  const amp = 3.6 * Math.sin(Math.min(Math.abs(lat), 75) * 2 * RAD);
  return base - amp * winterness(lat, t) * 0.5;
}

function cellSeed(p: LatLon): number {
  // Neighbouring points share weather systems: seed by a ~4° cell.
  return seedOf(`${Math.round(p.lat / 4)}:${Math.round(p.lon / 4)}`);
}

/** Wind-sea significant wave height for a fully developed sea (Pierson–Moskowitz). */
export function pmWaveHeight(windMs: number): number {
  return (0.21 * windMs * windMs) / G;
}

export function beaufort(windMs: number): number {
  const limits = [0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const i = limits.findIndex((l) => windMs < l);
  return i === -1 ? 12 : i;
}

export const BEAUFORT_LABEL = [
  'Calm',
  'Light air',
  'Light breeze',
  'Gentle breeze',
  'Moderate breeze',
  'Fresh breeze',
  'Strong breeze',
  'Near gale',
  'Gale',
  'Strong gale',
  'Storm',
  'Violent storm',
  'Hurricane force',
];

/** Instantaneous sea state at a point and time. */
export function seaStateAt(p: LatLon, t: number): SeaState {
  const seed = cellSeed(p);
  const hours = t / HOUR_MS;
  const mw = meanWind(p.lat, t);

  // Synoptic systems pass every ~3–4 days; gusts every few hours.
  const synoptic = fbm(seed, hours / 78);
  const gust = noise1(seed + 17, hours / 5);
  // Occasional deep lows: rare large positive excursions.
  const stormPulse = Math.max(0, noise1(seed + 31, hours / 140) - 0.55) * 3.4;
  const wind = Math.max(0.3, mw * (1 + 0.42 * synoptic + 0.1 * gust + stormPulse * 0.9));

  const windDir =
    ((p.lat > 30 || p.lat < -30 ? 250 : 70) + 60 * noise1(seed + 5, hours / 60) + 360) % 360;

  // Wind sea is lagged/partially developed; swell persists from distant weather.
  const windSea = pmWaveHeight(wind) * 0.82;
  const swell = 0.6 + 0.13 * mw + 0.45 * (fbm(seed + 3, hours / 120) + 1);
  const hs = Math.max(0.2, Math.sqrt(windSea * windSea + swell * swell));
  const tp = Math.max(5, 0.42 * wind + 4.4 + 1.5 * (fbm(seed + 9, hours / 90) + 1));

  const sst = meanSst(p.lat, t) + 0.6 * fbm(seed + 13, hours / 400);
  // Seawater intake at ~30 m sits below the mixed layer in summer, colder in the tropics' thermocline.
  const stratification =
    clamp((sst - 12) / 16) * 2.6 * (1 - 0.5 * clamp(winterness(p.lat, t) + 1, 0, 2));
  const intakeTemp = sst - Math.max(0.3, stratification);
  const airTemp = sst - 1.2 + 2.2 * noise1(seed + 23, hours / 18) - 0.25 * Math.max(0, wind - 10);

  return {
    sst,
    intakeTemp,
    wind,
    windDir,
    hs,
    tp,
    airTemp,
    beaufort: beaufort(wind),
  };
}

/** Normalised output (0..1) of an offshore wind turbine at a given hub-height wind speed. */
export function turbineOutput(windAt10m: number): number {
  // Power-law shear from 10 m to a ~150 m hub over open water.
  const v = windAt10m * Math.pow(150 / 10, 0.09);
  const cutIn = 3.5;
  const rated = 12.5;
  const cutOut = 27;
  if (v < cutIn || v >= cutOut) return 0;
  if (v >= rated) return 1;
  return (v ** 3 - cutIn ** 3) / (rated ** 3 - cutIn ** 3);
}

export interface Climatology {
  meanWind: number;
  capacityFactor: number;
  meanSst: number;
  maxSst: number;
  hsP50: number;
  hsP90: number;
  hsMax: number;
  /** Fraction of hours with Hs ≥ 6 m (vessel enters reduced-load envelope). */
  roughFraction: number;
  /** Fraction of hours with Hs ≥ 9 m (storm mode). */
  stormFraction: number;
}

/** Sample a full year (every 6 hours) to build site statistics. */
export function climatology(p: LatLon, year = 2026): Climatology {
  const start = Date.UTC(year, 0, 1);
  const n = 1460;
  const hs: number[] = [];
  let wind = 0;
  let cf = 0;
  let sst = 0;
  let maxSst = -Infinity;
  let rough = 0;
  let storm = 0;
  for (let i = 0; i < n; i++) {
    const s = seaStateAt(p, start + i * 6 * HOUR_MS);
    hs.push(s.hs);
    wind += s.wind;
    cf += turbineOutput(s.wind);
    sst += s.sst;
    maxSst = Math.max(maxSst, s.sst);
    if (s.hs >= 6) rough++;
    if (s.hs >= 9) storm++;
  }
  hs.sort((a, b) => a - b);
  return {
    meanWind: wind / n,
    capacityFactor: cf / n,
    meanSst: sst / n,
    maxSst,
    hsP50: hs[Math.floor(n * 0.5)],
    hsP90: hs[Math.floor(n * 0.9)],
    hsMax: hs[n - 1],
    roughFraction: rough / n,
    stormFraction: storm / n,
  };
}
