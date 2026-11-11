// Marine, bewusst einfach: Flotten stehen nicht als Einheiten auf der Karte, sondern werden Seegebieten
// zugeteilt. Aus den Flotten beider Seiten ergibt sich je Seegebiet die Seeherrschaft; sie bestimmt die
// Verluste bei Überfahrten und den Nachschub über See. Transporter tragen Verbände und Nachschub,
// U-Boote führen den Handelskrieg, Überwasserschiffe kämpfen um die Seeherrschaft.
// Die Zahlen sind eigene Näherungen des historischen Bestands (Zerstörer und U-Boote in Flottillen).
import type { GameState, NavyState, Ships } from './types';
import { PLIST } from '../data/world';
import { COUNTRIES } from '../data/europa';
import { log } from './game';
import { RNG } from './rng';

export type ShipKind = keyof Ships;
export const SHIP_KINDS: ShipKind[] = ['tr', 'ub', 'dd', 'bb', 'cv'];
/** cost = Industrietage der Werften, str = Kampfkraft im Seegefecht. */
export const SHIPS: Record<ShipKind, { name: string; plural: string; cost: number; str: number; tech?: string; text: string }> = {
  tr: { name: 'Transportflotte', plural: 'Transportflotten', cost: 220, str: 0, text: 'trägt je Runde einen Verband über See und sichert den Nachschub über See' },
  ub: { name: 'U-Boot-Flottille', plural: 'U-Boot-Flottillen', cost: 320, str: 1.5, text: 'versenkt feindlichen Schiffsraum und bremst so den Aufbau des Gegners' },
  dd: { name: 'Zerstörerflottille', plural: 'Zerstörerflottillen', cost: 650, str: 3, text: 'Geleit und leichte Seestreitkräfte' },
  bb: { name: 'Schlachtschiff', plural: 'Schlachtschiffe', cost: 2400, str: 10, text: 'Rückgrat der Schlachtflotte' },
  cv: { name: 'Flugzeugträger', plural: 'Flugzeugträger', cost: 3000, str: 4, tech: 'cv3', text: 'voll wirksam nur mit zwei Staffeln Trägerflugzeugen je Träger' },
};
export const ZONE_NAME: Record<string, string> = {
  H: 'Im Hafen', N: 'Nordsee und Atlantik', B: 'Ostsee', M: 'Mittelmeer', S: 'Schwarzes Meer', Z: 'Pazifik', I: 'Indischer Ozean',
};
const none = (): Ships => ({ tr: 0, ub: 0, dd: 0, bb: 0, cv: 0 });
const S = (bb: number, cv: number, dd: number, ub: number, tr: number): Ships => ({ tr, ub, dd, bb, cv });

/** Flotten der übrigen Staaten um 1936–1939 und ihre Verteilung auf die Seegebiete. */
const FLEETS: Record<string, { ships: Ships; at: Record<string, number> }> = {
  ENG: { ships: S(15, 6, 34, 11, 30), at: { N: 0.5, M: 0.3, I: 0.1, Z: 0.1 } },
  FRA: { ships: S(7, 1, 14, 15, 8), at: { N: 0.4, M: 0.6 } },
  ITA: { ships: S(4, 0, 20, 21, 8), at: { M: 1 } },
  SOV: { ships: S(3, 0, 6, 30, 4), at: { B: 0.4, S: 0.3, N: 0.1, Z: 0.2 } },
  USA: { ships: S(15, 5, 40, 20, 30), at: { N: 0.4, Z: 0.6 } },
  JAP: { ships: S(10, 8, 22, 12, 15), at: { Z: 0.9, I: 0.1 } },
  NLD: { ships: S(0, 0, 2, 4, 3), at: { N: 0.4, I: 0.3, Z: 0.3 } },
  POL: { ships: S(0, 0, 1, 1, 0), at: { B: 1 } },
  NOR: { ships: S(0, 0, 1, 1, 2), at: { N: 1 } },
  SWE: { ships: S(0, 0, 3, 3, 2), at: { B: 1 } },
  DNK: { ships: S(0, 0, 1, 1, 1), at: { B: 0.5, N: 0.5 } },
  SPA: { ships: S(2, 0, 3, 2, 2), at: { M: 0.6, N: 0.4 } },
  GRC: { ships: S(0, 0, 2, 1, 1), at: { M: 1 } },
  TUR: { ships: S(1, 0, 1, 1, 1), at: { M: 0.5, S: 0.5 } },
  ROM: { ships: S(0, 0, 1, 0, 0), at: { S: 1 } },
};

/** Deutsche Flotte am 1. Januar 1936: drei Panzerschiffe, erste Zerstörer und U-Boote; zwei Schlachtschiffe auf den Helgen. */
export function initNavy(g: GameState): NavyState {
  const eu = g.eu!, zones = zonesOf();
  const other: Record<string, Ships> = {};
  for (const c of Object.keys(FLEETS)) if (eu.rel[c] !== undefined) other[c] = { ...FLEETS[c].ships };
  const own: Record<string, Ships> = { H: S(3, 0, 2, 3, 0) };
  for (const z of zones) own[z] = none();
  own.N.tr = 2;
  own.B.tr = 2;
  return {
    own, other, used: {}, sunk: 0, lostUb: 0, airT: 0,
    yard: [{ k: 'bb', name: 'Scharnhorst', prog: 0.35 * SHIPS.bb.cost }, { k: 'bb', name: 'Gneisenau', prog: 0.3 * SHIPS.bb.cost }],
  };
}
/** Ältere Spielstände kennen noch keine Marine. */
export function ensureNavy(g: GameState): NavyState {
  const eu = g.eu!;
  eu.navy ??= initNavy(g);
  for (const z of zonesOf()) eu.navy.own[z] ??= none();
  return eu.navy;
}

let zoneCache: { n: number; z: string[] } | null = null;
/** Seegebiete der aktiven Karte. */
export function zonesOf(): string[] {
  if (zoneCache?.n === PLIST.length) return zoneCache.z;
  const set = new Set<string>();
  for (const p of PLIST) for (const s of p.sea ?? '') set.add(s);
  const z = ['N', 'B', 'M', 'S', 'Z', 'I'].filter(s => set.has(s));
  zoneCache = { n: PLIST.length, z };
  return z;
}

const rel = (g: GameState, c: string) => (g.eu!.gone.includes(c) ? 'X' : g.eu!.rel[c] ?? 'N');
/** Hat die Achse in diesem Seegebiet einen Hafen, von dem deutsche Schiffe auslaufen können? */
export const canBase = (g: GameState, z: string) => z === 'H' || PLIST.some(p => p.port && g.ctrl[p.id] === 'GER' && p.sea!.includes(z));

/** Kampfkraft einer Flotte. Träger ohne Flugzeuge sind kaum etwas wert. */
function power(s: Ships, air = 1) {
  return s.bb * SHIPS.bb.str + s.dd * SHIPS.dd.str + s.cv * (SHIPS.cv.str + 10 * air);
}
/** Anteil der deutschen Träger, der ein volles Geschwader (zwei Staffeln) an Bord hat. */
export function carrierAir(g: GameState) {
  const n = ensureNavy(g), cv = Object.values(n.own).reduce((a, s) => a + s.cv, 0);
  return cv ? Math.min(1, n.airT / (2 * cv)) : 0;
}
/** Schiffe der anderen Staaten einer Seite in einem Seegebiet (Bruchteile nach ihrer Verteilung). */
function foreign(g: GameState, z: string, side: 'A' | 'E'): Ships {
  const n = ensureNavy(g), out = none();
  for (const [c, s] of Object.entries(n.other)) {
    if (rel(g, c) !== side) continue;
    const share = FLEETS[c]?.at[z] ?? 0;
    for (const k of SHIP_KINDS) out[k] += s[k] * share;
  }
  return out;
}
export function strengthIn(g: GameState, z: string) {
  const n = ensureNavy(g), ally = foreign(g, z, 'A'), foe = foreign(g, z, 'E');
  const own = n.own[z] ?? none();
  return { axis: power(own, carrierAir(g)) + power(ally), enemy: power(foe), own, ally, foe };
}
/** Seeherrschaft der Achse in einem Seegebiet, 0–1. Ohne Gegner gehört die See dem, der sie befährt. */
export function control(g: GameState, z: string): number {
  const s = strengthIn(g, z);
  if (s.enemy <= 0) return 1;
  return s.axis / (s.axis + s.enemy);
}

/** Freie Transportflotten in einem Seegebiet; jeder Verband, der in dieser Runde über See geht, belegt eine. */
export function transportsFree(g: GameState, z: string) {
  const n = ensureNavy(g);
  const used = g.divs.filter(d => d.sea && d.seaZ === z && (d.order || d.moved) && (d.nation === 'GER' || d.ctl)).length;
  return Math.floor(n.own[z]?.tr ?? 0) - used;
}
/** Kann die Achse in diesem Seegebiet Nachschub über See führen? Verbündete Flotten zählen mit. */
export const canShip = (g: GameState, z: string) => (ensureNavy(g).own[z]?.tr ?? 0) >= 1 || foreign(g, z, 'A').tr >= 1;

/** Gefahr für eine Überfahrt (0–1): je schwächer die eigene Seeherrschaft, desto höher die Verluste. */
export function crossingRisk(g: GameState, z: string, side: 'GER' | 'POL') {
  const c = control(g, z), s = strengthIn(g, z);
  if (side === 'GER') return s.enemy > 0 ? 0.6 * (1 - c) : 0;
  return s.axis > 0 ? 0.6 * c : 0;
}
/** Ein deutscher Transporter geht bei einer verlustreichen Überfahrt verloren. */
export function loseTransport(g: GameState, z: string) {
  const own = ensureNavy(g).own[z];
  if (own && own.tr >= 1) (own.tr--, log(g, `Eine Transportflotte geht verloren (${ZONE_NAME[z]}).`));
}

export function orderShip(g: GameState, k: ShipKind) {
  const n = ensureNavy(g);
  n.num ??= {};
  n.num[k] = (n.num[k] ?? 0) + 1;
  n.yard.push({ k, name: `${SHIPS[k].name} ${n.num[k]}`, prog: 0 });
}
/** Verlegt Schiffe zwischen zwei Seegebieten (oder dem Hafen). */
export function moveShips(g: GameState, k: ShipKind, from: string, to: string, count: number) {
  const n = ensureNavy(g);
  if (!n.own[from] || !n.own[to] || !canBase(g, to)) return;
  const c = Math.min(count, Math.floor(n.own[from][k]));
  n.own[from][k] -= c;
  n.own[to][k] += c;
}

/** Werftarbeit: die Industrietage verteilen sich auf die beiden ältesten Aufträge. */
export function buildShips(g: GameState, ikDays: number) {
  const n = ensureNavy(g), act = n.yard.slice(0, 2);
  for (const o of act) {
    o.prog += ikDays / act.length;
    if (o.prog < SHIPS[o.k].cost) continue;
    n.yard.splice(n.yard.indexOf(o), 1);
    n.own.H[o.k]++;
    const text = `${o.name} ist in Dienst gestellt und liegt im Hafen. Unter Reich verwalten → Marine teilen Sie das Schiff einem Seegebiet zu.`;
    g.eu!.news.push({ title: `In Dienst gestellt: ${o.name}`, text });
    log(g, `${o.name} in Dienst gestellt.`);
  }
}

/** Eine Runde auf See: Gefechte um die Seeherrschaft, Handelskrieg der U-Boote, Zuwachs der gegnerischen Flotten. */
export function navyTick(g: GameState, days: number, war: boolean) {
  const eu = g.eu!, n = ensureNavy(g), rng = new RNG((g.seed + eu.day * 977 + 5) >>> 0), wk = days / 7;
  const year = new Date(Date.UTC(1936, 0, 1 + eu.day)).getUTCFullYear();
  // Zuwachs der großen Flotten
  for (const [c, per] of [['ENG', 110], ['USA', 21], ['JAP', 120]] as const) {
    const s = n.other[c];
    if (!s || rel(g, c) === 'X' || (c === 'USA' && rel(g, c) !== 'E')) continue;
    if (rng.next() < days / per) s.dd++;
    if (rng.next() < days / (per * 8)) s.cv++;
    if (rng.next() < days / (per * 12)) s.bb++;
  }
  if (!war) return;
  const lossNames: string[] = [];
  for (const z of zonesOf()) {
    const s = strengthIn(g, z), own = n.own[z];
    // Seegefechte: wer auf See steht, verliert Schiffe im Verhältnis zur Übermacht des Gegners
    if (s.axis > 0 && s.enemy > 0) {
      const pOwn = Math.min(0.25, (0.03 * s.enemy) / (s.axis + 1)) * wk, pFoe = Math.min(0.25, (0.03 * s.axis) / (s.enemy + 1)) * wk;
      for (const k of ['dd', 'bb', 'cv'] as ShipKind[])
        for (let i = Math.floor(own[k]); i > 0; i--)
          if (rng.next() < pOwn) (own[k]--, lossNames.push(`${SHIPS[k].name} (${ZONE_NAME[z]})`));
      let sunk = 0;
      for (const [c, f] of Object.entries(n.other)) {
        if (rel(g, c) !== 'E') continue;
        const share = FLEETS[c]?.at[z] ?? 0;
        for (const k of ['dd', 'bb', 'cv'] as ShipKind[])
          for (let i = Math.round(f[k] * share); i > 0; i--) if (f[k] >= 1 && rng.next() < pFoe) (f[k]--, sunk++);
      }
      if (sunk && power(own, carrierAir(g)) > 0) log(g, `Seegefecht (${ZONE_NAME[z]}): ${sunk} feindliche ${sunk === 1 ? 'Einheit' : 'Einheiten'} versenkt.`);
    }
    // Handelskrieg: U-Boote gegen die Zufuhr der Seemächte, Geleitschutz und Ortung werden ab 1943 übermächtig
    const ub = Math.floor(own.ub), trade = (['ENG', 'USA'] as const).filter(c => rel(g, c) === 'E' && (FLEETS[c].at[z] ?? 0) > 0 && n.other[c]);
    if (ub > 0 && trade.length) {
      const tech = (eu.eco.done.includes('ub1') ? 1.25 : 1) * (eu.eco.done.includes('ub2') ? 1.5 : 1);
      const era = year <= 1941 ? 1 : year === 1942 ? 0.9 : year === 1943 ? 0.45 : 0.25;
      const sunk = ub * tech * era * wk * (0.7 + 0.6 * rng.next());
      n.sunk += sunk;
      // versenkter Schiffsraum fehlt beim Aufbau neuer Verbände
      eu.pts.ENG = Math.max(-200, (eu.pts.ENG ?? 0) - sunk * 4);
      const pLoss = Math.min(0.15, (0.008 + 0.0015 * s.foe.dd) * (year >= 1943 ? 3 : 1) * (eu.eco.done.includes('ub2') ? 0.6 : 1)) * wk;
      for (let i = ub; i > 0; i--) if (rng.next() < pLoss) (own.ub--, n.lostUb++, lossNames.push(`U-Boot-Flottille (${ZONE_NAME[z]})`));
    }
  }
  if (lossNames.length) {
    log(g, `Verluste zur See: ${lossNames.join(', ')}.`);
    // eigene Meldung nur für die großen Schiffe, sonst genügt die Zeile im Verlauf
    if (lossNames.some(l => /Schlachtschiff|Flugzeugträger/.test(l))) eu.news.push({ title: 'Verluste zur See', text: `Verloren: ${lossNames.join(', ')}. Schiffe im Hafen sind sicher; auf See entscheidet das Kräfteverhältnis (Reich verwalten → Marine).` });
  }
}

/** Ein Staat scheidet aus: seine Flotte zählt nicht mehr. */
export const fleetOf = (g: GameState, c: string) => ensureNavy(g).other[c];
export const fleetNations = (g: GameState) => Object.keys(ensureNavy(g).other).filter(c => rel(g, c) !== 'X' && COUNTRIES[c]);
export const fleetShare = (c: string, z: string) => FLEETS[c]?.at[z] ?? 0;
