// Headless-Probelauf des Europa-Szenarios: die KI führt auch das Reich, forscht, stellt Linien um
// und nimmt jede historische Entscheidung an. Aufruf: npm run sim:eu [seed] [bis Jahr]
import { useWorld, PLIST } from '../src/data/world';
import { setTypeNames, MODELS, CATS, type Cat } from '../src/data/units';
import { collectBattles, endTurn, strength } from '../src/core/game';
import { resolveAuto } from '../src/core/flow';
import { atWar, fmtDate, installEurope, newEurope, resolveChoice, vpEurope } from '../src/core/europa';
import { bestLvl, deals, researchable, setLine, yearOfDay } from '../src/core/economy';
import { euAI } from '../src/core/euai';
import type { Side } from '../src/core/types';

useWorld('europa');
setTypeNames(true);
installEurope();
const g = newEurope(+(process.argv[2] ?? 1));
const until = +(process.argv[3] ?? 1946);
const eu = g.eu!, e = eu.eco;
let lastYear = 0, battles = 0, ms = 0;
const status = () => {
  const n: Record<string, number> = {};
  for (const d of g.divs) n[d.nation] = (n[d.nation] ?? 0) + 1;
  const ger = g.divs.filter(d => d.nation === 'GER');
  const v = vpEurope(g);
  console.log(`\n== ${fmtDate(eu.day)} (Runde ${g.turn}) IK ${e.ik.toFixed(0)} | Stahl ${e.steel | 0} Öl ${e.oil | 0} Mann ${e.men | 0} Nachschub ${e.sup | 0} | Werke +${e.fac} Hydr ${e.plants} Tank ${e.tank} Ausfuhr ${e.exp.toFixed(1)} Ölverbr ${(e.rate.oilUse ?? 0).toFixed(1)} Saldo ${(e.rate.oil ?? 0).toFixed(1)} | VP ${v.axis}/${v.total} | ${battles} Schlachten, ${ms} ms`);
  console.log(`   Heer: ${ger.length} Verbände, Stärke ${ger.reduce((a, d) => a + strength(d), 0)}, Luft ${e.airF.join('/')} J ${e.airB.join('/')} B | Typen ${Object.entries(ger.flatMap(d => d.units).reduce((a: Record<string, number>, u) => ((a[u.t] = (a[u.t] ?? 0) + 1), a), {})).map(([t, c]) => `${t}×${c}`).join(' ')}`);
  console.log(`   Lager neu ${Object.entries(e.neu).filter(x => x[1] >= 1).map(([k, v]) => `${k}=${v | 0}`).join(' ')} | um ${Object.entries(e.upg).filter(x => x[1] >= 1).map(([k, v]) => `${k}=${v | 0}`).join(' ')} | Bau ${e.queue.map(b => b.kind).join(',')} | Forschung ${e.done.length}`);
  console.log(`   Staaten: ${Object.entries(n).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join(', ')} | low ${ger.filter(d => d.low).length} oos ${ger.filter(d => d.oos).length}`);
  battles = ms = 0;
};
while (!g.over && yearOfDay(eu.day) < until) {
  while (eu.news.length) {
    const n = eu.news.shift()!;
    console.log(`  [${fmtDate(eu.day)}] ${n.title}`);
    if (n.id) resolveChoice(g, n.id, true);
  }
  // Reich: freie Forschungsplätze füllen, Linien auf das neueste Muster stellen
  for (let i = 0; i < e.slots.length; i++) if (!e.slots[i]) e.slots[i] = researchable(e).find(t => !e.slots.includes(t)) ?? null;
  for (const c of Object.keys(CATS) as Cat[]) if (bestLvl(e, c) > e.lines[c].lvl) setLine(g, c, Math.min(bestLvl(e, c), MODELS[c].length - 1));
  for (const d of deals(g)) e.trade[d.id] = d.sell ? 0 : d.max;
  const t0 = Date.now();
  for (const side of ['GER', 'POL'] as Side[]) {
    euAI(g, side, true);
    for (const pb of collectBattles(g, side)) if (resolveAuto(g, pb)) battles++;
  }
  endTurn(g);
  ms += Date.now() - t0;
  const y = yearOfDay(eu.day) * 2 + (atWar(g) ? Math.floor(new Date(Date.UTC(1936, 0, 1 + eu.day)).getUTCMonth() / 6) : 0);
  if (y !== lastYear) (lastYear = y), status();
}
status();
console.log('\nERGEBNIS:', g.over?.winner, g.over?.text);
console.log('Besitz:', Object.entries(PLIST.reduce((a: Record<string, number>, p) => ((a[eu.owner[p.id]] = (a[eu.owner[p.id]] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', '));
