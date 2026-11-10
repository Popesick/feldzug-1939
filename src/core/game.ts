// Strategische Ebene: Spielzustand, Bewegung, Schlachten sammeln, Rundenabschluss.
import type { Division, GameState, Owner, Side, Terrain, UnitTypeId } from './types';
import { other } from './types';
import { PLIST, PROV } from '../data/world';
import { OOB_RAW, TEMPLATES, TYPES } from '../data/units';
import { hash } from './rng';

export const MAX_TURNS = 12;
export const DAYS_PER_TURN = 3;
export const STACK = 8; // Divisionen je Provinz
export const BATTLE_MAX = 3; // Divisionen je Seite in einer Schlacht
export const VP_TO_WIN = 14;
const CAPITAL: Record<Side, string> = { GER: 'berlin', POL: 'warschau' };

/** Einhängepunkte für das Europa-Szenario (core/europa.ts trägt sich hier ein). */
export const hooks: {
  capture?: (g: GameState, prov: string, d: Division) => void;
  targets?: (g: GameState, d: Division) => MoveTarget[];
  special?: (g: GameState, d: Division, t: MoveTarget) => void;
  capital?: (g: GameState, d: Division) => string;
  endTurn?: (g: GameState) => void;
} = {};
/** Bezeichnungen der beiden Seiten in Meldungen; das Szenario kann sie austauschen. */
export const WORDS: Record<Side, { adj: string; by: string }> = {
  GER: { adj: 'Deutsche', by: 'deutschen Truppen' }, POL: { adj: 'Polnische', by: 'polnischen Truppen' },
};

export function newGame(player: Side, seed = (Date.now() & 0x7fffffff) || 1): GameState {
  const ctrl: Record<string, Owner> = {};
  for (const p of PLIST) ctrl[p.id] = p.side0;
  const divs: Division[] = [];
  OOB_RAW.trim().split('\n').forEach((line, i) => {
    const [side, nation, name, kind, prov, army, extra] = line.split('|');
    const tp = TEMPLATES[kind];
    if (!tp || !PROV[prov]) throw new Error(`Aufstellung fehlerhaft: ${line}`);
    const units = [...tp.units, ...(extra ? extra.split(',') : [])].map(u => {
      const [t, s] = u.split(':');
      return { t: t as UnitTypeId, s: s ? +s : 10 };
    });
    divs.push({
      id: i + 1, name, side: side as Side, nation, kind, army, q: tp.q, prov, units,
      mp: tp.mp, dug: 0, fought: false, moved: false, order: null, oos: false,
    });
  });
  const g: GameState = {
    turn: 1, player, ctrl, divs, log: [], over: null, seed,
    // grob nach dem Kräfteverhältnis der Luftflotten 1 und 4 zur polnischen Fliegertruppe
    air: { GER: { f: 8, b: 12 }, POL: { f: 4, b: 3 } },
    airAssign: {
      GER: { wielun: { f: 2, b: 3 }, tschenstochau: { f: 2, b: 3 }, konitz: { f: 2, b: 2 }, mlawa: { f: 1, b: 2 }, kattowitz: { f: 1, b: 2 } },
      POL: { warschau: { f: 2, b: 1 }, lodz: { f: 1, b: 1 }, krakau: { f: 1, b: 0 }, posen: { f: 0, b: 1 } },
    },
  };
  // Polen steht in vorbereiteten Stellungen, Garnisonen sind voll eingegraben
  for (const d of divs)
    if (d.side === 'POL') d.dug = tp(d).mp === 0 ? 3 : PROV[d.prov].adj.some(a => ctrl[a] === 'GER') ? 2 : 1;
  updateSupply(g);
  return g;
}

export const tp = (d: Division) => TEMPLATES[d.kind];

export function turnDate(turn: number): string {
  const day = (n: number) => (n <= 30 ? `${n}. September` : `${n - 30}. Oktober`);
  const a = 1 + (turn - 1) * DAYS_PER_TURN;
  return `${day(a)} – ${day(a + DAYS_PER_TURN - 1)} 1939`;
}

export const divsIn = (g: GameState, prov: string, side?: Side) =>
  g.divs.filter(d => d.prov === prov && (!side || d.side === side));

export const strength = (d: Division) => d.units.reduce((a, u) => a + u.s, 0);

export function divPower(d: Division): number {
  let p = 0;
  for (const u of d.units) {
    const t = TYPES[u.t];
    p += (u.s / 10) * (t.sa + t.ha * 0.5 + t.def + (t.rng > 1 ? 3 : 0));
  }
  return p * (1 + 0.1 * d.q) * (d.oos ? 0.7 : d.low ? 0.85 : 1);
}

const TERR_MULT: Record<Terrain, number> = { p: 1, f: 1.25, h: 1.25, m: 1.5, s: 1.3, u: 1.4 };
export const defenseMult = (prov: string) => TERR_MULT[PROV[prov].terrain] + (PROV[prov].river ? 0.15 : 0);

export function log(g: GameState, msg: string) {
  g.log.push(`[${g.turn}] ${msg}`);
  if (g.log.length > 300) g.log.shift();
}

// ---- Luftwaffe und Aufklärung ---------------------------------------------

/** Im Sektor wirksame Staffeln: die der Provinz selbst und die aller Nachbarsektoren. */
export function airAt(g: GameState, side: Side, prov: string) {
  let f = 0, b = 0;
  for (const [s, a] of Object.entries(g.airAssign[side]))
    if (s === prov || PROV[s].adj.includes(prov)) (f += a.f), (b += a.b);
  const q = g.airQ?.[side];
  return q ? { f: Math.round(f * q.f), b: Math.round(b * q.b) } : { f, b };
}

export function airFree(g: GameState, side: Side) {
  let f = g.air[side].f, b = g.air[side].b;
  for (const a of Object.values(g.airAssign[side])) (f -= a.f), (b -= a.b);
  return { f, b };
}

export function assignAir(g: GameState, side: Side, prov: string, kind: 'f' | 'b', delta: 1 | -1) {
  const a = (g.airAssign[side][prov] ??= { f: 0, b: 0 });
  if (delta > 0 ? airFree(g, side)[kind] > 0 : a[kind] > 0) a[kind] += delta;
  if (!a.f && !a.b) delete g.airAssign[side][prov];
}

/** Verlorene Staffeln aus dem Bestand und aus den Sektoren streichen, die über der Provinz lagen. */
export function airLoss(g: GameState, side: Side, prov: string, kind: 'f' | 'b', n: number) {
  const as = g.airAssign[side];
  for (; n > 0 && g.air[side][kind] > 0; n--) {
    g.air[side][kind]--;
    const s = Object.keys(as).find(s => as[s][kind] > 0 && (s === prov || PROV[s].adj.includes(prov))) ?? Object.keys(as).find(s => as[s][kind] > 0);
    if (s) assignAir(g, side, s, kind, -1);
  }
}

/** Provinzen, in denen eine Seite den Gegner sieht: eigenes Gebiet, Frontnachbarn, Luftsektoren. */
export function seenProvs(g: GameState, side: Side): Set<string> {
  const out = new Set<string>();
  const add = (id: string) => (out.add(id), PROV[id].adj.forEach(a => out.add(a)));
  for (const p of PLIST) if (g.ctrl[p.id] === side) add(p.id);
  for (const s of Object.keys(g.airAssign[side])) add(s);
  return out;
}

/** Geschätzte Stärke eines gegnerischen Verbands (bis zu 15 % daneben, je Runde gleichbleibend). */
export function estimate(d: Division, turn: number): number {
  const off = (hash(`${d.id}:${turn}`) % 31) - 15;
  return Math.max(5, Math.round((strength(d) * (1 + off / 100)) / 5) * 5);
}

/** Verbände, die in dieser Runde noch Befehle annehmen. */
export const isFree = (d: Division) => d.mp > 0 && !d.order && !d.done;

// ---- Bewegung -------------------------------------------------------------

export interface MoveTarget { prov: string; attack: boolean; kind?: 'sea' | 'rail' }

/** Ziele eines Verbands; far = auch Seetransport und Bahnverlegung (nur Europa). */
export function moveTargets(g: GameState, d: Division, far = true): MoveTarget[] {
  if (d.mp < 1 || d.order) return [];
  const out: MoveTarget[] = [];
  for (const a of PROV[d.prov].adj) {
    if (g.ctrl[a] === 'NEU') continue;
    const attack = divsIn(g, a, other(d.side)).length > 0;
    if (!attack && divsIn(g, a, d.side).length >= STACK) continue;
    out.push({ prov: a, attack });
  }
  if (far && g.eu && hooks.targets) out.push(...hooks.targets(g, d));
  return out;
}

/** Sofortige Bewegung in eine Provinz ohne Feind; Angriffe werden nur vorgemerkt. */
export function orderMove(g: GameState, d: Division, to: string): 'moved' | 'attack' | null {
  const t = moveTargets(g, d, !PROV[d.prov].adj.includes(to)).find(m => m.prov === to);
  if (!t) return null;
  if (t.attack) {
    d.order = to;
    d.sea = t.kind === 'sea';
    return 'attack';
  }
  if (t.kind) {
    hooks.special!(g, d, t);
    return 'moved';
  }
  enter(g, d, to);
  return 'moved';
}

function enter(g: GameState, d: Division, to: string) {
  if (g.ctrl[to] !== d.side) {
    // Feindgebiet besetzen kostet Fußtruppen die ganze Runde
    d.mp = tp(d).mp >= 2 ? d.mp - 1 : 0;
    capture(g, to, d);
    if (PROV[to].vp) log(g, `${d.name} besetzt ${PROV[to].name}.`);
  } else d.mp -= 1;
  d.prov = to;
  d.moved = true;
  d.dug = 0;
}

/** Eine Provinz wechselt den Besitzer. */
export function capture(g: GameState, prov: string, d: Division) {
  g.ctrl[prov] = d.side;
  if (g.eu) hooks.capture?.(g, prov, d);
}

// ---- Schlachten -----------------------------------------------------------

export interface PendingBattle {
  prov: string;
  side: Side; // Angreifer
  attackers: Division[]; // kämpfende Verbände
  followers: Division[]; // rücken bei Erfolg nach
  defenders: Division[];
  reserve: Division[]; // Verteidiger, die nicht in die Schlacht eingreifen
}

export function collectBattles(g: GameState, side: Side): PendingBattle[] {
  const by = new Map<string, Division[]>();
  for (const d of g.divs)
    if (d.side === side && d.order) {
      if (!by.has(d.order)) by.set(d.order, []);
      by.get(d.order)!.push(d);
    }
  const out: PendingBattle[] = [];
  for (const [prov, all] of by) {
    const pw = (a: Division, b: Division) => divPower(b) - divPower(a);
    all.sort(pw);
    const en = divsIn(g, prov, other(side)).sort(pw);
    out.push({
      prov, side,
      attackers: all.slice(0, BATTLE_MAX), followers: all.slice(BATTLE_MAX),
      defenders: en.slice(0, BATTLE_MAX), reserve: en.slice(BATTLE_MAX),
    });
  }
  return out.sort((a, b) => PROV[b.prov].vp - PROV[a.prov].vp);
}

function retreatTarget(g: GameState, d: Division, from: string): string | null {
  const cap = PROV[(g.eu && hooks.capital?.(g, d)) || CAPITAL[d.side]];
  let best: string | null = null, bs = -Infinity;
  for (const a of PROV[from].adj) {
    if (g.ctrl[a] !== d.side || divsIn(g, a, other(d.side)).length) continue;
    if (divsIn(g, a, d.side).length >= STACK) continue;
    const danger = PROV[a].adj.filter(n => g.ctrl[n] === other(d.side)).length;
    const s = -danger * 2 - Math.hypot(PROV[a].x - cap.x, PROV[a].y - cap.y) / 150;
    if (s > bs) (bs = s), (best = a);
  }
  return best;
}

/** Trägt den Ausgang einer Schlacht in die Strategiekarte ein. */
export function applyBattle(g: GameState, pb: PendingBattle, winner: Side) {
  const all = [...pb.attackers, ...pb.followers];
  for (const d of [...pb.attackers, ...pb.defenders]) d.fought = true;
  for (const d of all) (d.order = null), (d.mp = 0), (d.sea = false);
  g.divs = g.divs.filter(d => {
    if (d.units.length) return true;
    log(g, `${d.name} ist aufgerieben.`);
    return false;
  });
  const name = PROV[pb.prov].name;
  if (winner !== pb.side) {
    if (!g.eu) log(g, `Angriff auf ${name} abgewiesen.`);
    return;
  }
  for (const d of divsIn(g, pb.prov, other(pb.side))) {
    const to = tp(d).mp > 0 ? retreatTarget(g, d, pb.prov) : null;
    if (!to) {
      log(g, `${d.name} kapituliert bei ${name}.`);
      g.divs.splice(g.divs.indexOf(d), 1);
      continue;
    }
    d.prov = to;
    d.dug = 0;
    d.moved = true;
    d.order = null;
    for (const u of d.units) u.s = Math.max(1, u.s - 1);
  }
  const first = all.find(d => g.divs.includes(d));
  if (first) capture(g, pb.prov, first);
  else g.ctrl[pb.prov] = pb.side;
  if (!g.eu || PROV[pb.prov].vp) log(g, `${name} von ${WORDS[pb.side].by} genommen.`);
  for (const d of all) {
    if (!g.divs.includes(d) || divsIn(g, pb.prov, pb.side).length >= STACK) continue;
    d.prov = pb.prov;
    d.moved = true;
    d.dug = 0;
  }
}

// ---- Versorgung und Rundenabschluss --------------------------------------

export function updateSupply(g: GameState) {
  for (const side of ['GER', 'POL'] as Side[]) {
    const seen = new Set<string>();
    const q = PLIST.filter(p => p.supply && p.side0 === side && g.ctrl[p.id] === side).map(p => p.id);
    q.forEach(id => seen.add(id));
    while (q.length) {
      const id = q.pop()!;
      for (const a of PROV[id].adj)
        if (!seen.has(a) && g.ctrl[a] === side) seen.add(a), q.push(a);
    }
    for (const d of g.divs) if (d.side === side) d.oos = !seen.has(d.prov);
  }
}

export function vpStatus(g: GameState) {
  let ger = 0, total = 0;
  for (const p of PLIST)
    if (p.side0 === 'POL' && p.vp) {
      total += p.vp;
      if (g.ctrl[p.id] === 'GER') ger += p.vp;
    }
  return { ger, total };
}

/** Schließt die Runde ab, nachdem beide Seiten gezogen haben. */
export function endTurn(g: GameState) {
  if (g.eu) return hooks.endTurn!(g);
  updateSupply(g);
  for (const d of g.divs) {
    if (d.oos) for (const u of d.units) u.s -= 2;
    else if (!d.fought) for (const u of d.units) u.s = Math.min(10, u.s + 1);
    d.units = d.units.filter(u => u.s > 0);
    if (!d.moved && !d.fought) d.dug = Math.min(3, d.dug + 1);
    d.mp = tp(d).mp;
    d.moved = d.fought = d.done = false;
    d.order = null;
  }
  g.asked = false;
  g.divs = g.divs.filter(d => {
    if (d.units.length) return true;
    log(g, `${d.name} löst sich ohne Versorgung auf.`);
    return false;
  });
  g.turn++;
  const { ger } = vpStatus(g);
  const warsaw = g.ctrl.warschau === 'GER';
  if ((warsaw && ger >= VP_TO_WIN) || !g.divs.some(d => d.side === 'POL'))
    g.over = { winner: 'GER', text: 'Warschau ist gefallen, der polnische Widerstand bricht zusammen.' };
  else if (!g.divs.some(d => d.side === 'GER'))
    g.over = { winner: 'POL', text: 'Die deutschen Angriffsverbände sind zerschlagen.' };
  else if (g.turn > MAX_TURNS)
    g.over = warsaw
      ? { winner: 'GER', text: 'Warschau ist gefallen, doch Teile Polens kämpfen weiter – ein knapper Sieg.' }
      : { winner: 'POL', text: 'Warschau hält am 6. Oktober noch aus – länger als in der Geschichte.' };
}
