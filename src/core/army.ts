// Armeen und ihre Generäle: bis zu acht Verbände unter einem Befehlshaber, dessen Stärken ihnen zugutekommen.
import type { Army, Division, GameState } from './types';
import { GENERAL, GENERALS, RANKS, RANK_MAX, TRAITS, type Trait, WINS_NEEDED } from '../data/generals';
import { TYPES, baseOf } from '../data/units';
import { log } from './game';

export const ARMY_MAX = 8;
const FAST = ['CAV', 'MOT', 'REC'];

export const armies = (g: GameState): Army[] => (g.eu ? (g.eu.armies ??= []) : []);
export const members = (g: GameState, a: Army) => g.divs.filter(d => d.arm === a.id);
export const armyOf = (g: GameState, d: Division) => (d.arm ? armies(g).find(a => a.id === d.arm) : undefined);
const mine = (d: Division) => d.side === 'GER' && (d.nation === 'GER' || !!d.ctl);

/** Rang und Siege eines Generals; ohne Eintrag gilt der Stand, mit dem er ins Spiel kommt. */
export function genState(g: GameState, id: string) {
  const s = (g.eu!.gens ??= {});
  return (s[id] ??= { rank: GENERAL[id].rank, wins: 0 });
}
export function rankName(g: GameState, id: string) {
  const r = genState(g, id).rank;
  return r === 3 ? `General der ${GENERAL[id].arm}` : RANKS[r];
}
/** Vorteile nach Rang: je Rang ein Punkt, in der Reihenfolge seines Werdegangs. */
export function traitsOf(g: GameState, id: string): Partial<Record<Trait, number>> {
  const out: Partial<Record<Trait, number>> = {};
  for (const t of GENERAL[id].path.slice(0, genState(g, id).rank)) out[t] = (out[t] ?? 0) + 1;
  return out;
}
export const traitText = (g: GameState, id: string) =>
  Object.entries(traitsOf(g, id)).map(([t, n]) => `${TRAITS[t as Trait].name} +${n}`).join(' · ');

/** Generäle, die schon im Rang stehen und keine Armee führen. */
export function freeGenerals(g: GameState) {
  const year = 1936 + g.eu!.day / 365.25, used = new Set(armies(g).map(a => a.gen));
  return GENERALS.filter(x => x.from <= year && !used.has(x.id));
}

/** Löst leere Armeen auf; ihr General ist wieder frei. */
export function pruneArmies(g: GameState) {
  if (!g.eu?.armies) return;
  const live = new Set(g.divs.map(d => d.arm));
  g.eu.armies = g.eu.armies.filter(a => live.has(a.id));
  for (const d of g.divs) if (d.arm && (!mine(d) || !g.eu.armies.some(a => a.id === d.arm))) d.arm = undefined;
}

export function formArmy(g: GameState, divs: Division[]): Army | null {
  const ds = divs.filter(mine).slice(0, ARMY_MAX);
  if (!g.eu || !ds.length) return null;
  const no = (g.eu.armyNo = (g.eu.armyNo ?? 0) + 1), a: Army = { id: no, name: `${no}. Armee`, gen: null };
  armies(g).push(a);
  for (const d of ds) d.arm = a.id;
  pruneArmies(g);
  return a;
}
export function joinArmy(g: GameState, a: Army, divs: Division[]) {
  let room = ARMY_MAX - members(g, a).length;
  for (const d of divs) if (mine(d) && d.arm !== a.id && room-- > 0) d.arm = a.id;
  pruneArmies(g);
}
export function leaveArmy(g: GameState, divs: Division[]) {
  for (const d of divs) d.arm = undefined;
  pruneArmies(g);
}
export function setGeneral(g: GameState, a: Army, id: string | null) {
  if (id && !freeGenerals(g).some(x => x.id === id)) return;
  a.gen = id;
}

/** Vorteile, die ein Verband von seinem General hat. */
export function bonus(g: GameState, d: Division): Partial<Record<Trait, number>> | null {
  const gen = g.eu && armyOf(g, d)?.gen;
  return gen ? traitsOf(g, gen) : null;
}
/** Zuschlag auf Angriff und Abwehr eines Bataillons. */
export function unitBonus(g: GameState, d: Division, t: string) {
  const b = bonus(g, d);
  if (!b) return { a: 0, d: 0 };
  const cls: Trait | null = TYPES[t].hard ? 'pz' : FAST.includes(baseOf(t)) ? 'kav' : TYPES[baseOf(t)].cat === 'inf' ? 'inf' : null;
  const x = cls ? b[cls] ?? 0 : 0;
  return { a: (b.att ?? 0) + x, d: (b.def ?? 0) + x };
}

/** Ein gewonnenes Gefecht zählt für jeden General, dessen Armee beteiligt war; genug Siege bringen die Beförderung. */
export function creditWin(g: GameState, divs: Division[]) {
  if (!g.eu) return;
  for (const id of new Set(divs.map(d => armyOf(g, d)?.gen).filter(Boolean) as string[])) {
    const s = genState(g, id);
    s.wins++;
    if (s.rank >= RANK_MAX || s.wins < WINS_NEEDED[s.rank]) continue;
    const gained = GENERAL[id].path[s.rank];
    s.rank++;
    s.wins = 0;
    const text = `${GENERAL[id].name} wird zum ${rankName(g, id)} befördert (${TRAITS[gained].name} +1).`;
    log(g, text);
    g.eu.news.push({ title: 'Beförderung', text: `${text} Seine Vorteile jetzt: ${traitText(g, id)}.` });
  }
}
