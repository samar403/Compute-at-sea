import { geoContains } from 'd3-geo';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Topology } from 'topojson-specification';
import { coastDistanceKm } from '../shared/geo.js';
import type { LatLon } from '../shared/types.js';

const require = createRequire(import.meta.url);

/** Natural Earth 1:50m land polygons, loaded once. */
const topology = JSON.parse(
  readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8'),
) as Topology;

const land = feature(topology, topology.objects.land) as unknown as FeatureCollection<
  Polygon | MultiPolygon
>;

function collectVertices(): Float64Array {
  const pts: number[] = [];
  for (const f of land.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const ring of poly) for (const [lon, lat] of ring) pts.push(lon, lat);
  }
  return Float64Array.from(pts);
}

const coastVertices = collectVertices();

export function isLand(p: LatLon): boolean {
  return geoContains(land, [p.lon, p.lat]);
}

export function distanceToCoastKm(p: LatLon): number {
  return coastDistanceKm(p, coastVertices);
}

export const coastVertexCount = coastVertices.length / 2;
