// Strategische KI: Deutschland greift an, Polen verteidigt und weicht notfalls aus.
import type { Division, GameState, Side } from './types';
import { other } from './types';
import { PLIST, PROV } from '../data/world';
import { BATTLE_MAX, STACK, assignAir, defenseMult, divPower, divsIn, orderMove } from './game';

/** Breitensuche über alle nicht neutralen Provinzen, ausgehend von mehreren Startpunkten. */
export function distMap(g: GameState, starts: string[], pass: (id: string) => boolean = () => true): Record<string, number> {
  const dist: Record<string, number> = {};
  const q = [...starts];
  for (const s of starts) dist[s] = 0;
  for (let i = 0; i < q.length; i++)
    for (const a of PROV[q[i]].adj)
      if (!(a in dist) && g.ctrl[a] !== 'NEU' && pass(a)) (dist[a] = dist[q[i]] + 1), q.push(a);
  return dist;
}

export const sumPower = (ds: Division[]) => ds.reduce((a, d) => a + divPower(d), 0);

export type Pick = (d: Division) => boolean;
const ANY: Pick = () => true;

export function planAttacks(g: GameState, side: Side, need: number, homeOnly: boolean, pick: Pick = ANY, allow: (prov: string) => boolean = () => true) {
  const en = other(side);
  // der Verteidiger stößt nur auf eigenem Boden zurück, nicht über die Grenze
  const targets = PLIST.filter(p => g.ctrl[p.id] === en && divsIn(g, p.id, en).length && (!homeOnly || p.side0 === side) && allow(p.id))
    .sort((a, b) => b.vp - a.vp);
  for (const t of targets) {
    const cand = t.adj.flatMap(a => divsIn(g, a, side)).filter(d => d.mp > 0 && !d.order && pick(d))
      .sort((a, b) => divPower(b) - divPower(a));
    if (!cand.length) continue;
    const defs = divsIn(g, t.id, en).sort((a, b) => divPower(b) - divPower(a)).slice(0, BATTLE_MAX);
    const dug = defs.reduce((a, d) => a + d.dug, 0) / defs.length;
    const def = sumPower(defs) * defenseMult(t.id) * (1 + 0.12 * dug);
    const att = cand.slice(0, BATTLE_MAX);
    if (sumPower(att) / def < need) continue;
    for (const d of cand.slice(0, BATTLE_MAX + 2)) orderMove(g, d, t.id);
  }
}

function advance(g: GameState, side: Side) {
  const en = other(side);
  const goals = PLIST.filter(p => g.ctrl[p.id] === en && p.vp > 0).map(p => p.id);
  if (!goals.length) return;
  const dist = distMap(g, goals);
  for (const d of g.divs) {
    if (d.side !== side || d.order) continue;
    while (d.mp > 0) {
      const here = dist[d.prov] ?? 99;
      let best: string | null = null, bs = 0;
      for (const a of PROV[d.prov].adj) {
        if (g.ctrl[a] === 'NEU' || divsIn(g, a, en).length || divsIn(g, a, side).length >= STACK) continue;
        // näher ans Ziel ist gut, unbesetztes Feindgebiet mitnehmen auch
        const s = (here - (dist[a] ?? 99)) * 2 + (g.ctrl[a] === en ? 1.5 : 0);
        if (s > bs) (bs = s), (best = a);
      }
      if (!best || !orderMove(g, d, best)) break;
    }
  }
}

function defend(g: GameState, side: Side) {
  const en = other(side);
  const cap = side === 'POL' ? 'warschau' : 'berlin';
  const own = (id: string) => g.ctrl[id] === side;
  const toCap = distMap(g, [cap], own);
  const front = PLIST.filter(p => own(p.id) && p.adj.some(a => g.ctrl[a] === en)).map(p => p.id);
  const toFront = distMap(g, front, own);
  for (const d of g.divs) {
    if (d.side !== side || d.order || d.mp < 1) continue;
    const p = PROV[d.prov];
    const threat = sumPower(p.adj.flatMap(a => divsIn(g, a, en)));
    const mates = divsIn(g, p.id, side);
    const hold = sumPower(mates) * defenseMult(p.id);
    let goal: Record<string, number> | null = null;
    if (threat > hold * 3.5 && p.vp < 2) goal = toCap; // aussichtslos: Richtung Hauptstadt ausweichen
    else if (threat === 0 && !(p.vp > 0 && mates.length === 1)) goal = toFront; // Reserve nach vorn
    if (!goal) continue;
    const here = goal[p.id] ?? 99;
    const next = p.adj
      .filter(a => own(a) && !divsIn(g, a, en).length && divsIn(g, a, side).length < STACK && (goal![a] ?? 99) < here)
      .sort((a, b) => goal![a] - goal![b])[0];
    if (next) orderMove(g, d, next);
  }
}

/** Staffeln reihum auf die Brennpunkte verteilen: Angriffsziele bzw. bedrohte eigene Provinzen. */
export function assignAirAI(g: GameState, side: Side, offensive: boolean) {
  const en = other(side);
  const spots = offensive
    ? [...new Set(g.divs.filter(d => d.side === side && d.order).map(d => d.order!))]
    : PLIST.filter(p => g.ctrl[p.id] === side && divsIn(g, p.id, side).length && p.adj.some(a => divsIn(g, a, en).length)).map(p => p.id);
  if (!spots.length) return;
  const weight = (id: string) => PROV[id].vp * 100 + sumPower(offensive ? divsIn(g, id, en) : PROV[id].adj.flatMap(a => divsIn(g, a, en)));
  spots.sort((a, b) => weight(b) - weight(a));
  g.airAssign[side] = {};
  for (const kind of ['f', 'b'] as const)
    for (let i = 0; i < g.air[side][kind]; i++) assignAir(g, side, spots[i % spots.length], kind, 1);
}

/** Führt die Züge einer Seite aus; Angriffe bleiben als Befehle stehen. */
export function strategicAI(g: GameState, side: Side) {
  const offensive = side === 'GER';
  planAttacks(g, side, offensive ? 1.25 : 2.2, !offensive);
  assignAirAI(g, side, offensive);
  if (offensive) advance(g, side);
  else defend(g, side);
}
