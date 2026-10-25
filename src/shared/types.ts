export interface LatLon {
  lat: number;
  lon: number;
}

export type VesselClass = 'Tidewater' | 'Leviathan' | 'Petrel';
export type VesselStatus = 'operational' | 'storm-mode' | 'transit' | 'degraded';
export type GpuModelId = 'gb300' | 'b200' | 'mi355x' | 'h200';

export interface VesselSpec {
  id: string;
  name: string;
  callsign: string;
  cls: VesselClass;
  flag: string;
  /** Design IT load in megawatts. */
  itCapacityMW: number;
  gpuModel: GpuModelId;
  gpus: number;
  batteryMWh: number;
  /** Dedicated offshore-wind tie-in, MW nameplate. */
  windTieMW: number;
  /** Subsea export/import cable to shore, MW. */
  cableImportMW: number;
  /** Shore-grid carbon intensity at the landing point, gCO2/kWh. */
  shoreGridCI: number;
  /** Green-methanol gensets for resilience, MW. */
  gensetMW: number;
  berth: LatLon;
  berthName: string;
  /** Metro this vessel primarily serves. */
  servesMetro: string;
  commissioned: string;
  /** Present only for vessels relocating between berths. */
  route?: { waypoints: LatLon[]; fromName: string; toName: string; periodDays: number };
}

export interface SeaState {
  /** Sea-surface temperature, °C. */
  sst: number;
  /** Intake temperature at 30 m depth, °C. */
  intakeTemp: number;
  /** 10 m wind speed, m/s. */
  wind: number;
  /** Wind direction, degrees true (from). */
  windDir: number;
  /** Significant wave height, m. */
  hs: number;
  /** Peak wave period, s. */
  tp: number;
  airTemp: number;
  beaufort: number;
}

export interface PowerMix {
  /** Total wind generation from the tie-in, MW (load + charging + export + curtailment). */
  windGenMW: number;
  /** Wind serving the vessel's own load, MW. */
  windMW: number;
  cableMW: number;
  batteryMW: number;
  gensetMW: number;
  curtailedMW: number;
}

export interface Telemetry {
  vesselId: string;
  t: number;
  position: LatLon;
  status: VesselStatus;
  sea: SeaState;
  /** Fraction of IT capacity allowed by sea state. */
  motionCap: number;
  utilization: number;
  itLoadMW: number;
  coolingMW: number;
  overheadMW: number;
  facilityMW: number;
  pue: number;
  mix: PowerMix;
  batterySoc: number;
  carbonIntensity: number;
  /** Seawater outfall temperature rise at the discharge, K. */
  outfallDeltaK: number;
  /** Plume temperature rise 100 m downstream, K (regulatory metric). */
  plumeDeltaK100m: number;
  coolantSupplyC: number;
  gpuHotspotC: number;
  rollDeg: number;
  pitchDeg: number;
  heaveM: number;
  activeGpus: number;
  /** Round-trip latency to the served metro, ms. */
  rttMs: number;
  /** Freshwater not consumed versus an evaporatively cooled land site, litres per hour. */
  freshwaterSavedLph: number;
}

export type AlertLevel = 'info' | 'caution' | 'warning';

export interface Alert {
  id: string;
  vesselId: string;
  level: AlertLevel;
  code: string;
  message: string;
  t: number;
}

export interface FleetSnapshot {
  t: number;
  simSpeed: number;
  vessels: Telemetry[];
  alerts: Alert[];
  totals: {
    itLoadMW: number;
    facilityMW: number;
    activeGpus: number;
    avgPue: number;
    avgCarbon: number;
    renewableShare: number;
    freshwaterSavedLph: number;
  };
}

export interface ForecastHour {
  t: number;
  hs: number;
  wind: number;
  motionCap: number;
  /** GPUs that can run this hour given sea state + available power. */
  gpusAvailable: number;
  carbonIntensity: number;
  renewableShare: number;
}

export interface Metro {
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** Metro population in millions (drives demand weighting). */
  pop: number;
}
