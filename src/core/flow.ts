// Ablauf einer Schlacht von der Vormerkung bis zum Eintrag in die Strategiekarte.
import type { GameState } from './types';
import { other } from './types';
import { type PendingBattle, airAt, airLoss, applyBattle, gainXp } from './game';
import { seaLoss } from './europa';
import { creditWin } from './army';
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
  // Kampferfahrung: der Sieger lernt mehr, aber auch eine Niederlage lehrt
  const winner = b.winner ?? other(pb.side);
  for (const d of [...pb.attackers, ...pb.defenders]) gainXp(d, d.side === winner ? 10 : 5);
  // Siege zählen für die Generäle der beteiligten Armeen
  if (winner === 'GER') creditWin(g, [...pb.attackers, ...pb.defenders].filter(d => d.side === 'GER'));
  applyBattle(g, pb, winner);
}

export function resolveAuto(g: GameState, pb: PendingBattle): Battle | null {
  const b = startBattle(g, pb);
  if (!b) return null;
  autoResolve(b);
  finishBattle(g, pb, b);
  return b;
}
