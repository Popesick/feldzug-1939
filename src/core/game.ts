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
  targets?: (g: GameState, d: Division, n: number) => MoveTarget[]; // n = Verbände, die gemeinsam ziehen
  special?: (g: GameState, d: Division, t: MoveTarget) => void;
  capital?: (g: GameState, d: Division) => string;
  endTurn?: (g: GameState) => void;
  air?: (g: GameState, side: Side, prov: string) => boolean; // darf die Seite hier Staffeln einsetzen?
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
  return p * (1 + 0.1 * effQ(d)) * (d.oos ? 0.7 : d.low ? 0.85 : 1);
}

const TERR_MULT: Record<Terrain, number> = { p: 1, f: 1.25, h: 1.25, m: 1.5, s: 1.3, u: 1.4 };
export const defenseMult = (prov: string) => TERR_MULT[PROV[prov].terrain] + (PROV[prov].river ? 0.15 : 0);

export function log(g: GameState, msg: string) {
  g.log.push(`[${g.turn}] ${msg}`);
  if (g.log.length > 300) g.log.shift();
}

// ---- Luftwaffe und Aufklärung ---------------------------------------------

/** Im Sektor wirksame Staffeln: die der Provinz selbst und die aller Nachbarsektoren. */
// ---- Erfahrung --------------------------------------------------------------

/** Stufen der Erfahrung: ab welchem Wert, Name, Zu- oder Abschlag auf die Güte. */
export const XP_LEVELS = [
  { at: 0, name: 'unerfahren', q: -1 }, { at: 30, name: 'ausgebildet', q: 0 }, { at: 60, name: 'kampferprobt', q: 1 }, { at: 100, name: 'Elite', q: 2 },
];
export const XP_MAX = 130, XP_TRAINED = 30, XP_NEW = 10;
export const xpOf = (d: Division) => d.xp ?? XP_TRAINED;
export function xpLevel(d: Division) {
  let l = 0;
  XP_LEVELS.forEach((x, i) => xpOf(d) >= x.at && (l = i));
  return l;
}
/** Güte, mit der ein Verband kämpft: Gliederung und Staat plus Erfahrung. */
export const effQ = (d: Division) => d.q + XP_LEVELS[xpLevel(d)].q;
/** Höchststärke eines Bataillons: 10, ab „kampferprobt“ 11, als Elite 12. */
export const maxS = (d: Division) => 10 + Math.max(0, xpLevel(d) - 1);
export const maxStrength = (d: Division) => d.units.length * maxS(d);
export function gainXp(d: Division, n: number) {
  const before = maxS(d);
  d.xp = Math.min(XP_MAX, xpOf(d) + n);
  // mit der höheren Stufe wächst der Verband auch an Stärke
  const up = maxS(d) - before;
  if (up > 0) for (const u of d.units) u.s = Math.min(maxS(d), u.s + up);
}
/** Ersatz verwässert die Kampferfahrung: was über dem Stand der Ausbildung liegt, schrumpft mit dem Anteil der Neuen. */
export function diluteXp(d: Division, added: number) {
  const xp = xpOf(d);
  if (added <= 0 || xp <= XP_TRAINED || !d.units.length) return;
  d.xp = XP_TRAINED + (xp - XP_TRAINED) * (1 - Math.min(1, (0.6 * added) / (d.units.length * 10)));
  for (const u of d.units) u.s = Math.min(u.s, maxS(d));
}
/** Ausbildung ohne Kampf bringt einen neuen Verband in etwa vier Monaten auf den Stand „ausgebildet“, weiter nicht. */
export function trainXp(d: Division, days: number) {
  if (xpOf(d) < XP_TRAINED && !d.fought) d.xp = Math.min(XP_TRAINED, xpOf(d) + days / 6);
}

export function airAt(g: GameState, side: Side, prov: string) {
  let f = 0, b = 0;
  for (const [s, a] of Object.entries(g.airAssign[side]))
    if (s === prov || PROV[s].adj.includes(prov)) (f += a.f), (b += a.b);
  // gezählt werden Staffeln; die Güte der Muster geht als Kampfwert in die Abschusschancen und den Bombenschaden ein
  return { f, b };
}
/** Kampfwert der Flugzeuge einer Seite auf einer Skala, auf der 10 dem Durchschnitt entspricht (Polen 1939: beide Seiten 10). */
export const airVal = (g: GameState, side: Side, kind: 'f' | 'b') => Math.round(10 * (g.airQ?.[side][kind] ?? 1));

export function airFree(g: GameState, side: Side) {
  let f = g.air[side].f, b = g.air[side].b;
  for (const a of Object.values(g.airAssign[side])) (f -= a.f), (b -= a.b);
  return { f, b };
}

export function assignAir(g: GameState, side: Side, prov: string, kind: 'f' | 'b', delta: 1 | -1) {
  if (delta > 0 && hooks.air && !hooks.air(g, side, prov)) return;
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
export const isFree = (d: Division) => d.mp > 0 && !d.order && !d.follow && !d.done;

/**
 * Wer gemeinsam zieht: eine Armee des Spielers bleibt zusammen, also der Verband mit seinen Armeekameraden
 * in derselben Provinz. Die Armeen der KI-Mächte sind nicht gebunden.
 */
export function group(g: GameState, d: Division): Division[] {
  const a = d.arm ? g.eu?.armies?.find(x => x.id === d.arm) : undefined;
  return a && !a.nation ? g.divs.filter(x => x.arm === d.arm && x.prov === d.prov) : [d];
}
/** Hat noch Bewegungspunkte, kann sie aber nicht nutzen, weil ein Verband seiner Armee keine mehr hat. */
export const bound = (g: GameState, d: Division) => d.mp > 0 && group(g, d).some(x => x.mp < 1);
/** Befehle gelten für die ganze Armee: Hat sie nicht jeder Verband, verfallen sie für alle. */
function syncGroups(g: GameState) {
  for (const d of g.divs) {
    if (!d.arm) continue;
    const grp = group(g, d);
    if (grp.some(x => x.order !== d.order)) for (const x of grp) x.order = null;
    if (grp.some(x => x.follow !== d.follow)) for (const x of grp) x.follow = null;
  }
}

// ---- Bewegung -------------------------------------------------------------

export interface MoveTarget { prov: string; attack: boolean; kind?: 'sea' | 'rail' | 'follow'; zone?: string }

/** Ziele eines Verbands; far = auch Seetransport und Bahnverlegung (nur Europa). */
export function moveTargets(g: GameState, d: Division, far = true): MoveTarget[] {
  // eine Armee zieht nur geschlossen: jeder Verband braucht Bewegungspunkte, und das Ziel muss alle aufnehmen
  const grp = group(g, d), n = grp.length;
  if (grp.some(x => x.mp < 1 || x.order || x.follow)) return [];
  const out: MoveTarget[] = [];
  for (const a of PROV[d.prov].adj) {
    if (g.ctrl[a] === 'NEU') continue;
    const attack = divsIn(g, a, other(d.side)).length > 0;
    if (!attack && divsIn(g, a, d.side).length + n > STACK) {
      // volle Provinz: für jeden Verband, der von dort abrückt, darf einer nachrücken
      if (d.side === g.player && g.ctrl[a] === d.side && followRoom(g, a, d.side) >= n) out.push({ prov: a, attack: false, kind: 'follow' });
      continue;
    }
    out.push({ prov: a, attack });
  }
  if (far && g.eu && hooks.targets) {
    const lists = grp.map(x => hooks.targets!(g, x, n));
    out.push(...lists[0].filter(t => lists.every(l => l.some(o => o.prov === t.prov && o.kind === t.kind))));
  }
  return out;
}

/** Wie viele Verbände noch in eine Provinz nachrücken dürfen: so viele, wie von dort abrücken sollen. */
export function followRoom(g: GameState, prov: string, side: Side) {
  let n = STACK - divsIn(g, prov, side).length;
  for (const d of g.divs) {
    if (d.side !== side) continue;
    if (d.prov === prov && (d.order || d.follow)) n++;
    if (d.follow === prov) n--;
  }
  return n;
}

/** Streicht Nachrück-Befehle, denen der Platz fehlt, weil ein Angriff abgebrochen wurde. */
export function pruneFollows(g: GameState) {
  syncGroups(g);
  for (let again = true; again; ) {
    again = false;
    for (const d of [...g.divs].reverse())
      if (d.follow && followRoom(g, d.follow, d.side) < 0) {
        for (const x of group(g, d)) x.follow = null;
        again = true;
      }
  }
}

/** Nach den Schlachten: Wer nachrücken soll, zieht ein, soweit die Provinz noch eigen und Platz frei ist. */
export function runFollows(g: GameState, side: Side) {
  for (let again = true; again; ) {
    again = false;
    for (const d of g.divs) {
      const to = d.follow;
      if (!to || d.side !== side || d.order || d.mp < 1) continue;
      const grp = group(g, d).filter(x => x.follow === to);
      if (g.ctrl[to] !== side || divsIn(g, to, other(side)).length || divsIn(g, to, side).length + grp.length > STACK) continue;
      for (const x of grp) (x.follow = null), enter(g, x, to);
      again = true;
    }
  }
  for (const d of g.divs) if (d.side === side) d.follow = null;
}

/**
 * Sofortige Bewegung in eine Provinz ohne Feind; Angriffe und Nachrücken werden nur vorgemerkt.
 * Gehört der Verband zu einer Armee des Spielers, gilt der Befehl für die ganze Armee.
 */
export function orderMove(g: GameState, d: Division, to: string): 'moved' | 'attack' | 'follow' | null {
  const t = moveTargets(g, d, !PROV[d.prov].adj.includes(to)).find(m => m.prov === to);
  if (!t) return null;
  let res: ReturnType<typeof orderMove> = null;
  for (const x of group(g, d)) res = orderOne(g, x, to, t);
  return res;
}

function orderOne(g: GameState, d: Division, to: string, t: MoveTarget): 'moved' | 'attack' | 'follow' {
  if (t.kind === 'follow') {
    d.follow = to;
    return 'follow';
  }
  if (t.attack) {
    d.order = to;
    d.sea = t.kind === 'sea';
    d.seaZ = t.zone;
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
  from?: string; // Provinz, aus der dieser Angriff kommt
  picked?: boolean; // der Spieler hat die kämpfenden Verteidiger selbst bestimmt
}

export function collectBattles(g: GameState, side: Side): PendingBattle[] {
  // Jede Richtung führt ihren eigenen Angriff: Wird ein Ziel aus mehreren Provinzen angegriffen, folgen die Angriffe
  // aufeinander, der stärkste zuerst. Wer danach noch im Ziel steht, muss sich dem nächsten stellen.
  const by = new Map<string, Division[]>();
  for (const d of g.divs)
    if (d.side === side && d.order) {
      const k = `${d.order}|${d.prov}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(d);
    }
  const out: PendingBattle[] = [];
  const pw = (a: Division, b: Division) => divPower(b) - divPower(a);
  for (const [k, all] of by) {
    const [prov, from] = k.split('|');
    all.sort(pw);
    const en = divsIn(g, prov, other(side)).sort(pw);
    out.push({
      prov, side, from,
      attackers: all.slice(0, BATTLE_MAX), followers: all.slice(BATTLE_MAX),
      defenders: en.slice(0, BATTLE_MAX), reserve: en.slice(BATTLE_MAX),
    });
  }
  const sum = (pb: PendingBattle) => pb.attackers.reduce((a, d) => a + divPower(d), 0);
  return out.sort((a, b) => PROV[b.prov].vp - PROV[a.prov].vp || a.prov.localeCompare(b.prov) || sum(b) - sum(a));
}

function retreatTarget(g: GameState, d: Division, from: string, n = 1): string | null {
  const cap = PROV[(g.eu && hooks.capital?.(g, d)) || CAPITAL[d.side]];
  let best: string | null = null, bs = -Infinity;
  for (const a of PROV[from].adj) {
    if (g.ctrl[a] !== d.side || divsIn(g, a, other(d.side)).length) continue;
    if (divsIn(g, a, d.side).length + n > STACK) continue;
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
  // Die Geschlagenen weichen aus, jeder Verband für sich; eine Armee wird dabei geteilt, nicht aufgelöst.
  // Wer keinen Platz findet, weil alle Nachbarprovinzen voll sind, bleibt stehen und verliert je Bataillon zwei Stärke.
  // Nur wer eingeschlossen ist oder sich nicht bewegen kann, kapituliert.
  let stay = 0;
  for (const d of divsIn(g, pb.prov, other(pb.side))) {
    const to = tp(d).mp > 0 ? retreatTarget(g, d, pb.prov) : null;
    if (!to) {
      const way = tp(d).mp > 0 && PROV[pb.prov].adj.some(a => g.ctrl[a] === d.side && !divsIn(g, a, other(d.side)).length);
      if (way) {
        for (const u of d.units) u.s -= 2;
        d.units = d.units.filter(u => u.s > 0);
        d.dug = 0;
        d.order = null;
        if (d.units.length) { stay++; continue; }
        log(g, `${d.name} ist aufgerieben.`);
      } else log(g, `${d.name} kapituliert bei ${name}.`);
      g.divs.splice(g.divs.indexOf(d), 1);
      continue;
    }
    d.prov = to;
    d.dug = 0;
    d.moved = true;
    d.order = null;
    for (const u of d.units) u.s = Math.max(1, u.s - 1);
  }
  if (stay) {
    log(g, `${name}: Der Gegner ist geschlagen, aber ${stay} ${stay === 1 ? 'Verband findet' : 'Verbände finden'} keinen Raum zum Ausweichen und ${stay === 1 ? 'hält' : 'halten'} sich geschwächt.`);
    return;
  }
  const first = all.find(d => g.divs.includes(d));
  if (first) capture(g, pb.prov, first);
  else g.ctrl[pb.prov] = pb.side;
  if (!g.eu || PROV[pb.prov].vp) log(g, `${name} von ${WORDS[pb.side].by} genommen.`);
  // Armeen rücken geschlossen ein oder gar nicht
  const done = new Set<Division>();
  for (const d of all) {
    if (!g.divs.includes(d) || done.has(d)) continue;
    const grp = group(g, d).filter(x => all.includes(x));
    grp.forEach(x => done.add(x));
    if (divsIn(g, pb.prov, pb.side).length + grp.length > STACK) continue;
    for (const x of grp) {
      x.prov = pb.prov;
      x.moved = true;
      x.dug = 0;
    }
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
    else if (!d.fought) {
      const before = strength(d);
      for (const u of d.units) u.s = Math.min(maxS(d), u.s + 1);
      diluteXp(d, strength(d) - before);
    }
    d.units = d.units.filter(u => u.s > 0);
    if (!d.moved && !d.fought) d.dug = Math.min(3, d.dug + 1);
    d.mp = tp(d).mp;
    d.moved = d.fought = d.done = false;
    d.order = d.follow = null;
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
