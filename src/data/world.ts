import type { Owner, Province, Terrain } from '../core/types';
import { PROV_RAW } from './provinces';
import map from './map.json';

interface MapProv { x: number; y: number; poly: number[]; adj: string[]; river: boolean }

export const MAP = map as unknown as {
  w: number;
  h: number;
  land: number[][];
  lakes: number[][];
  rivers: number[][];
  edges: [string, string, number, number, number, number][];
  prov: Record<string, MapProv>;
};

const sideOf = (c: string): Owner => (c === 'GER' || c === 'DZG' || c === 'SVK' ? 'GER' : c === 'POL' ? 'POL' : 'NEU');

export const PROV: Record<string, Province> = {};
for (const line of PROV_RAW.trim().split('\n')) {
  const [id, name, , , country, terrain, vp, flags] = line.split('|');
  const m = MAP.prov[id];
  if (!m) continue;
  PROV[id] = {
    id, name, country,
    x: m.x, y: m.y, poly: m.poly, adj: m.adj, river: m.river,
    side0: sideOf(country),
    terrain: terrain as Terrain,
    vp: +(vp || 0),
    supply: !!flags?.includes('s'),
    capital: !!flags?.includes('c'),
  };
}
export const PLIST = Object.values(PROV);

export const TERRAIN_NAME: Record<Terrain, string> = {
  p: 'Ebene', f: 'Wald', h: 'Hügelland', m: 'Gebirge', s: 'Sumpf', u: 'Stadtgebiet',
};
