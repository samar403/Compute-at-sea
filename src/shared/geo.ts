import type { LatLon, Metro } from './types.js';

export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point a fraction `f` along the great circle from `a` to `b`. */
export function interpolateGreatCircle(a: LatLon, b: LatLon, f: number): LatLon {
  const φ1 = a.lat * RAD;
  const λ1 = a.lon * RAD;
  const φ2 = b.lat * RAD;
  const λ2 = b.lon * RAD;
  const d = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-9) return { ...a };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
}

/** Initial bearing from a to b, degrees true. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * Light in fibre travels at ~200 km/ms. Real cable routes are not great circles,
 * so we apply a route-inflation factor and a fixed equipment/landing overhead.
 */
export const FIBRE_KM_PER_MS = 200;
export const ROUTE_FACTOR = 1.35;
export const EQUIPMENT_RTT_MS = 0.6;

export function rttMsForKm(km: number): number {
  return (2 * km * ROUTE_FACTOR) / FIBRE_KM_PER_MS + EQUIPMENT_RTT_MS;
}

export function rttMs(a: LatLon, b: LatLon): number {
  return rttMsForKm(haversineKm(a, b));
}

export const NM_KM = 1.852;

export type MaritimeZone = 'territorial' | 'contiguous' | 'eez' | 'high-seas';

/** UNCLOS zones by distance from the baseline (approximated by the coastline). */
export function maritimeZone(coastKm: number): MaritimeZone {
  if (coastKm <= 12 * NM_KM) return 'territorial';
  if (coastKm <= 24 * NM_KM) return 'contiguous';
  if (coastKm <= 200 * NM_KM) return 'eez';
  return 'high-seas';
}

export const ZONE_LABEL: Record<MaritimeZone, string> = {
  territorial: 'Territorial sea (≤12 nm)',
  contiguous: 'Contiguous zone (12–24 nm)',
  eez: 'Exclusive economic zone (24–200 nm)',
  'high-seas': 'High seas (>200 nm)',
};

/** Coastal metros that anchor demand. Populations are metro-area estimates in millions. */
export const METROS: Metro[] = [
  { name: 'New York', country: 'US', lat: 40.71, lon: -74.01, pop: 19.5 },
  { name: 'Boston', country: 'US', lat: 42.36, lon: -71.06, pop: 4.9 },
  { name: 'Miami', country: 'US', lat: 25.76, lon: -80.19, pop: 6.1 },
  { name: 'Houston', country: 'US', lat: 29.76, lon: -95.37, pop: 7.3 },
  { name: 'Los Angeles', country: 'US', lat: 34.05, lon: -118.24, pop: 12.9 },
  { name: 'San Francisco', country: 'US', lat: 37.77, lon: -122.42, pop: 6.7 },
  { name: 'Seattle', country: 'US', lat: 47.61, lon: -122.33, pop: 4.0 },
  { name: 'Vancouver', country: 'CA', lat: 49.28, lon: -123.12, pop: 2.6 },
  { name: 'Rio de Janeiro', country: 'BR', lat: -22.91, lon: -43.17, pop: 13.6 },
  { name: 'São Paulo', country: 'BR', lat: -23.55, lon: -46.63, pop: 22.4 },
  { name: 'Buenos Aires', country: 'AR', lat: -34.6, lon: -58.38, pop: 15.6 },
  { name: 'Lagos', country: 'NG', lat: 6.52, lon: 3.38, pop: 15.9 },
  { name: 'Cape Town', country: 'ZA', lat: -33.92, lon: 18.42, pop: 4.8 },
  { name: 'London', country: 'GB', lat: 51.51, lon: -0.13, pop: 14.8 },
  { name: 'Amsterdam', country: 'NL', lat: 52.37, lon: 4.9, pop: 2.5 },
  { name: 'Hamburg', country: 'DE', lat: 53.55, lon: 9.99, pop: 5.1 },
  { name: 'Oslo', country: 'NO', lat: 59.91, lon: 10.75, pop: 1.6 },
  { name: 'Dublin', country: 'IE', lat: 53.35, lon: -6.26, pop: 2.0 },
  { name: 'Lisbon', country: 'PT', lat: 38.72, lon: -9.14, pop: 2.9 },
  { name: 'Marseille', country: 'FR', lat: 43.3, lon: 5.37, pop: 1.9 },
  { name: 'Istanbul', country: 'TR', lat: 41.01, lon: 28.98, pop: 15.8 },
  { name: 'Alexandria', country: 'EG', lat: 31.2, lon: 29.92, pop: 5.6 },
  { name: 'Jeddah', country: 'SA', lat: 21.49, lon: 39.19, pop: 4.7 },
  { name: 'Dubai', country: 'AE', lat: 25.2, lon: 55.27, pop: 3.6 },
  { name: 'Karachi', country: 'PK', lat: 24.86, lon: 67.01, pop: 17.2 },
  { name: 'Mumbai', country: 'IN', lat: 19.08, lon: 72.88, pop: 21.7 },
  { name: 'Chennai', country: 'IN', lat: 13.08, lon: 80.27, pop: 11.5 },
  { name: 'Singapore', country: 'SG', lat: 1.35, lon: 103.82, pop: 5.9 },
  { name: 'Jakarta', country: 'ID', lat: -6.21, lon: 106.85, pop: 11.2 },
  { name: 'Ho Chi Minh City', country: 'VN', lat: 10.82, lon: 106.63, pop: 9.3 },
  { name: 'Manila', country: 'PH', lat: 14.6, lon: 120.98, pop: 14.4 },
  { name: 'Hong Kong', country: 'HK', lat: 22.32, lon: 114.17, pop: 7.5 },
  { name: 'Shanghai', country: 'CN', lat: 31.23, lon: 121.47, pop: 29.2 },
  { name: 'Taipei', country: 'TW', lat: 25.03, lon: 121.57, pop: 7.0 },
  { name: 'Seoul', country: 'KR', lat: 37.57, lon: 126.98, pop: 25.5 },
  { name: 'Tokyo', country: 'JP', lat: 35.68, lon: 139.69, pop: 37.1 },
  { name: 'Osaka', country: 'JP', lat: 34.69, lon: 135.5, pop: 19.0 },
  { name: 'Sydney', country: 'AU', lat: -33.87, lon: 151.21, pop: 5.4 },
  { name: 'Melbourne', country: 'AU', lat: -37.81, lon: 144.96, pop: 5.2 },
  { name: 'Auckland', country: 'NZ', lat: -36.85, lon: 174.76, pop: 1.7 },
];

export function metroByName(name: string): Metro | undefined {
  return METROS.find((m) => m.name.toLowerCase() === name.toLowerCase());
}

export function nearestMetros(p: LatLon, n = 3): Array<Metro & { km: number; rttMs: number }> {
  return METROS.map((m) => {
    const km = haversineKm(p, m);
    return { ...m, km, rttMs: rttMsForKm(km) };
  })
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/**
 * Distance from a point to the nearest coastline vertex, in km.
 * `coastVertices` is a flat [lon, lat, lon, lat, …] array (see server/landmask.ts and client/lib/world.ts).
 */
export function coastDistanceKm(p: LatLon, coastVertices: Float64Array | number[]): number {
  let best = Infinity;
  const cosLat = Math.cos(p.lat * RAD);
  for (let i = 0; i < coastVertices.length; i += 2) {
    const lon = coastVertices[i];
    const lat = coastVertices[i + 1];
    // Cheap equirectangular pre-filter before the exact haversine.
    let dLon = Math.abs(lon - p.lon);
    if (dLon > 180) dLon = 360 - dLon;
    const approx = Math.hypot((lat - p.lat) * 111.2, dLon * 111.2 * cosLat);
    if (approx - 50 > best) continue;
    const d = haversineKm(p, { lat, lon });
    if (d < best) best = d;
  }
  return best;
}

export function formatLatLon(p: LatLon): string {
  const ns = p.lat >= 0 ? 'N' : 'S';
  const ew = p.lon >= 0 ? 'E' : 'W';
  const dm = (v: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${d}°${m.toFixed(1).padStart(4, '0')}′`;
  };
  return `${dm(p.lat)}${ns} ${dm(p.lon)}${ew}`;
}

/** Point reached travelling `km` from `p` on an initial bearing (degrees true). */
export function destinationPoint(p: LatLon, bearing: number, km: number): LatLon {
  const δ = km / EARTH_RADIUS_KM;
  const θ = bearing * RAD;
  const φ1 = p.lat * RAD;
  const λ1 = p.lon * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / RAD, lon: ((λ2 / RAD + 540) % 360) - 180 };
}
