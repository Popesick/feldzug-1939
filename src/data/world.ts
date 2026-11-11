import type { Owner, Province, Terrain } from '../core/types';
import { PROV_RAW } from './provinces';
import map from './map.json';
import mapEu from './map_eu.json';

interface MapProv { x: number; y: number; poly: number[]; adj: string[]; river: boolean }
interface EuProv extends MapProv { n: string; c: string; t: string; vp: number; f: string; ll: [number, number]; sea: string; port: boolean; ind: number; steel: number; oil: number; infra: number; sup: boolean }
interface MapData {
  w: number;
  h: number;
  km?: number;
  land: number[][];
  lakes: number[][];
  rivers: number[][];
  edges: [string, string, number, number, number, number][];
  prov: Record<string, MapProv>;
}

export type Scenario = 'polen' | 'europa' | 'welt';

// Die aktive Karte. Alle Module greifen über diese Bindungen zu; useWorld() tauscht sie aus.
export let SCEN: Scenario = 'polen';
export let MAP: MapData = map as unknown as MapData;
export let PROV: Record<string, Province> = {};
export let PLIST: Province[] = [];
export let KM_PX = 1;

const sideOf = (c: string): Owner => (c === 'GER' || c === 'DZG' || c === 'SVK' ? 'GER' : c === 'POL' ? 'POL' : 'NEU');

function loadPolen() {
  const m = map as unknown as MapData, out: Record<string, Province> = {};
  for (const line of PROV_RAW.trim().split('\n')) {
    const [id, name, , , country, terrain, vp, flags] = line.split('|');
    const p = m.prov[id];
    if (!p) continue;
    out[id] = {
      id, name, country,
      x: p.x, y: p.y, poly: p.poly, adj: p.adj, river: p.river,
      side0: sideOf(country),
      terrain: terrain as Terrain,
      vp: +(vp || 0),
      supply: !!flags?.includes('s'),
      capital: !!flags?.includes('c'),
    };
  }
  return { m, out };
}

function loadEuropa(m: MapData) {
  const out: Record<string, Province> = {};
  for (const [id, raw] of Object.entries(m.prov)) {
    const p = raw as EuProv;
    out[id] = {
      id, name: p.n, country: p.c,
      x: p.x, y: p.y, poly: p.poly, adj: p.adj, river: p.river,
      side0: 'NEU',
      terrain: p.t as Terrain,
      vp: p.vp,
      supply: p.sup,
      capital: p.f.includes('c'),
      sea: p.sea, port: p.port, ind: p.ind, steel: p.steel, oil: p.oil, infra: p.infra, flags: p.f, ll: p.ll,
    };
  }
  return { m, out };
}

const cache: Partial<Record<Scenario, { m: MapData; out: Record<string, Province> }>> = {};
/** Die Weltkarte ist groß und wird erst geladen, wenn das Szenario gewählt ist. */
export async function preload(s: Scenario) {
  if (s === 'welt' && !cache.welt) cache.welt = loadEuropa((await import('./map_world.json')).default as unknown as MapData);
}
export function useWorld(s: Scenario) {
  if (s === 'welt' && !cache.welt) throw new Error('Weltkarte nicht geladen (preload)');
  const w = (cache[s] ??= s === 'europa' ? loadEuropa(mapEu as unknown as MapData) : loadPolen());
  SCEN = s;
  MAP = w.m;
  PROV = w.out;
  PLIST = Object.values(PROV);
  KM_PX = w.m.km || 1;
}
useWorld('polen');

export const TERRAIN_NAME: Record<Terrain, string> = {
  p: 'Ebene', f: 'Wald', h: 'Hügelland', m: 'Gebirge', s: 'Sumpf', u: 'Stadtgebiet',
};
