// Headless-Probelauf: KI gegen KI über den ganzen Feldzug. Aufruf: npm run sim [seed]
import { collectBattles, endTurn, newGame, strength, turnDate, vpStatus } from '../src/core/game';
import { strategicAI } from '../src/core/stratai';
import { resolveAuto } from '../src/core/flow';
import { losses } from '../src/core/battle';
import { PROV } from '../src/data/world';
import type { Side } from '../src/core/types';

const g = newGame('GER', +(process.argv[2] ?? 1));
const sum = (s: Side) => g.divs.filter(d => d.side === s).reduce((a, d) => a + strength(d), 0);
console.log(`Start: GER ${g.divs.filter(d => d.side === 'GER').length} Verbände (${sum('GER')}), POL ${g.divs.filter(d => d.side === 'POL').length} (${sum('POL')})`);
while (!g.over) {
  const t0 = Date.now();
  const rows: string[] = [];
  for (const side of ['GER', 'POL'] as Side[]) {
    strategicAI(g, side);
    for (const pb of collectBattles(g, side)) {
      const b = resolveAuto(g, pb);
      if (b) rows.push(`${side}→${PROV[pb.prov].name}: ${b.winner === side ? 'Sieg' : 'abgewiesen'} T${Math.min(b.turn, 12)} (${losses(b, 'GER')}/${losses(b, 'POL')})`);
    }
  }
  const date = turnDate(g.turn);
  endTurn(g);
  const v = vpStatus(g);
  console.log(`\n${date}: ${rows.length} Schlachten, ${Date.now() - t0} ms | GER ${sum('GER')} POL ${sum('POL')} | VP ${v.ger}/${v.total} | OOS POL ${g.divs.filter(d => d.side === 'POL' && d.oos).length}`);
  console.log('  ' + rows.join('\n  '));
}
console.log('\nERGEBNIS:', g.over.winner, g.over.text);
console.log(g.log.filter(l => /besetzt|genommen|kapitul|aufgerieben/.test(l)).slice(-40).join('\n'));
