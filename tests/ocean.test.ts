import { describe, expect, it } from 'vitest';
import {
  beaufort,
  climatology,
  meanSst,
  meanWind,
  seaStateAt,
  turbineOutput,
} from '../src/shared/ocean';

const T = Date.UTC(2026, 9, 25, 12);

describe('metocean model', () => {
  it('is deterministic', () => {
    expect(seaStateAt({ lat: 54, lon: 3 }, T)).toEqual(seaStateAt({ lat: 54, lon: 3 }, T));
  });

  it('produces physically sensible ranges', () => {
    for (let i = 0; i < 200; i++) {
      const s = seaStateAt({ lat: -60 + i * 0.6, lon: -170 + i * 1.7 }, T + i * 3_600_000 * 7);
      expect(s.hs).toBeGreaterThan(0);
      expect(s.hs).toBeLessThan(20);
      expect(s.wind).toBeGreaterThan(0);
      expect(s.sst).toBeGreaterThan(-2);
      expect(s.sst).toBeLessThan(33);
      expect(s.intakeTemp).toBeLessThanOrEqual(s.sst);
      expect(s.beaufort).toBeGreaterThanOrEqual(0);
      expect(s.beaufort).toBeLessThanOrEqual(12);
    }
  });

  it('has westerlies stronger than the doldrums and tropics warmer than high latitudes', () => {
    expect(meanWind(52, T)).toBeGreaterThan(meanWind(2, T));
    expect(meanSst(5, T)).toBeGreaterThan(meanSst(58, T) + 15);
  });

  it('follows a turbine power curve', () => {
    expect(turbineOutput(0)).toBe(0);
    expect(turbineOutput(2)).toBe(0);
    expect(turbineOutput(14)).toBe(1);
    expect(turbineOutput(30)).toBe(0); // cut-out
    expect(turbineOutput(7)).toBeGreaterThan(turbineOutput(6));
  });

  it('maps wind to the Beaufort scale', () => {
    expect(beaufort(0.2)).toBe(0);
    expect(beaufort(6)).toBe(4);
    expect(beaufort(40)).toBe(12);
  });

  it('summarises a year of sea state', () => {
    const north = climatology({ lat: 54, lon: 3 });
    const equator = climatology({ lat: 2, lon: 105 });
    expect(north.capacityFactor).toBeGreaterThan(equator.capacityFactor);
    expect(north.meanSst).toBeLessThan(equator.meanSst);
    expect(north.hsP90).toBeGreaterThanOrEqual(north.hsP50);
    expect(north.stormFraction).toBeLessThanOrEqual(north.roughFraction);
  });
});
