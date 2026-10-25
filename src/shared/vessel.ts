/**
 * Vessel physics: position, motion envelope, power dispatch, seawater cooling.
 *
 * Every function here is pure. The server owns mutable state (battery charge)
 * and steps it forward; forecasts call the same code with a neutral battery.
 */
import { BATTERY_CI, GENSET_CI } from './fleet.js';
import { bearingDeg, haversineKm, interpolateGreatCircle, metroByName, rttMs } from './geo.js';
import { clamp, DAY_MS, HOUR_MS, noise1, seedOf } from './math.js';
import { seaStateAt, turbineOutput } from './ocean.js';
import type {
  Alert,
  ForecastHour,
  LatLon,
  PowerMix,
  SeaState,
  Telemetry,
  VesselSpec,
  VesselStatus,
} from './types.js';

/** Litres of freshwater an evaporatively cooled land data centre consumes per IT kWh (WUE). */
export const LAND_WUE_L_PER_KWH = 1.8;
/** Propulsion load while a Petrel-class unit is under way, MW. */
export const TRANSIT_PROPULSION_MW = 5.5;
/** Share of fleet GPUs held for reserved charters; the rest is the spot pool the router fills. */
export const RESERVED_SHARE = 0.55;
/** Battery is never discharged below this state of charge: it is the storm ride-through reserve. */
export const BATTERY_RESERVE = 0.3;
/** In normal operations the battery only smooths wind down to this level; below it the cable is preferred. */
export const BATTERY_FLOOR = 0.5;

export interface VesselPosition {
  position: LatLon;
  underway: boolean;
  headingDeg: number;
  /** For relocating units: name of the berth it is heading to or sitting at. */
  legLabel?: string;
  /** 0..1 progress through the current sailing leg. */
  legProgress?: number;
}

function along(waypoints: LatLon[], f: number): { p: LatLon; heading: number } {
  const legs = waypoints.slice(1).map((w, i) => haversineKm(waypoints[i], w));
  const total = legs.reduce((s, x) => s + x, 0);
  let d = clamp(f) * total;
  for (let i = 0; i < legs.length; i++) {
    if (d <= legs[i] || i === legs.length - 1) {
      const lf = legs[i] === 0 ? 0 : clamp(d / legs[i]);
      const a = waypoints[i];
      const b = waypoints[i + 1];
      return { p: interpolateGreatCircle(a, b, lf), heading: bearingDeg(a, b) };
    }
    d -= legs[i];
  }
  return { p: waypoints[waypoints.length - 1], heading: 0 };
}

/**
 * Relocatable units cycle: dwell at A → sail A→B → dwell at B → sail B→A.
 * Each quarter of the period is one phase.
 */
export function vesselPosition(spec: VesselSpec, t: number): VesselPosition {
  if (!spec.route) return { position: spec.berth, underway: false, headingDeg: 0 };
  const { waypoints, periodDays, fromName, toName } = spec.route;
  const phase = (((t / (periodDays * DAY_MS)) % 1) + 1) % 1;
  const q = Math.floor(phase * 4);
  const f = phase * 4 - q;
  if (q === 0)
    return { position: waypoints[0], underway: false, headingDeg: 0, legLabel: fromName };
  if (q === 2)
    return {
      position: waypoints[waypoints.length - 1],
      underway: false,
      headingDeg: 0,
      legLabel: toName,
    };
  if (q === 1) {
    const { p, heading } = along(waypoints, f);
    return { position: p, underway: true, headingDeg: heading, legLabel: toName, legProgress: f };
  }
  const rev = [...waypoints].reverse();
  const { p, heading } = along(rev, f);
  return { position: p, underway: true, headingDeg: heading, legLabel: fromName, legProgress: f };
}

/**
 * Fraction of IT load the vessel may carry in a given sea.
 * Liquid-cooled racks are rated for the hull's motions up to Hs 5.5 m; beyond that
 * load is ramped down to limit coolant sloshing and rack accelerations, and above
 * 9 m the vessel is in storm mode with only priority workloads running.
 */
export function motionCap(hs: number): number {
  if (hs <= 5.5) return 1;
  if (hs >= 9) return 0.35;
  return 1 - (0.4 * (hs - 5.5)) / 3.5;
}

/** Demand follows the served metro's working day. */
export function demandUtilization(spec: VesselSpec, t: number): number {
  const metro = metroByName(spec.servesMetro);
  const lon = metro?.lon ?? spec.berth.lon;
  const utcHour = (t / HOUR_MS) % 24;
  const localHour = (utcHour + lon / 15 + 48) % 24;
  const diurnal = 0.11 * Math.sin((2 * Math.PI * (localHour - 9)) / 24);
  const jitter = 0.05 * noise1(seedOf(spec.id), t / (HOUR_MS * 1.5));
  return clamp(0.8 + diurnal + jitter, 0.45, 0.98);
}

export function coolingFraction(intakeC: number): number {
  return 0.016 + 0.0021 * Math.max(0, intakeC - 6) + 0.006 * Math.max(0, intakeC - 24);
}

export function overheadFraction(hs: number): number {
  // Hotel load, ballast pumps, mooring winches and DP-assist thrusters scale with sea state.
  return 0.012 + 0.0016 * hs;
}

export interface DispatchInput {
  spec: VesselSpec;
  sea: SeaState;
  underway: boolean;
  utilization: number;
  soc: number;
  dtHours: number;
}

export interface DispatchResult {
  status: VesselStatus;
  cap: number;
  itLoadMW: number;
  coolingMW: number;
  overheadMW: number;
  facilityMW: number;
  pue: number;
  mix: PowerMix;
  soc: number;
  carbonIntensity: number;
  shedMW: number;
}

/**
 * Merit-order dispatch: wind → battery (smoothing band) → shore cable →
 * battery (storm reserve band) → gensets → shed load.
 */
export function dispatch({
  spec,
  sea,
  underway,
  utilization,
  soc,
  dtHours,
}: DispatchInput): DispatchResult {
  const cap = underway ? Math.min(0.35, motionCap(sea.hs)) : motionCap(sea.hs);
  const cool = coolingFraction(sea.intakeTemp);
  const ovh = overheadFraction(sea.hs);
  const propulsion = underway ? TRANSIT_PROPULSION_MW : 0;

  let it = spec.itCapacityMW * cap * utilization;
  const facilityFor = (itMW: number) => itMW * (1 + cool + ovh) + propulsion;
  let demand = facilityFor(it);

  const wind = underway ? 0 : spec.windTieMW * turbineOutput(sea.wind);
  const cableCap = underway ? 0 : spec.cableImportMW;
  const rate = spec.batteryMWh / 2; // C/2
  const mix: PowerMix = {
    windGenMW: wind,
    windMW: 0,
    cableMW: 0,
    batteryMW: 0,
    gensetMW: 0,
    curtailedMW: 0,
  };

  mix.windMW = Math.min(wind, demand);
  let deficit = demand - mix.windMW;
  let surplus = wind - mix.windMW;

  if (surplus > 0) {
    const room = ((1 - soc) * spec.batteryMWh) / dtHours;
    const charge = Math.min(surplus, rate, room);
    mix.batteryMW = -charge;
    surplus -= charge;
    const exported = Math.min(surplus, cableCap);
    mix.cableMW = -exported;
    mix.curtailedMW = surplus - exported;
  }

  if (deficit > 0) {
    const band = (floor: number) => (Math.max(0, soc - floor) * spec.batteryMWh) / dtHours;
    const smooth = Math.min(deficit, rate, band(BATTERY_FLOOR));
    deficit -= smooth;
    const imp = Math.min(deficit, cableCap);
    mix.cableMW = imp;
    deficit -= imp;
    const reserve = Math.min(deficit, rate - smooth, Math.max(0, band(BATTERY_RESERVE) - smooth));
    deficit -= reserve;
    mix.batteryMW = smooth + reserve;
    const gen = Math.min(deficit, spec.gensetMW);
    mix.gensetMW = gen;
    deficit -= gen;
  }

  let shed = 0;
  if (deficit > 1e-6) {
    // Shed IT load until supply matches.
    const supplied = demand - deficit;
    const newIt = Math.max(0, (supplied - propulsion) / (1 + cool + ovh));
    shed = it - newIt;
    it = newIt;
    demand = facilityFor(it);
  }

  const nextSoc = clamp(soc - (mix.batteryMW * dtHours) / spec.batteryMWh);
  const fromCable = Math.max(0, mix.cableMW);
  const fromBattery = Math.max(0, mix.batteryMW);
  const emissions =
    fromCable * spec.shoreGridCI + mix.gensetMW * GENSET_CI + fromBattery * BATTERY_CI;
  const carbonIntensity = demand > 0 ? emissions / demand : 0;

  let status: VesselStatus = 'operational';
  if (underway) status = 'transit';
  else if (shed > 0.05) status = 'degraded';
  else if (sea.hs >= 9) status = 'storm-mode';

  return {
    status,
    cap,
    itLoadMW: it,
    coolingMW: it * cool,
    overheadMW: it * ovh + propulsion,
    facilityMW: demand,
    pue: it > 0 ? demand / it : 0,
    mix,
    soc: nextSoc,
    carbonIntensity,
    shedMW: shed,
  };
}

/** Advance one vessel to time `t`. Returns telemetry and the new battery state of charge. */
export function simulateVessel(
  spec: VesselSpec,
  t: number,
  soc: number,
  dtHours: number,
): Telemetry & { shedMW: number } {
  const pos = vesselPosition(spec, t);
  const sea = seaStateAt(pos.position, t);
  const utilization = demandUtilization(spec, t);
  const d = dispatch({ spec, sea, underway: pos.underway, utilization, soc, dtHours });

  // Seawater loop sized for an 8 K rise at design heat; VFD pumps keep ≥40 % flow.
  const designHeat = spec.itCapacityMW * 1.1;
  const heat = d.itLoadMW + d.coolingMW * 0.6;
  const flowFrac = Math.max(0.4, heat / designHeat);
  const outfallDeltaK = (8 * (heat / designHeat)) / flowFrac;
  // Multiport diffuser dilution grows with wave-driven mixing.
  const plumeDeltaK100m = outfallDeltaK / (9 + 2.2 * sea.hs);

  const coolantSupplyC = sea.intakeTemp + 3.5;
  const loadFrac = spec.itCapacityMW > 0 ? d.itLoadMW / spec.itCapacityMW : 0;
  const gpuHotspotC = coolantSupplyC + 26 + 16 * loadFrac;

  const seed = seedOf(spec.id);
  const sway = noise1(seed + 3, t / 40_000);
  const metro = metroByName(spec.servesMetro);

  return {
    vesselId: spec.id,
    t,
    position: pos.position,
    status: d.status,
    sea,
    motionCap: d.cap,
    utilization,
    itLoadMW: d.itLoadMW,
    coolingMW: d.coolingMW,
    overheadMW: d.overheadMW,
    facilityMW: d.facilityMW,
    pue: d.pue,
    mix: d.mix,
    batterySoc: d.soc,
    carbonIntensity: d.carbonIntensity,
    outfallDeltaK,
    plumeDeltaK100m,
    coolantSupplyC,
    gpuHotspotC,
    rollDeg: Math.max(0, (spec.cls === 'Tidewater' ? 0.32 : 0.48) * sea.hs * (1 + 0.25 * sway)),
    pitchDeg: Math.max(0, (spec.cls === 'Tidewater' ? 0.22 : 0.3) * sea.hs * (1 - 0.2 * sway)),
    heaveM: (spec.cls === 'Tidewater' ? 0.14 : 0.24) * sea.hs,
    activeGpus: Math.round(spec.gpus * loadFrac),
    rttMs: metro ? rttMs(pos.position, metro) : 0,
    freshwaterSavedLph: d.itLoadMW * 1000 * LAND_WUE_L_PER_KWH,
    shedMW: d.shedMW,
  };
}

/** Hourly outlook used by the workload router and the console's tide chart. */
export function forecastVessel(spec: VesselSpec, from: number, hours: number): ForecastHour[] {
  const out: ForecastHour[] = [];
  const start = Math.floor(from / HOUR_MS) * HOUR_MS;
  for (let h = 0; h < hours; h++) {
    const t = start + h * HOUR_MS;
    const pos = vesselPosition(spec, t);
    const sea = seaStateAt(pos.position, t);
    // Ask dispatch what the vessel could carry flat-out, with a mid-charge battery.
    const d = dispatch({ spec, sea, underway: pos.underway, utilization: 1, soc: 0.6, dtHours: 1 });
    const frac = spec.itCapacityMW > 0 ? d.itLoadMW / spec.itCapacityMW : 0;
    const renewable =
      d.facilityMW > 0 ? (d.mix.windMW + Math.max(0, d.mix.batteryMW)) / d.facilityMW : 0;
    out.push({
      t,
      hs: sea.hs,
      wind: sea.wind,
      motionCap: d.cap,
      gpusAvailable: Math.floor(spec.gpus * frac),
      carbonIntensity: d.carbonIntensity,
      renewableShare: clamp(renewable),
    });
  }
  return out;
}

/** Spot-pool GPUs free for the workload router in a forecast hour. */
export function spotGpus(spec: VesselSpec, f: ForecastHour): number {
  return Math.max(0, f.gpusAvailable - Math.ceil(spec.gpus * RESERVED_SHARE));
}

export function alertsFor(spec: VesselSpec, tm: Telemetry & { shedMW: number }): Alert[] {
  const out: Alert[] = [];
  const add = (level: Alert['level'], code: string, message: string) =>
    out.push({ id: `${spec.id}:${code}`, vesselId: spec.id, level, code, message, t: tm.t });

  if (tm.status === 'storm-mode')
    add('warning', 'STORM', `Storm mode — Hs ${tm.sea.hs.toFixed(1)} m, IT load capped at 35 %`);
  else if (tm.sea.hs >= 5.5)
    add(
      'caution',
      'HEAVY-WX',
      `Heavy weather — motion envelope limiting load to ${Math.round(tm.motionCap * 100)} %`,
    );
  if (tm.status === 'degraded')
    add('warning', 'SHED', `Power deficit — shedding ${tm.shedMW.toFixed(1)} MW of IT load`);
  if (tm.status === 'transit') {
    const pos = vesselPosition(spec, tm.t);
    add('info', 'TRANSIT', `Under way to ${pos.legLabel} — compute held at 35 % on gensets`);
  }
  if (tm.sea.intakeTemp >= 27)
    add(
      'caution',
      'WARM-INTAKE',
      `Warm intake ${tm.sea.intakeTemp.toFixed(1)} °C — PUE ${tm.pue.toFixed(3)}`,
    );
  if (tm.plumeDeltaK100m > 1)
    add(
      'caution',
      'PLUME',
      `Outfall plume +${tm.plumeDeltaK100m.toFixed(2)} K at 100 m (limit 1.0 K)`,
    );
  if (tm.mix.gensetMW > 0.5 && tm.status !== 'transit')
    add('info', 'GENSET', `Methanol gensets online — ${tm.mix.gensetMW.toFixed(1)} MW`);
  if (tm.mix.cableMW < -5)
    add('info', 'EXPORT', `Exporting ${(-tm.mix.cableMW).toFixed(1)} MW surplus wind to shore`);
  if (tm.batterySoc <= BATTERY_RESERVE + 0.02 && tm.status !== 'transit')
    add(
      'caution',
      'BATT-RESERVE',
      `Battery at storm reserve (${Math.round(tm.batterySoc * 100)} %)`,
    );
  return out;
}
