// Baut src/data/map.json: Küsten, Seen und Flüsse aus Natural Earth (gemeinfrei)
// plus Provinzzellen (Voronoi um die Saatpunkte) samt Nachbarschaften.
// Aufruf: npm run map   (erwartet die GeoJSON-Dateien unter tools/ne/)
import { readFileSync, writeFileSync } from 'node:fs';
import { Delaunay } from 'd3-delaunay';
import { PROV_RAW } from '../src/data/provinces';

const LON0 = 9.3, LON1 = 28.6, LAT0 = 47.0, LAT1 = 56.2;
const W = 1600;
const KX = W / (LON1 - LON0);
const KY = KX / Math.cos((52 * Math.PI) / 180);
const H = Math.round((LAT1 - LAT0) * KY);
const px = (lon: number, lat: number): [number, number] => [(lon - LON0) * KX, (LAT1 - lat) * KY];
const r1 = (v: number) => Math.round(v * 10) / 10;

const load = (n: string) => JSON.parse(readFileSync(new URL(`./ne/${n}.geojson`, import.meta.url), 'utf8'));

type Pt = [number, number];
const M = 0.6; // Rand in Grad, damit Küstenlinien sauber über den Kartenrand laufen
const BOX = { x0: LON0 - M, x1: LON1 + M, y0: LAT0 - M, y1: LAT1 + M };

// Sutherland-Hodgman gegen das Kartenrechteck (reicht für die Darstellung)
function clipRing(ring: Pt[]): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [p => p[0] >= BOX.x0, (a, b) => [BOX.x0, a[1] + ((b[1] - a[1]) * (BOX.x0 - a[0])) / (b[0] - a[0])]],
    [p => p[0] <= BOX.x1, (a, b) => [BOX.x1, a[1] + ((b[1] - a[1]) * (BOX.x1 - a[0])) / (b[0] - a[0])]],
    [p => p[1] >= BOX.y0, (a, b) => [a[0] + ((b[0] - a[0]) * (BOX.y0 - a[1])) / (b[1] - a[1]), BOX.y0]],
    [p => p[1] <= BOX.y1, (a, b) => [a[0] + ((b[0] - a[0]) * (BOX.y1 - a[1])) / (b[1] - a[1]), BOX.y1]],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

function simplify(pts: Pt[], tol: number): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= tol) out.push(p);
  }
  return out;
}

function polys(name: string): number[][] {
  const rings: number[][] = [];
  for (const f of load(name).features) {
    const g = f.geometry;
    const list: Pt[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of list)
      for (const ring of poly) {
        const c = clipRing(ring as Pt[]);
        if (c.length < 3) continue;
        const s = simplify(c.map(p => px(p[0], p[1])), 0.7);
        if (s.length >= 3) rings.push(s.flat().map(r1));
      }
  }
  return rings;
}

function lines(name: string, maxRank: number): { rank: number; pts: number[] }[] {
  const out: { rank: number; pts: number[] }[] = [];
  for (const f of load(name).features) {
    const g = f.geometry;
    if (!g) continue;
    const rank = f.properties.scalerank ?? 9;
    if (rank > maxRank) continue;
    const list: Pt[][] = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    for (const line of list) {
      let cur: Pt[] = [];
      const flush = () => {
        const s = simplify(cur, 0.8);
        if (s.length >= 2) out.push({ rank, pts: s.flat().map(r1) });
        cur = [];
      };
      for (const p of line) {
        if (p[0] < LON0 || p[0] > LON1 || p[1] < LAT0 || p[1] > LAT1) flush();
        else cur.push(px(p[0], p[1]));
      }
      flush();
    }
  }
  return out;
}

const land = polys('ne_10m_land');
const lakes = polys('ne_10m_lakes');
const rivers = [...lines('ne_10m_rivers_lake_centerlines', 9), ...lines('ne_10m_rivers_europe', 9)];

function onLand(x: number, y: number): boolean {
  let inside = false;
  for (const r of land)
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

const seeds = PROV_RAW.trim().split('\n').map(l => {
  const [id, , lat, lon] = l.split('|');
  const [x, y] = px(+lon, +lat);
  return { id, x, y };
});
const del = Delaunay.from(seeds, s => s.x, s => s.y);
const vor = del.voronoi([0, 0, W, H]);
const cells = seeds.map((_, i) => vor.cellPolygon(i) as Pt[] | null);

const prov: Record<string, { x: number; y: number; poly: number[]; adj: string[]; river: boolean }> = {};
seeds.forEach((s, i) => {
  const c = cells[i];
  if (!c) return;
  prov[s.id] = { x: r1(s.x), y: r1(s.y), poly: c.slice(0, -1).flat().map(r1), adj: [], river: false };
});

const edges: (string | number)[][] = [];
seeds.forEach((s, i) => {
  if (!cells[i]) return;
  for (const j of del.neighbors(i)) {
    if (j <= i || !cells[j]) continue;
    const sh = cells[i]!.slice(0, -1).filter(p => cells[j]!.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05));
    if (sh.length < 2) continue;
    const [a, b] = sh;
    let ok = false;
    for (let k = 1; k < 12 && !ok; k++) ok = onLand(a[0] + ((b[0] - a[0]) * k) / 12, a[1] + ((b[1] - a[1]) * k) / 12);
    if (!ok) continue;
    prov[s.id].adj.push(seeds[j].id);
    prov[seeds[j].id].adj.push(s.id);
    edges.push([s.id, seeds[j].id, r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]);
  }
});

// Provinz gilt als Flussprovinz, wenn ein größerer Fluss ein gutes Stück durch sie läuft
const hits: Record<string, number> = {};
for (const r of rivers) {
  if (r.rank > 7) continue;
  for (let i = 0; i + 3 < r.pts.length; i += 2) {
    const len = Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]);
    const id = seeds[del.find((r.pts[i] + r.pts[i + 2]) / 2, (r.pts[i + 1] + r.pts[i + 3]) / 2)].id;
    hits[id] = (hits[id] ?? 0) + len;
  }
}
for (const id in hits) if (prov[id] && hits[id] > 25) prov[id].river = true;

const out = { w: W, h: H, land, lakes, rivers: rivers.map(r => r.pts), edges, prov };
const json = JSON.stringify(out);
writeFileSync(new URL('../src/data/map.json', import.meta.url), json);
console.log(`map.json ${(json.length / 1024) | 0} kB, ${W}x${H}, Provinzen ${Object.keys(prov).length}, Kanten ${edges.length}`);
console.log('Flussprovinzen:', Object.keys(prov).filter(k => prov[k].river).join(' '));
for (const id of ['strehlitz', 'oppeln', 'kreuzburg', 'danzig', 'schlochau', 'neidenburg', 'warschau', 'lauenburg', 'oels', 'sillein', 'poprad'])
  console.log(id, '->', prov[id].adj.join(' '));
