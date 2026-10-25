import { FLEET } from '../shared/fleet.js';
import { HOUR_MS } from '../shared/math.js';
import type { Alert, FleetSnapshot, Telemetry } from '../shared/types.js';
import { alertsFor, simulateVessel } from '../shared/vessel.js';

export interface HistoryPoint {
  t: number;
  it: number;
  pue: number;
  hs: number;
  wind: number;
  ci: number;
  soc: number;
  util: number;
}

const HISTORY_LEN = 240;

/**
 * Owns the fleet's mutable state (battery charge, history) and advances it on a
 * simulated clock. Simulated time runs `simSpeed`× faster than wall-clock time,
 * anchored to the moment the server started.
 */
export class FleetSimulator {
  readonly simSpeed: number;
  readonly tickMs: number;
  private readonly realAnchor: number;
  private readonly simAnchor: number;
  private soc = new Map<string, number>();
  private latest = new Map<string, Telemetry & { shedMW: number }>();
  private hist = new Map<string, HistoryPoint[]>();
  private alerts: Alert[] = [];
  private lastT = 0;
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<(s: FleetSnapshot) => void>();

  constructor(opts: { simSpeed?: number; tickMs?: number; simStart?: number } = {}) {
    this.simSpeed = opts.simSpeed ?? 60;
    this.tickMs = opts.tickMs ?? 2000;
    this.realAnchor = Date.now();
    this.simAnchor = opts.simStart ?? this.realAnchor;
    for (const v of FLEET) {
      this.soc.set(v.id, 0.62);
      this.hist.set(v.id, []);
    }
    this.backfill();
  }

  simNow(): number {
    return this.simAnchor + (Date.now() - this.realAnchor) * this.simSpeed;
  }

  private get stepMs(): number {
    return this.tickMs * this.simSpeed;
  }

  /** Warm up history so charts are populated the moment the console opens. */
  private backfill(): void {
    const now = this.simNow();
    for (let i = HISTORY_LEN; i > 0; i--) this.advance(now - i * this.stepMs);
    this.advance(now);
  }

  private advance(t: number): void {
    const dtHours = this.lastT ? Math.max(1e-4, (t - this.lastT) / HOUR_MS) : this.stepMs / HOUR_MS;
    this.lastT = t;
    const alerts: Alert[] = [];
    for (const v of FLEET) {
      const tm = simulateVessel(v, t, this.soc.get(v.id) ?? 0.6, dtHours);
      this.soc.set(v.id, tm.batterySoc);
      this.latest.set(v.id, tm);
      const h = this.hist.get(v.id)!;
      h.push({
        t,
        it: tm.itLoadMW,
        pue: tm.pue,
        hs: tm.sea.hs,
        wind: tm.sea.wind,
        ci: tm.carbonIntensity,
        soc: tm.batterySoc,
        util: tm.utilization,
      });
      if (h.length > HISTORY_LEN) h.shift();
      alerts.push(...alertsFor(v, tm));
    }
    const rank = { warning: 0, caution: 1, info: 2 } as const;
    this.alerts = alerts.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  tick(): FleetSnapshot {
    this.advance(this.simNow());
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
    return snap;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(fn: (s: FleetSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  telemetry(id: string): Telemetry | undefined {
    const tm = this.latest.get(id);
    if (!tm) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { shedMW, ...rest } = tm;
    return rest;
  }

  history(id: string): HistoryPoint[] {
    return this.hist.get(id) ?? [];
  }

  snapshot(): FleetSnapshot {
    const vessels = FLEET.map((v) => this.telemetry(v.id)!).filter(Boolean);
    const it = vessels.reduce((s, x) => s + x.itLoadMW, 0);
    const fac = vessels.reduce((s, x) => s + x.facilityMW, 0);
    const renewable = vessels.reduce((s, x) => s + x.mix.windMW + Math.max(0, x.mix.batteryMW), 0);
    const emissions = vessels.reduce((s, x) => s + x.carbonIntensity * x.facilityMW, 0);
    return {
      t: this.lastT,
      simSpeed: this.simSpeed,
      vessels,
      alerts: this.alerts,
      totals: {
        itLoadMW: it,
        facilityMW: fac,
        activeGpus: vessels.reduce((s, x) => s + x.activeGpus, 0),
        avgPue: it > 0 ? fac / it : 0,
        avgCarbon: fac > 0 ? emissions / fac : 0,
        renewableShare: fac > 0 ? Math.min(1, renewable / fac) : 0,
        freshwaterSavedLph: vessels.reduce((s, x) => s + x.freshwaterSavedLph, 0),
      },
    };
  }
}
