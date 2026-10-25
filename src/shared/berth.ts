/**
 * Berth scoring: is this patch of ocean a good place to moor a data-centre vessel?
 *
 * Six weighted factors, each 0–100, explained in plain language so a siting
 * decision can be argued with, not just accepted.
 */
import { maritimeZone, nearestMetros, ZONE_LABEL, type MaritimeZone } from './geo.js';
import { clamp } from './math.js';
import { climatology, type Climatology } from './ocean.js';
import type { LatLon } from './types.js';

export type BerthFactorKey =
  'latency' | 'wind' | 'cooling' | 'seastate' | 'mooring' | 'jurisdiction';

export interface BerthFactor {
  key: BerthFactorKey;
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface BerthScore {
  point: LatLon;
  onLand: boolean;
  total: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  coastKm: number;
  zone: MaritimeZone | null;
  zoneLabel: string | null;
  factors: BerthFactor[];
  metros: Array<{ name: string; country: string; km: number; rttMs: number; pop: number }>;
  climate: Climatology | null;
  /** Expected annual PUE given the site's sea temperature. */
  expectedPue: number | null;
  /** Population (millions) reachable within a 10 ms round trip. */
  popWithin10ms: number;
}

export const BERTH_WEIGHTS: Record<BerthFactorKey, number> = {
  latency: 0.24,
  wind: 0.2,
  cooling: 0.14,
  seastate: 0.2,
  mooring: 0.12,
  jurisdiction: 0.1,
};

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function gradeFor(total: number): BerthScore['grade'] {
  if (total >= 80) return 'A';
  if (total >= 68) return 'B';
  if (total >= 55) return 'C';
  if (total >= 40) return 'D';
  return 'F';
}

export function scoreBerth(point: LatLon, opts: { onLand: boolean; coastKm: number }): BerthScore {
  const metros = nearestMetros(point, 40);
  const top = metros
    .slice(0, 3)
    .map(({ name, country, km, rttMs, pop }) => ({ name, country, km, rttMs, pop }));
  const popWithin10ms = metros.filter((m) => m.rttMs <= 10).reduce((s, m) => s + m.pop, 0);

  if (opts.onLand) {
    return {
      point,
      onLand: true,
      total: 0,
      grade: 'F',
      verdict: 'That is dry land. Floating compute needs at least 40 m of water under the keel.',
      coastKm: 0,
      zone: null,
      zoneLabel: null,
      factors: [],
      metros: top,
      climate: null,
      expectedPue: null,
      popWithin10ms,
    };
  }

  const c = climatology(point);
  const zone = maritimeZone(opts.coastKm);
  const nearest = metros[0];

  // Latency: best RTT to a metro, boosted by how many people sit inside 10 ms.
  const rttScore = clamp(1 - (nearest.rttMs - 1.5) / 18) * 100;
  const popBoost = clamp(Math.log10(1 + popWithin10ms) / Math.log10(60)) * 100;
  const latency = 0.7 * rttScore + 0.3 * popBoost;

  const wind = clamp((c.capacityFactor - 0.18) / 0.37) * 100;
  const cooling = clamp(1 - (c.meanSst - 6) / 24) * 100;
  const seastate =
    clamp(1 - c.roughFraction * 3.5 - c.stormFraction * 8 - Math.max(0, c.hsP90 - 4) * 0.08) * 100;

  let mooring: number;
  const k = opts.coastKm;
  if (k < 5) mooring = 25 + k * 8;
  else if (k <= 70) mooring = 100;
  else if (k <= 220) mooring = 100 - ((k - 70) / 150) * 45;
  else mooring = Math.max(15, 55 - (k - 220) / 20);

  const jurisdiction = { territorial: 82, contiguous: 90, eez: 96, 'high-seas': 38 }[zone];

  const coolingFrac = 0.016 + 0.0021 * Math.max(0, c.meanSst - 1.5 - 6);
  const expectedPue = 1 + coolingFrac + 0.012 + 0.0016 * c.hsP50;

  const factors: BerthFactor[] = [
    {
      key: 'latency',
      label: 'Latency to demand',
      weight: BERTH_WEIGHTS.latency,
      score: latency,
      detail: `${nearest.name} at ${nearest.rttMs.toFixed(1)} ms RTT; ${popWithin10ms.toFixed(0)} M people within 10 ms`,
    },
    {
      key: 'wind',
      label: 'Offshore wind resource',
      weight: BERTH_WEIGHTS.wind,
      score: wind,
      detail: `Mean wind ${c.meanWind.toFixed(1)} m/s → turbine capacity factor ${pct(c.capacityFactor)}`,
    },
    {
      key: 'cooling',
      label: 'Seawater cooling',
      weight: BERTH_WEIGHTS.cooling,
      score: cooling,
      detail: `Mean SST ${c.meanSst.toFixed(1)} °C (peak ${c.maxSst.toFixed(1)} °C) → PUE ≈ ${expectedPue.toFixed(3)}`,
    },
    {
      key: 'seastate',
      label: 'Sea-state uptime',
      weight: BERTH_WEIGHTS.seastate,
      score: seastate,
      detail: `Hs P50 ${c.hsP50.toFixed(1)} m · P90 ${c.hsP90.toFixed(1)} m · storm mode ${pct(c.stormFraction)} of hours`,
    },
    {
      key: 'mooring',
      label: 'Mooring & export cable',
      weight: BERTH_WEIGHTS.mooring,
      score: mooring,
      detail: `${k.toFixed(0)} km from shore — ${k < 5 ? 'too close: visual & navigation conflicts' : k <= 70 ? 'ideal shelf distance for a short export cable' : 'long cable run and deep-water moorings'}`,
    },
    {
      key: 'jurisdiction',
      label: 'Jurisdiction clarity',
      weight: BERTH_WEIGHTS.jurisdiction,
      score: jurisdiction,
      detail: `${ZONE_LABEL[zone]} — ${zone === 'high-seas' ? 'flag-state law only; data-sovereignty buyers will hesitate' : 'coastal-state licensing with a clear data-residency story'}`,
    },
  ];

  const total = factors.reduce((s, f) => s + f.score * f.weight, 0);
  const grade = gradeFor(total);
  const strongest = [...factors].sort((a, b) => b.score - a.score)[0];
  const weakest = [...factors].sort((a, b) => a.score - b.score)[0];
  const verdict =
    grade === 'A' || grade === 'B'
      ? `Strong berth. ${strongest.label} leads; watch ${weakest.label.toLowerCase()}.`
      : grade === 'C'
        ? `Workable with mitigation: ${weakest.label.toLowerCase()} is the constraint.`
        : `Poor berth: ${weakest.label.toLowerCase()} rules it out for a first deployment.`;

  return {
    point,
    onLand: false,
    total,
    grade,
    verdict,
    coastKm: k,
    zone,
    zoneLabel: ZONE_LABEL[zone],
    factors,
    metros: top,
    climate: c,
    expectedPue,
    popWithin10ms,
  };
}
