import { describe, expect, it } from 'vitest';
import { FLEET } from '../src/shared/fleet';
import { metroByName, rttMs } from '../src/shared/geo';
import { planWorkloads, type Job } from '../src/shared/scheduler';
import type { ForecastHour } from '../src/shared/types';
import { forecastVessel, spotGpus } from '../src/shared/vessel';

const T = Date.UTC(2026, 9, 25, 0);
const H = 48;
const forecasts: Record<string, ForecastHour[]> = Object.fromEntries(
  FLEET.map((v) => [v.id, forecastVessel(v, T, H)]),
);

let n = 0;
const job = (over: Partial<Job>): Job => ({
  id: `j${++n}`,
  createdAt: n,
  name: `job-${n}`,
  gpuHours: 10_000,
  maxGpus: 500,
  deadlineHours: 48,
  priority: 2,
  latencyMetro: null,
  maxRttMs: null,
  carbonCapG: null,
  ...over,
});

describe('tide router', () => {
  it('never oversubscribes a vessel-hour', () => {
    const jobs = Array.from({ length: 12 }, () => job({ gpuHours: 60_000, maxGpus: 4000 }));
    const plan = planWorkloads(jobs, FLEET, forecasts, H);
    for (const v of FLEET) {
      for (let h = 0; h < H; h++) {
        const used = plan.placements
          .filter((p) => p.vesselId === v.id)
          .reduce((s, p) => s + (p.segments.find((g) => g.hour === h)?.gpus ?? 0), 0);
        expect(used).toBeLessThanOrEqual(spotGpus(v, forecasts[v.id][h]));
        expect(plan.residual[v.id][h]).toBe(spotGpus(v, forecasts[v.id][h]) - used);
      }
    }
  });

  it('delivers exactly the requested GPU-hours within the width limit', () => {
    const j = job({ gpuHours: 12_345, maxGpus: 300 });
    const plan = planWorkloads([j], FLEET, forecasts, H);
    const p = plan.placements[0];
    expect(p.segments.reduce((s, g) => s + g.gpus, 0)).toBe(12_345);
    expect(Math.max(...p.segments.map((g) => g.gpus))).toBeLessThanOrEqual(300);
    expect(p.onTime).toBe(true);
  });

  it('honours latency pins', () => {
    const plan = planWorkloads([job({ latencyMetro: 'Tokyo', maxRttMs: 4 })], FLEET, forecasts, H);
    const p = plan.placements[0];
    const v = FLEET.find((x) => x.id === p.vesselId)!;
    expect(rttMs(v.berth, metroByName('Tokyo')!)).toBeLessThanOrEqual(4);
  });

  it('reports impossible latency', () => {
    const plan = planWorkloads(
      [job({ latencyMetro: 'Auckland', maxRttMs: 2 })],
      FLEET,
      forecasts,
      H,
    );
    expect(plan.placements).toHaveLength(0);
    expect(plan.unplaced[0].reason).toMatch(/No vessel within/);
  });

  it('honours carbon caps hour by hour', () => {
    const plan = planWorkloads([job({ carbonCapG: 50 })], FLEET, forecasts, H);
    for (const p of plan.placements)
      for (const s of p.segments)
        expect(forecasts[p.vesselId][s.hour].carbonIntensity).toBeLessThanOrEqual(50);
  });

  it('refuses work that cannot meet its deadline', () => {
    const plan = planWorkloads(
      [job({ gpuHours: 100_000, maxGpus: 100, deadlineHours: 10 })],
      FLEET,
      forecasts,
      H,
    );
    expect(plan.placements).toHaveLength(0);
    expect(plan.unplaced[0].reason).toMatch(/deadline|capacity/);
  });

  it('serves urgent work first', () => {
    const lo = job({ priority: 1, gpuHours: 400_000, maxGpus: 20_000, createdAt: 0 });
    const hi = job({ priority: 3, gpuHours: 1_000, maxGpus: 100, createdAt: 99 });
    const plan = planWorkloads([lo, hi], FLEET, forecasts, H);
    const p = plan.placements.find((x) => x.jobId === hi.id)!;
    expect(p.startHour).toBe(0);
  });
});
