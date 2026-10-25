import { describe, expect, it } from 'vitest';
import { QuoteInput, quote, tco, TCO_DEFAULTS, TERM_DISCOUNTS } from '../src/shared/economics';
import { GPU_MODELS } from '../src/shared/fleet';

describe('charter pricing', () => {
  it('applies term discount, tier and burst multipliers', () => {
    const base = quote({
      gpuModel: 'b200',
      gpuCount: 1000,
      termMonths: 1,
      sla: 'standard',
      burst: false,
    });
    expect(base.ratePerGpuHour).toBeCloseTo(GPU_MODELS.b200.listPrice, 9);
    const term = quote({
      gpuModel: 'b200',
      gpuCount: 1000,
      termMonths: 36,
      sla: 'standard',
      burst: false,
    });
    expect(term.ratePerGpuHour).toBeCloseTo(
      GPU_MODELS.b200.listPrice * (1 - TERM_DISCOUNTS[36]),
      9,
    );
    const sov = quote({
      gpuModel: 'b200',
      gpuCount: 1000,
      termMonths: 1,
      sla: 'sovereign',
      burst: true,
    });
    expect(sov.ratePerGpuHour).toBeCloseTo(GPU_MODELS.b200.listPrice * 1.22 * 1.25, 9);
  });

  it('computes totals, power and footprint', () => {
    const q = quote({
      gpuModel: 'gb300',
      gpuCount: 72,
      termMonths: 12,
      sla: 'standard',
      burst: false,
    });
    expect(q.monthly).toBeCloseTo(q.ratePerGpuHour * 72 * 730, 6);
    expect(q.total).toBeCloseTo(q.monthly * 12, 6);
    expect(q.itMW).toBeCloseTo((72 * GPU_MODELS.gb300.kwPerGpu) / 1000, 9);
    expect(q.carbonTPerMonth).toBeLessThan(q.landCarbonTPerMonth);
    expect(q.savingsVsLandPct).toBeGreaterThan(0);
  });

  it('validates inputs', () => {
    expect(
      QuoteInput.safeParse({ gpuModel: 'b200', gpuCount: 4, termMonths: 12, sla: 'standard' })
        .success,
    ).toBe(false);
    expect(
      QuoteInput.safeParse({ gpuModel: 'b200', gpuCount: 64, termMonths: 7, sla: 'standard' })
        .success,
    ).toBe(false);
    expect(
      QuoteInput.safeParse({ gpuModel: 'b200', gpuCount: 64, termMonths: 6, sla: 'standard' })
        .success,
    ).toBe(true);
  });
});

describe('land vs sea model', () => {
  it('pays back sooner at sea with the default assumptions', () => {
    const r = tco(TCO_DEFAULTS);
    expect(r.series).toHaveLength(TCO_DEFAULTS.horizonMonths);
    expect(r.seaPaybackMonth).not.toBeNull();
    expect(r.seaPaybackMonth!).toBeLessThan(r.landPaybackMonth ?? Infinity);
    expect(r.seaNpv).toBeGreaterThan(r.landNpv);
    expect(r.monthsOfComputeGained).toBe(
      TCO_DEFAULTS.landMonthsToPower - TCO_DEFAULTS.seaMonthsToPower,
    );
  });

  it('loses its edge when land is just as fast and cheaper to run', () => {
    const r = tco({
      ...TCO_DEFAULTS,
      landMonthsToPower: 14,
      landCapexPerMW: 8,
      landEnergyPrice: 40,
    });
    expect(r.monthsOfComputeGained).toBe(0);
    expect(r.landNpv).toBeGreaterThan(r.seaNpv);
  });

  it('draws capex before energisation', () => {
    const r = tco(TCO_DEFAULTS);
    expect(r.series[TCO_DEFAULTS.seaMonthsToPower - 1].sea).toBeCloseTo(
      -TCO_DEFAULTS.seaCapexPerMW * TCO_DEFAULTS.mw,
      6,
    );
  });
});
