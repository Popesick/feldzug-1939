// Deutsche Kriegswirtschaft im Europa-Szenario: Industrie, Rohstoffe, Fertigungslinien,
// Umrüstung und Neuaufstellung, Forschung. Bewusst grob – ein Regler je Posten.
import type { Division, Eco, GameState } from './types';
import { PLIST, PROV } from '../data/world';
import { type Cat, CATS, GROUND, MODELS, TEMPLATES, TYPES, catOf, ladder } from '../data/units';
import { GER_BUILD, START_TECH, TECHS } from '../data/europa';
import { STACK, divsIn, log } from './game';

export const ECO_KEYS = ['res', 'sup', ...(Object.keys(CATS) as Cat[])];
export const KEY_NAME: Record<string, string> = { res: 'Forschung', sup: 'Nachschubgüter', ...CATS };
const MEN_PER_POINT = 0.3; // Tausend Mann je Stärkepunkt
const STEEL_PER_IK = 0.6;
const TRAIN_DAYS = 30;

export function initEco(): Eco {
  const lines: Eco['lines'] = {}, split: Eco['split'] = {};
  for (const c of Object.keys(CATS)) (lines[c] = { lvl: START_TECH.includes(`${c}0`) ? 0 : -1, eff: 1 }), (split[c] = 30);
  return {
    ik: 100, ikHome: 100, ikOcc: 0,
    w: { res: 15, sup: 4, inf: 16, kfz: 12, art: 13, pak: 9, pzl: 8, pzm: 9, pzs: 6, jg: 10, bo: 9 },
    steel: 800, oil: 500, men: 350, sup: 300, rate: {},
    lines, neu: {}, upg: {}, split, acc: {}, queue: [], auto: true,
    done: [...START_TECH], prog: {}, slots: ['pzl1', 'jg1', 'bo1'],
    airF: [6], airB: [6],
    num: { 'Infanterie-Division': 31, 'Panzer-Division': 3, 'Gebirgs-Division': 0, 'Infanterie-Division (mot.)': 0, 'leichte Division': 0, 'schwere Panzer-Abteilung': 500, 'Festungs-Brigade': 0 },
    short: [],
  };
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
  for (const p of PLIST) if (eu.owner[p.id] === 'GER') eu.core[p.id] ? (home += p.ind ?? 0) : (occ += (p.ind ?? 0) * 0.4);
  const mult = 1 + (has(e, 'ind1') ? 0.06 : 0) + (has(e, 'ind2') ? 0.06 : 0) + (has(e, 'ind3') ? 0.08 : 0) + (eu.flags.totalerkrieg ? 0.15 : 0);
  e.ikHome = home * mult;
  e.ikOcc = occ * mult;
  e.ik = e.ikHome + e.ikOcc;
}

/** Posten, auf die sich die Industrie gerade verteilt (Linien ohne Muster ruhen). */
export function shares(e: Eco): Record<string, number> {
  const act = ECO_KEYS.filter(k => k === 'res' || k === 'sup' || e.lines[k].lvl >= 0);
  const sum = act.reduce((a, k) => a + e.w[k], 0) || 1;
  const out: Record<string, number> = {};
  for (const k of ECO_KEYS) out[k] = act.includes(k) ? (e.ik * e.w[k]) / sum : 0;
  return out;
}

/** Tageserträge aus eigenem Gebiet und Handel. */
export function income(g: GameState) {
  const eu = g.eu!, e = eu.eco, rel = (c: string) => (eu.gone.includes(c) ? 'X' : eu.rel[c] ?? 'N');
  let steel = 0, oil = 0;
  const notes: string[] = [];
  for (const p of PLIST) if (eu.owner[p.id] === 'GER') (steel += (p.steel ?? 0) * (eu.core[p.id] ? 1 : 0.6)), (oil += (p.oil ?? 0) * (eu.core[p.id] ? 1 : 0.6));
  if (rel('ENG') !== 'E') (steel += 12), (oil += 8), notes.push('Überseehandel');
  else notes.push('Seeblockade');
  if (rel('SWE') === 'N') (steel += 12), notes.push('Schwedenerz');
  if (rel('ROM') === 'N') (oil += 6), notes.push('rumänisches Öl');
  else if (rel('ROM') === 'A') (oil += 12), notes.push('rumänisches Öl (Bündnis)');
  if (eu.flags.pakt && rel('SOV') === 'N') (oil += 5), (steel += 4), notes.push('sowjetische Lieferungen');
  const syn = (has(e, 'syn1') ? 3 : 0) + (has(e, 'syn2') ? 3 : 0) + (has(e, 'syn3') ? 4 : 0);
  if (syn) (oil += syn), notes.push('Hydrierwerke');
  const men = (0.011 * e.ikHome + 0.1) * (Object.values(eu.rel).includes('E') ? 1.5 : 1);
  return { steel, oil, men, notes };
}

const isMine = (d: Division) => d.nation === 'GER';
const usesOil = (t: string) => TYPES[t].move === 'track' || TYPES[t].move === 'wheel';

/** Nimmt bis zu n Punkte einer Gattung aus den Lagern, bevorzugt die gewünschte Generation. */
function draw(e: Eco, cat: string, lvl: number, n: number): number {
  let got = 0;
  const order = [lvl, ...MODELS[cat as Cat].map((_, i) => i).filter(i => i !== lvl).sort((a, b) => Math.abs(a - lvl) - Math.abs(b - lvl))];
  for (const l of order)
    for (const pool of [e.upg, e.neu]) {
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
  return Object.values(TECHS).filter(t => !has(e, t.id) && (!t.req || has(e, t.req))).sort((a, b) => a.year - b.year).map(t => t.id);
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
    mp: 0, dug: 0, fought: false, moved: true, order: null, oos: false,
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
  const eu = g.eu!, e = eu.eco, war = Object.entries(eu.rel).some(([c, r]) => r === 'E' && !eu.gone.includes(c));
  computeIK(g);
  const sh = shares(e), inc = income(g), mine = g.divs.filter(isMine);
  e.short = [];
  const before = { steel: e.steel, oil: e.oil, men: e.men, sup: e.sup };
  e.steel = Math.min(6000, e.steel + inc.steel * days);
  e.oil = Math.min(3000, e.oil + inc.oil * days);
  e.men += inc.men * days;

  // Verbrauch von Treibstoff und Nachschubgütern
  let oilUse = 0, supUse = 0;
  for (const d of mine) {
    const busy = war && (d.moved || d.fought) ? 4 : 1;
    supUse += 0.03 * busy * days;
    for (const u of d.units) if (usesOil(u.t)) oilUse += 0.03 * busy * days * (u.s / 10);
  }
  if (war) for (const a of Object.values(g.airAssign.GER)) oilUse += (a.f + a.b) * 0.15 * days;
  e.oil -= oilUse;
  e.sup += sh.sup * days - supUse;
  if (e.oil <= 0) (e.oil = 0), e.short.push('oil');
  if (e.sup <= 0) (e.sup = 0), e.short.push('sup');
  e.sup = Math.min(e.sup, 3000);

  // Fertigung
  const prodIK = (Object.keys(CATS) as Cat[]).reduce((a, c) => a + sh[c], 0);
  const steelNeed = prodIK * STEEL_PER_IK * days;
  const scale = steelNeed > 0 ? Math.min(1, e.steel / steelNeed) : 1;
  e.steel -= steelNeed * scale;
  if (scale < 0.999) e.short.push('steel');
  for (const cat of Object.keys(CATS) as Cat[]) {
    const l = e.lines[cat];
    if (l.lvl < 0) continue;
    const out = (sh[cat] * l.eff * days * scale) / MODELS[cat][l.lvl].cost, k = `${cat}:${l.lvl}`, up = e.split[cat] / 100;
    l.eff = Math.min(1, l.eff + 0.012 * days);
    if (cat === 'jg' || cat === 'bo') {
      const arr = cat === 'jg' ? e.airF : e.airB;
      e.acc[cat] = (e.acc[cat] ?? 0) + out;
      e.acc[`${cat}u`] = (e.acc[`${cat}u`] ?? 0) + out * up;
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
      e.upg[k] = (e.upg[k] ?? 0) + out * up;
      e.neu[k] = (e.neu[k] ?? 0) + out * (1 - up);
      // die erste Generation hat nichts umzurüsten: ihr Umrüstlager dient nur dem Ersatz und läuft sonst über
      if (l.lvl === 0 && e.upg[k] > 120) (e.neu[k] += e.upg[k] - 120), (e.upg[k] = 120);
    }
  }

  // Forschung
  const active = e.slots.filter((s): s is string => !!s && !has(e, s));
  const year = yearOfDay(eu.day), bonus = eu.flags.condor ? 1.25 : 1;
  for (const id of active) {
    const t = TECHS[id], ahead = Math.max(0, t.year - year);
    e.prog[id] = (e.prog[id] ?? 0) + ((sh.res * days) / active.length / (1 + 0.6 * ahead)) * (t.group === 'jg' || t.group === 'bo' ? bonus : 1);
    if (e.prog[id] >= t.cost) {
      e.done.push(id);
      e.slots[e.slots.indexOf(id)] = null;
      const cat = t.group as Cat, isModel = t.group !== 'x';
      if (isModel && e.lines[cat].lvl < 0) setLine(g, cat, +id.slice(cat.length));
      eu.news.push({
        title: `Forschung abgeschlossen: ${t.name}`,
        text: isModel
          ? `${CATS[cat]}: Das Muster „${t.name}“ ist fertigungsreif. Die Linie fertigt weiter „${MODELS[cat][e.lines[cat].lvl].name}“, bis Sie sie unter Wirtschaft → Produktion umstellen. Das Umstellen kostet Anlaufzeit.`
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
    for (const u of d.units) {
      const want = Math.min(10 - u.s, days >= 28 ? 6 : 2, Math.floor(e.men / MEN_PER_POINT));
      if (want <= 0) continue;
      const got = Math.floor(draw(e, TYPES[u.t].cat!, TYPES[u.t].lvl ?? 0, want));
      u.s += got;
      e.men -= got * MEN_PER_POINT;
    }
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
    steel: (e.steel - before.steel) / days, oil: (e.oil - before.oil) / days, men: (e.men - before.men) / days, sup: (e.sup - before.sup) / days,
  };
}
