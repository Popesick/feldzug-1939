// Ablauf einer Schlacht von der Vormerkung bis zum Eintrag in die Strategiekarte.
import type { GameState } from './types';
import { other } from './types';
import { type PendingBattle, applyBattle } from './game';
import { type Battle, autoResolve, createBattle, writeBack } from './battle';

export function startBattle(g: GameState, pb: PendingBattle): Battle | null {
  // Ziel inzwischen geräumt oder Angreifer weggefallen: keine Schlacht
  pb.attackers = pb.attackers.filter(d => g.divs.includes(d));
  pb.defenders = pb.defenders.filter(d => g.divs.includes(d) && d.prov === pb.prov);
  if (!pb.attackers.length) return null;
  if (!pb.defenders.length) {
    applyBattle(g, pb, pb.side);
    return null;
  }
  return createBattle(g, pb.prov, pb.attackers, pb.defenders);
}

export function finishBattle(g: GameState, pb: PendingBattle, b: Battle) {
  writeBack(b, [...pb.attackers, ...pb.defenders]);
  applyBattle(g, pb, b.winner ?? other(pb.side));
}

export function resolveAuto(g: GameState, pb: PendingBattle): Battle | null {
  const b = startBattle(g, pb);
  if (!b) return null;
  autoResolve(b);
  finishBattle(g, pb, b);
  return b;
}
