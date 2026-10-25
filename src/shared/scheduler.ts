/**
 * The Tide Router: places batch AI workloads onto the fleet's spot pool.
 *
 * Constraints per job: GPU-hours, a GPU ceiling, an optional latency bound to a
 * metro, an optional carbon cap, and a deadline. The router runs priority-first,
 * earliest-deadline-first, and for each job picks the vessel that finishes it
 * soonest (ties → lower carbon). Work is preemptible across hours but never
 * migrates between vessels mid-job, so checkpoints stay local.
 */
import { z } from 'zod';
import { metroByName, rttMs } from './geo.js';
import type { ForecastHour, VesselSpec } from './types.js';
import { GPU_MODELS } from './fleet.js';
import { spotGpus } from './vessel.js';

export const JobInput = z.object({
  name: z.string().trim().min(1).max(80),
  gpuHours: z.number().int().min(8).max(2_000_000),
  maxGpus: z.number().int().min(1).max(20_000),
  deadlineHours: z.number().int().min(1).max(168),
  priority: z.number().int().min(1).max(3),
  latencyMetro: z.string().max(60).nullable().default(null),
  maxRttMs: z.number().min(1).max(200).nullable().default(null),
  carbonCapG: z.number().min(10).max(1000).nullable().default(null),
});
export type JobInput = z.infer<typeof JobInput>;
export type Job = JobInput & { id: string; createdAt: number };

export interface Segment {
  hour: number;
  gpus: number;
}

export interface Placement {
  jobId: string;
  vesselId: string;
  segments: Segment[];
  startHour: number;
  finishHour: number;
  onTime: boolean;
  avgCarbon: number;
  energyMWh: number;
  rttMs: number | null;
}

export interface Unplaced {
  jobId: string;
  reason: string;
}

export interface Plan {
  hours: number;
  start: number;
  placements: Placement[];
  unplaced: Unplaced[];
  /** Spot-pool GPUs left per vessel per hour after placement. */
  residual: Record<string, number[]>;
  utilization: number;
}

export function planWorkloads(
  jobs: Job[],
  fleet: VesselSpec[],
  forecasts: Record<string, ForecastHour[]>,
  horizonHours: number,
): Plan {
  const start = forecasts[fleet[0]?.id]?.[0]?.t ?? Date.now();
  const free: Record<string, number[]> = {};
  const capacity: Record<string, number> = {};
  for (const v of fleet) {
    const f = forecasts[v.id] ?? [];
    free[v.id] = Array.from({ length: horizonHours }, (_, h) => (f[h] ? spotGpus(v, f[h]) : 0));
    capacity[v.id] = free[v.id].reduce((s, x) => s + x, 0);
  }

  const order = [...jobs].sort(
    (a, b) =>
      b.priority - a.priority || a.deadlineHours - b.deadlineHours || a.createdAt - b.createdAt,
  );

  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];

  for (const job of order) {
    const metro = job.latencyMetro ? metroByName(job.latencyMetro) : undefined;
    let best: Placement | null = null;
    const rejections: string[] = [];

    for (const v of fleet) {
      const f = forecasts[v.id] ?? [];
      const rtt = metro ? rttMs(v.berth, metro) : null;
      if (metro && job.maxRttMs !== null && rtt !== null && rtt > job.maxRttMs) {
        rejections.push('latency');
        continue;
      }
      let remaining = job.gpuHours;
      const segments: Segment[] = [];
      let ciWeighted = 0;
      for (let h = 0; h < horizonHours && remaining > 0; h++) {
        const fh = f[h];
        if (!fh) break;
        if (job.carbonCapG !== null && fh.carbonIntensity > job.carbonCapG) continue;
        const take = Math.min(free[v.id][h], job.maxGpus, remaining);
        if (take <= 0) continue;
        segments.push({ hour: h, gpus: take });
        ciWeighted += take * fh.carbonIntensity;
        remaining -= take;
      }
      if (remaining > 0) {
        rejections.push(job.carbonCapG !== null ? 'carbon-or-capacity' : 'capacity');
        continue;
      }
      const finishHour = segments[segments.length - 1].hour + 1;
      const kw = GPU_MODELS[v.gpuModel].kwPerGpu;
      const candidate: Placement = {
        jobId: job.id,
        vesselId: v.id,
        segments,
        startHour: segments[0].hour,
        finishHour,
        onTime: finishHour <= job.deadlineHours,
        avgCarbon: ciWeighted / job.gpuHours,
        energyMWh: (job.gpuHours * kw * 1.07) / 1000,
        rttMs: rtt,
      };
      if (
        !best ||
        (candidate.onTime && !best.onTime) ||
        (candidate.onTime === best.onTime &&
          (candidate.finishHour < best.finishHour ||
            (candidate.finishHour === best.finishHour && candidate.avgCarbon < best.avgCarbon)))
      ) {
        best = candidate;
      }
    }

    if (!best) {
      const why = rejections.every((r) => r === 'latency')
        ? `No vessel within ${job.maxRttMs} ms of ${job.latencyMetro}`
        : rejections.includes('carbon-or-capacity')
          ? `Not enough spot capacity under ${job.carbonCapG} gCO₂/kWh in the next ${horizonHours} h`
          : `Not enough spot capacity in the next ${horizonHours} h`;
      unplaced.push({ jobId: job.id, reason: why });
      continue;
    }
    if (!best.onTime) {
      unplaced.push({
        jobId: job.id,
        reason: `Earliest finish is hour ${best.finishHour}, after the ${job.deadlineHours} h deadline`,
      });
      continue;
    }
    for (const s of best.segments) free[best.vesselId][s.hour] -= s.gpus;
    placements.push(best);
  }

  const totalCap = Object.values(capacity).reduce((s, x) => s + x, 0);
  const used = placements.reduce((s, p) => s + p.segments.reduce((a, g) => a + g.gpus, 0), 0);
  return {
    hours: horizonHours,
    start,
    placements,
    unplaced,
    residual: free,
    utilization: totalCap ? used / totalCap : 0,
  };
}

export const SAMPLE_JOBS: JobInput[] = [
  {
    name: 'llm-pretrain-shard-07',
    gpuHours: 420_000,
    maxGpus: 8192,
    deadlineHours: 72,
    priority: 2,
    latencyMetro: null,
    maxRttMs: null,
    carbonCapG: 150,
  },
  {
    name: 'video-diffusion-finetune',
    gpuHours: 36_000,
    maxGpus: 1024,
    deadlineHours: 48,
    priority: 2,
    latencyMetro: null,
    maxRttMs: null,
    carbonCapG: null,
  },
  {
    name: 'nyc-trading-inference',
    gpuHours: 9_000,
    maxGpus: 512,
    deadlineHours: 24,
    priority: 3,
    latencyMetro: 'New York',
    maxRttMs: 3,
    carbonCapG: null,
  },
  {
    name: 'protein-fold-sweep',
    gpuHours: 64_000,
    maxGpus: 2048,
    deadlineHours: 96,
    priority: 1,
    latencyMetro: null,
    maxRttMs: null,
    carbonCapG: 60,
  },
  {
    name: 'tokyo-agent-serving',
    gpuHours: 14_000,
    maxGpus: 512,
    deadlineHours: 36,
    priority: 3,
    latencyMetro: 'Tokyo',
    maxRttMs: 4,
    carbonCapG: null,
  },
  {
    name: 'eu-sovereign-rag-index',
    gpuHours: 18_000,
    maxGpus: 768,
    deadlineHours: 40,
    priority: 2,
    latencyMetro: 'Amsterdam',
    maxRttMs: 6,
    carbonCapG: 200,
  },
];
