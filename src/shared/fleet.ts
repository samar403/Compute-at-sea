import type { GpuModelId, LatLon, VesselClass, VesselSpec } from './types.js';

export interface GpuModel {
  id: GpuModelId;
  label: string;
  vendor: string;
  /** All-in IT power per GPU at the rack (GPU + CPU + NIC + switch share), kW. */
  kwPerGpu: number;
  /** Modelled on-demand list price, USD per GPU-hour. Illustrative, not a market quote. */
  listPrice: number;
  memoryGB: number;
  /** Dense BF16 PFLOPS per GPU (approximate, vendor-published class figures). */
  bf16Pflops: number;
  formFactor: string;
}

export const GPU_MODELS: Record<GpuModelId, GpuModel> = {
  gb300: {
    id: 'gb300',
    label: 'GB300 NVL72',
    vendor: 'NVIDIA',
    kwPerGpu: 1.9,
    listPrice: 3.4,
    memoryGB: 288,
    bf16Pflops: 2.5,
    formFactor: '72-GPU liquid-cooled rack',
  },
  b200: {
    id: 'b200',
    label: 'B200 HGX',
    vendor: 'NVIDIA',
    kwPerGpu: 1.75,
    listPrice: 2.6,
    memoryGB: 180,
    bf16Pflops: 2.25,
    formFactor: '8-GPU node, direct liquid cooling',
  },
  mi355x: {
    id: 'mi355x',
    label: 'Instinct MI355X',
    vendor: 'AMD',
    kwPerGpu: 1.8,
    listPrice: 2.3,
    memoryGB: 288,
    bf16Pflops: 2.3,
    formFactor: '8-GPU node, direct liquid cooling',
  },
  h200: {
    id: 'h200',
    label: 'H200 HGX',
    vendor: 'NVIDIA',
    kwPerGpu: 1.3,
    listPrice: 1.85,
    memoryGB: 141,
    bf16Pflops: 0.99,
    formFactor: '8-GPU node, rear-door + DLC',
  },
};

export const VESSEL_CLASSES: Record<
  VesselClass,
  { tagline: string; loaM: number; beamM: number; hull: string; mooring: string }
> = {
  Leviathan: {
    tagline: 'Converted VLCC hull, 30–40 MW IT',
    loaM: 330,
    beamM: 60,
    hull: 'Converted very large crude carrier, double hull, 4 compute decks',
    mooring: 'Internal turret, 9-line spread, weathervaning',
  },
  Tidewater: {
    tagline: 'Purpose-built semi-submersible, 20–24 MW IT',
    loaM: 140,
    beamM: 92,
    hull: 'Four-column semi-submersible, deep draft for low heave',
    mooring: '12-line taut polyester spread',
  },
  Petrel: {
    tagline: 'Self-propelled relocatable unit, 10–12 MW IT',
    loaM: 160,
    beamM: 32,
    hull: 'Ice-class 1C monohull with DP2 station-keeping',
    mooring: 'Dynamic positioning + quick-release anchor spread',
  },
};

/** Lifecycle carbon intensity of green-methanol gensets, gCO2e/kWh. */
export const GENSET_CI = 140;
/** Battery discharge carbon intensity (charged from offshore wind + losses), gCO2e/kWh. */
export const BATTERY_CI = 24;

const v = (s: Omit<VesselSpec, 'gpus'> & { gpus?: number }): VesselSpec => ({
  ...s,
  gpus: s.gpus ?? Math.floor((s.itCapacityMW * 1000) / GPU_MODELS[s.gpuModel].kwPerGpu),
});

const LISBON_OFFSHORE: LatLon = { lat: 38.6, lon: -10.2 };
const LAGOS_OFFSHORE: LatLon = { lat: 5.6, lon: 3.4 };

export const FLEET: VesselSpec[] = [
  v({
    id: 'halcyon',
    name: 'Halcyon',
    callsign: 'CAS-01',
    cls: 'Leviathan',
    flag: 'NL',
    itCapacityMW: 40,
    gpuModel: 'gb300',
    batteryMWh: 80,
    windTieMW: 110,
    cableImportMW: 40,
    shoreGridCI: 270,
    gensetMW: 20,
    berth: { lat: 53.85, lon: 3.3 },
    berthName: 'Dogger Approaches, North Sea',
    servesMetro: 'Amsterdam',
    commissioned: '2025-11-03',
  }),
  v({
    id: 'meridian',
    name: 'Meridian',
    callsign: 'CAS-02',
    cls: 'Leviathan',
    flag: 'US',
    itCapacityMW: 36,
    gpuModel: 'b200',
    batteryMWh: 72,
    windTieMW: 95,
    cableImportMW: 36,
    shoreGridCI: 260,
    gensetMW: 18,
    berth: { lat: 40.12, lon: -72.85 },
    berthName: 'Hudson Canyon Shelf, NY Bight',
    servesMetro: 'New York',
    commissioned: '2026-02-18',
  }),
  v({
    id: 'kestrel',
    name: 'Kestrel',
    callsign: 'CAS-03',
    cls: 'Tidewater',
    flag: 'US',
    itCapacityMW: 24,
    gpuModel: 'gb300',
    batteryMWh: 48,
    windTieMW: 70,
    cableImportMW: 24,
    shoreGridCI: 210,
    gensetMW: 12,
    berth: { lat: 37.45, lon: -123.35 },
    berthName: 'Farallon Floating-Wind Zone',
    servesMetro: 'San Francisco',
    commissioned: '2026-05-09',
  }),
  v({
    id: 'monsoon',
    name: 'Monsoon',
    callsign: 'CAS-04',
    cls: 'Tidewater',
    flag: 'IN',
    itCapacityMW: 20,
    gpuModel: 'mi355x',
    batteryMWh: 40,
    windTieMW: 45,
    cableImportMW: 25,
    shoreGridCI: 640,
    gensetMW: 12,
    berth: { lat: 18.7, lon: 72.25 },
    berthName: 'Bombay High Margin, Arabian Sea',
    servesMetro: 'Mumbai',
    commissioned: '2026-07-21',
  }),
  v({
    id: 'corvina',
    name: 'Corvina',
    callsign: 'CAS-05',
    cls: 'Tidewater',
    flag: 'SG',
    itCapacityMW: 20,
    gpuModel: 'b200',
    batteryMWh: 40,
    windTieMW: 14,
    cableImportMW: 30,
    shoreGridCI: 410,
    gensetMW: 15,
    berth: { lat: 1.95, lon: 104.95 },
    berthName: 'South China Sea, Johor Approaches',
    servesMetro: 'Singapore',
    commissioned: '2026-03-30',
  }),
  v({
    id: 'albatross',
    name: 'Albatross',
    callsign: 'CAS-06',
    cls: 'Leviathan',
    flag: 'JP',
    itCapacityMW: 32,
    gpuModel: 'gb300',
    batteryMWh: 64,
    windTieMW: 90,
    cableImportMW: 32,
    shoreGridCI: 450,
    gensetMW: 16,
    berth: { lat: 34.55, lon: 140.6 },
    berthName: 'Bōsō Offshore Block, Pacific',
    servesMetro: 'Tokyo',
    commissioned: '2026-01-12',
  }),
  v({
    id: 'southerly',
    name: 'Southerly',
    callsign: 'CAS-07',
    cls: 'Tidewater',
    flag: 'AU',
    itCapacityMW: 24,
    gpuModel: 'mi355x',
    batteryMWh: 48,
    windTieMW: 75,
    cableImportMW: 24,
    shoreGridCI: 520,
    gensetMW: 12,
    berth: { lat: -34.1, lon: 151.65 },
    berthName: 'Illawarra Offshore Zone, Tasman Sea',
    servesMetro: 'Sydney',
    commissioned: '2026-08-14',
  }),
  v({
    id: 'nordkapp',
    name: 'Nordkapp',
    callsign: 'CAS-08',
    cls: 'Petrel',
    flag: 'NO',
    itCapacityMW: 12,
    gpuModel: 'h200',
    batteryMWh: 24,
    windTieMW: 40,
    cableImportMW: 12,
    shoreGridCI: 28,
    gensetMW: 8,
    berth: { lat: 58.9, lon: 4.85 },
    berthName: 'Utsira Nord, Norwegian Sea',
    servesMetro: 'Oslo',
    commissioned: '2025-09-01',
  }),
  v({
    id: 'wayfarer',
    name: 'Wayfarer',
    callsign: 'CAS-09',
    cls: 'Petrel',
    flag: 'PT',
    itCapacityMW: 12,
    gpuModel: 'b200',
    batteryMWh: 30,
    windTieMW: 0,
    cableImportMW: 12,
    shoreGridCI: 180,
    gensetMW: 14,
    berth: LAGOS_OFFSHORE,
    berthName: 'Lagos Offshore Anchorage (relocating)',
    servesMetro: 'Lagos',
    commissioned: '2026-09-02',
    route: {
      waypoints: [
        LISBON_OFFSHORE,
        { lat: 30.0, lon: -13.6 },
        { lat: 20.0, lon: -19.2 },
        { lat: 10.0, lon: -17.6 },
        { lat: 3.6, lon: -8.0 },
        LAGOS_OFFSHORE,
      ],
      fromName: 'Lisbon Offshore',
      toName: 'Lagos Offshore',
      periodDays: 28,
    },
  }),
];

export function vesselById(id: string): VesselSpec | undefined {
  return FLEET.find((x) => x.id === id);
}
