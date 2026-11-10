// Taktische Ebene: Hex-Schlacht um eine Provinz. Auto-Resolve lässt dieselbe
// Simulation mit der KI auf beiden Seiten laufen, damit manuelle und automatische
// Schlachten nach denselben Regeln entschieden werden.
import type { AirForce, Division, GameState, MoveType, Side, UnitTypeId } from './types';
import { other } from './types';
import { RNG, hash } from './rng';
import { PROV } from '../data/world';
import { TYPES } from '../data/units';

export const BW = 22, BH = 14;
export const MAX_BATTLE_TURNS = 12; // je Zug rund sechs Stunden
export const TURNS_PER_DAY = 4;

export const enum Hex { Clear, Forest, Hill, Mount, Marsh, River, Town, City }
export const HEX_NAME = ['Offenes Gelände', 'Wald', 'Hügel', 'Gebirge', 'Sumpf', 'Fluss', 'Ortschaft', 'Stadt'];
const DEF_BONUS = [0, 2, 2, 3, 1, -2, 2, 3];
const COST: Record<MoveType, number[]> = {
  foot: [1, 2, 2, 3, 2, 3, 1, 1],
  horse: [1, 2, 2, 4, 3, 4, 1, 1],
  wheel: [1.5, 3, 3, 6, 5, 6, 1, 1],
  track: [1, 2, 2, 5, 4, 5, 1, 1],
};
const ROAD: Record<MoveType, number> = { foot: 0.5, horse: 0.5, wheel: 0.4, track: 0.5 };

export interface BUnit {
  id: number;
  div: number;
  ui: number; // Index in division.units
  t: UnitTypeId;
  side: Side;
  s: number;
  q: number;
  oos: boolean;
  c: number;
  r: number;
  moved: boolean;
  fired: boolean;
  ent: number;
  sup: boolean; // Unterstützungsfeuer in diesem Gegnerzug schon abgegeben
  setup: number; // Artillerie: Züge bis zur Feuerbereitschaft nach einem Stellungswechsel
  cut: boolean; // auf der Schlachtkarte eingeschlossen
  done: boolean; // setzt diesen Zug aus
}

export interface Objective { c: number; r: number; main: boolean; owner: Side }

export interface Battle {
  prov: string;
  attacker: Side;
  terr: number[];
  road: boolean[];
  obj: Objective[];
  units: BUnit[]; // auch vernichtete (s <= 0)
  divNames: Record<number, string>;
  turn: number;
  active: Side;
  air: Record<Side, number>; // heute noch mögliche Bombereinsätze
  bombers: Record<Side, number>;
  fighters: Record<Side, number>;
  lostB: Record<Side, number>;
  lostF: Record<Side, number>;
  sup: Side | null; // Luftüberlegenheit
  edges: Edge[]; // Kartenseiten, von denen der Angreifer kommt
  init: Record<Side, number>;
  winner: Side | null;
  reason: string;
  log: string[];
  rng: RNG;
}

// ---- Hexgeometrie (spitze Hexfelder, ungerade Reihen eingerückt) ----------

export const idx = (c: number, r: number) => r * BW + c;
const inMap = (c: number, r: number) => c >= 0 && r >= 0 && c < BW && r < BH;
const NB = [
  [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]],
  [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]],
];
export function neighbors(i: number): number[] {
  const c = i % BW, r = (i / BW) | 0, out: number[] = [];
  for (const [dc, dr] of NB[r & 1]) if (inMap(c + dc, r + dr)) out.push(idx(c + dc, r + dr));
  return out;
}
export function hexDist(a: number, b: number): number {
  const ar = (a / BW) | 0, br = (b / BW) | 0;
  const ax = (a % BW) - ((ar - (ar & 1)) >> 1), bx = (b % BW) - ((br - (br & 1)) >> 1);
  const dx = ax - bx, dz = ar - br;
  return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz));
}

// ---- Kartenerzeugung ------------------------------------------------------

function noise(rng: RNG) {
  const G = 4, gw = Math.ceil(BW / G) + 2, gh = Math.ceil(BH / G) + 2;
  const v = Array.from({ length: gw * gh }, () => rng.next());
  return (c: number, r: number) => {
    const x = (c + 0.5 * (r & 1)) / G, y = r / G;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (i: number, j: number) => v[j * gw + i];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
}

function hexLine(a: number, b: number): number[] {
  // gierig zum Ziel laufen; reicht für Straßen
  const out = [a];
  let cur = a;
  while (cur !== b) {
    cur = neighbors(cur).reduce((m, n) => (hexDist(n, b) < hexDist(m, b) ? n : m));
    out.push(cur);
  }
  return out;
}

/** Die Karte hängt nur von der Provinz ab: um Lodz kämpft man immer im selben Gelände. */
function genMap(provId: string) {
  const p = PROV[provId], rng = new RNG(hash(provId));
  const nf = noise(rng), ne = noise(rng);
  const terr: number[] = new Array(BW * BH).fill(Hex.Clear);
  const K = {
    p: { f: 0.64, h: 0.74, m: 2, s: -1 }, u: { f: 0.68, h: 0.78, m: 2, s: -1 },
    f: { f: 0.46, h: 0.72, m: 2, s: -1 }, h: { f: 0.58, h: 0.5, m: 0.8, s: -1 },
    m: { f: 0.55, h: 0.42, m: 0.62, s: -1 }, s: { f: 0.56, h: 2, m: 2, s: 0.44 },
  }[p.terrain];
  for (let r = 0; r < BH; r++)
    for (let c = 0; c < BW; c++) {
      const e = ne(c, r), f = nf(c, r);
      terr[idx(c, r)] = e > K.m ? Hex.Mount : e > K.h ? Hex.Hill : e < K.s ? Hex.Marsh : f > K.f ? Hex.Forest : Hex.Clear;
    }
  const cx = BW >> 1, cy = BH >> 1, main = idx(cx, cy);
  if (p.river) {
    // Fluss ein paar Felder neben dem Hauptort, quer über die ganze Karte
    const off = (2 + rng.int(3)) * (rng.next() < 0.5 ? -1 : 1);
    if (rng.next() < 0.5) {
      let c = cx + off;
      for (let r = 0; r < BH; r++) {
        terr[idx(c, r)] = Hex.River;
        const step = rng.int(3) - 1;
        if (step && inMap(c + step, r) && Math.abs(c + step - cx) >= 2 && c + step > 1 && c + step < BW - 2) {
          c += step;
          terr[idx(c, r)] = Hex.River;
        }
      }
    } else {
      let r = cy + off;
      for (let c = 0; c < BW; c++) {
        terr[idx(c, r)] = Hex.River;
        const step = rng.int(3) - 1;
        if (step && Math.abs(r + step - cy) >= 2 && r + step > 1 && r + step < BH - 2) {
          r += step;
          terr[idx(c, r)] = Hex.River;
        }
      }
    }
  }
  const obj: Objective[] = [{ c: cx, r: cy, main: true, owner: 'POL' }];
  terr[main] = p.terrain === 'u' ? Hex.City : Hex.Town;
  const nb = neighbors(main);
  for (let k = 0; k < (p.terrain === 'u' ? 4 : 1); k++) terr[nb[(k * 2 + rng.int(2)) % nb.length]] = p.terrain === 'u' ? Hex.City : Hex.Town;
  for (let tries = 0; obj.length < 3 && tries < 200; tries++) {
    const c = 5 + rng.int(BW - 10), r = 3 + rng.int(BH - 6), i = idx(c, r);
    if (terr[i] === Hex.River || obj.some(o => hexDist(idx(o.c, o.r), i) < 4)) continue;
    terr[i] = Hex.Town;
    obj.push({ c, r, main: false, owner: 'POL' });
  }
  const road: boolean[] = new Array(BW * BH).fill(false);
  const ends = [idx(0, cy), idx(BW - 1, cy), idx(cx, 0), idx(cx, BH - 1), ...obj.slice(1).map(o => idx(o.c, o.r))];
  for (const e of ends) for (const h of hexLine(main, e)) road[h] = true;
  return { terr, road, obj };
}

// ---- Aufbau ---------------------------------------------------------------

type Edge = 'W' | 'E' | 'N' | 'S';

function edgeOf(from: string, to: string): Edge {
  const dx = PROV[from].x - PROV[to].x, dy = PROV[from].y - PROV[to].y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : dy < 0 ? 'N' : 'S';
}

export function createBattle(g: GameState, provId: string, attackers: Division[], defenders: Division[], air: AirForce): Battle {
  const { terr, road, obj } = genMap(provId);
  const attacker = attackers[0].side, defender = other(attacker);
  for (const o of obj) o.owner = defender;
  const b: Battle = {
    prov: provId, attacker, terr, road, obj, units: [], divNames: {},
    turn: 1, active: attacker,
    air: { GER: air.GER.b, POL: air.POL.b }, bombers: { GER: air.GER.b, POL: air.POL.b },
    fighters: { GER: air.GER.f, POL: air.POL.f }, lostB: { GER: 0, POL: 0 }, lostF: { GER: 0, POL: 0 },
    sup: air.GER.f > air.POL.f ? 'GER' : air.POL.f > air.GER.f ? 'POL' : null, edges: [],
    init: { GER: 0, POL: 0 }, winner: null, reason: '', log: [],
    rng: new RNG((g.seed + g.turn * 7919 + hash(provId)) >>> 0),
  };
  const taken = new Set<number>();
  const add = (d: Division, ui: number, at: number, ent: number) => {
    const u = d.units[ui];
    taken.add(at);
    b.units.push({
      id: b.units.length + 1, div: d.id, ui, t: u.t, side: d.side, s: u.s, q: d.q, oos: d.oos,
      c: at % BW, r: (at / BW) | 0, moved: false, fired: false, ent, sup: false, setup: 0, cut: false, done: false,
    });
    b.init[d.side] += u.s;
  };
  const free = (i: number) => !taken.has(i) && terr[i] !== Hex.River;
  const all = Array.from({ length: BW * BH }, (_, i) => i);
  const main = idx(obj[0].c, obj[0].r);

  // Angreifer kommen von der Kartenseite, auf der ihre Ausgangsprovinz liegt
  const edges: Edge[] = [];
  for (const d of attackers) {
    b.divNames[d.id] = d.name;
    const e = edgeOf(d.prov, provId);
    edges.push(e);
    const depth = (i: number) => {
      const c = i % BW, r = (i / BW) | 0;
      return e === 'W' ? c : e === 'E' ? BW - 1 - c : e === 'N' ? r : BH - 1 - r;
    };
    const lateral = (i: number) => (e === 'W' || e === 'E' ? Math.abs(((i / BW) | 0) - BH / 2) : Math.abs((i % BW) - BW / 2));
    const spots = all.filter(i => depth(i) <= 2).sort((x, y) => lateral(x) + depth(x) * 0.7 - (lateral(y) + depth(y) * 0.7));
    // Artillerie und Tross hinten, Kampftruppen vorn
    const order = d.units.map((_, i) => i).sort((x, y) => TYPES[d.units[x].t].rng - TYPES[d.units[y].t].rng);
    for (const ui of order) {
      const art = TYPES[d.units[ui].t].rng > 1;
      const at = spots.find(i => free(i) && (art ? depth(i) === 0 : depth(i) > 0)) ?? spots.find(free) ?? all.find(free)!;
      add(d, ui, at, 0);
    }
  }

  // Verteidiger um die Ziele; Artillerie auf der dem Angriff abgewandten Seite
  const threat = (i: number) => {
    const c = i % BW, r = (i / BW) | 0;
    return Math.min(...edges.map(e => (e === 'W' ? c : e === 'E' ? BW - 1 - c : e === 'N' ? r : BH - 1 - r)));
  };
  const ring = all.filter(i => hexDist(i, main) <= 4).sort((x, y) => hexDist(x, main) - hexDist(y, main) || DEF_BONUS[terr[y]] - DEF_BONUS[terr[x]]);
  const side = obj.slice(1).map(o => idx(o.c, o.r));
  let n = 0;
  for (const d of defenders) {
    b.divNames[d.id] = d.name;
    d.units.forEach((u, ui) => {
      const art = TYPES[u.t].rng > 1;
      let at: number | undefined;
      if (art) at = ring.filter(i => free(i) && hexDist(i, main) <= 2).sort((x, y) => threat(y) - threat(x))[0];
      else if (n === 2 || n === 4) at = side.find(free);
      at ??= ring.find(free) ?? all.find(free)!;
      if (!art) n++;
      add(d, ui, at, Math.min(3, d.dug));
    });
  }
  b.edges = edges;
  // Die unterlegenen Jäger zahlen für den Kampf um den Luftraum
  if (b.sup && b.fighters[other(b.sup)] > 0 && b.rng.next() < 0.3) {
    b.fighters[other(b.sup)]--;
    b.lostF[other(b.sup)]++;
  }
  updateCut(b, 'GER', false);
  updateCut(b, 'POL', false);
  return b;
}

// ---- Abfragen -------------------------------------------------------------

export const alive = (b: Battle, side?: Side) => b.units.filter(u => u.s > 0 && (!side || u.side === side));
export const pos = (u: BUnit) => idx(u.c, u.r);
export const unitAt = (b: Battle, i: number) => b.units.find(u => u.s > 0 && pos(u) === i);
export const isArt = (u: BUnit) => TYPES[u.t].rng > 1;
export const sideStrength = (b: Battle, side: Side) => alive(b, side).reduce((a, u) => a + u.s, 0);

function stepCost(b: Battle, u: BUnit, to: number): number {
  const t = TYPES[u.t], h = b.terr[to];
  if (b.road[to]) return ROAD[t.move];
  if (u.t === 'GEB' && (h === Hex.Hill || h === Hex.Mount)) return 1.5;
  if (u.t === 'ENG' && h === Hex.River) return 2;
  return COST[t.move][h];
}

/** Erreichbare Felder (ohne das eigene) mit Wegkosten. Feindnähe beendet die Bewegung. */
export function reachable(b: Battle, u: BUnit): Map<number, number> {
  const out = new Map<number, number>();
  if (u.moved) return out;
  const occ = new Map<number, BUnit>();
  for (const x of alive(b)) occ.set(pos(x), x);
  const zoc = (i: number) => neighbors(i).some(n => occ.get(n) && occ.get(n)!.side !== u.side);
  const start = pos(u), mp = TYPES[u.t].mp;
  const best = new Map<number, number>([[start, 0]]);
  const open = [start];
  while (open.length) {
    open.sort((x, y) => best.get(y)! - best.get(x)!);
    const cur = open.pop()!, cc = best.get(cur)!;
    if (cur !== start && zoc(cur)) continue;
    for (const n of neighbors(cur)) {
      const o = occ.get(n);
      if (o && o.side !== u.side) continue;
      let cost = cc + stepCost(b, u, n);
      if (cost > mp) {
        if (cur !== start) continue;
        cost = mp; // ein Feld geht immer
      }
      if (cost >= (best.get(n) ?? Infinity)) continue;
      best.set(n, cost);
      open.push(n);
      if (!o) out.set(n, cost);
    }
  }
  return out;
}

// ---- Gefecht --------------------------------------------------------------

const closeTerrain = (h: number) => h === Hex.Forest || h === Hex.City || h === Hex.Town || h === Hex.Mount;

function attackValue(b: Battle, a: BUnit, from: number, d: BUnit): number {
  const t = TYPES[a.t];
  let v = (TYPES[d.t].hard ? t.ha : t.sa) + a.q - (a.oos || a.cut ? 2 : 0);
  if (b.terr[from] === Hex.River) v -= 3;
  if (t.hard && closeTerrain(b.terr[pos(d)])) v -= 2;
  return v;
}

function defenseValue(b: Battle, d: BUnit, at: number, a: BUnit, cover: boolean): number {
  let v = TYPES[d.t].def + d.q * 0.5 - (d.oos || d.cut ? 1 : 0);
  if (cover) v += DEF_BONUS[b.terr[at]] + (a.t === 'ENG' ? 0 : d.ent);
  return v;
}

const kills = (str: number, base: number, av: number, dv: number) => (str / 10) * base * Math.pow(2, (av - dv) / 4);

function supporter(b: Battle, d: BUnit, attackerAt: number): BUnit | undefined {
  return alive(b, d.side).find(x => x !== d && isArt(x) && !x.sup && x.setup === 0 && hexDist(pos(x), attackerAt) <= TYPES[x.t].rng);
}

export function canAttack(b: Battle, a: BUnit, d: BUnit, from = pos(a)): boolean {
  if (a.fired || a.side === d.side || d.s <= 0) return false;
  const dist = hexDist(from, pos(d));
  if (isArt(a)) return from === pos(a) && !a.moved && a.setup === 0 && dist <= TYPES[a.t].rng;
  return dist === 1;
}

/** Erwartete Verluste: dl beim Verteidiger, al beim Angreifer. */
export function predict(b: Battle, a: BUnit, d: BUnit, from = pos(a)): { dl: number; al: number } {
  const dist = hexDist(from, pos(d));
  const dl = Math.min(d.s, kills(a.s, isArt(a) ? 1.7 : 2.2, attackValue(b, a, from, d), defenseValue(b, d, pos(d), a, true)));
  let al = 0;
  if (dist === 1) {
    const back = TYPES[a.t].ini >= TYPES[d.t].ini ? Math.max(0, d.s - dl) : d.s;
    al += kills(back, isArt(d) ? 0.8 : 1.6, attackValue(b, d, pos(d), a), defenseValue(b, a, from, d, false));
    if (!isArt(a)) {
      const x = supporter(b, d, from);
      if (x) al += kills(x.s, 0.9, attackValue(b, x, pos(x), a), defenseValue(b, a, from, x, false));
    }
  }
  return { dl, al: Math.min(a.s, al) };
}

const label = (b: Battle, u: BUnit) => `${TYPES[u.t].name[u.side].split(' (')[0]} (${b.divNames[u.div]})`;

function hit(b: Battle, u: BUnit, expected: number): number {
  const x = expected * (0.7 + 0.6 * b.rng.next());
  const n = Math.min(u.s, Math.floor(x) + (b.rng.next() < x % 1 ? 1 : 0));
  u.s -= n;
  return n;
}

export function attack(b: Battle, a: BUnit, d: BUnit) {
  if (!canAttack(b, a, d)) return;
  const from = pos(a), dist = hexDist(from, pos(d));
  let al = 0;
  if (dist === 1 && !isArt(a)) {
    const x = supporter(b, d, from);
    if (x) {
      x.sup = true;
      al += hit(b, a, kills(x.s, 0.9, attackValue(b, x, pos(x), a), defenseValue(b, a, from, x, false)));
    }
  }
  const before = d.s;
  const dl = hit(b, d, kills(a.s, isArt(a) ? 1.7 : 2.2, attackValue(b, a, from, d), defenseValue(b, d, pos(d), a, true)));
  if (dist === 1 && a.s > 0) {
    const back = TYPES[a.t].ini >= TYPES[d.t].ini ? d.s : before;
    al += hit(b, a, kills(back, isArt(d) ? 0.8 : 1.6, attackValue(b, d, pos(d), a), defenseValue(b, a, from, d, false)));
  }
  a.fired = a.moved = true;
  d.ent = Math.max(0, d.ent - 1);
  b.log.push(`${label(b, a)} greift ${label(b, d)} an: −${dl} / −${al}${d.s <= 0 ? ' – vernichtet' : ''}`);
}

export function move(b: Battle, u: BUnit, to: number) {
  if (!reachable(b, u).has(to)) return;
  u.c = to % BW;
  u.r = (to / BW) | 0;
  u.moved = true;
  u.ent = 0;
  if (isArt(u)) u.setup = 1; // Stellungswechsel: der nächste Zug vergeht mit dem Instellunggehen
  const o = b.obj.find(o => idx(o.c, o.r) === to);
  if (o && o.owner !== u.side) {
    o.owner = u.side;
    b.log.push(`${label(b, u)} nimmt ${o.main ? 'den Hauptort' : 'eine Ortschaft'}.`);
  }
}

export function airStrike(b: Battle, side: Side, d: BUnit) {
  if (b.air[side] < 1 || d.side === side || d.s <= 0) return;
  b.air[side]--;
  let n = 1 + b.rng.int(3);
  if (closeTerrain(b.terr[pos(d)])) n--;
  n = Math.min(d.s, Math.max(1, n));
  d.s -= n;
  d.ent = Math.max(0, d.ent - 1);
  b.log.push(`Luftangriff auf ${label(b, d)}: −${n}${d.s <= 0 ? ' – vernichtet' : ''}`);
  if (b.sup === other(side) && b.rng.next() < 0.4) {
    b.bombers[side]--;
    b.lostB[side]++;
    b.log.push(`${side === 'GER' ? 'Deutsche' : 'Polnische'} Bomberstaffel von feindlichen Jägern abgeschossen.`);
  }
}

const BREAK = 0.35;

function checkEnd(b: Battle, roundDone: boolean) {
  if (b.winner) return;
  const def = other(b.attacker);
  const win = (s: Side, why: string) => ((b.winner = s), (b.reason = why));
  if (sideStrength(b, def) <= b.init[def] * BREAK) return win(b.attacker, 'Die Verteidigung ist zusammengebrochen.');
  if (sideStrength(b, b.attacker) <= b.init[b.attacker] * BREAK) return win(def, 'Der Angriff ist verblutet.');
  if (!roundDone) return;
  if (b.obj.every(o => o.owner === b.attacker)) return win(b.attacker, 'Alle Ziele sind genommen.');
  if (b.turn > MAX_BATTLE_TURNS)
    return b.obj[0].owner === b.attacker ? win(b.attacker, 'Der Hauptort ist bei Schlachtende in der Hand des Angreifers.') : win(def, 'Der Hauptort wurde gehalten.');
}

export function endBattleTurn(b: Battle) {
  if (b.winner) return;
  const s = b.active;
  for (const u of alive(b, s)) {
    if (u.moved) continue;
    if (!u.cut) u.ent = Math.min(3, u.ent + 1);
    if (u.setup > 0) u.setup--;
  }
  b.active = other(s);
  for (const u of alive(b)) (u.moved = u.fired = false), (u.sup = u.done = false);
  const roundDone = b.active === b.attacker;
  if (roundDone) b.turn++;
  // neuer Tag: jede Bomberstaffel fliegt wieder einen Einsatz
  if (roundDone && (b.turn - 1) % TURNS_PER_DAY === 0) b.air = { ...b.bombers };
  updateCut(b, b.active);
  checkEnd(b, roundDone);
}

/**
 * Einkesselung auf der Schlachtkarte: Wer keinen freien Weg mehr zum eigenen Kartenrand hat,
 * kämpft schlechter, gräbt sich nicht ein und verliert zu Beginn jedes eigenen Zuges Stärke.
 */
export function updateCut(b: Battle, side: Side, attrition = true) {
  const en = new Set<number>(), zoc = new Set<number>();
  for (const e of alive(b, other(side))) {
    en.add(pos(e));
    for (const n of neighbors(pos(e))) zoc.add(n);
  }
  const own = new Set(alive(b, side).map(pos));
  const att = side === b.attacker;
  const source = (i: number) => {
    const c = i % BW, r = (i / BW) | 0;
    const mine = b.edges.some(e => (e === 'W' ? c === 0 : e === 'E' ? c === BW - 1 : e === 'N' ? r === 0 : r === BH - 1));
    return att ? mine : (c === 0 || r === 0 || c === BW - 1 || r === BH - 1) && !mine;
  };
  let q = Array.from({ length: BW * BH }, (_, i) => i).filter(i => source(i) && !en.has(i));
  // Angriff von allen Seiten: der Verteidiger lebt aus dem Hauptort, solange er ihn hält
  if (!att && !q.length && b.obj[0].owner === side) q = [idx(b.obj[0].c, b.obj[0].r)];
  const seen = new Set(q);
  q = q.filter(i => !zoc.has(i) || own.has(i));
  for (let k = 0; k < q.length; k++)
    for (const n of neighbors(q[k])) {
      if (seen.has(n) || en.has(n)) continue;
      seen.add(n);
      if (!zoc.has(n) || own.has(n)) q.push(n);
    }
  for (const u of alive(b, side)) {
    const was = u.cut;
    u.cut = !seen.has(pos(u));
    if (attrition && was && u.cut) {
      u.s -= 1;
      b.log.push(`${label(b, u)} ist eingeschlossen: −1${u.s <= 0 ? ' – aufgerieben' : ''}`);
    }
  }
}

// ---- Sicht ----------------------------------------------------------------

/** Sichtweite in Feldern; Aufklärer sehen zwei Felder weiter, Luftüberlegenheit verdoppelt. */
export const sight = (b: Battle, u: BUnit) => (2 + (u.t === 'REC' ? 2 : 0)) * (b.sup === u.side ? 2 : 1);

export function visibleEnemies(b: Battle, side: Side): Set<number> {
  const mine = alive(b, side), out = new Set<number>();
  for (const e of alive(b, other(side))) if (mine.some(u => hexDist(pos(u), pos(e)) <= sight(b, u))) out.add(e.id);
  return out;
}

export function concede(b: Battle, side: Side) {
  b.winner = other(side);
  b.reason = side === b.attacker ? 'Der Angriff wurde abgebrochen.' : 'Die Verteidiger haben das Feld geräumt.';
}

// ---- Taktische KI ---------------------------------------------------------

const worth = (u: BUnit) => {
  const t = TYPES[u.t];
  return 0.6 + (t.sa + t.ha + t.def) / 30 + (t.rng > 1 ? 0.3 : 0);
};

export function aiBattleTurn(b: Battle, side: Side) {
  if (b.winner || b.active !== side) return;
  const isAtt = side === b.attacker;
  const main = b.obj[0], mainIdx = idx(main.c, main.r);
  // auch die KI sieht nur, was ihre Einheiten aufgeklärt haben
  const enemies = () => {
    const v = visibleEnemies(b, side);
    return alive(b, other(side)).filter(e => v.has(e.id));
  };

  if (b.air[side] > 0 && enemies().length) {
    const t = enemies().reduce((m, e) => (e.s * worth(e) > m.s * worth(m) ? e : m));
    airStrike(b, side, t);
  }

  const units = alive(b, side).sort((x, y) => TYPES[y.t].rng - TYPES[x.t].rng || TYPES[y.t].ini - TYPES[x.t].ini);
  for (const u of units) {
    if (u.s <= 0) continue;
    const en = enemies();
    const here = pos(u);
    // Wer muss vorwärts? Angreifer immer, Verteidiger nur zum Gegenstoß auf den Hauptort.
    const push = isAtt || main.owner !== side;
    const goal = push
      ? isAtt && main.owner === side
        ? b.obj.filter(o => o.owner !== side).map(o => idx(o.c, o.r)).sort((x, y) => hexDist(here, x) - hexDist(here, y))[0] ?? mainIdx
        : mainIdx
      : null;

    if (isArt(u)) {
      const t = en.filter(e => canAttack(b, u, e)).map(e => ({ e, p: predict(b, u, e) }))
        .sort((x, y) => y.p.dl * worth(y.e) - y.p.al - (x.p.dl * worth(x.e) - x.p.al))[0];
      if (t) attack(b, u, t.e);
      else if (goal !== null) {
        const opts = [...reachable(b, u).keys()].filter(h => en.every(e => hexDist(h, pos(e)) >= 2));
        const best = opts.sort((x, y) => hexDist(x, goal) - hexDist(y, goal))[0];
        if (best !== undefined && hexDist(best, goal) < hexDist(here, goal)) move(b, u, best);
      }
      continue;
    }

    const reach = reachable(b, u);
    const holding = !isAtt && b.obj.some(o => idx(o.c, o.r) === here);
    const froms = holding ? [here] : [here, ...reach.keys()];
    let best: { from: number; e: BUnit; score: number } | null = null;
    for (const from of froms)
      for (const e of en) {
        if (hexDist(from, pos(e)) !== 1) continue;
        const p = predict(b, u, e, from);
        let score = p.dl * worth(e) - p.al * worth(u) * (u.s <= 4 ? 1.8 : 1.1);
        if (p.dl >= e.s - 0.3) score += 2;
        if (b.obj.some(o => idx(o.c, o.r) === pos(e))) score += push ? 1 : 0;
        if (from !== here && !push) score -= 0.6;
        if (!best || score > best.score) best = { from, e, score };
      }
    if (best && best.score > (push ? 0.15 : 0.7)) {
      if (best.from !== here) move(b, u, best.from);
      attack(b, u, best.e);
      continue;
    }
    if (goal === null) {
      // Verteidiger: freie eigene Ziele besetzen, sonst Stellung halten
      const gap = b.obj.map(o => idx(o.c, o.r)).find(i => reach.has(i) && !unitAt(b, i));
      if (gap !== undefined && !holding) move(b, u, gap);
      continue;
    }
    let to = here, bs = hexDist(here, goal) - DEF_BONUS[b.terr[here]] * 0.15;
    for (const h of reach.keys()) {
      const s = hexDist(h, goal) - DEF_BONUS[b.terr[h]] * 0.15;
      if (s < bs) (bs = s), (to = h);
    }
    if (to !== here) move(b, u, to);
  }
  endBattleTurn(b);
}

export function autoResolve(b: Battle) {
  for (let guard = 0; !b.winner && guard < 100; guard++) aiBattleTurn(b, b.active);
}

/** Überträgt die Verluste zurück in die Divisionen. */
export function writeBack(b: Battle, divs: Division[]) {
  for (const d of divs) {
    const mine = b.units.filter(u => u.div === d.id);
    d.units = d.units.map((u, i) => ({ t: u.t, s: mine.find(m => m.ui === i)?.s ?? u.s })).filter(u => u.s > 0);
  }
}

export function losses(b: Battle, side: Side) {
  return b.init[side] - sideStrength(b, side);
}
