// Wirtschaftsfenster des Europa-Szenarios: Produktion, Aufstellung, Forschung, Diplomatie.
import type { GameState } from '../core/types';
import { type Cat, CATS, GROUND, MODELS, TEMPLATES, TYPES } from '../data/units';
import { COUNTRIES, GER_BUILD, TECHS } from '../data/europa';
import { PROV } from '../data/world';
import { AIR, ECO_KEYS, USES, USE_MIN, USE_NAME, type Use, WORKS, allot, demand, setUse, bestLvl, computeIK, deals, income, maxPlants, plantYield, tradeFlow, workCost, needs, neuTotal, queueBuild, researchable, setLine, shares, yearOfDay } from '../core/economy';
import { exists, fmtDate, supplyRange } from '../core/europa';
import { SHIPS, SHIP_KINDS, type ShipKind, ZONE_NAME, canBase, carrierAir, control, crossingRisk, ensureNavy, fleetNations, fleetOf, moveShips, orderShip, strengthIn, transportsFree, zonesOf } from '../core/navy';
import { TF_COST } from '../core/economy';
import { esc } from './draw';
import { AID_BUILD, AIR_KINDS, type AirCat, airSpare, allies, giveAir, giveGear, giveShips, hasFleet, shipSpare, stockOf } from '../core/aid';
import { ARMY_MAX, armies, ownArmies, freeGenerals, genState, inTransfer, leaveArmy, maxRank, members, rankName, rankTitle, setGeneral, traitText } from '../core/army';
import { GENERAL, GENERAL_NATIONS, TRAITS, WINS_NEEDED } from '../data/generals';
import { sbFree, sbTotal } from '../core/airwar';

export interface EcoOpts { tab?: string; prov: string | null; done: () => void; war: (c: string) => void }
const TABS: [string, string][] = [['prod', 'Produktion'], ['trade', 'Handel'], ['navy', 'Marine'], ['build', 'Aufstellung'], ['army', 'Armeen'], ['aid', 'Verbündete'], ['res', 'Forschung'], ['dip', 'Diplomatie']];
const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const sign = (v: number) => (v >= 0 ? '+' : '−') + n1(Math.abs(v));

export function openEco(modal: HTMLElement, g: GameState, opts: EcoOpts) {
  const eu = g.eu!, e = eu.eco;
  let tab = opts.tab ?? 'prod';
  let aidTo: string | null = null, aidAmt: Record<string, number> = {};

  /** Bataillone des Heeres je Gattung und Generation. */
  const fielded = () => {
    const out: Record<string, number[]> = {};
    for (const d of g.divs)
      if (d.nation === 'GER')
        for (const u of d.units) {
          const t = TYPES[u.t];
          if (t.cat) ((out[t.cat] ??= [])[t.lvl ?? 0] = (out[t.cat][t.lvl ?? 0] ?? 0) + 1);
        }
    return out;
  };

  const ikText = (v: number) => `${n1(v)} IK · ${Math.round((100 * v) / Math.max(0.01, e.ik - e.exp))} %`;

  const prod = () => {
    const sh = shares(e), inc = income(g), field = fielded(), navy = ensureNavy(g);
    const stock = (cat: string) => MODELS[cat as Cat].map((m, i) => {
      const v = USES.map(u => [u, e[u][`${cat}:${i}`] ?? 0] as const).filter(x => x[1] >= 1);
      return v.length ? `<div>Lager ${esc(m.name)}: ${v.map(([u, n]) => `${USE_NAME[u]} <b>${n | 0}</b>`).join(' · ')}</div>` : '';
    }).join('');
    // wohin die Fertigung der nächsten Runde nach Anteilen und Bedarf tatsächlich geht
    const flow = (cat: Cat, out: number) => {
      const need = demand(g, cat), part = allot(out, e.use, need);
      return `Verteilung derzeit: ${USES.map(u => `${USE_NAME[u]} <b>${out > 0 ? Math.round((100 * part[u]) / out) : 0} %</b>${need[u] > 0 ? '' : ' (kein Bedarf)'}`).join(' · ')}`;
    };
    const useRow = (u: Use) => `<div><span class="lbl">${USE_NAME[u]}</span> <input type="range" min="${USE_MIN}" max="${100 - 2 * USE_MIN}" step="5" value="${e.use[u]}" data-use="${u}"> <span class="num" data-uv="${u}">${e.use[u]} %</span></div>`;
    const useBox = `<div class="line"><b>Verwendung der Fertigung</b>${USES.map(useRow).join('')}
      <div class="dim">Gilt für alle Gattungen. <b>Neuaufstellung</b> stattet neue Verbände aus, <b>Umrüstung</b> bringt neue Muster in bestehende, <b>Verstärkung</b> ersetzt Verluste. Jeder Bereich erhält mindestens ${USE_MIN} %. Hat ein Bereich gerade keinen Bedarf, fällt sein Anteil an die beiden anderen, statt ins Lager zu gehen.</div></div>`;
    const row = (k: string) => {
      const locked = e.lock?.[k] !== undefined;
      const ctl = `<input type="range" min="0" max="40" value="${e.w[k]}" data-w="${k}" ${locked ? 'disabled' : ''}> <span class="num" data-ik="${k}">${ikText(sh[k])}</span>
        <button class="lock${locked ? ' on' : ''}" data-lock="${k}" title="${locked ? 'Gesperrt: Der Anteil bleibt fest, auch wenn andere Regler bewegt werden. Klicken zum Entsperren.' : 'Anteil sperren: bleibt fest, wenn andere Regler bewegt werden'}">${locked ? '🔒 gesperrt' : '🔓'}</button>`;
      if (k === 'res') return `<div class="line"><b>Forschung</b><div>${ctl}</div><div class="dim">${e.slots.filter(Boolean).length} von 3 Vorhaben laufen</div></div>`;
      if (k === 'sup') return `<div class="line"><b>Nachschubgüter</b><div>${ctl}</div><div class="dim">Vorrat ${e.sup | 0} (${sign(e.rate.sup ?? 0)} je Tag) · Reichweite ${supplyRange(g)}</div></div>`;
      if (k === 'mar') {
        const y = navy.yard.slice(0, 2);
        return `<div class="line"><b>Werften</b><div>${ctl}</div><div class="dim">${y.length ? `In Arbeit: ${y.map(o => `${esc(o.name)} (${Math.round((100 * o.prog) / SHIPS[o.k].cost)} %)`).join(', ')}${navy.yard.length > 2 ? ` · ${navy.yard.length - 2} weitere warten` : ''}` : '<span class="bad">Kein Auftrag – die Werften stehen still.</span> Schiffe bestellen Sie unter Aufstellung.'}</div></div>`;
      }
      if (k === 'tf') {
        if (!e.done.includes('tf1')) return `<div class="line off"><b>Trägerflugzeuge</b><div class="dim">eigene Fertigung, erst nach der Forschung „Trägerflugzeuge Bf 109 T / Ju 87 C“</div></div>`;
        return `<div class="line"><b>Trägerflugzeuge</b><div>${ctl} <span class="dim">→ ${n1((sh.tf * 7) / TF_COST)} Staffeln je Woche</span></div><div class="dim">Vorhanden: <b>${navy.airT}</b> Staffeln · je Träger zwei · Träger derzeit zu ${Math.round(carrierAir(g) * 100)} % bestückt</div></div>`;
      }
      if (WORKS.includes(k)) {
        const pct = Math.round((100 * (e.acc[k] ?? 0)) / workCost(e, k)), eta = sh[k] > 0.01 ? `fertig in etwa ${Math.ceil((workCost(e, k) - (e.acc[k] ?? 0)) / sh[k])} Tagen` : 'ruht';
        const bar = `<div class="bar"><i style="width:${Math.min(100, pct)}%;background:var(--acc)"></i></div>`;
        if (k === 'fix') {
          const dmg = e.dmg ?? 0;
          if (dmg <= 0.01) return `<div class="line off"><b>Industrie reparieren</b><div class="dim">keine Bombenschäden – der Anteil verteilt sich auf die übrigen Posten</div></div>`;
          return `<div class="line new"><b>Industrie reparieren</b><div>${ctl} <span class="dim">→ ${n1((sh.fix * 7) / workCost(e, k))} IK je Woche</span></div>
            <div class="dim"><span class="bad">Durch Bomben zerstört: <b>${n1(dmg)}</b> IK</span>${(e.rate.bombed ?? 0) > 0 ? ` · letzte Runde −${n1(e.rate.bombed)} IK` : ''} · Reparatur kostet ${Math.round(workCost(e, k))} IK-Tage je IK (ein Viertel eines Neubaus)${sh.fix > 0.01 ? ` · alles behoben in etwa ${Math.ceil((dmg * workCost(e, k)) / sh.fix)} Tagen` : ''}</div></div>`;
        }
        if (k === 'ind') return `<div class="line"><b>Industrieausbau</b><div>${ctl}</div>${bar}<div class="dim">Bisher gebaut: <b>${e.fac}</b> Werke (je +1 IK, dauerhaft) · nächstes Werk kostet ${workCost(e, k)} IK-Tage, ${eta}</div></div>`;
        if (k === 'tank') return `<div class="line"><b>Tanklager</b><div>${ctl}</div>${bar}<div class="dim">Fassungsvermögen <b>${e.tank}</b>, gefüllt mit ${e.oil | 0} · je Ausbaustufe +100 für ${workCost(e, k)} IK-Tage, ${eta}</div></div>`;
        const cap = maxPlants(e);
        if (!e.done.includes('syn1')) return `<div class="line off"><b>Hydrierwerke (Kohle → Öl)</b><div class="dim">erst das Verfahren „Kohlehydrierung“ erforschen</div></div>`;
        return `<div class="line"><b>Hydrierwerke (Kohle → Öl)</b><div>${e.plants >= cap ? '<span class="bad">Die Kohle der eigenen Reviere reicht für kein weiteres Werk.</span>' : ctl}</div>${e.plants >= cap ? '' : bar}
          <div class="dim">In Betrieb: <b>${Math.min(e.plants, cap)}</b> von höchstens ${cap} Werken (Kohleförderung ${n1(e.coal)}, je Werk 3) · Ausbeute ${n1(plantYield(e))} Öl je Tag und Werk, zusammen <b>${n1(inc.syn)}</b> · nächstes Werk ${workCost(e, k)} IK-Tage${e.plants >= cap ? '' : ', ' + eta}</div></div>`;
      }
      const cat = k as Cat, l = e.lines[cat], air = !!AIR[cat];
      if (l.lvl < 0) return `<div class="line off"><b>${CATS[cat]}</b><div class="dim">noch kein Muster erforscht – die Linie ruht</div></div>`;
      const best = bestLvl(e, cat), m = MODELS[cat][l.lvl];
      const sel = `<select data-line="${cat}">${MODELS[cat].map((x, i) => (e.done.includes(`${cat}${i}`) ? `<option value="${i}" ${i === l.lvl ? 'selected' : ''}>${esc(x.name)}</option>` : '')).join('')}</select>`;
      const out = (sh[cat] * l.eff * 7) / m.cost;
      const have = air ? e[AIR[cat]!].map((n, i) => (n ? `${n}× ${esc(MODELS[cat][i].name)}` : '')).filter(Boolean).join(' · ')
        : (field[cat] ?? []).map((n, i) => (n ? `${n}× ${esc(MODELS[cat][i].name)}` : '')).filter(Boolean).join(' · ');
      return `<div class="line${best > l.lvl ? ' new' : ''}"><b>${CATS[cat]}</b>
        <div>${sel} <span class="dim">Auslastung ${Math.round(l.eff * 100)} %</span>${best > l.lvl ? ` <span class="bad">neueres Muster verfügbar: ${esc(MODELS[cat][best].name)}</span>` : ''}</div>
        <div>${ctl} <span class="dim" data-out="${cat}">→ ${n1(out)} ${air ? 'Staffeln' : 'Stärkepunkte'} je Woche</span></div>
        <div class="dim">${air ? 'Staffeln' : 'Im Heer (Bataillone)'}: ${have || '–'}</div>${air ? '' : `<div class="dim">${flow(cat, out)}</div><div class="dim">${stock(cat)}</div>`}</div>`;
    };
    const res = (label: string, v: number, r: number, key: string) => `<span class="${e.short.includes(key) ? 'bad' : ''}">${label} <b>${v | 0}</b> <span class="dim">(${sign(r)}/Tag)</span></span>`;
    return `<div class="stats"><span>Industrie <b>${n1(e.ik)}</b> IK <span class="dim">(Reich ${n1(e.ikHome)}, besetzt ${n1(e.ikOcc)}${e.exp ? `, davon Ausfuhr ${n1(e.exp)}` : ''})</span></span>
        ${res('Stahl', e.steel, e.rate.steel ?? 0, 'steel')}${res(`Öl <span class="dim">(Lager ${e.tank})</span>`, e.oil, e.rate.oil ?? 0, 'oil')}${res('Mannschaften', e.men, e.rate.men ?? 0, 'men')}</div>
      <div class="dim">Zufluss je Tag: Stahl ${n1(inc.steel)} (${inc.notes.join(', ')}) · Öl ${n1(inc.oil)} (Förderung ${n1(inc.own)}, Hydrierwerke ${n1(inc.syn)}, Einkauf ${n1(inc.buy)})${(e.rate.spill ?? 0) > 0 ? ` · <span class="bad">Tanklager voll: ${n1(e.rate.spill)} Öl je Tag gehen verloren</span>` : ''}${e.short.length ? ` · <span class="bad">Mangel: ${e.short.map(s => ({ oil: 'Öl – schnelle Verbände und Luftwaffe gelähmt', steel: 'Stahl – Fertigung gedrosselt', sup: 'Nachschubgüter – kein Ersatz' })[s]).join('; ')}</span>` : ''}</div>
      <p class="dim">Die Regler verteilen die Industrie. Jede Linie fertigt ein Muster; nach dem Umstellen auf ein neues Muster läuft sie erst wieder an (Auslastung 25 %, dann +8 % je Woche). Das <b>Schloss</b> sperrt einen Posten: Sein Anteil bleibt fest, auch wenn Sie andere Regler bewegen. </p>
      ${ECO_KEYS.map(k => (k === 'ind' ? '<h3>Ausbau</h3>' : k === 'inf' ? '<h3>Rüstung</h3>' + useBox : k === 'mar' ? '<h3>Marine</h3>' : '') + row(k)).join('')}`;
  };

  const trade = () => {
    const inc = income(g), f = tradeFlow(g), unit = { ik: 'IK', steel: 'Stahl', sup: 'Nachschubgüter' };
    const row = (d: ReturnType<typeof deals>[number]) => {
      const v = Math.min(d.max, e.trade[d.id] ?? 0);
      return `<div class="line${d.closed ? ' off' : ''}"><b>${esc(d.name)}</b>
        <div><input type="range" min="0" max="${d.max}" value="${v}" data-trade="${d.id}"> <span class="num" data-tv="${d.id}">${v}</span> ${d.good === 'steel' ? 'Stahl' : 'Öl'} je Tag <span class="dim">(höchstens ${d.max})</span></div>
        <div class="dim">${d.sell ? `bringt ${n1(d.price)} ${unit[d.pay]} je Öl` : `kostet ${n1(d.price)} IK je ${d.good === 'steel' ? 'Stahl' : 'Öl'} und Tag (Ausfuhrgüter)`}${d.note ? ` · ${esc(d.note)}` : ''}${d.closed ? ` · <span class="bad">geschlossen: ${esc(d.closed)}</span>` : ''}</div></div>`;
    };
    const all = deals(g);
    return `<div class="stats"><span class="${e.short.includes('oil') ? 'bad' : ''}">Öl <b>${e.oil | 0}</b> von ${e.tank} <span class="dim">(${sign(e.rate.oil ?? 0)}/Tag in der letzten Runde, Verbrauch ${n1(e.rate.oilUse ?? 0)})</span></span>
        <span class="${e.short.includes('steel') ? 'bad' : ''}">Stahl <b>${e.steel | 0}</b> <span class="dim">(${sign(e.rate.steel ?? 0)}/Tag in der letzten Runde)</span></span></div>
      <div class="dim" data-tsum>Je Tag: Förderung ${n1(inc.own)} · Hydrierwerke ${n1(inc.syn)} · Öleinkauf <b>${n1(f.buy)}</b> · Stahleinkauf <b>${n1(f.steelBuy)}</b> · zusammen für ${n1(e.exp)} IK · Ölverkauf <b>${n1(f.sell)}</b> gegen ${n1(f.steel)} Stahl und ${n1(f.sup)} Nachschubgüter</div>
      <p class="dim">Öl und Stahl werden gegen Ausfuhrgüter eingekauft: Die dafür nötige Industrie fehlt der Rüstung. Was die Tanklager nicht fassen, geht verloren – Lager lassen sich unter Produktion ausbauen. Verkauft wird nur aus dem, was nach dem eigenen Verbrauch im Lager bleibt. Im Krieg mit Großbritannien ist der Seeweg gesperrt.</p>
      <h3>Öl einkaufen</h3>${all.filter(d => !d.sell && d.good === 'oil').map(row).join('')}<h3>Stahl einkaufen</h3>${all.filter(d => d.good === 'steel').map(row).join('')}<h3>Öl verkaufen</h3>${all.filter(d => d.sell).map(row).join('')}`;
  };

  const GROUPS: [string, string[]][] = [
    ['Infanterie', ['ID1', 'ID2', 'ID3', 'GEBD']], ['Schnelle Truppen', ['IDM', 'LEI']], ['Panzer', ['PZD36', 'PZD', 'PZD41', 'SPZ']], ['Festungstruppen', ['BRIG']],
  ];
  const build = () => {
    const at = opts.prov && eu.core[opts.prov] && eu.owner[opts.prov] === 'GER' ? opts.prov : 'berlin';
    const navy = ensureNavy(g), sh = shares(e);
    const unitRow = (kind: string) => {
      const t = TEMPLATES[kind], nd = needs(kind);
      const ok = Object.keys(nd).every(c => e.lines[c].lvl >= 0);
      return `<tr><td><b>${esc(t.label)}</b><div class="dim">${t.units.map(u => u.split(':')[0]).join(' ')}</div></td>
        <td>${Object.entries(nd).map(([c, n]) => `<span class="${neuTotal(e, c) < n ? 'bad' : ''}">${CATS[c as Cat]} ${n} <span class="dim">(Lager ${neuTotal(e, c) | 0})</span></span>`).join('<br>')}</td>
        <td><button data-build="${kind}" ${ok ? '' : 'disabled'}>aufstellen</button></td></tr>`;
    };
    const known = new Set(GROUPS.flatMap(x => x[1]));
    const groups = [...GROUPS, ['Sonstige', GER_BUILD.map(b => b[0]).filter(k => !known.has(k))] as [string, string[]]]
      .map(([name, kinds]) => [name, kinds.filter(k => GER_BUILD.some(b => b[0] === k))] as const).filter(x => x[1].length)
      .map(([name, kinds]) => `<h3>${name}</h3><table>${kinds.map(unitRow).join('')}</table>`).join('');
    const air = (cat: 'jg' | 'bo' | 'sb', arr: number[]) => {
      const l = e.lines[cat];
      return `<tr><td><b>${CATS[cat]}</b><div class="dim">${arr.map((n, i) => (n ? `${n}× ${esc(MODELS[cat][i].name)}` : '')).filter(Boolean).join(' · ') || 'keine Staffeln'}</div></td>
        <td class="dim">${l.lvl >= 0 ? `laufende Fertigung: ${n1((sh[cat] * l.eff * 7) / MODELS[cat][l.lvl].cost)} Staffeln je Woche (${esc(MODELS[cat][l.lvl].name)})` : 'kein Muster'}</td><td></td></tr>`;
    };
    const total = (k: ShipKind) => Object.values(navy.own).reduce((a, s) => a + Math.floor(s[k]), 0);
    const ships = SHIP_KINDS.map(k => {
      const sp = SHIPS[k], ok = !sp.tech || e.done.includes(sp.tech);
      return `<tr><td><b>${sp.name}</b><div class="dim">${sp.text}</div></td><td>${sp.cost} Industrietage der Werften <span class="dim">· vorhanden ${total(k)}</span>${ok ? '' : '<br><span class="bad">erst nach der Forschung „Flugzeugträger Graf Zeppelin“</span>'}</td>
        <td><button data-ship="${k}" ${ok ? '' : 'disabled'}>auf Kiel legen</button></td></tr>`;
    }).join('');
    const queue = e.queue.map((b, i) => `<tr><td><b>${esc(b.name)}</b> <span class="dim">${esc(TEMPLATES[b.kind].label)} · ${esc(PROV[b.prov].name)}</span></td>
      <td>${b.got.filter(Boolean).length}/${b.got.length} Bataillone ausgestattet · seit ${fmtDate(b.day)}</td><td><button data-unq="${i}">streichen</button></td></tr>`).join('');
    const yard = navy.yard.map((o, i) => `<tr><td><b>${esc(o.name)}</b> <span class="dim">${SHIPS[o.k].name}</span></td>
      <td><div class="bar"><i style="width:${Math.min(100, Math.round((100 * o.prog) / SHIPS[o.k].cost))}%;background:var(--acc)"></i></div><span class="dim">${Math.round((100 * o.prog) / SHIPS[o.k].cost)} %${i < 2 ? (sh.mar > 0.01 ? ` · fertig in etwa ${Math.ceil((SHIPS[o.k].cost - o.prog) / (sh.mar / Math.min(2, navy.yard.length)))} Tagen` : ' · Werften ohne Industrie') : ' · wartet'}</span></td>
      <td><button data-unship="${i}">streichen</button></td></tr>`).join('');
    return `<p class="dim">Neue Verbände werden Bataillon für Bataillon aus dem Lager „Neuaufstellung“ ausgestattet – immer mit dem neuesten vorrätigen Muster. Fertig sind sie frühestens nach 30 Tagen Ausbildung. Aufstellungsort: <b>${esc(PROV[at].name)}</b> (die auf der Karte gewählte Provinz im Reichsgebiet, sonst Berlin). Schiffe bauen die Werften nacheinander, zwei zugleich.</p>
      <label><input type="checkbox" data-auto ${e.auto ? 'checked' : ''}> Heeresverbände selbsttätig aufstellen, was das Lager hergibt (erst schnelle Verbände, dann Infanterie)</label>
      ${groups}
      <h3>Flugzeuge</h3><table>${air('jg', e.airF)}${air('bo', e.airB)}${air('sb', e.airS)}</table>
      <div class="dim">Strategische Bomber greifen die Industrie des Gegners an: Ziel in der Luftansicht auf der Karte wählen (feindliche Provinz mit Industrie, höchstens 1500 km vom eigenen Gebiet). Frei: ${sbFree(g)} von ${sbTotal(g)} Staffeln.</div>
      <h3>Marine</h3><table>${ships}</table>
      <h3>In Aufstellung (${e.queue.length})</h3><table>${queue || '<tr><td class="dim">nichts</td></tr>'}</table>
      <h3>Auf den Werften (${navy.yard.length})</h3><table>${yard || '<tr><td class="dim">nichts</td></tr>'}</table>`;
  };

  const armyTab = () => {
    const free = freeGenerals(g);
    const genLine = (id: string) => {
      const s = genState(g, id);
      return `${esc(rankName(g, id))} <b>${esc(GENERAL[id].name)}</b> · ${traitText(g, id)}${s.rank < maxRank(id) ? ` <span class="dim">· ${s.wins}/${WINS_NEEDED[s.rank]} Siege bis ${esc(rankTitle(id, s.rank + 1))}</span>` : ''}`;
    };
    const foreign = GENERAL_NATIONS.map(c => {
      const as = armies(g).filter(a => a.nation === c && a.gen);
      return as.length ? `<div class="line${eu.rel[c] === 'E' ? ' new' : ''}"><b>${esc(COUNTRIES[c].name)}</b> <span class="dim">${eu.rel[c] === 'E' ? 'im Krieg' : 'verbündet'} · ${as.length} Armeen unter Generälen</span>
        ${as.sort((a, b) => genState(g, b.gen!).rank - genState(g, a.gen!).rank).map(a => `<div class="dim">${esc(rankName(g, a.gen!))} <b>${esc(GENERAL[a.gen!].name)}</b> · ${traitText(g, a.gen!)} · ${members(g, a).length} Verbände</div>`).join('')}</div>` : '';
    }).join('');
    const rows = ownArmies(g).map(a => {
      const ds = members(g, a), where = [...new Set(ds.map(d => PROV[d.prov].name))];
      const opt = [a.gen, ...free.map(x => x.id)].filter(Boolean) as string[];
      return `<div class="line${a.gen ? '' : ' new'}"><b>${esc(a.name)}</b>
        <div>${ds.length}/${ARMY_MAX} Verbände <span class="dim">· ${where.slice(0, 4).map(esc).join(', ')}${where.length > 4 ? ' …' : ''}</span></div>
        <div>Befehlshaber: <select data-gen="${a.id}"><option value="">– keiner –</option>${opt.map(id => `<option value="${id}" ${id === a.gen ? 'selected' : ''}>${esc(rankTitle(id, genState(g, id).rank))} ${esc(GENERAL[id].name)} (${traitText(g, id)})</option>`).join('')}</select>
          <button data-disband="${a.id}">Armee auflösen</button></div>
        <div class="dim">${a.gen ? genLine(a.gen) + (inTransfer(g, a) ? ` <span class="bad">· General in Transfer, trifft am ${fmtDate(a.genAt!)} ein</span>` : '') : '<span class="bad">Ohne General hat die Armee keine Vorteile.</span>'}</div>
        <div class="dim">${ds.map(d => esc(d.name)).join(' · ')}</div></div>`;
    }).join('');
    return `<p class="dim">Bis zu ${ARMY_MAX} Verbände bilden eine Armee: Auf der Karte Verbände auswählen und in der Seitenleiste „Armee bilden“ wählen. Der General lässt sich dort oder hier zuteilen und braucht eine Woche bis zu seiner Armee. Er gibt allen Verbänden seiner Armee seine Vorteile, gleich wo sie stehen. Eine Armee bleibt zusammen: Sie zieht und greift nur geschlossen an, braucht im Ziel Platz für alle und kommt nur so weit wie ihr langsamster Verband. Jedes gewonnene Gefecht, an dem die Armee beteiligt war, zählt für seine Beförderung; mit jedem Rang kommt ein Punkt hinzu.</p>
      <div class="dim">${(Object.keys(TRAITS) as (keyof typeof TRAITS)[]).map(t => `<b>${TRAITS[t].name}</b>: ${TRAITS[t].text} +1 je Punkt`).join(' · ')}</div>
      <h3>Armeen (${ownArmies(g).length})</h3>${rows || '<div class="dim">Noch keine Armee gebildet.</div>'}
      <h3>Generäle ohne Kommando (${free.length})</h3>${free.map(x => `<div class="dim">${genLine(x.id)}</div>`).join('') || '<div class="dim">keine</div>'}
      ${foreign ? `<h3>Generäle der anderen Mächte</h3><p class="dim">Die KI fasst die Verbände der Großmächte selbst zu Armeen zusammen; auch ihre Generäle steigen mit Siegen auf.</p>${foreign}` : ''}`;
  };

  // Waffenhilfe: eigenes Lager, Wahl des Verbündeten, Regler je Posten
  const aidTab = () => {
    const list = allies(g), navy = ensureNavy(g);
    if (aidTo && !list.includes(aidTo)) aidTo = null;
    const to = aidTo, row = (id: string, name: string, have: string, max: number, note = '') => {
      aidAmt[id] = Math.min(aidAmt[id] ?? 0, max);
      return `<tr><td>${name}</td><td>${have}</td><td>${to ? (max > 0 ? `<input type="range" min="0" max="${max}" value="${aidAmt[id]}" data-aid="${id}"> <b>${aidAmt[id]}</b> <span class="dim">von ${max}</span>` : `<span class="dim">${note || 'nichts abzugeben'}</span>`) : ''}</td></tr>`;
    };
    const gear = GROUND.flatMap(cat => MODELS[cat].map((m, lvl) => {
      const k = `${cat}:${lvl}`, n = stockOf(g, k);
      return n >= 1 ? row(`g|${k}`, `<b>${esc(m.name)}</b> <span class="dim">${CATS[cat]}</span>`, `<b>${Math.floor(n)}</b> <span class="dim">neu ${Math.floor(e.neu[k] ?? 0)} · um ${Math.floor(e.upg[k] ?? 0)} · Ersatz ${Math.floor(e.rep[k] ?? 0)}</span>`, Math.floor(n)) : '';
    })).join('');
    const air = (Object.keys(AIR_KINDS) as AirCat[]).flatMap(cat => MODELS[cat].map((m, lvl) => {
      const n = e[AIR_KINDS[cat]][lvl] ?? 0, spare = airSpare(g, cat, lvl);
      return n > 0 ? row(`a|${cat}|${lvl}`, `<b>${esc(m.name)}</b> <span class="dim">${CATS[cat]}</span>`, `<b>${n}</b> Staffeln <span class="dim">${spare} keinem Sektor zugeteilt</span>`, spare, 'alle Staffeln sind Sektoren zugeteilt') : '';
    })).join('');
    const ships = SHIP_KINDS.map(k => {
      const n = shipSpare(g, k), all = Object.values(navy.own).reduce((a, s) => a + Math.floor(s[k]), 0);
      return all > 0 ? row(`s|${k}`, `<b>${SHIPS[k].plural}</b>`, `<b>${all}</b> <span class="dim">${n} im Hafen</span>`, to && hasFleet(g, to) ? n : 0, to && !hasFleet(g, to) ? 'dieser Verbündete unterhält keine Flotte' : 'nur Schiffe im Hafen lassen sich abgeben') : '';
    }).join('');
    const sec = (title: string, body: string) => `<h3>${title}</h3>${body ? `<table>${body}</table>` : '<div class="dim">nichts auf Lager</div>'}`;
    let ally = '<p class="dim">Wählen Sie oben einen Verbündeten; dann erscheinen die Regler.</p>';
    if (to) {
      const ds = g.divs.filter(d => d.nation === to), a = eu.airN[to], f = fleetOf(g, to), st = eu.store?.[to] ?? {};
      const stTxt = Object.entries(st).filter(x => x[1] >= 1).map(([k, n]) => `${Math.floor(n)} ${esc(MODELS[k.split(':')[0] as Cat][+k.split(':')[1]].name)}`).join(' · ');
      const lv: Record<string, number> = {};
      for (const d of ds) for (const u of d.units) if (TYPES[u.t].cat) lv[`${TYPES[u.t].cat}:${TYPES[u.t].lvl ?? 0}`] = (lv[`${TYPES[u.t].cat}:${TYPES[u.t].lvl ?? 0}`] ?? 0) + u.s;
      const field = GROUND.map(cat => {
        const parts = MODELS[cat].map((_, i) => lv[`${cat}:${i}`] ? `Stand ${i + 1}: ${lv[`${cat}:${i}`]}` : '').filter(Boolean).join(', ');
        return parts ? `${CATS[cat]} (${parts})` : '';
      }).filter(Boolean).join(' · ');
      ally = `<div class="line"><b>${esc(COUNTRIES[to].name)}</b>
        <div>Heer: <b>${ds.length}</b> Verbände, Stärke ${ds.reduce((x, d) => x + d.units.reduce((y, u) => y + u.s, 0), 0)} · Luftwaffe: <b>${a?.f ?? 0}</b> Jagd-, <b>${a?.b ?? 0}</b> Bomberstaffeln${f ? ` · Flotte: ${SHIP_KINDS.filter(k => f[k] >= 1).map(k => `${Math.floor(f[k])} ${SHIPS[k].plural}`).join(', ') || 'keine Schiffe'}` : ' · keine Flotte'}</div>
        <div class="dim">Bei der Truppe (Stärkepunkte): ${field || 'nichts'}</div>
        <div>Auf Lager: ${stTxt ? `<b>${stTxt}</b>` : '<span class="dim">nichts – geliefertes Gerät ist verteilt</span>'}${COUNTRIES[to].mob ? ` <span class="dim">· Rüstungspunkte für neue Verbände ${Math.floor(eu.pts[to] ?? 0)}</span>` : ''}</div></div>`;
    }
    return `<p class="dim">Was auf Lager liegt, können Sie einem Verbündeten überlassen. Er rüstet damit zuerst seine ältesten Bataillone um, füllt dann Verluste auf und stellt aus dem Rest neue Verbände auf (${AID_BUILD} Stärkepunkte je Woche). Flugzeuge und Schiffe gehen sofort in seinen Bestand über. Eine Lieferung lässt sich nicht zurückholen.</p>
      <h3>Verbündeter</h3><div class="row">${list.map(c => `<button data-ally="${c}" class="${c === to ? 'on' : ''}">${esc(COUNTRIES[c].name)}</button>`).join('') || '<span class="dim">Das Reich hat derzeit keine Verbündeten.</span>'}</div>
      ${list.length ? ally : ''}
      ${sec('Waffen und Fahrzeuge (Stärkepunkte)', gear)}${sec('Flugzeuge', air)}${sec('Schiffe', ships)}
      <h3>Vorräte</h3><div>Stahl <b>${Math.floor(e.steel)}</b> · Öl <b>${Math.floor(e.oil)}</b> · Nachschub <b>${Math.floor(e.sup)}</b> <span class="dim">· Vorräte werden nicht übertragen</span></div>
      ${to ? `<div class="row"><button class="primary" data-aidgo="1">Auswahl an ${esc(COUNTRIES[to].name)} übertragen</button></div>` : ''}`;
  };

  const navyTab = () => {
    const navy = ensureNavy(g), zones = ['H', ...zonesOf()], pct = (v: number) => `${Math.round(v * 100)} %`;
    const head = `<tr class="dim"><td></td>${zones.map(z => `<td>${ZONE_NAME[z]}</td>`).join('')}</tr>`;
    const rows = SHIP_KINDS.map(k => `<tr><td><b>${SHIPS[k].plural}</b></td>${zones.map(z => {
      const v = Math.floor(navy.own[z]?.[k] ?? 0);
      if (z === 'H') return `<td><b>${v}</b></td>`;
      return `<td><input type="number" class="ships" min="0" max="${v + Math.floor(navy.own.H[k])}" value="${v}" data-fleet="${k}" data-zone="${z}" ${canBase(g, z) ? '' : 'disabled title="kein Hafen der Achse an diesem Meer"'}></td>`;
    }).join('')}</tr>`).join('');
    const seas = zonesOf().map(z => {
      const s = strengthIn(g, z), c = control(g, z), risk = crossingRisk(g, z, 'GER');
      const foes = fleetNations(g).filter(n => eu.rel[n] === 'E').map(n => COUNTRIES[n].name).join(', ');
      return `<div class="line${s.axis + s.enemy > 0 ? '' : ' off'}"><b>${ZONE_NAME[z]}</b>
        <div class="bar"><i style="width:${Math.round(c * 100)}%;background:var(--ger)"></i></div>
        <div class="dim">Seeherrschaft der Achse <b>${pct(c)}</b> · Kampfkraft ${n1(s.axis)} gegen ${n1(s.enemy)}${s.enemy > 0 ? ` · Gefahr für Überfahrten <span class="${risk > 0.3 ? 'bad' : ''}">${pct(risk)}</span> je Bataillon` : ' · kein Gegner auf See'}
          · Transportflotten frei: <b>${Math.max(0, transportsFree(g, z))}</b>${canBase(g, z) ? '' : ' · kein Hafen der Achse'}</div>
        ${s.enemy > 0 ? `<div class="dim">Gegner hier etwa: ${SHIP_KINDS.filter(k => k !== 'tr' && s.foe[k] >= 0.5).map(k => `${Math.round(s.foe[k])} ${SHIPS[k].plural}`).join(', ') || 'kaum etwas'}</div>` : ''}${z === zonesOf()[0] && foes ? '' : ''}</div>`;
    }).join('');
    const fleets = fleetNations(g).filter(c => eu.rel[c] !== 'N' || ['ENG', 'FRA', 'ITA', 'SOV', 'USA', 'JAP'].includes(c)).map(c => {
      const f = fleetOf(g, c), r = eu.rel[c] ?? 'N';
      return `<tr><td><span class="sw" style="background:${COUNTRIES[c].color}"></span> <b>${esc(COUNTRIES[c].name)}</b></td><td>${r === 'A' ? 'verbündet' : r === 'E' ? '<span class="bad">im Krieg</span>' : 'neutral'}</td>
        <td>${SHIP_KINDS.filter(k => k !== 'tr').map(k => `${Math.floor(f[k])} ${SHIPS[k].plural}`).join(' · ')}</td></tr>`;
    }).join('');
    return `<p class="dim">Schiffe stehen nicht auf der Karte, sondern werden Seegebieten zugeteilt: Zahl eintragen, die Schiffe kommen aus dem Hafen oder kehren dorthin zurück. Im Hafen sind sie sicher, bewirken aber nichts. <b>Transportflotten</b> tragen je Runde einen Verband über See und führen den Nachschub über See – ohne sie kein Übersetzen und keine Landung. <b>Überwasserschiffe</b> ringen um die Seeherrschaft; gegen eine Übermacht gehen sie rasch verloren. <b>U-Boote</b> versenken im Krieg mit den Seemächten Schiffsraum und bremsen den Aufbau des Gegners.</p>
      <table class="fleet">${head}${rows}</table>
      <div class="dim">Trägerflugzeuge: ${navy.airT} Staffeln${Object.values(navy.own).some(s => s.cv > 0) ? ` · Träger zu ${pct(carrierAir(g))} bestückt` : ''} · Handelskrieg bisher: ${n1(navy.sunk)} Einheiten Schiffsraum versenkt, ${navy.lostUb} U-Boot-Flottillen verloren</div>
      <h3>Seegebiete</h3>${seas}
      <h3>Flotten der Mächte</h3><table>${fleets}</table>`;
  };

  const research = () => {
    const year = yearOfDay(eu.day), sh = shares(e), act = e.slots.filter(Boolean).length || 1;
    const slots = e.slots.map((id, i) => {
      if (!id) return `<div class="line off"><b>Platz ${i + 1}</b><div class="dim">frei – unten ein Vorhaben wählen</div></div>`;
      const t = TECHS[id], p = (e.prog[id] ?? 0) / t.cost, ahead = Math.max(0, t.year - year);
      const days = ((t.cost - (e.prog[id] ?? 0)) * (1 + 0.6 * ahead)) / Math.max(0.01, sh.res / act);
      return `<div class="line"><b>${esc(t.name)}</b><div class="bar"><i style="width:${Math.round(p * 100)}%;background:var(--acc)"></i></div>
        <div class="dim">${Math.round(p * 100)} % · noch etwa ${Math.ceil(days / 30)} Monate${ahead ? ` · <span class="bad">${ahead} Jahr(e) vor der Zeit, entsprechend langsamer</span>` : ''} <button data-unres="${i}">abbrechen</button></div></div>`;
    }).join('');
    const free = e.slots.includes(null);
    const list = researchable(e).filter(id => !e.slots.includes(id)).map(id => {
      const t = TECHS[id];
      return `<tr><td><b>${esc(t.name)}</b><div class="dim">${t.group === 'x' ? esc(t.text) : CATS[t.group as Cat]}</div></td><td>${t.year}${t.year > year ? ' <span class="bad">verfrüht</span>' : ''}</td>
        <td>${Math.round(((e.prog[id] ?? 0) / t.cost) * 100)} %</td><td><button data-res="${id}" ${free ? '' : 'disabled'}>erforschen</button></td></tr>`;
    }).join('');
    return `<p class="dim">Drei Vorhaben laufen gleichzeitig und teilen sich den Forschungsanteil der Industrie (${n1(sh.res)} IK). Ein fertiges Muster kommt nicht von selbst in die Truppe: Erst die Fertigungslinie umstellen, dann umrüsten oder neu aufstellen.</p>
      ${slots}<h3>Mögliche Vorhaben</h3><table><tr class="dim"><td>Vorhaben</td><td>historisch</td><td>Stand</td><td></td></tr>${list}</table>
      <h3>Abgeschlossen</h3><div class="dim">${e.done.filter(id => TECHS[id]).map(id => esc(TECHS[id].name)).join(' · ') || '–'}</div>`;
  };

  const dip = () => {
    const count: Record<string, number> = {};
    for (const d of g.divs) count[d.nation] = (count[d.nation] ?? 0) + 1;
    const rank = { E: 0, A: 1, N: 2 };
    const rows = Object.keys(COUNTRIES).filter(c => c !== 'GER' && exists(g, c) && eu.rel[c]).sort((a, b) => rank[eu.rel[a] ?? 'N'] - rank[eu.rel[b] ?? 'N'] || COUNTRIES[a].name.localeCompare(COUNTRIES[b].name)).map(c => {
      const r = eu.rel[c] ?? 'N';
      return `<tr><td><span class="sw" style="background:${COUNTRIES[c].color}"></span> <b>${esc(COUNTRIES[c].name)}</b></td>
        <td>${r === 'A' ? 'verbündet' : r === 'E' ? '<span class="bad">im Krieg</span>' : 'neutral'}</td><td class="dim">${count[c] ? `${count[c]} Verbände` : ''}</td>
        <td>${r === 'N' && c !== 'USA' ? `<button data-war="${c}">Krieg erklären …</button>` : ''}</td></tr>`;
    }).join('');
    return `<p class="dim">Verbündete führt die KI. Ein neutraler Staat stellt sein Heer erst auf, wenn er in den Krieg eintritt. Jeder Angriff auf einen europäischen Staat (außer der Sowjetunion) ruft Großbritannien und Frankreich auf den Plan.</p>
      <table>${rows}</table><h3>Untergegangen</h3><div class="dim">${eu.gone.filter(c => !['SVK', 'VIC'].includes(c) || eu.flags[`army_${c}`]).map(c => esc(COUNTRIES[c]?.name ?? c)).join(' · ') || '–'}</div>`;
  };

  const render = () => {
    const body = tab === 'prod' ? prod() : tab === 'trade' ? trade() : tab === 'navy' ? navyTab() : tab === 'build' ? build() : tab === 'army' ? armyTab() : tab === 'aid' ? aidTab() : tab === 'res' ? research() : dip();
    const box = modal.querySelector('.box'), top = box?.scrollTop ?? 0;
    modal.innerHTML = `<div class="box wide"><div class="tabs">${TABS.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}
      <span class="sp"></span><span class="dim">${fmtDate(eu.day)}</span> <button class="primary" data-close>Schließen</button></div>${body}</div>`;
    modal.querySelector('.box')!.scrollTop = top;
  };
  const close = () => {
    modal.hidden = true;
    modal.onclick = modal.oninput = modal.onchange = null;
    opts.done();
  };

  modal.hidden = false;
  modal.onclick = ev => {
    const t = ev.target as HTMLElement, d = t.closest<HTMLElement>('button, input[type=checkbox]')?.dataset;
    if (!d) return;
    if ('close' in d) return close();
    if (d.tab) tab = d.tab;
    else if (d.lock) {
      // sperren hält den augenblicklichen Anteil fest
      const lock = (e.lock ??= {});
      if (lock[d.lock] !== undefined) delete lock[d.lock];
      else lock[d.lock] = shares(e)[d.lock] / Math.max(0.01, e.ik - e.exp);
    }
    else if (d.build) queueBuild(g, d.build, opts.prov ?? undefined);
    else if (d.ship) orderShip(g, d.ship as ShipKind);
    else if (d.unship) ensureNavy(g).yard.splice(+d.unship, 1);
    else if (d.unq) {
      // bereits zugeteilte Waffen gehen ins Lager zurück
      const b = e.queue.splice(+d.unq, 1)[0];
      b.got.forEach((ty, i) => ty && (e.neu[`${TYPES[ty].cat}:${TYPES[ty].lvl ?? 0}`] = (e.neu[`${TYPES[ty].cat}:${TYPES[ty].lvl ?? 0}`] ?? 0) + +(TEMPLATES[b.kind].units[i].split(':')[1] ?? 10)));
    } else if ('auto' in d) e.auto = (t as HTMLInputElement).checked;
    else if (d.res) e.slots[e.slots.indexOf(null)] = d.res;
    else if (d.unres) e.slots[+d.unres] = null;
    else if (d.ally) (aidTo = d.ally), (aidAmt = {});
    else if (d.aidgo && aidTo) {
      for (const [id, n] of Object.entries(aidAmt)) {
        const [kind, a, b] = id.split('|');
        if (n <= 0) continue;
        if (kind === 'g') giveGear(g, aidTo, a, n);
        else if (kind === 'a') giveAir(g, aidTo, a as AirCat, +b, n);
        else giveShips(g, aidTo, a as ShipKind, n);
      }
      aidAmt = {};
    }
    else if (d.disband) leaveArmy(g, g.divs.filter(x => x.arm === +d.disband!));
    else if (d.war) return close(), opts.war(d.war);
    else return;
    render();
  };
  modal.oninput = ev => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.aid) {
      aidAmt[t.dataset.aid] = +t.value;
      t.parentElement!.querySelector('b')!.textContent = t.value;
    } else if (t.dataset.w) {
      e.w[t.dataset.w] = +t.value;
      const sh = shares(e);
      for (const k of ECO_KEYS) {
        const el = modal.querySelector(`[data-ik="${k}"]`);
        if (el) el.textContent = ikText(sh[k]);
        const out = modal.querySelector(`[data-out="${k}"]`), l = e.lines[k];
        if (out && l) out.textContent = `→ ${n1((sh[k] * l.eff * 7) / MODELS[k as Cat][l.lvl].cost)} ${GROUND.includes(k as Cat) ? 'Stärkepunkte' : 'Staffeln'} je Woche`;
      }
    } else if (t.dataset.trade) {
      e.trade[t.dataset.trade] = +t.value;
      computeIK(g);
      const inc = income(g), f = tradeFlow(g);
      modal.querySelector(`[data-tv="${t.dataset.trade}"]`)!.textContent = t.value;
      modal.querySelector('[data-tsum]')!.innerHTML = `Je Tag: Förderung ${n1(inc.own)} · Hydrierwerke ${n1(inc.syn)} · Öleinkauf <b>${n1(f.buy)}</b> · Stahleinkauf <b>${n1(f.steelBuy)}</b> · zusammen für ${n1(e.exp)} IK · Ölverkauf <b>${n1(f.sell)}</b> gegen ${n1(f.steel)} Stahl und ${n1(f.sup)} Nachschubgüter`;
    } else if (t.dataset.use) {
      setUse(e, t.dataset.use as Use, +t.value);
      for (const u of USES) {
        (modal.querySelector(`[data-use="${u}"]`) as HTMLInputElement).value = `${e.use[u]}`;
        modal.querySelector(`[data-uv="${u}"]`)!.textContent = `${e.use[u]} %`;
      }
    }
  };
  modal.onchange = ev => {
    const t = ev.target as HTMLSelectElement;
    if (t.dataset.use) return render();
    if (t.dataset.gen) {
      const a = ownArmies(g).find(x => x.id === +t.dataset.gen!);
      if (a) setGeneral(g, a, t.value || null);
      return render();
    }
    if (t.dataset.fleet) {
      // Schiffe kommen aus dem Hafen oder kehren dorthin zurück
      const k = t.dataset.fleet as ShipKind, z = t.dataset.zone!, cur = Math.floor(ensureNavy(g).own[z][k]), want = Math.max(0, Math.round(+t.value || 0));
      if (want > cur) moveShips(g, k, 'H', z, want - cur);
      else moveShips(g, k, z, 'H', cur - want);
      return render();
    }
    if (!t.dataset.line) return;
    setLine(g, t.dataset.line, +t.value);
    render();
  };
  render();
}
