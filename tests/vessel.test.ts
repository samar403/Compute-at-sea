import { describe, expect, it } from 'vitest';
import { FLEET, vesselById } from '../src/shared/fleet';
import type { SeaState } from '../src/shared/types';
import {
  BATTERY_RESERVE,
  coolingFraction,
  dispatch,
  forecastVessel,
  motionCap,
  simulateVessel,
  spotGpus,
  vesselPosition,
} from '../src/shared/vessel';

const T = Date.UTC(2026, 9, 25, 12);
const calm: SeaState = {
  sst: 10,
  intakeTemp: 9,
  wind: 9,
  windDir: 250,
  hs: 2,
  tp: 8,
  airTemp: 9,
  beaufort: 5,
};

const supplied = (d: ReturnType<typeof dispatch>) =>
  d.mix.windMW + Math.max(0, d.mix.cableMW) + Math.max(0, d.mix.batteryMW) + d.mix.gensetMW;

describe('vessel physics', () => {
  it('caps load by sea state', () => {
    expect(motionCap(3)).toBe(1);
    expect(motionCap(5.5)).toBe(1);
    expect(motionCap(7.25)).toBeCloseTo(0.8, 5);
    expect(motionCap(9)).toBe(0.35);
    expect(motionCap(14)).toBe(0.35);
  });

  it('costs more to cool with warmer water', () => {
    expect(coolingFraction(28)).toBeGreaterThan(coolingFraction(8));
  });

  it('balances supply and demand in every dispatch', () => {
    const spec = vesselById('halcyon')!;
    for (const wind of [0, 4, 8, 12, 20, 30]) {
      for (const soc of [0.2, 0.5, 0.9]) {
        const d = dispatch({
          spec,
          sea: { ...calm, wind },
          underway: false,
          utilization: 0.9,
          soc,
          dtHours: 1 / 30,
        });
        expect(supplied(d)).toBeCloseTo(d.facilityMW, 6);
        expect(d.soc).toBeGreaterThanOrEqual(0);
        expect(d.soc).toBeLessThanOrEqual(1);
        expect(d.pue).toBeGreaterThan(1);
        expect(d.pue).toBeLessThan(1.25);
      }
    }
  });

  it('never drains the battery below the storm reserve', () => {
    const spec = vesselById('corvina')!;
    const d = dispatch({
      spec,
      sea: { ...calm, wind: 0 },
      underway: false,
      utilization: 1,
      soc: BATTERY_RESERVE + 0.01,
      dtHours: 1,
    });
    expect(d.soc).toBeGreaterThanOrEqual(BATTERY_RESERVE - 1e-9);
  });

  it('enters storm mode in very high seas', () => {
    const spec = vesselById('halcyon')!;
    const d = dispatch({
      spec,
      sea: { ...calm, hs: 10, wind: 22 },
      underway: false,
      utilization: 1,
      soc: 0.8,
      dtHours: 0.1,
    });
    expect(d.status).toBe('storm-mode');
    expect(d.itLoadMW).toBeLessThanOrEqual(spec.itCapacityMW * 0.35 + 1e-9);
  });

  it('sheds load when every source is exhausted', () => {
    const spec = { ...vesselById('meridian')!, cableImportMW: 0, gensetMW: 0 };
    const d = dispatch({
      spec,
      sea: { ...calm, wind: 0 },
      underway: false,
      utilization: 1,
      soc: BATTERY_RESERVE,
      dtHours: 1,
    });
    expect(d.status).toBe('degraded');
    expect(d.itLoadMW).toBe(0);
    expect(d.shedMW).toBeGreaterThan(0);
  });

  it('moves relocatable units along their route and holds others on their berth', () => {
    const fixed = vesselPosition(vesselById('halcyon')!, T);
    expect(fixed.position).toEqual(vesselById('halcyon')!.berth);
    const wayfarer = vesselById('wayfarer')!;
    const period = wayfarer.route!.periodDays * 86_400_000;
    const states = Array.from({ length: 8 }, (_, i) =>
      vesselPosition(wayfarer, i * (period / 8) + period / 16),
    );
    expect(states.some((s) => s.underway)).toBe(true);
    expect(states.some((s) => !s.underway)).toBe(true);
  });

  it('simulates every vessel with consistent telemetry', () => {
    for (const v of FLEET) {
      const tm = simulateVessel(v, T, 0.6, 1 / 30);
      expect(tm.itLoadMW).toBeLessThanOrEqual(v.itCapacityMW + 1e-9);
      expect(tm.activeGpus).toBeLessThanOrEqual(v.gpus);
      expect(tm.carbonIntensity).toBeGreaterThanOrEqual(0);
      expect(tm.plumeDeltaK100m).toBeLessThan(tm.outfallDeltaK);
      expect(tm.rttMs).toBeGreaterThan(0);
    }
  });

  it('forecasts hourly capacity', () => {
    const spec = vesselById('kestrel')!;
    const f = forecastVessel(spec, T, 72);
    expect(f).toHaveLength(72);
    expect(f[1].t - f[0].t).toBe(3_600_000);
    for (const h of f) {
      expect(h.gpusAvailable).toBeLessThanOrEqual(spec.gpus);
      expect(spotGpus(spec, h)).toBeGreaterThanOrEqual(0);
    }
  });
});
