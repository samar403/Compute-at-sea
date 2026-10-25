import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  coastDistanceKm,
  destinationPoint,
  haversineKm,
  interpolateGreatCircle,
  maritimeZone,
  metroByName,
  nearestMetros,
  rttMsForKm,
} from '../src/shared/geo';

describe('geo', () => {
  it('measures great-circle distance', () => {
    const london = metroByName('London')!;
    const ny = metroByName('New York')!;
    expect(haversineKm(london, ny)).toBeGreaterThan(5500);
    expect(haversineKm(london, ny)).toBeLessThan(5600);
    expect(haversineKm(london, london)).toBe(0);
  });

  it('models fibre round-trip time', () => {
    // 100 km of route at 200 km/ms with 1.35× route inflation, there and back, plus 0.6 ms.
    expect(rttMsForKm(100)).toBeCloseTo((2 * 100 * 1.35) / 200 + 0.6, 6);
    expect(rttMsForKm(0)).toBeCloseTo(0.6);
  });

  it('classifies UNCLOS zones', () => {
    expect(maritimeZone(10)).toBe('territorial');
    expect(maritimeZone(30)).toBe('contiguous');
    expect(maritimeZone(200)).toBe('eez');
    expect(maritimeZone(500)).toBe('high-seas');
  });

  it('round-trips destination points and bearings', () => {
    const p = { lat: 40, lon: -70 };
    const q = destinationPoint(p, 45, 250);
    expect(haversineKm(p, q)).toBeCloseTo(250, 3);
    expect(bearingDeg(p, q)).toBeCloseTo(45, 3);
  });

  it('interpolates along the great circle', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 90 };
    const mid = interpolateGreatCircle(a, b, 0.5);
    expect(mid.lat).toBeCloseTo(0, 6);
    expect(mid.lon).toBeCloseTo(45, 6);
  });

  it('finds the nearest metros in order', () => {
    const near = nearestMetros({ lat: 35.5, lon: 139.9 }, 3);
    expect(near[0].name).toBe('Tokyo');
    expect(near[0].km).toBeLessThanOrEqual(near[1].km);
  });

  it('measures distance to a coastline vertex set', () => {
    const verts = [0, 0, 1, 0];
    expect(coastDistanceKm({ lat: 0, lon: 0.5 }, verts)).toBeCloseTo(
      haversineKm({ lat: 0, lon: 0.5 }, { lat: 0, lon: 0 }),
      6,
    );
  });
});
