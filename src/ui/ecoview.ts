// Wirtschaftsfenster des Europa-Szenarios: Produktion, Aufstellung, Forschung, Diplomatie.
import type { GameState } from '../core/types';
import { type Cat, CATS, GROUND, MODELS, TEMPLATES, TYPES } from '../data/units';
import { COUNTRIES, GER_BUILD, TECHS } from '../data/europa';
import { PROV } from '../data/world';
import { ECO_KEYS, WORKS, bestLvl, computeIK, deals, income, maxPlants, plantYield, tradeFlow, workCost, needs, neuTotal, queueBuild, researchable, setLine, shares, yearOfDay } from '../core/economy';
import { exists, fmtDate, supplyRange } from '../core/europa';
import { esc } from './draw';

export interface EcoOpts { tab?: string; prov: string | null; done: () => void; war: (c: string) => void }
const TABS: [string, string][] = [['prod', 'Produktion'], ['trade', 'Handel'], ['build', 'Aufstellung'], ['res', 'Forschung'], ['dip', 'Diplomatie']];
const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const sign = (v: number) => (v >= 0 ? '+' : '−') + n1(Math.abs(v));

export function openEco(modal: HTMLElement, g: GameState, opts: EcoOpts) {
  const eu = g.eu!, e = eu.eco;
  let tab = opts.tab ?? 'prod';

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
    const sh = shares(e), inc = income(g), field = fielded();
    const stock = (cat: string) => MODELS[cat as Cat].map((m, i) => {
      const u = e.upg[`${cat}:${i}`] ?? 0, n = e.neu[`${cat}:${i}`] ?? 0;
      return u >= 1 || n >= 1 ? `<div>${esc(m.name)}: Umrüstung/Ersatz <b>${u | 0}</b> · Neuaufstellung <b>${n | 0}</b></div>` : '';
    }).join('');
    const row = (k: string) => {
      const locked = e.lock?.[k] !== undefined;
      const ctl = `<input type="range" min="0" max="40" value="${e.w[k]}" data-w="${k}" ${locked ? 'disabled' : ''}> <span class="num" data-ik="${k}">${ikText(sh[k])}</span>
        <button class="lock${locked ? ' on' : ''}" data-lock="${k}" title="${locked ? 'Gesperrt: Der Anteil bleibt fest, auch wenn andere Regler bewegt werden. Klicken zum Entsperren.' : 'Anteil sperren: bleibt fest, wenn andere Regler bewegt werden'}">${locked ? '🔒 gesperrt' : '🔓'}</button>`;
      if (k === 'res') return `<div class="line"><b>Forschung</b><div>${ctl}</div><div class="dim">${e.slots.filter(Boolean).length} von 3 Vorhaben laufen</div></div>`;
      if (k === 'sup') return `<div class="line"><b>Nachschubgüter</b><div>${ctl}</div><div class="dim">Vorrat ${e.sup | 0} (${sign(e.rate.sup ?? 0)} je Tag) · Reichweite ${supplyRange(g)}</div></div>`;
      if (WORKS.includes(k)) {
        const pct = Math.round((100 * (e.acc[k] ?? 0)) / workCost(e, k)), eta = sh[k] > 0.01 ? `fertig in etwa ${Math.ceil((workCost(e, k) - (e.acc[k] ?? 0)) / sh[k])} Tagen` : 'ruht';
        const bar = `<div class="bar"><i style="width:${Math.min(100, pct)}%;background:var(--acc)"></i></div>`;
        if (k === 'ind') return `<div class="line"><b>Industrieausbau</b><div>${ctl}</div>${bar}<div class="dim">Bisher gebaut: <b>${e.fac}</b> Werke (je +1 IK, dauerhaft) · nächstes Werk kostet ${workCost(e, k)} IK-Tage, ${eta}</div></div>`;
        if (k === 'tank') return `<div class="line"><b>Tanklager</b><div>${ctl}</div>${bar}<div class="dim">Fassungsvermögen <b>${e.tank}</b>, gefüllt mit ${e.oil | 0} · je Ausbaustufe +100 für ${workCost(e, k)} IK-Tage, ${eta}</div></div>`;
        const cap = maxPlants(e);
        if (!e.done.includes('syn1')) return `<div class="line off"><b>Hydrierwerke (Kohle → Öl)</b><div class="dim">erst das Verfahren „Kohlehydrierung“ erforschen</div></div>`;
        return `<div class="line"><b>Hydrierwerke (Kohle → Öl)</b><div>${e.plants >= cap ? '<span class="bad">Die Kohle der eigenen Reviere reicht für kein weiteres Werk.</span>' : ctl}</div>${e.plants >= cap ? '' : bar}
          <div class="dim">In Betrieb: <b>${Math.min(e.plants, cap)}</b> von höchstens ${cap} Werken (Kohleförderung ${n1(e.coal)}, je Werk 3) · Ausbeute ${n1(plantYield(e))} Öl je Tag und Werk, zusammen <b>${n1(inc.syn)}</b> · nächstes Werk ${workCost(e, k)} IK-Tage${e.plants >= cap ? '' : ', ' + eta}</div></div>`;
      }
      const cat = k as Cat, l = e.lines[cat], air = cat === 'jg' || cat === 'bo';
      if (l.lvl < 0) return `<div class="line off"><b>${CATS[cat]}</b><div class="dim">noch kein Muster erforscht – die Linie ruht</div></div>`;
      const best = bestLvl(e, cat), m = MODELS[cat][l.lvl];
      const sel = `<select data-line="${cat}">${MODELS[cat].map((x, i) => (e.done.includes(`${cat}${i}`) ? `<option value="${i}" ${i === l.lvl ? 'selected' : ''}>${esc(x.name)}</option>` : '')).join('')}</select>`;
      const out = (sh[cat] * l.eff * 7) / m.cost;
      const have = air ? (cat === 'jg' ? e.airF : e.airB).map((n, i) => (n ? `${n}× ${esc(MODELS[cat][i].name)}` : '')).filter(Boolean).join(' · ')
        : (field[cat] ?? []).map((n, i) => (n ? `${n}× ${esc(MODELS[cat][i].name)}` : '')).filter(Boolean).join(' · ');
      return `<div class="line${best > l.lvl ? ' new' : ''}"><b>${CATS[cat]}</b>
        <div>${sel} <span class="dim">Auslastung ${Math.round(l.eff * 100)} %</span>${best > l.lvl ? ` <span class="bad">neueres Muster verfügbar: ${esc(MODELS[cat][best].name)}</span>` : ''}</div>
        <div>${ctl} <span class="dim" data-out="${cat}">→ ${n1(out)} ${air ? 'Staffeln' : 'Stärkepunkte'} je Woche</span></div>
        <div><span class="dim">neue Einheiten</span> <input type="range" min="0" max="100" step="10" value="${e.split[cat]}" data-split="${cat}"> <span class="dim">alte Einheiten umrüsten</span> <span class="num" data-sp="${cat}">${e.split[cat]} %</span></div>
        <div class="dim">${air ? 'Staffeln' : 'Im Heer (Bataillone)'}: ${have || '–'}</div>${air ? '' : `<div class="dim">${stock(cat)}</div>`}</div>`;
    };
    const res = (label: string, v: number, r: number, key: string) => `<span class="${e.short.includes(key) ? 'bad' : ''}">${label} <b>${v | 0}</b> <span class="dim">(${sign(r)}/Tag)</span></span>`;
    return `<div class="stats"><span>Industrie <b>${n1(e.ik)}</b> IK <span class="dim">(Reich ${n1(e.ikHome)}, besetzt ${n1(e.ikOcc)}${e.exp ? `, davon Ausfuhr ${n1(e.exp)}` : ''})</span></span>
        ${res('Stahl', e.steel, e.rate.steel ?? 0, 'steel')}${res(`Öl <span class="dim">(Lager ${e.tank})</span>`, e.oil, e.rate.oil ?? 0, 'oil')}${res('Mannschaften', e.men, e.rate.men ?? 0, 'men')}</div>
      <div class="dim">Zufluss je Tag: Stahl ${n1(inc.steel)} (${inc.notes.join(', ')}) · Öl ${n1(inc.oil)} (Förderung ${n1(inc.own)}, Hydrierwerke ${n1(inc.syn)}, Einkauf ${n1(inc.buy)})${(e.rate.spill ?? 0) > 0 ? ` · <span class="bad">Tanklager voll: ${n1(e.rate.spill)} Öl je Tag gehen verloren</span>` : ''}${e.short.length ? ` · <span class="bad">Mangel: ${e.short.map(s => ({ oil: 'Öl – schnelle Verbände und Luftwaffe gelähmt', steel: 'Stahl – Fertigung gedrosselt', sup: 'Nachschubgüter – kein Ersatz' })[s]).join('; ')}</span>` : ''}</div>
      <p class="dim">Die Regler verteilen die Industrie. Jede Linie fertigt ein Muster; nach dem Umstellen auf ein neues Muster läuft sie erst wieder an (Auslastung 25 %, dann +8 % je Woche). Das <b>Schloss</b> sperrt einen Posten: Sein Anteil bleibt fest, auch wenn Sie andere Regler bewegen. Der zweite Regler legt fest, wie viel der Fertigung in die <b>Umrüstung und den Ersatz</b> bestehender Einheiten geht und wie viel in <b>Neuaufstellungen</b>.</p>
      ${ECO_KEYS.map(k => (k === 'ind' ? '<h3>Ausbau</h3>' : k === 'inf' ? '<h3>Rüstung</h3>' : '') + row(k)).join('')}`;
  };

  const trade = () => {
    const inc = income(g), f = tradeFlow(g), unit = { ik: 'IK', steel: 'Stahl', sup: 'Nachschubgüter' };
    const row = (d: ReturnType<typeof deals>[number]) => {
      const v = Math.min(d.max, e.trade[d.id] ?? 0);
      return `<div class="line${d.closed ? ' off' : ''}"><b>${esc(d.name)}</b>
        <div><input type="range" min="0" max="${d.max}" value="${v}" data-trade="${d.id}"> <span class="num" data-tv="${d.id}">${v}</span> Öl je Tag <span class="dim">(höchstens ${d.max})</span></div>
        <div class="dim">${d.sell ? `bringt ${n1(d.price)} ${unit[d.pay]} je Öl` : `kostet ${n1(d.price)} IK je Öl und Tag (Ausfuhrgüter)`}${d.closed ? ` · <span class="bad">geschlossen: ${esc(d.closed)}</span>` : ''}</div></div>`;
    };
    const all = deals(g);
    return `<div class="stats"><span class="${e.short.includes('oil') ? 'bad' : ''}">Öl <b>${e.oil | 0}</b> von ${e.tank} <span class="dim">(${sign(e.rate.oil ?? 0)}/Tag in der letzten Runde, Verbrauch ${n1(e.rate.oilUse ?? 0)})</span></span></div>
      <div class="dim" data-tsum>Je Tag: Förderung ${n1(inc.own)} · Hydrierwerke ${n1(inc.syn)} · Einkauf <b>${n1(f.buy)}</b> für ${n1(e.exp)} IK · Verkauf <b>${n1(f.sell)}</b> gegen ${n1(f.steel)} Stahl und ${n1(f.sup)} Nachschubgüter</div>
      <p class="dim">Öl wird gegen Ausfuhrgüter eingekauft: Die dafür nötige Industrie fehlt der Rüstung. Was die Tanklager nicht fassen, geht verloren – Lager lassen sich unter Produktion ausbauen. Verkauft wird nur aus dem, was nach dem eigenen Verbrauch im Lager bleibt. Im Krieg mit Großbritannien ist der Seeweg gesperrt.</p>
      <h3>Öl einkaufen</h3>${all.filter(d => !d.sell).map(row).join('')}<h3>Öl verkaufen</h3>${all.filter(d => d.sell).map(row).join('')}`;
  };

  const build = () => {
    const at = opts.prov && eu.core[opts.prov] && eu.owner[opts.prov] === 'GER' ? opts.prov : 'berlin';
    const rows = GER_BUILD.map(([kind]) => {
      const t = TEMPLATES[kind], nd = needs(kind);
      const ok = Object.keys(nd).every(c => e.lines[c].lvl >= 0);
      return `<tr><td><b>${esc(t.label)}</b><div class="dim">${t.units.map(u => u.split(':')[0]).join(' ')}</div></td>
        <td>${Object.entries(nd).map(([c, n]) => `<span class="${neuTotal(e, c) < n ? 'bad' : ''}">${CATS[c as Cat]} ${n} <span class="dim">(Lager ${neuTotal(e, c) | 0})</span></span>`).join('<br>')}</td>
        <td><button data-build="${kind}" ${ok ? '' : 'disabled'}>aufstellen</button></td></tr>`;
    }).join('');
    const queue = e.queue.map((b, i) => `<tr><td><b>${esc(b.name)}</b> <span class="dim">${esc(TEMPLATES[b.kind].label)} · ${esc(PROV[b.prov].name)}</span></td>
      <td>${b.got.filter(Boolean).length}/${b.got.length} Bataillone ausgestattet · seit ${fmtDate(b.day)}</td><td><button data-unq="${i}">streichen</button></td></tr>`).join('');
    return `<p class="dim">Neue Verbände werden Bataillon für Bataillon aus dem Lager „Neuaufstellung“ ausgestattet – immer mit dem neuesten vorrätigen Muster. Fertig sind sie frühestens nach 30 Tagen Ausbildung. Aufstellungsort: <b>${esc(PROV[at].name)}</b> (die auf der Karte gewählte Provinz im Reichsgebiet, sonst Berlin).</p>
      <label><input type="checkbox" data-auto ${e.auto ? 'checked' : ''}> Selbsttätig aufstellen, was das Lager hergibt (erst schnelle Verbände, dann Infanterie)</label>
      <h3>In Aufstellung (${e.queue.length})</h3><table>${queue || '<tr><td class="dim">nichts</td></tr>'}</table>
      <h3>Gliederungen</h3><table>${rows}</table>`;
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
    const body = tab === 'prod' ? prod() : tab === 'trade' ? trade() : tab === 'build' ? build() : tab === 'res' ? research() : dip();
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
    else if (d.unq) {
      // bereits zugeteilte Waffen gehen ins Lager zurück
      const b = e.queue.splice(+d.unq, 1)[0];
      b.got.forEach((ty, i) => ty && (e.neu[`${TYPES[ty].cat}:${TYPES[ty].lvl ?? 0}`] = (e.neu[`${TYPES[ty].cat}:${TYPES[ty].lvl ?? 0}`] ?? 0) + +(TEMPLATES[b.kind].units[i].split(':')[1] ?? 10)));
    } else if ('auto' in d) e.auto = (t as HTMLInputElement).checked;
    else if (d.res) e.slots[e.slots.indexOf(null)] = d.res;
    else if (d.unres) e.slots[+d.unres] = null;
    else if (d.war) return close(), opts.war(d.war);
    else return;
    render();
  };
  modal.oninput = ev => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.w) {
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
      modal.querySelector('[data-tsum]')!.innerHTML = `Je Tag: Förderung ${n1(inc.own)} · Hydrierwerke ${n1(inc.syn)} · Einkauf <b>${n1(f.buy)}</b> für ${n1(e.exp)} IK · Verkauf <b>${n1(f.sell)}</b> gegen ${n1(f.steel)} Stahl und ${n1(f.sup)} Nachschubgüter`;
    } else if (t.dataset.split) {
      e.split[t.dataset.split] = +t.value;
      modal.querySelector(`[data-sp="${t.dataset.split}"]`)!.textContent = `${t.value} %`;
    }
  };
  modal.onchange = ev => {
    const t = ev.target as HTMLSelectElement;
    if (!t.dataset.line) return;
    setLine(g, t.dataset.line, +t.value);
    render();
  };
  render();
}
