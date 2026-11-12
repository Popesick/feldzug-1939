// Armeen und ihre Generäle: bis zu acht Verbände unter einem Befehlshaber, dessen Stärken ihnen zugutekommen.
import type { Army, Division, GameState } from './types';
import { GENERAL, GENERALS, GENERAL_NATIONS, RANKS_OF, TRAITS, type Trait, WINS_NEEDED } from '../data/generals';
import { PROV } from '../data/world';
import { TYPES, baseOf } from '../data/units';
import { log } from './game';

export const ARMY_MAX = 8;
export const GEN_DAYS = 7; // so lange ist ein neu zugeteilter General unterwegs
const FAST = ['CAV', 'MOT', 'REC'];

export const armies = (g: GameState): Army[] => (g.eu ? (g.eu.armies ??= []) : []);
/** Armeen des Spielers; die der übrigen Mächte führt die KI. */
export const ownArmies = (g: GameState) => armies(g).filter(a => !a.nation);
export const members = (g: GameState, a: Army) => g.divs.filter(d => d.arm === a.id);
export const armyOf = (g: GameState, d: Division) => (d.arm ? armies(g).find(a => a.id === d.arm) : undefined);
const mine = (d: Division) => d.side === 'GER' && (d.nation === 'GER' || !!d.ctl);

/** Rang und Siege eines Generals; ohne Eintrag gilt der Stand, mit dem er ins Spiel kommt. */
export function genState(g: GameState, id: string) {
  const s = (g.eu!.gens ??= {});
  return (s[id] ??= { rank: GENERAL[id].rank, wins: 0 });
}
export const maxRank = (id: string) => RANKS_OF[GENERAL[id].nat].length - 1;
export const rankTitle = (id: string, r: number) => (GENERAL[id].nat === 'GER' && r === 3 ? `General der ${GENERAL[id].arm}` : RANKS_OF[GENERAL[id].nat][r]);
export const rankName = (g: GameState, id: string) => rankTitle(id, genState(g, id).rank);
/** Vorteile nach Rang: je Rang ein Punkt, in der Reihenfolge seines Werdegangs. */
export function traitsOf(g: GameState, id: string): Partial<Record<Trait, number>> {
  const out: Partial<Record<Trait, number>> = {};
  for (const t of GENERAL[id].path.slice(0, genState(g, id).rank)) out[t] = (out[t] ?? 0) + 1;
  return out;
}
export const traitText = (g: GameState, id: string) =>
  Object.entries(traitsOf(g, id)).map(([t, n]) => `${TRAITS[t as Trait].name} +${n}`).join(' · ');

/** Generäle, die schon im Rang stehen und keine Armee führen. */
export function freeGenerals(g: GameState, nat = 'GER') {
  const year = 1936 + g.eu!.day / 365.25, used = new Set(armies(g).map(a => a.gen));
  return GENERALS.filter(x => x.nat === nat && x.from <= year && !used.has(x.id));
}

/** Löst leere Armeen auf; ihr General ist wieder frei. */
export function pruneArmies(g: GameState) {
  if (!g.eu?.armies) return;
  for (const d of g.divs) {
    const a = d.arm ? g.eu.armies.find(x => x.id === d.arm) : undefined;
    if (d.arm && !(a && (a.nation ? d.nation === a.nation && !d.ctl : mine(d)))) d.arm = undefined;
  }
  const live = new Set(g.divs.map(d => d.arm));
  g.eu.armies = g.eu.armies.filter(a => live.has(a.id));
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
  if (id && !freeGenerals(g, a.nation ?? 'GER').some(x => x.id === id)) return;
  if (id === a.gen) return;
  a.gen = id;
  a.genAt = id && !a.nation ? g.eu!.day + GEN_DAYS : undefined;
}
/** Der General ist zugeteilt, aber noch auf dem Weg zu seiner Armee. */
export const inTransfer = (g: GameState, a: Army) => !!a.gen && (a.genAt ?? 0) > g.eu!.day;
/** General, der die Armee eines Verbands tatsächlich führt. */
function leader(g: GameState, d: Division) {
  const a = g.eu && armyOf(g, d);
  return a && a.gen && !inTransfer(g, a) ? a.gen : null;
}

/** Vorteile, die ein Verband von seinem General hat. */
export function bonus(g: GameState, d: Division): Partial<Record<Trait, number>> | null {
  const gen = leader(g, d);
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
  for (const id of new Set(divs.map(d => leader(g, d)).filter(Boolean) as string[])) {
    const s = genState(g, id);
    s.wins++;
    if (s.rank >= maxRank(id) || s.wins < WINS_NEEDED[s.rank]) continue;
    const gained = GENERAL[id].path[s.rank];
    s.rank++;
    s.wins = 0;
    const text = `${GENERAL[id].name} wird zum ${rankName(g, id)} befördert (${TRAITS[gained].name} +1).`;
    log(g, text);
    if (GENERAL[id].nat === 'GER') g.eu.news.push({ title: 'Beförderung', text: `${text} Seine Vorteile jetzt: ${traitText(g, id)}.` });
  }
}

/** Namen der Generäle, deren Armeen an einem Gefecht beteiligt sind. */
export const commanders = (g: GameState, divs: Division[]) =>
  [...new Set(divs.map(d => leader(g, d)).filter(Boolean) as string[])].map(id => `${rankName(g, id)} ${GENERAL[id].name}`);

/** Die KI fasst die Verbände der Großmächte zu Armeen zusammen und stellt sie unter ihre Generäle, die ranghöchsten zuerst. */
export function aiArmies(g: GameState) {
  const eu = g.eu;
  if (!eu) return;
  for (const nat of GENERAL_NATIONS) {
    if (eu.gone.includes(nat) || (eu.rel[nat] ?? 'N') === 'N') continue;
    const ds = g.divs.filter(d => d.nation === nat && !d.ctl), list = () => armies(g).filter(a => a.nation === nat);
    if (!ds.length) continue;
    const size = (a: Army) => ds.filter(d => d.arm === a.id).length;
    const limit = list().filter(a => a.gen).length + freeGenerals(g, nat).length;
    for (const d of ds) {
      if (d.arm) continue;
      const open = list().filter(a => size(a) < ARMY_MAX), near = (a: Army, ps: string[]) => ds.some(x => x.arm === a.id && ps.includes(x.prov));
      let a = open.find(a => near(a, [d.prov])) ?? open.find(a => near(a, PROV[d.prov].adj));
      if (!a && list().length < limit) {
        const no = (eu.armyNo = (eu.armyNo ?? 0) + 1);
        armies(g).push((a = { id: no, name: `${list().length + 1}. Armee`, gen: null, nation: nat }));
      }
      a ??= open[0];
      if (a) d.arm = a.id;
    }
    const free = freeGenerals(g, nat).sort((a, b) => genState(g, b.id).rank - genState(g, a.id).rank);
    for (const a of list().filter(a => !a.gen).sort((a, b) => size(b) - size(a))) a.gen = free.shift()?.id ?? null;
  }
}
