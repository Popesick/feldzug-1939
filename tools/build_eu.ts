// Baut src/data/map_eu.json: Europa, Nordafrika und Vorderasien mit den Grenzen von 1936.
// Küsten, Seen, Flüsse und Orte stammen aus Natural Earth (gemeinfrei); die Provinzen sind
// Voronoi-Zellen um ausgewählte Orte. Die Staatszugehörigkeit von 1936 wird aus dem heutigen
// Staat plus einigen groben Grenzpolygonen abgeleitet und ist damit nur angenähert.
// Aufruf: npm run map:eu
import { readFileSync, writeFileSync } from 'node:fs';
import { Delaunay } from 'd3-delaunay';
import { FORCED, RENAME } from './eu_seeds';

type Pt = [number, number];
const RAD = Math.PI / 180;
const KM_PX = 2.2;
// Lambert-Kegelprojektion (winkeltreu), Bezugsparallelen 36° und 62°
const P1 = 36 * RAD, P2 = 62 * RAD, LAT0 = 49 * RAD, LON0 = 17 * RAD, R = 6371;
const tn = (p: number) => Math.tan(Math.PI / 4 + p / 2);
const N = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(tn(P2) / tn(P1));
const F = (Math.cos(P1) * Math.pow(tn(P1), N)) / N;
const RHO0 = F / Math.pow(tn(LAT0), N);
const X0 = -2350, X1 = 2800, Y0 = -2400, Y1 = 2450; // Kartenausschnitt in km um den Bezugspunkt
const W = Math.round((X1 - X0) / KM_PX), H = Math.round((Y1 - Y0) / KM_PX);
function px(lon: number, lat: number): Pt {
  const rho = F / Math.pow(tn(lat * RAD), N), th = N * (lon * RAD - LON0);
  return [(R * rho * Math.sin(th) - X0) / KM_PX, (Y1 - R * (RHO0 - rho * Math.cos(th))) / KM_PX];
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const load = (n: string) => JSON.parse(readFileSync(new URL(`./ne/${n}.geojson`, import.meta.url), 'utf8'));

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

function polys(name: string, minArea: number): number[][] {
  const rings: number[][] = [];
  for (const f of load(name).features) {
    const g = f.geometry;
    const list: Pt[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of list)
      for (const ring of poly) {
        // erst grob in Grad beschneiden (die Projektion taugt nur für die Nordhalbkugel), dann im Kartenbild
        const c = clip(ring as Pt[], -40, 80, 12, 85);
        if (c.length < 3) continue;
        const s = simplify(clip(c.map(p => px(p[0], p[1])), -20, W + 20, -20, H + 20), 1.1);
        if (s.length >= 3 && area(s) >= minArea) rings.push(s.flat().map(r1));
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
        const s = simplify(cur, 1.5);
        if (s.length >= 2) out.push({ rank, pts: s.flat().map(r1) });
        cur = [];
      };
      for (const p of line) {
        if (p[0] < -40 || p[0] > 80 || p[1] < 12) { flush(); continue; }
        const q = px(p[0], p[1]);
        if (q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) flush();
        else cur.push(q);
      }
      flush();
    }
  }
  return out;
}

const land = polys('ne_10m_land', 4);
const lakes = polys('ne_10m_lakes', 12);
const rivers = [...lines('ne_10m_rivers_lake_centerlines', 6), ...lines('ne_10m_rivers_europe', 6)];

const boxes = land.map(r => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < r.length; i += 2) (x0 = Math.min(x0, r[i])), (x1 = Math.max(x1, r[i])), (y0 = Math.min(y0, r[i + 1])), (y1 = Math.max(y1, r[i + 1]));
  return [x0, x1, y0, y1];
});
function onLand(x: number, y: number): boolean {
  let inside = false;
  land.forEach((r, k) => {
    const b = boxes[k];
    if (x < b[0] || x > b[1] || y < b[2] || y > b[3]) return;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}

// ---- Staaten von 1936 -----------------------------------------------------

// Polen in den Grenzen von 1921–1939, grob (Länge, Breite)
const POLAND: Pt[] = [
  [18.4, 54.85], [17.9, 54.75], [17.6, 54.3], [17.3, 53.75], [16.9, 53.3], [16.3, 53.0], [15.9, 52.6], [15.8, 52.2], [16.3, 51.75],
  [17.0, 51.5], [17.8, 51.25], [18.3, 51.0], [18.7, 50.75], [18.85, 50.4], [18.75, 50.25], [18.5, 50.2], [18.45, 49.95], [18.7, 49.5],
  [19.4, 49.5], [19.8, 49.2], [20.3, 49.35], [21.3, 49.4], [22.5, 49.05], [22.85, 49.0], [23.6, 48.6], [24.6, 47.95], [25.2, 48.1],
  [26.1, 48.5], [26.3, 48.7], [26.2, 49.5], [26.4, 50.2], [26.9, 50.5], [27.2, 51.0], [27.4, 51.6], [27.5, 52.0], [26.9, 52.9],
  [26.9, 53.6], [27.1, 54.2], [27.9, 54.8], [28.3, 55.6], [27.6, 55.8], [26.6, 55.7], [26.4, 55.2], [25.0, 54.95], [24.6, 54.5],
  [24.2, 54.1], [23.5, 54.2], [22.8, 54.4], [22.7, 54.0], [22.6, 53.75], [22.0, 53.5], [21.3, 53.4], [20.6, 53.25], [20.0, 53.3],
  [19.6, 53.38], [19.3, 53.55], [18.95, 53.6], [18.85, 53.9], [18.8, 54.1], [18.4, 54.2], [18.2, 54.42], [18.58, 54.47], [18.9, 54.7],
];
function inPoly(poly: Pt[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SIMPLE: Record<string, string> = {
  DEU: 'GER', AUT: 'AUT', CZE: 'CSR', SVK: 'CSR', LVA: 'LAT', EST: 'EST', FIN: 'FIN', ALD: 'FIN', SWE: 'SWE', NOR: 'NOR', DNK: 'DNK',
  GBR: 'ENG', IMN: 'ENG', IRL: 'IRL', NLD: 'NLD', BEL: 'BEL', LUX: 'LUX', FRA: 'FRA', MCO: 'FRA', CHE: 'CHE', LIE: 'CHE', ITA: 'ITA', SMR: 'ITA',
  VAT: 'ITA', MLT: 'ENG', ESP: 'SPA', AND: 'SPA', PRT: 'POR', GIB: 'ENG', HUN: 'HUN', ROU: 'ROM', ALB: 'ALB', SRB: 'YUG', HRV: 'YUG',
  SVN: 'YUG', BIH: 'YUG', MNE: 'YUG', MKD: 'YUG', KOS: 'YUG', TUR: 'TUR', CYP: 'ENG', CYN: 'ENG', SYR: 'FRA', LBN: 'FRA', ISR: 'ENG',
  PSX: 'ENG', PSE: 'ENG', JOR: 'ENG', IRQ: 'IRQ', IRN: 'PER', SAU: 'SAU', KWT: 'ENG', EGY: 'ENG', LBY: 'ITA', TUN: 'FRA', DZA: 'FRA',
  GEO: 'SOV', ARM: 'SOV', AZE: 'SOV', KAZ: 'SOV', GRC: 'GRC', BGR: 'BUL', LTU: 'LIT', MDA: 'ROM', MAR: 'FRA',
};
function country36(a3: string, lon: number, lat: number): { c: string; f: string } | null {
  const poland = inPoly(POLAND, lon, lat);
  switch (a3) {
    case 'POL': return { c: poland ? 'POL' : 'GER', f: '' };
    case 'LTU': return { c: poland ? 'POL' : 'LIT', f: '' };
    case 'BLR': return { c: poland ? 'POL' : 'SOV', f: '' };
    case 'UKR':
      if (poland) return { c: 'POL', f: '' };
      if (lon < 24.2 && lat < 49.0) return { c: 'CSR', f: 'karp' };
      if (lat < 48.55 && lon > 25 && lon < 27) return { c: 'ROM', f: 'bess' };
      if (lon > 28.2 && lon < 30.4 && lat < 46.4) return { c: 'ROM', f: 'bess' };
      return { c: 'SOV', f: '' };
    case 'RUS':
      if (lon > 19.5 && lon < 23 && lat > 54.3 && lat < 55.4) return { c: 'GER', f: '' };
      if (lat > 69.2 && lon > 29 && lon < 32) return { c: 'FIN', f: '' };
      if (lon > 28 && lon < 31.5 && lat > 60.4 && lat < 62 && !(lon > 29.6 && lat < 60.9)) return { c: 'FIN', f: 'karel' };
      return { c: 'SOV', f: '' };
    case 'MDA': return lon > 29.3 && lat < 47.6 ? { c: 'SOV', f: '' } : { c: 'ROM', f: 'bess' };
    case 'BGR': return lat > 43.4 && lon > 27 ? { c: 'ROM', f: '' } : { c: 'BUL', f: '' };
    case 'ROU': return lat > 46.5 && lon > 22 && lon < 25.6 ? { c: 'ROM', f: 'ntrans' } : { c: 'ROM', f: '' };
    case 'GRC': return lon > 26.6 && lat < 37.3 ? { c: 'ITA', f: '' } : { c: 'GRC', f: '' };
    case 'HRV': case 'SVN': return lon < 14.5 && lat > 44.7 && lat < 45.75 ? { c: 'ITA', f: '' } : { c: 'YUG', f: '' };
    case 'MAR': return lat > 34.9 && lon > -6 ? { c: 'SPA', f: '' } : { c: 'FRA', f: '' };
    case 'SVK': return { c: 'CSR', f: 'slo' };
  }
  return SIMPLE[a3] ? { c: SIMPLE[a3], f: '' } : null;
}

// Mindestabstand der Provinzorte in km
function spacing(c: string, lon: number, lat: number): number {
  if (['IRQ', 'PER', 'SAU'].includes(c) || lat < 31.5 || (lat < 34 && lon > 9)) return 230;
  if (c === 'SOV') return lon > 42 || lat > 60 ? 190 : 135;
  if (['NOR', 'SWE', 'FIN'].includes(c)) return lat > 62 ? 200 : 140;
  if (['TUR', 'SPA', 'POR', 'IRL'].includes(c) || lat < 37) return 160;
  if (['GER', 'FRA', 'BEL', 'NLD', 'POL', 'CSR', 'AUT', 'CHE', 'ITA', 'ENG', 'LUX', 'DNK'].includes(c)) return 105;
  return 125;
}

// ---- Gelände --------------------------------------------------------------

const hsh = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const ell = (lat: number, lon: number, la: number, lo: number, ra: number, ro: number) => ((lat - la) / ra) ** 2 + ((lon - lo) / ro) ** 2 <= 1;
function terrain(c: string, lat: number, lon: number, pop: number, flags: string, id: string): string {
  if (flags.includes('u') || pop > 1500000) return 'u';
  const E = (la: number, lo: number, ra: number, ro: number) => ell(lat, lon, la, lo, ra, ro);
  if (E(46.6, 10.5, 1.0, 4.6) || E(45.0, 6.7, 1.2, 0.8) || E(42.7, 0.5, 0.55, 2.6) || E(49.1, 21, 0.5, 3) || E(47.4, 25.2, 1.5, 0.9) || E(45.5, 24.6, 0.45, 2.4)
    || E(43.6, 18.6, 1.5, 1.9) || E(39.6, 21.3, 1.6, 0.9) || E(42.7, 25, 0.35, 2.4) || E(41.7, 24.2, 0.5, 1.4) || E(42.9, 44, 0.8, 5) || E(40.3, 44.5, 1, 3)
    || E(39, 40.5, 1.8, 4.5) || E(33.4, -4.5, 1.4, 4) || E(35.4, 5, 0.8, 4.5) || E(43.05, -5, 0.35, 3.4) || E(42.4, 13.4, 0.6, 0.8)) return 'm';
  if (c === 'NOR' && !(lat < 60.5 && lon > 9.5)) return 'm';
  if (c === 'SWE' && lat > 61 && lon < 15.5) return 'm';
  if (c === 'CHE' || c === 'ALB') return 'm';
  if (E(52.0, 27.3, 0.75, 2.8)) return 's';
  if ((lat > 59 && lon > 21) || (c === 'SWE' && lat > 60) || E(64, 40, 6, 12)) return 'f';
  if (E(40.5, -4, 2.6, 3.6) || E(45, 3, 1.1, 1.4) || E(48, 7.6, 0.8, 0.8) || E(50.6, 9.6, 0.8, 2.6) || E(49.8, 15, 1.1, 3.4) || E(57, -4.5, 1.3, 1.6)
    || E(52.4, -3.6, 1, 0.9) || E(46.3, 23.5, 1, 1.4) || E(43.2, 12, 1.2, 1.5) || E(40.6, 15.8, 1.5, 1.2) || E(38, 23, 2, 2.5) || E(39, 33, 2.5, 6)
    || E(41.5, 21.5, 1.5, 1.5) || E(44.3, 21, 1, 1.2) || E(37.7, 14.2, 0.6, 1.6) || E(50, 5.6, 0.5, 0.9) || E(44.8, 34.3, 0.4, 0.8)) return 'h';
  if (lat > 52.5 && lat < 59.5 && lon > 22 && lon < 46 && hsh(id) < 0.5) return 'f';
  if (c === 'GER' && hsh(id) < 0.25) return 'f';
  return 'p';
}
function infra(c: string, lat: number, lon: number): number {
  if (['GER', 'FRA', 'BEL', 'NLD', 'LUX', 'ENG', 'CHE', 'AUT', 'CSR', 'DNK', 'DZG'].includes(c) && lat > 41 && lon < 25) return 1;
  if (c === 'ITA' && lat > 41) return 1;
  if (['SOV', 'TUR', 'ALB', 'IRQ', 'PER', 'SAU'].includes(c) || lat < 37.5 || lat > 62) return 2;
  return 1.5;
}
function seas(c: string, lat: number, lon: number, extra: string): string {
  let s = '';
  if (lon > 46 || (lat < 31 && lon > 47) || (lat < 29.9 && lon > 32.4)) s = '';
  else if (lon > 27.4 && lon < 42 && lat > 40.9 && lat < 47.4) s = 'S';
  else if (lat < 45.9 && lon > -5.6 && lon < 36.6 && !(lat > 42.9 && lon < 0.5)) s = 'M';
  else if (lon > 9.4 && lon < 30.6 && lat > 53.4 && lat < 66.2 && c !== 'NOR' && !(lon < 12.9 && lat > 56.2)) s = 'B';
  else s = 'N';
  for (const ch of extra) if ('NBMS'.includes(ch) && !s.includes(ch)) s += ch;
  return s;
}

// ---- Rohstoffe und Industrie ---------------------------------------------

// [Breite, Länge, Stahl (Kohle und Erz zusammengefasst), Öl] – grobe Größenordnungen der dreißiger Jahre
const RES: [number, number, number, number][] = [
  [51.45, 7.01, 30, 0], [49.23, 7.0, 8, 0], [50.3, 18.67, 6, 0], [50.26, 19.02, 6, 0], [49.12, 6.18, 14, 0], [49.61, 6.13, 4, 0],
  [67.85, 20.22, 14, 0], [59.9, 15.5, 4, 0], [47.91, 33.39, 14, 0], [48.0, 37.8, 20, 0], [52.48, -1.9, 16, 0], [51.48, -3.18, 8, 0],
  [54.98, -1.61, 8, 0], [43.26, -2.93, 5, 0], [47.07, 15.44, 4, 0], [50.08, 14.43, 4, 0], [49.83, 18.28, 5, 0], [50.63, 5.57, 6, 0],
  [50.63, 3.06, 6, 0], [45.07, 7.69, 3, 0], [56.33, 44.0, 6, 0], [55.75, 37.62, 6, 0], [59.94, 30.31, 6, 0],
  [44.94, 26.02, 0, 18], [40.4, 49.87, 0, 55], [44.61, 40.1, 0, 7], [43.32, 45.69, 0, 14], [49.35, 23.5, 0, 2], [48.21, 16.37, 0, 1],
  [52.37, 9.73, 0, 2], [36.34, 43.13, 0, 12], [30.5, 47.8, 0, 6], [59.38, 28.19, 0, 1], [41.33, 19.82, 0, 1],
];
// Industriekapazität je Staat (Deutsches Reich 1936 = 100), angelehnt an die bekannten Anteile am Rüstungspotential 1937
const IND: Record<string, number> = {
  GER: 100, SOV: 95, ENG: 72, FRA: 30, ITA: 18, CSR: 12, AUT: 6, BEL: 8, NLD: 6, POL: 8, SWE: 7, SPA: 5, CHE: 4, HUN: 3, ROM: 3,
  YUG: 2, DNK: 2, NOR: 2, FIN: 2, GRC: 1, BUL: 1, POR: 1, TUR: 2, LUX: 1, IRL: 1, LIT: 0.4, LAT: 0.5, EST: 0.4, DZG: 0.5,
};

// ---- Orte wählen ----------------------------------------------------------

interface Seed { id: string; name: string; lat: number; lon: number; c: string; vp: number; f: string; pop: number; x: number; y: number; forced: boolean }
const slug = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const km = (a: Seed | { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) * KM_PX;

const places = (load('ne_10m_populated_places').features as { properties: Record<string, never> }[])
  .map(f => f.properties as unknown as { NAME: string; NAME_DE: string; ADM0_A3: string; POP_MAX: number; LATITUDE: number; LONGITUDE: number })
  .filter(p => p.LONGITUDE > -25 && p.LONGITUDE < 70 && p.LATITUDE > 20)
  .map(p => ({ ...p, xy: px(p.LONGITUDE, p.LATITUDE) }))
  .filter(p => p.xy[0] > 8 && p.xy[0] < W - 8 && p.xy[1] > 8 && p.xy[1] < H - 8);

const seeds: Seed[] = [];
const ids = new Set<string>();
for (const line of FORCED.trim().split('\n')) {
  const [name, la, lo, c, vp, f] = line.split('|');
  const [x, y] = px(+lo, +la);
  if (x < 8 || x > W - 8 || y < 8 || y > H - 8) continue;
  const near = places.filter(p => Math.hypot(p.xy[0] - x, p.xy[1] - y) * KM_PX < 25).sort((a, b) => b.POP_MAX - a.POP_MAX)[0];
  const id = slug(name);
  ids.add(id);
  seeds.push({ id, name, lat: +la, lon: +lo, c, vp: +(vp || 0), f: f ?? '', pop: near?.POP_MAX ?? 40000, x, y, forced: true });
}
for (const p of places.sort((a, b) => b.POP_MAX - a.POP_MAX)) {
  const cc = country36(p.ADM0_A3, p.LONGITUDE, p.LATITUDE);
  if (!cc) continue;
  const s = { x: p.xy[0], y: p.xy[1] };
  const d = spacing(cc.c, p.LONGITUDE, p.LATITUDE);
  // fest gesetzte Orte halten etwas weniger Abstand, damit Grenzprovinzen klein bleiben können
  if (seeds.some(o => km(o, s) < (o.forced ? Math.min(d, 85) : d))) continue;
  if (!onLand(s.x, s.y)) continue;
  const de = p.NAME_DE || p.NAME, name = RENAME[de] ?? RENAME[p.NAME] ?? de;
  let id = slug(name);
  if (!id || ids.has(id)) id = `${id || 'ort'}_${cc.c.toLowerCase()}`;
  if (ids.has(id)) continue;
  ids.add(id);
  seeds.push({ id, name, lat: p.LATITUDE, lon: p.LONGITUDE, c: cc.c, vp: 0, f: cc.f, pop: p.POP_MAX, x: s.x, y: s.y, forced: false });
}

// ---- Zellen, Nachbarschaften, Küsten -------------------------------------

const del = Delaunay.from(seeds, s => s.x, s => s.y);
const vor = del.voronoi([0, 0, W, H]);
const cells = seeds.map((_, i) => vor.cellPolygon(i) as Pt[] | null);
interface OutProv { x: number; y: number; poly: number[]; adj: string[]; river: boolean; n: string; c: string; t: string; vp: number; f: string; ll: [number, number]; sea: string; port: boolean; ind: number; steel: number; oil: number; infra: number; sup: boolean }
const prov: Record<string, OutProv> = {};
const coast = new Set<string>();
seeds.forEach((s, i) => {
  const c = cells[i];
  if (!c) return;
  for (let k = 0; k + 1 < c.length; k++)
    for (let t = 0; t < 4; t++) {
      const x = c[k][0] + ((c[k + 1][0] - c[k][0]) * t) / 4, y = c[k][1] + ((c[k + 1][1] - c[k][1]) * t) / 4;
      // etwas zum Ort hin einrücken, damit der Kartenrand nicht als Küste zählt
      const qx = x + (s.x - x) * 0.25, qy = y + (s.y - y) * 0.25;
      if (qx > 4 && qy > 4 && qx < W - 4 && qy < H - 4 && !onLand(qx, qy)) coast.add(s.id);
    }
  const sea = coast.has(s.id) || /P/.test(s.f) ? seas(s.c, s.lat, s.lon, s.f.replace(/[a-z]/g, '')) : '';
  prov[s.id] = {
    x: r1(s.x), y: r1(s.y), poly: c.slice(0, -1).flat().map(r1), adj: [], river: false,
    n: s.name, c: s.c, t: terrain(s.c, s.lat, s.lon, s.pop, s.f, s.id), vp: s.vp || (s.pop > 900000 ? 1 : 0),
    f: s.f.replace(/[PNBMS]/g, ''), ll: [+s.lat.toFixed(2), +s.lon.toFixed(2)], sea,
    port: !!sea && (/P/.test(s.f) || s.pop >= 40000), ind: 0, steel: 0, oil: 0, infra: infra(s.c, s.lat, s.lon), sup: false,
  };
});

// Landraster (2 px), per Zeilenfüllung aus den Küstenringen erzeugt
const G = 2, GW = Math.ceil(W / G), GH = Math.ceil(H / G);
const dry = new Uint8Array(GW * GH);
for (let gy = 0; gy < GH; gy++) {
  const y = gy * G + G / 2, xs: number[] = [];
  land.forEach((r, k) => {
    if (y < boxes[k][2] || y > boxes[k][3]) return;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if (yi > y !== yj > y) xs.push(((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]);
    }
  });
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2)
    for (let gx = Math.max(0, Math.ceil((xs[k] - G / 2) / G)); gx < GW && gx * G + G / 2 <= xs[k + 1]; gx++) dry[gy * GW + gx] = 1;
}
/** Gibt es zwischen zwei Nachbarorten einen Landweg, der ihre beiden Zellen nicht verlässt? */
function landPath(i: number, j: number): boolean {
  const start = (s: Seed) => {
    const cx = Math.floor(s.x / G), cy = Math.floor(s.y / G);
    for (let r = 0; r < 5; r++)
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
// Meerengen, die das Raster fälschlich schließt
const CUT = [['kopenhagen', 'malmoe'], ['dover', 'calais']];

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
    for (let k = 1; k < 16 && !ok; k++) ok = onLand(a[0] + ((b[0] - a[0]) * k) / 16, a[1] + ((b[1] - a[1]) * k) / 16);
    if (!ok) continue;
    if (CUT.some(c => c.includes(s.id) && c.includes(seeds[j].id)) || !landPath(i, j)) continue;
    link(s.id, seeds[j].id);
    edges.push([s.id, seeds[j].id, r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]);
  }
});
// Meerengen, die als Landverbindung gelten
for (const [a, b] of [['reggio_calabria', 'messina'], ['kopenhagen', 'svendborg'], ['svendborg', 'aarhus']]) link(a, b);

const hits: Record<string, number> = {};
for (const r of rivers) {
  if (r.rank > 5) continue;
  for (let i = 0; i + 3 < r.pts.length; i += 2) {
    const len = Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]);
    const id = seeds[del.find((r.pts[i] + r.pts[i + 2]) / 2, (r.pts[i + 1] + r.pts[i + 3]) / 2)].id;
    hits[id] = (hits[id] ?? 0) + len;
  }
}
for (const id in hits) if (prov[id] && hits[id] > 22) prov[id].river = true;

// Rohstoffe der nächstgelegenen Provinz zuschlagen, Industrie nach Einwohnerzahl verteilen
for (const [la, lo, st, oil] of RES) {
  const [x, y] = px(lo, la);
  if (x < 0 || x > W || y < 0 || y > H) continue;
  const p = prov[seeds[del.find(x, y)].id];
  p.steel += st;
  p.oil += oil;
}
const wsum: Record<string, number> = {};
const wt = (s: Seed) => Math.pow(Math.max(s.pop, 20000), 0.6);
// Kolonien und Mandatsgebiete tragen zur Industrie des Mutterlands nichts bei
const colony = (s: Seed) => (s.lat < 37.6 && ['ENG', 'FRA', 'ITA', 'SPA'].includes(s.c) && !(s.c === 'ITA' && s.lon > 12 && s.lon < 16 && s.lat > 36.5) && !(s.c === 'SPA' && s.lat > 36)) || (s.c === 'ITA' && s.lon > 26);
for (const s of seeds) if (!colony(s)) wsum[s.c] = (wsum[s.c] ?? 0) + wt(s);
for (const s of seeds) {
  const p = prov[s.id];
  if (!p) continue;
  if (!colony(s)) p.ind = +(((IND[s.c] ?? 0.5) * wt(s)) / wsum[s.c]).toFixed(2);
  else p.f += 'k';
  p.sup = !colony(s) && (s.f.includes('c') || s.pop >= 300000 || s.vp > 0);
}

const out = { w: W, h: H, km: KM_PX, land, lakes, rivers: rivers.map(r => r.pts), edges, prov };
const json = JSON.stringify(out);
writeFileSync(new URL('../src/data/map_eu.json', import.meta.url), json);
const per: Record<string, number> = {};
for (const p of Object.values(prov)) per[p.c] = (per[p.c] ?? 0) + 1;
console.log(`map_eu.json ${(json.length / 1024) | 0} kB, ${W}x${H}, Provinzen ${Object.keys(prov).length}, Kanten ${edges.length}, Landringe ${land.length}, Flüsse ${rivers.length}`);
console.log(Object.entries(per).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', '));
console.log('ohne Nachbarn:', Object.keys(prov).filter(k => !prov[k].adj.length).join(' '));
for (const id of ['berlin', 'danzig', 'warschau', 'kopenhagen', 'messina', 'istanbul', 'wien', 'karlsbad', 'memel', 'dover', 'calais'])
  console.log(id, prov[id]?.c, prov[id]?.sea, '->', prov[id]?.adj.join(' '));
