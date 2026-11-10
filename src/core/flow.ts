// Ablauf einer Schlacht von der Vormerkung bis zum Eintrag in die Strategiekarte.
import type { GameState } from './types';
import { other } from './types';
import { type PendingBattle, airAt, airLoss, applyBattle } from './game';
import { seaLoss } from './europa';
import { type Battle, autoResolve, createBattle, writeBack } from './battle';

export function startBattle(g: GameState, pb: PendingBattle): Battle | null {
  // Ziel inzwischen geräumt oder Angreifer weggefallen: keine Schlacht
  pb.attackers = pb.attackers.filter(d => g.divs.includes(d));
  pb.defenders = pb.defenders.filter(d => g.divs.includes(d) && d.prov === pb.prov);
  if (!pb.attackers.length) return null;
  // Landungstruppen zahlen die Überfahrt, bevor sie an Land gehen
  for (const d of [...pb.attackers, ...pb.followers]) if (d.sea && g.eu) (seaLoss(g, d, pb.prov), (d.sea = false));
  if (!pb.defenders.length) {
    applyBattle(g, pb, pb.side);
    return null;
  }
  return createBattle(g, pb.prov, pb.attackers, pb.defenders, { GER: airAt(g, 'GER', pb.prov), POL: airAt(g, 'POL', pb.prov) });
}

export function finishBattle(g: GameState, pb: PendingBattle, b: Battle) {
  writeBack(b, [...pb.attackers, ...pb.defenders]);
  for (const s of ['GER', 'POL'] as const) {
    airLoss(g, s, pb.prov, 'b', b.lostB[s]);
    airLoss(g, s, pb.prov, 'f', b.lostF[s]);
  }
  applyBattle(g, pb, b.winner ?? other(pb.side));
}

export function resolveAuto(g: GameState, pb: PendingBattle): Battle | null {
  const b = startBattle(g, pb);
  if (!b) return null;
  autoResolve(b);
  finishBattle(g, pb, b);
  return b;
}
