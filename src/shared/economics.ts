/**
 * Charter pricing and the land-vs-sea capital model.
 *
 * Every number here is an explicit, editable assumption. The point of the model is
 * the shape of the answer — time-to-power dominates — not any single input.
 */
import { z } from 'zod';
import { GPU_MODELS } from './fleet.js';
import { LAND_WUE_L_PER_KWH } from './vessel.js';
import type { GpuModelId } from './types.js';

export const TERM_DISCOUNTS: Record<number, number> = {
  1: 0,
  3: 0.06,
  6: 0.11,
  12: 0.18,
  24: 0.26,
  36: 0.32,
};

export const SLA_TIERS = {
  standard: {
    label: 'Standard',
    uptime: '99.9 %',
    multiplier: 1,
    blurb: 'Fleet-wide placement, storm failover to sister vessels.',
  },
  pinned: {
    label: 'Latency-pinned',
    uptime: '99.95 %',
    multiplier: 1.12,
    blurb: 'Stays on one berth; guaranteed RTT to your metro.',
  },
  sovereign: {
    label: 'Sovereign',
    uptime: '99.95 %',
    multiplier: 1.22,
    blurb: 'Inside one nation’s EEZ, flag and crew of your choosing, audited.',
  },
} as const;
export type SlaTier = keyof typeof SLA_TIERS;

export const SEA_PUE = 1.07;
export const LAND_PUE = 1.38;
/** Blended fleet carbon intensity vs. an average land data-centre grid mix, gCO2e/kWh. */
export const SEA_CI = 95;
export const LAND_CI = 390;
export const HOURS_PER_MONTH = 730;

export const QuoteInput = z.object({
  gpuModel: z.enum(['gb300', 'b200', 'mi355x', 'h200']),
  gpuCount: z.number().int().min(8).max(20000),
  termMonths: z.union([
    z.literal(1),
    z.literal(3),
    z.literal(6),
    z.literal(12),
    z.literal(24),
    z.literal(36),
  ]),
  sla: z.enum(['standard', 'pinned', 'sovereign']),
  burst: z.boolean().default(false),
});
export type QuoteInput = z.infer<typeof QuoteInput>;

export interface Quote {
  input: QuoteInput;
  gpuLabel: string;
  ratePerGpuHour: number;
  listRate: number;
  discountPct: number;
  monthly: number;
  total: number;
  itMW: number;
  energyMWhPerMonth: number;
  carbonTPerMonth: number;
  landCarbonTPerMonth: number;
  freshwaterSavedM3PerMonth: number;
  landEquivalentRate: number;
  savingsVsLandPct: number;
  pflops: number;
}

export function quote(input: QuoteInput): Quote {
  const gpu = GPU_MODELS[input.gpuModel as GpuModelId];
  const discount = TERM_DISCOUNTS[input.termMonths] ?? 0;
  const sla = SLA_TIERS[input.sla];
  const burstMult = input.burst ? 1.25 : 1;
  const rate = gpu.listPrice * (1 - discount) * sla.multiplier * burstMult;
  const monthly = rate * input.gpuCount * HOURS_PER_MONTH;
  const itMW = (input.gpuCount * gpu.kwPerGpu) / 1000;
  const itMWh = itMW * HOURS_PER_MONTH;
  const energy = itMWh * SEA_PUE;
  // A land neocloud carries ~22 % more cost per GPU-hour from PUE, land, and grid-upgrade amortisation.
  const landRate = rate * 1.22;
  return {
    input,
    gpuLabel: gpu.label,
    ratePerGpuHour: rate,
    listRate: gpu.listPrice,
    discountPct: discount * 100,
    monthly,
    total: monthly * input.termMonths,
    itMW,
    energyMWhPerMonth: energy,
    carbonTPerMonth: (energy * SEA_CI) / 1000,
    landCarbonTPerMonth: (itMWh * LAND_PUE * LAND_CI) / 1000,
    freshwaterSavedM3PerMonth: (itMWh * 1000 * LAND_WUE_L_PER_KWH) / 1000,
    landEquivalentRate: landRate,
    savingsVsLandPct: (1 - rate / landRate) * 100,
    pflops: input.gpuCount * gpu.bf16Pflops,
  };
}

export const TcoInput = z.object({
  mw: z.number().min(1).max(500),
  horizonMonths: z.number().int().min(12).max(120),
  landCapexPerMW: z.number().min(1).max(40),
  seaCapexPerMW: z.number().min(1).max(40),
  landMonthsToPower: z.number().int().min(3).max(96),
  seaMonthsToPower: z.number().int().min(3).max(60),
  revenuePerMWMonth: z.number().min(0.05).max(3),
  landEnergyPrice: z.number().min(10).max(400),
  seaEnergyPrice: z.number().min(10).max(400),
  seaOpexPremiumPct: z.number().min(0).max(100),
  discountRatePct: z.number().min(0).max(30),
});
export type TcoInput = z.infer<typeof TcoInput>;

export const TCO_DEFAULTS: TcoInput = {
  mw: 40,
  horizonMonths: 72,
  landCapexPerMW: 11.5,
  seaCapexPerMW: 9.8,
  landMonthsToPower: 44,
  seaMonthsToPower: 14,
  revenuePerMWMonth: 0.82,
  landEnergyPrice: 82,
  seaEnergyPrice: 61,
  seaOpexPremiumPct: 18,
  discountRatePct: 10,
};

export interface TcoSeries {
  month: number;
  land: number;
  sea: number;
}

export interface TcoResult {
  input: TcoInput;
  series: TcoSeries[];
  landPaybackMonth: number | null;
  seaPaybackMonth: number | null;
  landNpv: number;
  seaNpv: number;
  monthsOfComputeGained: number;
  extraGpuHours: number;
}

/**
 * Cumulative cash position, $M. Capex is drawn evenly over the build; revenue starts at
 * energisation. Operating costs: energy at PUE plus a fixed O&M share (sea carries a premium
 * for crew, marine insurance and mooring inspection).
 */
export function tco(input: TcoInput): TcoResult {
  const r = (1 + input.discountRatePct / 100) ** (1 / 12) - 1;
  const run = (
    capexPerMW: number,
    buildMonths: number,
    pue: number,
    price: number,
    opexMult: number,
  ) => {
    const capex = capexPerMW * input.mw;
    const energyCost = (input.mw * HOURS_PER_MONTH * pue * price) / 1e6; // $M per month
    const om = input.mw * 0.035 * opexMult; // $M per MW-month baseline O&M
    const margin = input.revenuePerMWMonth * input.mw - energyCost - om;
    let cum = 0;
    let npv = 0;
    const out: number[] = [];
    for (let m = 1; m <= input.horizonMonths; m++) {
      const flow = m <= buildMonths ? -capex / buildMonths : margin;
      cum += flow;
      npv += flow / (1 + r) ** m;
      out.push(cum);
    }
    const payback = out.findIndex((v, i) => i >= buildMonths && v >= 0);
    return { out, npv, payback: payback === -1 ? null : payback + 1 };
  };
  const land = run(
    input.landCapexPerMW,
    input.landMonthsToPower,
    LAND_PUE,
    input.landEnergyPrice,
    1,
  );
  const sea = run(
    input.seaCapexPerMW,
    input.seaMonthsToPower,
    SEA_PUE,
    input.seaEnergyPrice,
    1 + input.seaOpexPremiumPct / 100,
  );
  const gained = Math.max(
    0,
    Math.min(input.horizonMonths, input.landMonthsToPower) - input.seaMonthsToPower,
  );
  const gpusPerMW = 1000 / 1.8;
  return {
    input,
    series: land.out.map((v, i) => ({ month: i + 1, land: v, sea: sea.out[i] })),
    landPaybackMonth: land.payback,
    seaPaybackMonth: sea.payback,
    landNpv: land.npv,
    seaNpv: sea.npv,
    monthsOfComputeGained: gained,
    extraGpuHours: gained * HOURS_PER_MONTH * gpusPerMW * input.mw,
  };
}
