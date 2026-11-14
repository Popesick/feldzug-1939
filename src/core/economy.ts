// Deutsche Kriegswirtschaft im Europa-Szenario: Industrie, Rohstoffe, Fertigungslinien,
// Umrüstung und Neuaufstellung, Forschung. Bewusst grob – ein Regler je Posten.
import type { Division, Eco, GameState } from './types';
import { PLIST, PROV } from '../data/world';
import { type Cat, CATS, GROUND, MODELS, TEMPLATES, TYPES, catOf, ladder } from '../data/units';
import { GER_BUILD, START_TECH, TECHS } from '../data/europa';
import { indLeft, repair } from './airwar';
import { STACK, XP_NEW, diluteXp, divsIn, log, maxS } from './game';
import { buildShips, ensureNavy } from './navy';

export const WORKS = ['ind', 'fix', 'syn', 'tank'];
/** Flugzeuggattungen und ihr Staffelbestand in der Wirtschaft. */
export const AIR: Partial<Record<Cat, 'airF' | 'airB' | 'airS'>> = { jg: 'airF', bo: 'airB', sb: 'airS' };
/** Reparatur zerstörter Industrie kostet ein Viertel eines Neubaus. */
export const FIX_SHARE = 0.25;
/** Marine: Werften und die eigene Fertigung der Trägerflugzeuge. */
export const NAVAL = ['mar', 'tf'];
export const TF_COST = 330; // Industrietage je Staffel Trägerflugzeuge
export const ECO_KEYS = ['res', 'sup', ...WORKS, ...(Object.keys(CATS) as Cat[]), ...NAVAL];
export const KEY_NAME: Record<string, string> = { res: 'Forschung', sup: 'Nachschubgüter', ind: 'Industrieausbau', fix: 'Industrie reparieren', syn: 'Hydrierwerke', tank: 'Tanklager', ...CATS, mar: 'Werften', tf: 'Trägerflugzeuge' };
const TANK_STEP = 100; // Fassungsvermögen je fertigem Tanklager
const COAL_PER_PLANT = 3;
const MEN_PER_POINT = 0.3; // Tausend Mann je Stärkepunkt
const STEEL_PER_IK = 0.6;
const TRAIN_DAYS = 30;

/** Verwendung der Fertigung: Neuaufstellung, Umrüstung, Verstärkung. Zusammen 100, jeder Anteil mindestens USE_MIN. */
export const USES = ['neu', 'upg', 'rep'] as const;
export type Use = (typeof USES)[number];
export const USE_NAME: Record<Use, string> = { neu: 'Neuaufstellung', upg: 'Umrüstung', rep: 'Verstärkung' };
export const USE_MIN = 10;
const USE_START: Record<Use, number> = { neu: 40, upg: 20, rep: 40 };

/** Stellt einen Anteil ein; die beiden anderen teilen sich den Rest im bisherigen Verhältnis. */
export function setUse(e: Eco, k: Use, v: number) {
  const [a, b] = USES.filter(x => x !== k), rest = 100 - (e.use[k] = Math.max(USE_MIN, Math.min(100 - 2 * USE_MIN, Math.round(v))));
  e.use[a] = Math.max(USE_MIN, Math.min(rest - USE_MIN, Math.round((rest * e.use[a]) / (e.use[a] + e.use[b]))));
  e.use[b] = rest - e.use[a];
}

/** Offener Bedarf einer Gattung in Stärkepunkten, abzüglich dessen, was schon im Lager liegt. */
export function demand(g: GameState, cat: Cat): Record<Use, number> {
  const e = g.eu!.eco, lvl = e.lines[cat].lvl, sum = (pool: Record<string, number>) => MODELS[cat].reduce((a, _, i) => a + (pool[`${cat}:${i}`] ?? 0), 0);
  let miss = 0, old = 0, open = 0;
  for (const d of g.divs)
    if (isMine(d))
      for (const u of d.units) {
        if (TYPES[u.t].cat !== cat) continue;
        miss += Math.max(0, maxS(d) - u.s);
        if ((TYPES[u.t].lvl ?? 0) < lvl) old += u.s;
      }
  for (const b of e.queue) b.got.forEach((t, i) => {
    const [base, s] = TEMPLATES[b.kind].units[i].split(':');
    if (t === null && catOf(base) === cat) open += s ? +s : 10;
  });
  return {
    // die selbsttätige Aufstellung braucht einen Vorrat, aus dem sie ganze Verbände ausstatten kann
    neu: Math.max(0, open + (e.auto ? 150 : 0) - sum(e.neu)),
    upg: Math.max(0, old - (e.upg[`${cat}:${lvl}`] ?? 0)),
    rep: Math.max(0, miss - sum(e.rep)),
  };
}

/** Verteilt die Fertigung nach den Anteilen. Wo kein Bedarf (mehr) besteht, geht der Rest an die übrigen Bereiche. */
export function allot(out: number, w: Record<Use, number>, need: Record<Use, number>): Record<Use, number> {
  const res: Record<Use, number> = { neu: 0, upg: 0, rep: 0 };
  let left = out, open = USES.filter(k => need[k] > 0);
  while (left > 1e-9 && open.length) {
    const tw = open.reduce((a, k) => a + w[k], 0), part = left, still: Use[] = [];
    for (const k of open) {
      const give = Math.min((part * w[k]) / tw, need[k] - res[k]);
      res[k] += give;
      left -= give;
      if (need[k] - res[k] > 1e-9) still.push(k);
    }
    if (still.length === open.length) break;
    open = still;
  }
  // nirgends Bedarf: auf Lager für spätere Aufstellungen
  res.neu += Math.max(0, left);
  return res;
}

export function initEco(): Eco {
  const lines: Eco['lines'] = {};
  for (const c of Object.keys(CATS)) lines[c] = { lvl: START_TECH.includes(`${c}0`) ? 0 : -1, eff: 1 };
  return {
    ik: 100, ikHome: 100, ikOcc: 0,
    w: { res: 15, sup: 4, ind: 5, fix: 8, syn: 5, tank: 2, inf: 16, kfz: 12, art: 13, pak: 9, pzl: 8, pzm: 9, pzs: 6, jg: 10, bo: 9, sb: 6, mar: 4, tf: 0 },
    steel: 800, oil: 500, men: 350, sup: 300, rate: {},
    lines, neu: {}, upg: {}, rep: {}, use: { ...USE_START }, acc: {}, queue: [], auto: true,
    done: [...START_TECH], prog: {}, slots: ['pzl1', 'jg1', 'bo1'],
    airF: [6], airB: [6], airS: [],
    num: { 'Infanterie-Division': 31, 'Panzer-Division': 3, 'Gebirgs-Division': 0, 'Infanterie-Division (mot.)': 0, 'leichte Division': 0, 'schwere Panzer-Abteilung': 500, 'Festungs-Brigade': 0 },
    short: [],
    fac: 0, plants: 0, tank: 1000, coal: 0, exp: 0, trade: { us: 8, rom: 6 },
  };
}

/** Ältere Spielstände kennen Ausbau, Tanklager und Handel noch nicht. */
export function migrateEco(e: Eco) {
  e.w.fix ??= 8;
  e.w.sb ??= 6;
  e.lines.sb ??= { lvl: -1, eff: 1 };
  e.airS ??= [];
  e.use ??= { ...USE_START };
  if (!e.rep) {
    // früher diente das Umrüstlager auch dem Ersatz; die erste Generation hat nichts umzurüsten
    e.rep = {};
    for (const c of GROUND) (e.rep[`${c}:0`] = e.upg[`${c}:0`] ?? 0), delete e.upg[`${c}:0`];
  }
  e.w.mar ??= 4;
  e.w.tf ??= 0;
  if (e.tank !== undefined) return;
  Object.assign(e, { fac: 0, plants: 3 * ['syn1', 'syn2', 'syn3'].filter(t => e.done.includes(t)).length, tank: Math.max(1000, Math.ceil(e.oil / 100) * 100), coal: 0, exp: 0, trade: { us: 8, rom: 6, sov: 5 } });
  Object.assign(e.w, { ind: 5, syn: 5, tank: 2 });
}

/** IK-Tage für die nächste Ausbaustufe. Fabriken werden teurer, je mehr schon stehen. */
export const workCost = (e: Eco, k: string): number => (k === 'ind' ? 450 + 10 * e.fac : k === 'fix' ? FIX_SHARE * workCost(e, 'ind') : k === 'syn' ? 300 : 100);
export const maxPlants = (e: Eco) => Math.floor(e.coal / COAL_PER_PLANT);
/** Öl je Tag und Hydrierwerk, je nach Stand der Verfahren. */
export const plantYield = (e: Eco) => (e.done.includes('syn1') ? 0.6 : 0) * (e.done.includes('syn2') ? 1.3 : 1) * (e.done.includes('syn3') ? 1.3 : 1);
const workOpen = (e: Eco, k: string) => (k === 'fix' ? (e.dmg ?? 0) > 0.01 : k !== 'syn' || (e.done.includes('syn1') && e.plants < maxPlants(e)));

export interface Deal { id: string; name: string; good: 'oil' | 'steel'; sell: boolean; max: number; price: number; pay: 'ik' | 'steel' | 'sup'; closed?: string; note?: string }
/** Handelspartner für Öl und Stahl. Einkauf kostet Industrie (Ausfuhrgüter), Ölverkauf bringt Stahl oder Nachschubgüter. */
export function deals(g: GameState): Deal[] {
  const eu = g.eu!, rel = (c: string) => (eu.gone.includes(c) ? 'X' : eu.rel[c] ?? 'N');
  const rom = rel('ROM'), sov = rel('SOV'), swe = rel('SWE'), ita = rel('ITA'), hun = rel('HUN'), usa = rel('USA');
  const blockade = rel('ENG') === 'E' ? 'britische Seeblockade' : undefined;
  const pact = sov !== 'N' ? (sov === 'E' ? 'im Krieg' : 'untergegangen') : eu.flags.pakt ? undefined : 'kein Wirtschaftsabkommen (erst mit dem Pakt)';
  // der Nahe Osten liefert über See – oder über Land, sobald Irak oder Iran an der Seite der Achse stehen
  const orient = rel('IRQ') === 'A' || rel('PER') === 'A';
  const gone = (r: string) => (r === 'E' ? 'im Krieg' : r === 'X' ? 'untergegangen' : undefined);
  const list: Deal[] = [
    { id: 'us', good: 'oil', name: 'Übersee (USA, Venezuela, Mexiko)', sell: false, max: 26, price: 0.4, pay: 'ik', closed: blockade, note: 'vor dem Krieg die Hauptquelle der deutschen Öleinfuhr' },
    { id: 'rom', good: 'oil', name: rom === 'A' ? 'Rumänien (Bündnis)' : 'Rumänien', sell: false, max: rom === 'A' ? 16 : 9, price: rom === 'A' ? 0.3 : 0.4, pay: 'ik',
      closed: rom === 'X' ? (PLIST.some(p => p.id === 'ploiesti' && eu.owner[p.id] === 'GER') ? 'Ölfelder in eigener Hand' : 'Staat untergegangen') : rom === 'E' ? 'im Krieg' : undefined },
    { id: 'sov', good: 'oil', name: 'Sowjetunion', sell: false, max: 10, price: 0.3, pay: 'ik', closed: pact, note: 'Wirtschaftsabkommen von 1940: rund 900 000 t Öl bis Juni 1941' },
    { id: 'hun', good: 'oil', name: 'Ungarn (Ölfelder von Zala)', sell: false, max: hun === 'A' ? 3 : 2, price: 0.35, pay: 'ik', closed: gone(hun) },
    { id: 'ori', good: 'oil', name: 'Naher Osten (Iran, Irak)', sell: false, max: orient ? 10 : 6, price: 0.4, pay: 'ik', closed: orient ? undefined : blockade,
      note: orient ? 'Landweg über einen verbündeten Staat' : 'Seeweg; im Krieg mit Großbritannien nur offen, wenn Irak oder Iran verbündet sind' },
    { id: 'st_us', good: 'steel', name: 'USA (Schrott und Stahl)', sell: false, max: 14, price: 0.3, pay: 'ik', closed: usa === 'E' ? 'im Krieg' : blockade },
    { id: 'st_sov', good: 'steel', name: 'Sowjetunion (Eisen-, Mangan- und Chromerz)', sell: false, max: 10, price: 0.25, pay: 'ik', closed: pact },
    { id: 'st_swe', good: 'steel', name: 'Schweden (zusätzliches Erz)', sell: false, max: 10, price: 0.3, pay: 'ik', closed: swe !== 'N' ? 'kein Handel' : undefined, note: 'über die feste Erzlieferung hinaus' },
    { id: 'swe', good: 'oil', name: 'Schweden (zahlt in Erz)', sell: true, max: 6, price: 2, pay: 'steel', closed: swe !== 'N' ? 'kein Handel' : undefined },
    { id: 'ita', good: 'oil', name: 'Italien (zahlt in Gütern)', sell: true, max: 6, price: 1.5, pay: 'sup', closed: gone(ita) },
  ];
  // Staaten, die es auf dieser Karte nicht gibt, bieten nichts an
  return list.filter(d => (d.id !== 'ori' || eu.rel.IRQ !== undefined || eu.rel.PER !== undefined) && (d.id !== 'hun' || eu.rel.HUN !== undefined));
}
/** Vereinbarte Tagesmengen. Geschlossene Wege liefern nichts, die Einstellung bleibt aber stehen. buy/sell = Öl, steelBuy = gekaufter Stahl. */
export function tradeFlow(g: GameState) {
  const e = g.eu!.eco, f = { buy: 0, sell: 0, ik: 0, steel: 0, sup: 0, steelBuy: 0 };
  for (const d of deals(g)) {
    const n = d.closed ? 0 : Math.min(d.max, e.trade[d.id] ?? 0);
    if (d.sell) (f.sell += n), (f[d.pay] += n * d.price);
    else (d.good === 'steel' ? (f.steelBuy += n) : (f.buy += n)), (f.ik += n * d.price);
  }
  return f;
}

const has = (e: Eco, tech: string) => e.done.includes(tech);
/** Höchste erforschte Generation einer Gattung, −1 wenn noch keine. */
export function bestLvl(e: Eco, cat: string): number {
  let l = -1;
  MODELS[cat as Cat].forEach((_, i) => has(e, `${cat}${i}`) && (l = i));
  return l;
}
export const yearOfDay = (day: number) => new Date(Date.UTC(1936, 0, 1 + day)).getUTCFullYear();

export function computeIK(g: GameState) {
  const eu = g.eu!, e = eu.eco;
  let home = 0, occ = 0;
  let coal = 0;
  e.dmg = 0;
  for (const p of PLIST)
    if (eu.owner[p.id] === 'GER') {
      // Bombenschäden mindern die Industrie, bis sie repariert sind
      const ind = indLeft(g, p.id);
      e.dmg += (p.ind ?? 0) - ind;
      eu.core[p.id] ? (home += ind) : (occ += ind * 0.4);
      // Kohle ist nicht eigens kartiert: die Reviere fördern Kohle im Maß ihrer Schwerindustrie
      coal += (p.steel ?? 0) * (eu.core[p.id] ? 1 : 0.6);
    }
  home += e.fac;
  e.coal = coal;
  const mult = 1 + (has(e, 'ind1') ? 0.06 : 0) + (has(e, 'ind2') ? 0.06 : 0) + (has(e, 'ind3') ? 0.08 : 0) + (eu.flags.totalerkrieg ? 0.15 : 0);
  e.ikHome = home * mult;
  e.ikOcc = occ * mult;
  e.ik = e.ikHome + e.ikOcc;
  e.exp = Math.min(tradeFlow(g).ik, e.ik * 0.5);
}

/** Posten, auf die sich die Industrie gerade verteilt (Linien ohne Muster ruhen). */
export function shares(e: Eco): Record<string, number> {
  const act = ECO_KEYS.filter(k => k === 'res' || k === 'sup' || k === 'mar' || (k === 'tf' ? e.done.includes('tf1') : WORKS.includes(k) ? workOpen(e, k) : e.lines[k].lvl >= 0));
  // gesperrte Posten behalten ihren festen Anteil, der Rest verteilt sich nach den Reglern
  const lock = e.lock ?? {}, fixed = act.filter(k => lock[k] !== undefined), held = fixed.reduce((a, k) => a + lock[k], 0), squeeze = held > 1 ? 1 / held : 1;
  const free = act.filter(k => lock[k] === undefined), sum = free.reduce((a, k) => a + e.w[k], 0) || 1;
  const out: Record<string, number> = {};
  // die Ausfuhr für den Öleinkauf geht vorab von der Industrie ab
  const ik = e.ik - e.exp;
  for (const k of ECO_KEYS) out[k] = !act.includes(k) ? 0 : lock[k] !== undefined ? ik * lock[k] * squeeze : (ik * Math.max(0, 1 - held) * e.w[k]) / sum;
  return out;
}

/** Tageserträge aus eigenem Gebiet und Handel. */
export function income(g: GameState) {
  const eu = g.eu!, e = eu.eco, rel = (c: string) => (eu.gone.includes(c) ? 'X' : eu.rel[c] ?? 'N');
  let steel = 0, oil = 0;
  const notes: string[] = [];
  for (const p of PLIST) if (eu.owner[p.id] === 'GER') (steel += (p.steel ?? 0) * (eu.core[p.id] ? 1 : 0.6)), (oil += (p.oil ?? 0) * (eu.core[p.id] ? 1 : 0.6));
  const own = oil;
  if (rel('ENG') !== 'E') (steel += 12), notes.push('Überseehandel');
  else notes.push('Seeblockade');
  if (rel('SWE') === 'N') (steel += 12), notes.push('Schwedenerz');
  if (eu.flags.pakt && rel('SOV') === 'N') (steel += 4), notes.push('sowjetische Lieferungen');
  const tr = tradeFlow(g), syn = Math.min(e.plants, maxPlants(e)) * plantYield(e);
  steel += tr.steel + tr.steelBuy;
  oil += syn + tr.buy;
  const men = (0.011 * e.ikHome + 0.1) * (Object.entries(eu.rel).some(([c, r]) => r === 'E' && c !== 'REP') ? 1.5 : 1);
  return { steel, oil, men, notes, own, syn, buy: tr.buy, sell: tr.sell, sup: tr.sup, steelBuy: tr.steelBuy };
}

const isMine = (d: Division) => d.nation === 'GER';
const usesOil = (t: string) => TYPES[t].move === 'track' || TYPES[t].move === 'wheel';

/** Nimmt bis zu n Punkte einer Gattung aus dem Ersatzlager, bevorzugt die gewünschte Generation. */
function draw(e: Eco, cat: string, lvl: number, n: number): number {
  let got = 0;
  const order = [lvl, ...MODELS[cat as Cat].map((_, i) => i).filter(i => i !== lvl).sort((a, b) => Math.abs(a - lvl) - Math.abs(b - lvl))];
  for (const l of order)
    for (const pool of [e.rep]) {
      const k = `${cat}:${l}`, take = Math.min(n - got, pool[k] ?? 0);
      if (take > 0) (pool[k] -= take), (got += take);
      if (got >= n) return got;
    }
  return got;
}

export function nextName(e: Eco, kind: string): string {
  const stem = GER_BUILD.find(b => b[0] === kind)?.[1] ?? TEMPLATES[kind].label;
  e.num[stem] = (e.num[stem] ?? 0) + 1;
  return `${e.num[stem]}. ${stem}`;
}

/** Bedarf einer Schablone an Waffenpunkten je Gattung. */
export function needs(kind: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of TEMPLATES[kind].units) {
    const [b, s] = u.split(':'), c = catOf(b);
    out[c] = (out[c] ?? 0) + (s ? +s : 10);
  }
  return out;
}
export const neuTotal = (e: Eco, cat: string) => MODELS[cat as Cat].reduce((a, _, i) => a + (e.neu[`${cat}:${i}`] ?? 0), 0);

export function queueBuild(g: GameState, kind: string, prov?: string) {
  const eu = g.eu!, e = eu.eco;
  const at = prov && eu.core[prov] && eu.owner[prov] === 'GER' ? prov : 'berlin';
  e.queue.push({ kind, name: nextName(e, kind), prov: at, day: eu.day, got: TEMPLATES[kind].units.map(() => null) });
}

export function setLine(g: GameState, cat: string, lvl: number) {
  const e = g.eu!.eco, l = e.lines[cat];
  if (l.lvl === lvl || !has(e, `${cat}${lvl}`)) return;
  // Umstellen kostet Anlaufzeit: die Linie beginnt bei einem Viertel ihrer Leistung
  l.eff = l.lvl < 0 ? 0.5 : 0.25;
  l.lvl = lvl;
  log(g, `Fertigung ${CATS[cat as Cat]} auf ${MODELS[cat as Cat][lvl].name} umgestellt.`);
}

export function researchable(e: Eco): string[] {
  return Object.values(TECHS).filter(t => !has(e, t.id) && !t.loot && (!t.req || has(e, t.req))).sort((a, b) => a.year - b.year).map(t => t.id);
}

function spawn(g: GameState, kind: string, name: string, prov: string, types: string[]) {
  const tp = TEMPLATES[kind], eu = g.eu!;
  let at = prov;
  if (g.ctrl[at] !== 'GER' || divsIn(g, at).length >= STACK)
    at = PLIST.filter(p => eu.core[p.id] && g.ctrl[p.id] === 'GER' && divsIn(g, p.id).length < STACK)
      .sort((a, b) => Math.hypot(a.x - PROV[prov].x, a.y - PROV[prov].y) - Math.hypot(b.x - PROV[prov].x, b.y - PROV[prov].y))[0]?.id ?? 'berlin';
  eu.flags._id = (eu.flags._id ?? 1000) + 1;
  g.divs.push({
    id: eu.flags._id, name, side: 'GER', nation: 'GER', kind, army: 'Ersatzheer', q: tp.q, prov: at,
    units: tp.units.map((u, i) => ({ t: types[i], s: +(u.split(':')[1] ?? 10) })),
    mp: 0, dug: 0, fought: false, moved: true, order: null, oos: false, xp: XP_NEW,
  });
  log(g, `${name} in ${PROV[at].name} aufgestellt.`);
}

/** Wählt ohne Zutun des Spielers die anspruchsvollste Gliederung, für die das Lager reicht. */
function autoQueue(g: GameState) {
  const e = g.eu!.eco;
  if (!e.auto) return;
  const free: Record<string, number> = {};
  for (const c of GROUND) free[c] = neuTotal(e, c);
  for (const b of e.queue) b.got.forEach((t, i) => t === null && (free[catOf(TEMPLATES[b.kind].units[i].split(':')[0])] -= 10));
  const fits = (kind: string) => Object.entries(needs(kind)).every(([c, n]) => free[c] >= n);
  // solange das Lager reicht: erst schnelle Verbände, dann Infanterie
  for (let n = e.queue.length; n < 8; n++) {
    // höchstens jeder fünfte Verband ein schneller, sonst fehlt der Infanterie die Ausstattung
    const army = g.divs.filter(isMine), fast = army.filter(d => TEMPLATES[d.kind].mp > 1).length + e.queue.filter(b => TEMPLATES[b.kind].mp > 1).length;
    const pool = fast * 5 < army.length + e.queue.length ? ['PZD41', 'PZD', 'PZD36', 'LEI', 'IDM', 'ID1', 'ID2'] : ['ID1', 'ID2'];
    const kind = pool.find(k => !(k === 'PZD36' && e.lines.pzm.lvl >= 0) && fits(k));
    if (!kind) return;
    queueBuild(g, kind);
    for (const [c, v] of Object.entries(needs(kind))) free[c] -= v;
  }
}

/** Ein Rundenabschnitt der Wirtschaft: Erträge, Fertigung, Forschung, Ersatz, Umrüstung, Aufstellung. */
export function ecoTick(g: GameState, days: number) {
  const eu = g.eu!, e = eu.eco, war = Object.entries(eu.rel).some(([c, r]) => r === 'E' && c !== 'REP' && !eu.gone.includes(c));
  computeIK(g);
  const sh = shares(e), inc = income(g), mine = g.divs.filter(isMine);
  e.short = [];
  const before = { steel: e.steel, oil: e.oil, men: e.men, sup: e.sup };
  e.steel = Math.min(6000, e.steel + inc.steel * days);
  e.oil += inc.oil * days;
  e.men += inc.men * days;

  // Verbrauch von Treibstoff und Nachschubgütern
  let oilUse = 0, supUse = 0;
  for (const d of mine) {
    const busy = war && (d.moved || d.fought) ? 4 : 1;
    supUse += 0.03 * busy * days;
    for (const u of d.units) if (usesOil(u.t)) oilUse += 0.05 * busy * days * (u.s / 10);
  }
  if (war) for (const a of Object.values(g.airAssign.GER)) oilUse += (a.f + a.b) * 0.25 * days;
  if (war) for (const n of Object.values(eu.bomb ?? {})) oilUse += n * 0.4 * days;
  e.oil -= oilUse;
  e.sup += sh.sup * days - supUse;
  if (e.oil <= 0) (e.oil = 0), e.short.push('oil');
  // Verkauf nur aus dem, was nach dem eigenen Verbrauch im Lager bleibt
  const sold = inc.sell > 0 ? Math.min(1, e.oil / (inc.sell * days)) : 0;
  e.oil -= inc.sell * days * sold;
  e.steel -= tradeFlow(g).steel * days * (1 - sold);
  e.sup += inc.sup * days * sold;
  // was die Tanklager nicht fassen, ist verloren
  const spill = Math.max(0, e.oil - e.tank);
  e.oil -= spill;
  if (e.sup <= 0) (e.sup = 0), e.short.push('sup');
  e.sup = Math.min(e.sup, 3000);

  // Fertigung
  const prodIK = [...WORKS, ...Object.keys(CATS), ...NAVAL].reduce((a, c) => a + sh[c], 0);
  const steelNeed = prodIK * STEEL_PER_IK * days;
  const scale = steelNeed > 0 ? Math.min(1, e.steel / steelNeed) : 1;
  e.steel -= steelNeed * scale;
  if (scale < 0.999) e.short.push('steel');
  for (const cat of Object.keys(CATS) as Cat[]) {
    const l = e.lines[cat];
    if (l.lvl < 0) continue;
    const out = (sh[cat] * l.eff * days * scale) / MODELS[cat][l.lvl].cost, k = `${cat}:${l.lvl}`;
    l.eff = Math.min(1, l.eff + 0.012 * days);
    if (AIR[cat]) {
      const arr = e[AIR[cat]!];
      e.acc[cat] = (e.acc[cat] ?? 0) + out;
      // Staffeln werden nicht aufgefüllt: Der Anteil der Verstärkung fällt an Neuaufstellung und Umrüstung
      e.acc[`${cat}u`] = (e.acc[`${cat}u`] ?? 0) + (out * e.use.upg) / (e.use.upg + e.use.neu);
      while (e.acc[cat] >= 1) {
        e.acc[cat]--;
        const old = arr.findIndex((n, i) => n > 0 && i < l.lvl);
        if (e.acc[`${cat}u`] >= 1 && old >= 0) (e.acc[`${cat}u`]--, arr[old]--);
        else if (e.men >= 0.5) e.men -= 0.5;
        else if (old >= 0) arr[old]--;
        else continue;
        arr[l.lvl] = (arr[l.lvl] ?? 0) + 1;
      }
      e.acc[`${cat}u`] = Math.min(e.acc[`${cat}u`], 2);
      for (let i = 0; i < arr.length; i++) arr[i] ??= 0;
    } else {
      const part = allot(out, e.use, demand(g, cat));
      for (const u of USES) e[u][k] = (e[u][k] ?? 0) + part[u];
    }
  }

  // Marine: Werften und Trägerflugzeuge
  buildShips(g, sh.mar * days * scale);
  const navy = ensureNavy(g);
  e.acc.tf = (e.acc.tf ?? 0) + sh.tf * days * scale;
  while (e.acc.tf >= TF_COST) (e.acc.tf -= TF_COST), navy.airT++;

  // Ausbau: Fabriken, Hydrierwerke, Tanklager
  // Reparatur läuft stetig: jeder IK-Tag stellt seinen Anteil zerstörter Industrie wieder her
  if (sh.fix > 0) repair(g, (sh.fix * days * scale) / workCost(e, 'fix'));
  for (const k of WORKS) {
    if (k === 'fix') continue;
    e.acc[k] = (e.acc[k] ?? 0) + sh[k] * days * scale;
    let n = 0;
    while (e.acc[k] >= workCost(e, k) && workOpen(e, k)) {
      e.acc[k] -= workCost(e, k);
      n++;
      if (k === 'ind') e.fac++;
      else if (k === 'syn') e.plants++;
      else e.tank += TANK_STEP;
    }
    if (n && k === 'ind') log(g, `Industrieausbau: ${n === 1 ? 'ein neues Werk nimmt' : `${n} neue Werke nehmen`} die Arbeit auf (+${n} IK).`);
    if (n && k === 'syn') log(g, `${n === 1 ? 'Ein Hydrierwerk geht' : `${n} Hydrierwerke gehen`} in Betrieb (jetzt ${e.plants}).`);
  }

  // Forschung
  const active = e.slots.filter((s): s is string => !!s && !has(e, s));
  const year = yearOfDay(eu.day), bonus = eu.flags.condor ? 1.25 : 1;
  for (const id of active) {
    const t = TECHS[id], ahead = Math.max(0, t.year - year);
    e.prog[id] = (e.prog[id] ?? 0) + ((sh.res * days) / active.length / (1 + 0.6 * ahead)) * (AIR[t.group as Cat] ? bonus : 1);
    if (e.prog[id] >= t.cost) {
      e.done.push(id);
      e.slots[e.slots.indexOf(id)] = null;
      const cat = t.group as Cat, isModel = t.group !== 'x';
      if (isModel && e.lines[cat].lvl < 0) setLine(g, cat, +id.slice(cat.length));
      eu.news.push({
        title: `Forschung abgeschlossen: ${t.name}`,
        text: isModel
          ? `${CATS[cat]}: Das Muster „${t.name}“ ist fertigungsreif. Die Linie fertigt weiter „${MODELS[cat][e.lines[cat].lvl].name}“, bis Sie sie unter Reich verwalten → Produktion umstellen. Das Umstellen kostet Anlaufzeit.`
          : t.text + '.',
      });
    }
  }
  e.slots = e.slots.map(s => (s && has(e, s) ? null : s));

  // Ersatz für Verluste: Waffen aus dem Lager, Mannschaften aus dem Ersatzheer
  const lowSup = e.short.includes('sup');
  for (const d of mine) {
    d.low = d.low || lowSup;
    if (d.oos || d.low || d.fought) continue;
    let added = 0;
    for (const u of d.units) {
      const want = Math.min(maxS(d) - u.s, days >= 28 ? 6 : 2, Math.floor(e.men / MEN_PER_POINT));
      if (want <= 0) continue;
      const got = Math.floor(draw(e, TYPES[u.t].cat!, TYPES[u.t].lvl ?? 0, want));
      u.s += got;
      added += got;
      e.men -= got * MEN_PER_POINT;
    }
    diluteXp(d, added);
  }

  // Umrüstung: älteste Bataillone zuerst auf die neueste Generation im Umrüstlager
  for (const cat of GROUND)
    for (let lvl = MODELS[cat].length - 1; lvl > 0; lvl--) {
      const k = `${cat}:${lvl}`;
      if ((e.upg[k] ?? 0) < 10) continue;
      const cand = mine.filter(d => !d.oos && !(war && d.fought))
        .flatMap(d => d.units.filter(u => TYPES[u.t].cat === cat && (TYPES[u.t].lvl ?? 0) < lvl))
        .sort((a, b) => (TYPES[a.t].lvl ?? 0) - (TYPES[b.t].lvl ?? 0));
      for (const u of cand) {
        if (e.upg[k] < u.s) break;
        e.upg[k] -= u.s;
        u.t = ladder('GER', TYPES[u.t].base!)[lvl] ?? u.t;
      }
    }

  // Neuaufstellungen: Bataillon für Bataillon aus dem Neulager ausstatten
  autoQueue(g);
  for (const b of [...e.queue]) {
    const tp = TEMPLATES[b.kind];
    tp.units.forEach((u, i) => {
      if (b.got[i]) return;
      const [base, s] = u.split(':'), cat = catOf(base), need = s ? +s : 10, lad = ladder('GER', base);
      for (let lvl = Math.min(lad.length, MODELS[cat].length) - 1; lvl >= 0; lvl--) {
        const k = `${cat}:${lvl}`;
        if ((e.neu[k] ?? 0) < need) continue;
        e.neu[k] -= need;
        b.got[i] = lad[lvl];
        break;
      }
    });
    const men = tp.units.reduce((a, u) => a + +(u.split(':')[1] ?? 10), 0) * MEN_PER_POINT;
    if (b.got.every(Boolean) && eu.day + days - b.day >= TRAIN_DAYS && e.men >= men) {
      e.men -= men;
      e.queue.splice(e.queue.indexOf(b), 1);
      spawn(g, b.kind, b.name, b.prov, b.got as string[]);
    }
  }
  e.rate = {
    steel: (e.steel - before.steel) / days, oil: (e.oil - before.oil) / days, spill: spill / days, oilUse: oilUse / days, men: (e.men - before.men) / days, sup: (e.sup - before.sup) / days,
  };
}
