import { describe, expect, it } from 'vitest';
import { BERTH_WEIGHTS, gradeFor, scoreBerth } from '../src/shared/berth';

describe('berth scoring', () => {
  it('weights sum to one', () => {
    expect(Object.values(BERTH_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 9);
  });

  it('rejects dry land', () => {
    const s = scoreBerth({ lat: 48.85, lon: 2.35 }, { onLand: true, coastKm: 0 });
    expect(s.total).toBe(0);
    expect(s.grade).toBe('F');
    expect(s.factors).toHaveLength(0);
  });

  it('scores open water with bounded, explained factors', () => {
    const s = scoreBerth({ lat: 53.85, lon: 3.3 }, { onLand: false, coastKm: 60 });
    expect(s.factors).toHaveLength(6);
    for (const f of s.factors) {
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(100);
      expect(f.detail.length).toBeGreaterThan(10);
    }
    expect(s.total).toBeGreaterThan(0);
    expect(s.total).toBeLessThanOrEqual(100);
    expect(s.zone).toBe('eez');
    expect(s.expectedPue).toBeGreaterThan(1);
  });

  it('prefers a berth near demand over the middle of the Pacific', () => {
    const nearTokyo = scoreBerth({ lat: 34.6, lon: 140.5 }, { onLand: false, coastKm: 40 });
    const midPacific = scoreBerth({ lat: 10, lon: -150 }, { onLand: false, coastKm: 2500 });
    expect(nearTokyo.total).toBeGreaterThan(midPacific.total);
    expect(midPacific.zone).toBe('high-seas');
  });

  it('grades on fixed bands', () => {
    expect(gradeFor(85)).toBe('A');
    expect(gradeFor(70)).toBe('B');
    expect(gradeFor(60)).toBe('C');
    expect(gradeFor(45)).toBe('D');
    expect(gradeFor(10)).toBe('F');
  });
});
