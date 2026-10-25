import { feature } from 'topojson-client';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Topology } from 'topojson-specification';

export type Land = FeatureCollection<Polygon | MultiPolygon>;

const cache = new Map<string, Promise<Land>>();

/** Natural Earth land at 1:110m (overview) or 1:50m (zoomed-in), code-split and cached. */
export function loadLand(res: '110m' | '50m'): Promise<Land> {
  let p = cache.get(res);
  if (!p) {
    const mod =
      res === '110m' ? import('world-atlas/land-110m.json') : import('world-atlas/land-50m.json');
    p = mod.then((m) => {
      const topo = (m.default ?? m) as unknown as Topology;
      return feature(topo, topo.objects.land) as unknown as Land;
    });
    cache.set(res, p);
  }
  return p;
}
