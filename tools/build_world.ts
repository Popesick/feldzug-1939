// Baut src/data/map_world.json: die ganze Welt in den Grenzen von 1936.
// Die Provinzen des Europa-Ausschnitts werden aus map_eu.json übernommen (gleiche Kennungen, damit
// alle Ereignisse weiter gelten); der Rest der Welt kommt aus Natural-Earth-Orten hinzu, in grober
// Körnung. Küsten, Seen und Flüsse stammen aus Natural Earth (gemeinfrei).
// Aufruf: npm run map:welt (vorher npm run map:eu, falls sich die Europakarte geändert hat)
import { readFileSync, writeFileSync } from 'node:fs';
import { Delaunay } from 'd3-delaunay';
import { A3_W, FORCED_W, IND_W, RENAME_W, RES_W } from './world_seeds';
import { RENAME } from './eu_seeds';

type Pt = [number, number];
const RAD = Math.PI / 180;
// Miller-Zylinderprojektion, Mittelmeridian 11° Ost: der Kartenrand läuft durch die Beringstraße
const S = 34, LON0 = 11, CUT = LON0 - 180, LAT_N = 77, LAT_S = -56.5;
const miller = (lat: number) => (1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD))) / RAD;
const W = 360 * S, H = Math.round((miller(LAT_N) - miller(LAT_S)) * S);
const wrap = (lon: number) => (lon < CUT ? lon + 360 : lon);
const px = (lon: number, lat: number): Pt => [(wrap(lon) - CUT) * S, (miller(LAT_N) - miller(lat)) * S];
const r0 = (v: number) => Math.round(v);
const load = (n: string) => JSON.parse(readFileSync(new URL(`./ne/${n}.geojson`, import.meta.url), 'utf8'));
/** Entfernung auf der Kugel in km. */
function gc(la1: number, lo1: number, la2: number, lo2: number) {
  const a = Math.sin(((la2 - la1) * RAD) / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(((lo2 - lo1) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function clip(ring: Pt[], x0: number, x1: number, y0: number, y1: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
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
function area(r: Pt[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
}

function polys(name: string, minArea: number, tol: number): number[][] {
  const rings: number[][] = [];
  for (const f of load(name).features) {
    const g = f.geometry;
    const list: Pt[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of list)
      for (const ring of poly) {
        const c = clip(ring as Pt[], -181, 181, LAT_S, LAT_N);
        if (c.length < 3) continue;
        // Ringe am Kartenrand als Ganzes auf eine Seite legen, sonst zieht sich ein Strich quer über die Karte
        const mean = c.reduce((a, p) => a + p[0], 0) / c.length;
        const near = c.some(p => p[0] < CUT) && c.some(p => p[0] >= CUT);
        const proj = c.map(p => {
          const q = px(p[0], p[1]);
          if (near) q[0] = (p[0] - CUT + (mean < CUT ? 360 : 0)) * S;
          return q;
        });
        const s = simplify(clip(proj, -20, W + 20, -20, H + 20), tol);
        if (s.length >= 3 && area(s) >= minArea) rings.push(s.flat().map(r0));
      }
  }
  return rings;
}
function lines(name: string, maxRank: number): number[][] {
  const out: number[][] = [];
  for (const f of load(name).features) {
    const g = f.geometry;
    if (!g || (f.properties.scalerank ?? 9) > maxRank) continue;
    const list: Pt[][] = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    for (const line of list) {
      let cur: Pt[] = [], last = NaN;
      const flush = () => {
        const s = simplify(cur, 4);
        if (s.length >= 2) out.push(s.flat().map(r0));
        cur = [];
      };
      for (const p of line) {
        if (p[1] < LAT_S || p[1] > LAT_N) { flush(); continue; }
        const q = px(p[0], p[1]);
        if (Math.abs(q[0] - last) > W / 2) flush();
        last = q[0];
        cur.push(q);
      }
      flush();
    }
  }
  return out;
}

const land = polys('ne_10m_land', 5, 3);
const lakes = polys('ne_10m_lakes', 60, 3);
const rivers = [...lines('ne_10m_rivers_lake_centerlines', 4), ...lines('ne_10m_rivers_europe', 4)];

// Landraster (2 px), per Zeilenfüllung aus den Küstenringen erzeugt
const G = 2, GW = Math.ceil(W / G), GH = Math.ceil(H / G);
const dry = new Uint8Array(GW * GH);
{
  const ys = land.map(r => {
    let y0 = 1e9, y1 = -1e9;
    for (let i = 1; i < r.length; i += 2) (y0 = Math.min(y0, r[i])), (y1 = Math.max(y1, r[i]));
    return [y0, y1];
  });
  for (let gy = 0; gy < GH; gy++) {
    const y = gy * G + G / 2 + 0.01;
    land.forEach((r, k) => {
      if (y < ys[k][0] || y > ys[k][1]) return;
      const xs: number[] = [];
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const yi = r[i + 1], yj = r[j + 1];
        if (yi > y !== yj > y) xs.push(((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]);
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2)
        for (let gx = Math.max(0, Math.ceil((xs[n] - G / 2) / G)); gx < GW && gx * G + G / 2 <= xs[n + 1]; gx++) dry[gy * GW + gx] ^= 1;
    });
  }
}
const onLand = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !!dry[Math.floor(y / G) * GW + Math.floor(x / G)];

// ---- Staaten von 1936 außerhalb des Europa-Ausschnitts ------------------------

function country36(a3: string, lon: number, lat: number): string | null {
  switch (a3) {
    case 'CHN':
      if ((lat > 40.6 && lon > 119.3) || (lat > 45 && lon > 116) || (lat > 41 && lat < 43 && lon > 117.5)) return 'MAN';
      if (lon < 99.5 && lat < 36.5 && lat > 27 && !(lon > 97 && lat < 29)) return 'TIB';
      return 'CHI';
    case 'RUS':
      if (lon > 141.5 && lon < 146 && lat < 50 && lat > 45.5) return 'JAP'; // Karafuto
      if (lon > 145.5 && lon < 157 && lat < 51 && lat > 43) return 'JAP'; // Kurilen
      return 'SOV';
    case 'MAR': return lat < 27.7 ? 'SPA' : 'FRA';
  }
  return A3_W[a3] ?? null;
}
const EMPIRES = ['ENG', 'FRA', 'ITA', 'SPA', 'POR', 'BEL', 'NLD', 'DNK'];
const colony = (c: string, a3: string, lat: number, lon: number) =>
  EMPIRES.includes(c) || (c === 'USA' && (a3 !== 'USA' || lat > 50 || lon < -150)) || (c === 'AST' && a3 === 'PNG') || (c === 'JAP' && lat < 22 && lon > 130);

/** Mindestabstand der Provinzorte in km. */
function spacing(c: string, lon: number, lat: number): number {
  if (c === 'USA') return lat > 50 ? 700 : lon > -100 ? 300 : 420;
  if (c === 'CAN') return lat > 53 ? 850 : 420;
  if (c === 'JAP') return 200;
  if (c === 'MAN') return 300;
  if (c === 'CHI') return lon > 104 ? 290 : 560;
  if (c === 'IND') return 340;
  if (c === 'SOV') return lat > 58 || lon > 90 ? 640 : 400;
  if (c === 'AST') return lat < -28 && lon > 135 ? 420 : 700;
  if (c === 'NZL') return 400;
  if (['TIB', 'MON', 'AFG', 'SAU', 'PER', 'YEM', 'NEP'].includes(c)) return 480;
  if (lon < -30) return lat < 5 && lat > -15 && lon > -72 ? 650 : 480; // Lateinamerika, Amazonasbecken gröber
  if (lon < 60 && lat < 38) return lat > 16 ? 560 : 480; // Afrika, Arabien
  return 360; // Südostasien
}

const hsh = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
function terrain(c: string, lat: number, lon: number, pop: number, flags: string, id: string): string {
  if (flags.includes('u') || pop > 2500000) return 'u';
  if (c === 'TIB' || c === 'NEP' || c === 'AFG' || (lat > 27 && lat < 37 && lon > 70 && lon < 103)) return 'm';
  if (['PRU', 'BOL', 'ECU'].includes(c) || (c === 'CHL' && lat > -40) || (c === 'COL' && lon < -73)) return 'm';
  if (lon > -125 && lon < -104 && lat > 33 && lat < 62) return hsh(id) < 0.6 ? 'm' : 'h';
  if (c === 'ETH' || c === 'JAP' || c === 'YEM' || (c === 'CHI' && lon < 110) || c === 'MEX') return 'h';
  if (c === 'SOV' && lat > 40 && lat < 52 && lon > 68 && lon < 90) return hsh(id) < 0.5 ? 'm' : 'p';
  // Regenwald und Taiga
  if (lat > -12 && lat < 9 && ((lon > -78 && lon < -45) || (lon > 8 && lon < 30) || lon > 94)) return 'f';
  if (lat >= 9 && lat < 25 && lon > 91 && lon < 110) return 'f';
  if (lat > 52 && (c === 'SOV' || c === 'CAN' || c === 'USA')) return 'f';
  return 'p';
}
function infra(c: string, lat: number, lon: number): number {
  if (c === 'USA' && lat < 50 && lon > -100) return 1;
  if ((c === 'USA' && lat < 50) || c === 'JAP' || (c === 'CAN' && lat < 52) || c === 'NZL' || (c === 'AST' && lat < -25 && lon > 135)) return 1.5;
  if ((c === 'SOV' && (lat > 58 || lon > 90)) || c === 'TIB' || (lat > -12 && lat < 9) || (lon < 40 && lat > 16 && lat < 30)) return 2.5;
  return 2;
}
/** Meere eines Küstenorts: N Atlantik, Z Pazifik, I Indischer Ozean. */
function seas(lat: number, lon: number): string {
  if (lon < -25) {
    if (lat > 66) return '';
    if (lat > 30) return lon < -105 ? 'Z' : 'N';
    if (lat > 18) return lon < -100 ? 'Z' : 'N';
    if (lat > 7 && lon < -77) return 'NZ';
    if (lat < -50) return 'NZ';
    return lon < (lat > -5 ? -76.5 : -69) ? 'Z' : 'N';
  }
  if (lon < 60 && lat < 38) {
    if (lat > 35 && lon > 46) return ''; // Kaspisches Meer
    if (lat < -28 && lon > 16 && lon < 32) return 'NI';
    return lon < 22 ? 'N' : 'I';
  }
  if (lat > 60 && lon < 160) return ''; // Eismeer
  if (lon < 100) return lat < 32 ? 'I' : '';
  if (lat > -12 && lat < 7 && lon < 120) return 'IZ';
  if (lat < -10 && lon < 130) return 'I';
  return 'Z';
}

// ---- Orte -----------------------------------------------------------------

interface EuProv { x: number; y: number; poly: number[]; adj: string[]; river: boolean; n: string; c: string; t: string; vp: number; f: string; ll: [number, number]; sea: string; port: boolean; ind: number; steel: number; oil: number; infra: number; sup: boolean }
interface Seed { id: string; name: string; lat: number; lon: number; c: string; x: number; y: number; d: number; eu?: EuProv; vp: number; f: string; pop: number; a3: string }
const eu = JSON.parse(readFileSync(new URL('../src/data/map_eu.json', import.meta.url), 'utf8')) as { w: number; h: number; prov: Record<string, EuProv> };
const slug = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Lambert-Projektion des Europa-Ausschnitts (wie in build_eu.ts), um dessen Grenzen zu kennen
const euPx = (() => {
  const P1 = 36 * RAD, P2 = 62 * RAD, LAT0 = 49 * RAD, L0 = 17 * RAD, R = 6371, KM = 2.2;
  const tn = (p: number) => Math.tan(Math.PI / 4 + p / 2);
  const N = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(tn(P2) / tn(P1)), F = (Math.cos(P1) * Math.pow(tn(P1), N)) / N, RHO0 = F / Math.pow(tn(LAT0), N);
  return (lon: number, lat: number): Pt => {
    const rho = F / Math.pow(tn(lat * RAD), N), th = N * (lon * RAD - L0);
    return [(R * rho * Math.sin(th) + 2350) / KM, (2450 - R * (RHO0 - rho * Math.cos(th))) / KM];
  };
})();
const inEu = (lon: number, lat: number) => {
  if (lat < 14 || lon < -40 || lon > 85) return false;
  const [x, y] = euPx(lon, lat);
  return x > 8 && x < eu.w - 8 && y > 8 && y < eu.h - 8;
};
const EU_A3 = new Set('DEU AUT CZE SVK LVA EST FIN ALD SWE NOR DNK GBR IMN IRL NLD BEL LUX FRA MCO CHE LIE ITA SMR VAT MLT ESP AND PRT GIB HUN ROU ALB SRB HRV SVN BIH MNE MKD KOS TUR CYP CYN SYR LBN ISR PSX PSE JOR IRQ IRN SAU KWT EGY LBY TUN DZA GEO ARM AZE KAZ GRC BGR LTU MDA MAR POL BLR UKR RUS'.split(' '));

const seeds: Seed[] = [];
const ids = new Set<string>();
for (const [id, p] of Object.entries(eu.prov)) {
  const [x, y] = px(p.ll[1], p.ll[0]);
  ids.add(id);
  // d: der Abstand, den dieser Ort zu neuen Nachbarn hält (etwa die Körnung der Europakarte)
  seeds.push({ id, name: p.n, lat: p.ll[0], lon: p.ll[1], c: p.c, x, y, d: 170, eu: p, vp: p.vp, f: p.f, pop: 0, a3: '' });
}
const places = (load('ne_10m_populated_places').features as { properties: Record<string, never> }[])
  .map(f => f.properties as unknown as { NAME: string; NAME_DE: string; ADM0_A3: string; POP_MAX: number; LATITUDE: number; LONGITUDE: number })
  .filter(p => p.LATITUDE > LAT_S + 1 && p.LATITUDE < LAT_N - 1);
const tooClose = (lat: number, lon: number, d: number) => seeds.some(o => gc(lat, lon, o.lat, o.lon) < Math.min(d, o.d));

for (const line of FORCED_W.trim().split('\n')) {
  const [name, la, lo, c, vp, f] = line.split('|');
  const lat = +la, lon = +lo, id = slug(name);
  if (ids.has(id) || seeds.some(o => gc(lat, lon, o.lat, o.lon) < 60)) { console.log('übersprungen (schon vorhanden):', name); continue; }
  const [x, y] = px(lon, lat);
  const near = places.filter(p => gc(lat, lon, p.LATITUDE, p.LONGITUDE) < 30).sort((a, b) => b.POP_MAX - a.POP_MAX)[0];
  ids.add(id);
  seeds.push({ id, name, lat, lon, c, x, y, d: 110, vp: +(vp || 0), f: (f ?? '') + (colony(c, near?.ADM0_A3 ?? '', lat, lon) && !(f ?? '').includes('k') ? 'k' : ''), pop: near?.POP_MAX ?? 40000, a3: near?.ADM0_A3 ?? '' });
}
for (const p of places.sort((a, b) => b.POP_MAX - a.POP_MAX)) {
  const lat = p.LATITUDE, lon = p.LONGITUDE;
  if (EU_A3.has(p.ADM0_A3) && inEu(lon, lat)) continue;
  const c = country36(p.ADM0_A3, lon, lat);
  if (!c) continue;
  const d = spacing(c, lon, lat), [x, y] = px(lon, lat);
  if (tooClose(lat, lon, d) || !onLand(x, y)) continue;
  const de = p.NAME_DE || p.NAME, name = RENAME_W[de] ?? RENAME_W[p.NAME] ?? RENAME[de] ?? RENAME[p.NAME] ?? de;
  let id = slug(name);
  if (!id || ids.has(id)) id = `${id || 'ort'}_${c.toLowerCase()}`;
  if (ids.has(id)) continue;
  ids.add(id);
  seeds.push({ id, name, lat, lon, c, x, y, d, vp: 0, f: colony(c, p.ADM0_A3, lat, lon) ? 'k' : '', pop: p.POP_MAX, a3: p.ADM0_A3 });
}

// ---- Zellen, Nachbarschaften, Küsten -------------------------------------

const del = Delaunay.from(seeds, s => s.x, s => s.y);
const vor = del.voronoi([0, 0, W, H]);
const cells = seeds.map((_, i) => vor.cellPolygon(i) as Pt[] | null);
const prov: Record<string, EuProv> = {};
seeds.forEach((s, i) => {
  const c = cells[i];
  if (!c) return;
  const poly = c.slice(0, -1).flat().map(r0);
  if (s.eu) {
    // Golf und Rotes Meer gehören auf der Weltkarte zum Indischen Ozean
    let sea = s.eu.sea;
    const gulf = (s.lat < 30.2 && s.lon > 32.3) || (s.lat < 31 && s.lon > 47 && s.lon < 60);
    let coast = false;
    if (gulf || s.id === 'suez')
      for (let k = 0; k + 1 < c.length && !coast; k++) {
        const qx = (c[k][0] + c[k + 1][0]) / 2, qy = (c[k][1] + c[k + 1][1]) / 2;
        coast = !onLand(qx + (s.x - qx) * 0.25, qy + (s.y - qy) * 0.25);
      }
    if (coast && !sea.includes('I') && (s.id === 'suez' || !sea)) sea += 'I';
    prov[s.id] = { ...s.eu, x: r0(s.x), y: r0(s.y), poly, adj: [], sea, port: s.eu.port || (!!sea && !s.eu.sea && s.vp > 0) };
    return;
  }
  let coast = false;
  for (let k = 0; k + 1 < c.length && !coast; k++)
    for (let t = 0; t < 4 && !coast; t++) {
      const x = c[k][0] + ((c[k + 1][0] - c[k][0]) * t) / 4, y = c[k][1] + ((c[k + 1][1] - c[k][1]) * t) / 4;
      const qx = x + (s.x - x) * 0.25, qy = y + (s.y - y) * 0.25;
      if (qx > 6 && qy > 6 && qx < W - 6 && qy < H - 6 && !onLand(qx, qy)) coast = true;
    }
  const forcedSea = s.f.replace(/[^NZI]/g, '');
  const sea = forcedSea || (coast || s.f.includes('P') ? seas(s.lat, s.lon) : '');
  const f = s.f.replace(/[PLNZI]/g, '');
  const col = f.includes('k');
  prov[s.id] = {
    x: r0(s.x), y: r0(s.y), poly, adj: [], river: false,
    n: s.name, c: s.c, t: terrain(s.c, s.lat, s.lon, s.pop, s.f, s.id), vp: s.vp || (s.pop > 3000000 && !col ? 1 : 0),
    f, ll: [+s.lat.toFixed(2), +s.lon.toFixed(2)], sea,
    port: !!sea && (s.f.includes('P') || s.pop >= 150000), ind: 0, steel: 0, oil: 0, infra: infra(s.c, s.lat, s.lon),
    sup: !col && (s.f.includes('c') || s.pop >= 500000 || s.vp > 0),
  };
});

/** Gibt es zwischen zwei Nachbarorten einen Landweg, der ihre beiden Zellen nicht verlässt? */
function landPath(i: number, j: number): boolean {
  const start = (s: Seed) => {
    const cx = Math.floor(s.x / G), cy = Math.floor(s.y / G);
    for (let r = 0; r < 6; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < GW && y < GH && dry[y * GW + x]) return y * GW + x;
        }
    return -1;
  };
  const a = start(seeds[i]), b = start(seeds[j]);
  if (a < 0 || b < 0) return false;
  const seen = new Set([a]), q = [a];
  for (let h = 0; h < q.length; h++) {
    if (q[h] === b) return true;
    const x = q[h] % GW, y = (q[h] / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, n = ny * GW + nx;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || !dry[n] || seen.has(n)) continue;
      const own = del.find(nx * G + G / 2, ny * G + G / 2, i);
      if (own !== i && own !== j) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return false;
}
const CUTS = [['kopenhagen', 'malmoe'], ['dover', 'calais']];
const edges: (string | number)[][] = [];
const link = (a: string, b: string) => {
  if (!prov[a] || !prov[b] || prov[a].adj.includes(b)) return;
  prov[a].adj.push(b);
  prov[b].adj.push(a);
};
seeds.forEach((s, i) => {
  if (!cells[i]) return;
  for (const j of del.neighbors(i)) {
    if (j <= i || !cells[j]) continue;
    const sh = cells[i]!.slice(0, -1).filter(p => cells[j]!.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05));
    if (sh.length < 2) continue;
    const [a, b] = sh;
    let ok = false;
    for (let k = 1; k < 24 && !ok; k++) ok = onLand(a[0] + ((b[0] - a[0]) * k) / 24, a[1] + ((b[1] - a[1]) * k) / 24);
    if (!ok) continue;
    const o = seeds[j];
    // Europa: nur Nachbarschaften, die es auch auf der Europakarte gibt (keine neuen Wege über Meerengen)
    if (s.eu && o.eu ? !s.eu.adj.includes(o.id) : CUTS.some(c => c.includes(s.id) && c.includes(o.id)) || !landPath(i, j)) continue;
    link(s.id, o.id);
    edges.push([s.id, o.id, r0(a[0]), r0(a[1]), r0(b[0]), r0(b[1])]);
  }
});
// Europa: alle Nachbarschaften der Europakarte gelten weiter, auch wo die Zellen hier anders fallen
for (const s of seeds) if (s.eu) for (const a of s.eu.adj) link(s.id, a);
// Inseln mit fester Verbindung zum Festland
for (const s of seeds) {
  if (!s.f.includes('L')) continue;
  const near = seeds.filter(o => o !== s && !prov[s.id].adj.includes(o.id)).sort((a, b) => gc(s.lat, s.lon, a.lat, a.lon) - gc(s.lat, s.lon, b.lat, b.lon))[0];
  if (!prov[s.id].adj.length && near) link(s.id, near.id);
}

const hits: Record<string, number> = {};
for (const r of rivers)
  for (let i = 0; i + 3 < r.length; i += 2) {
    const len = Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1]);
    const s = seeds[del.find((r[i] + r[i + 2]) / 2, (r[i + 1] + r[i + 3]) / 2)];
    if (!s.eu) hits[s.id] = (hits[s.id] ?? 0) + len;
  }
for (const id in hits) if (prov[id] && hits[id] > 40) prov[id].river = true;

// Rohstoffe der nächstgelegenen Provinz zuschlagen, Industrie nach Einwohnerzahl verteilen
for (const [la, lo, st, oil] of RES_W) {
  const [x, y] = px(lo, la);
  const p = prov[seeds[del.find(x, y)].id];
  p.steel += st;
  p.oil += oil;
}
const wt = (s: Seed) => Math.pow(Math.max(s.pop, 20000), 0.6);
const fresh = seeds.filter(s => !s.eu && !prov[s.id].f.includes('k'));
const wsum: Record<string, number> = {};
for (const s of fresh) wsum[s.c] = (wsum[s.c] ?? 0) + wt(s);
for (const s of fresh) prov[s.id].ind = +(((IND_W[s.c] ?? (EMPIRES.includes(s.c) ? 0 : 0.3)) * wt(s)) / wsum[s.c]).toFixed(2);

const out = { w: W, h: H, km: 0, land, lakes, rivers, edges, prov };
const json = JSON.stringify(out);
writeFileSync(new URL('../src/data/map_world.json', import.meta.url), json);
const per: Record<string, number> = {};
for (const p of Object.values(prov)) per[p.c] = (per[p.c] ?? 0) + 1;
console.log(`map_world.json ${(json.length / 1024) | 0} kB, ${W}x${H}, Provinzen ${Object.keys(prov).length} (neu ${seeds.filter(s => !s.eu).length}), Kanten ${edges.length}, Landringe ${land.length}, Flüsse ${rivers.length}`);
console.log(Object.entries(per).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', '));
console.log('ohne Nachbarn:', Object.keys(prov).filter(k => !prov[k].adj.length).join(' '));
for (const id of ['berlin', 'tokio', 'fukuoka', 'singapur', 'hongkong', 'panama', 'suez', 'wladiwostok', 'new_york', 'kapstadt', 'tschungking', 'rangun', 'imphal', 'teheran'])
  console.log(id, prov[id]?.c, prov[id]?.sea, prov[id]?.port, '->', prov[id]?.adj.join(' '));
