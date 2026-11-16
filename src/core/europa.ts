// Europa-Szenario ab 1936: Staaten und Bündnisse, historische Ereignisse, Kapitulationen,
// Nachschub mit Reichweite, Seetransport, Bahnverlegung und der Rundenabschluss.
// Gespielt wird das Deutsche Reich; alle übrigen Staaten führt die KI.
import type { Division, EuState, GameState, Rel, Side } from './types';
import { other } from './types';
import { PLIST, PROV } from '../data/world';
import { GEN_YEAR, MODELS, TEMPLATES, TYPES, ladder } from '../data/units';
import { COUNTRIES, EAST_AXIS, EMPIRE, GER_OOB } from '../data/europa';
import { aiArmies, bonus, pruneArmies } from './army';
import { bombTick, indLeft } from './airwar';
import { aidTick, frenchFleet, loot, scuttleToulon } from './aid';
import { type MoveTarget, STACK, WORDS, XP_NEW, airAt, assignAir, capture, diluteXp, divsIn, friendly, gainXp, hooks, isOwn, log, maxS, me, strength, tp, trainXp } from './game';
import { atWarMe, computeIK, ecoTick, initEco, yearOfDay } from './economy';
import { RNG } from './rng';
import { canShip, control, crossingRisk, ensureNavy, hasNavy, loseTransport, navyTick, transportsFree, zonesOf } from './navy';

export const END_DAY = dayOf(1946, 1, 1);
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function dayOf(y: number, m: number, d: number) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1936, 0, 1)) / 864e5);
}
export function fmtDate(day: number) {
  const d = new Date(Date.UTC(1936, 0, 1 + day));
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const relOf = (g: GameState, c: string): Rel => g.eu!.rel[c] ?? 'N';
export const exists = (g: GameState, c: string) => !g.eu!.gone.includes(c);
const sideOf = (r: Rel) => (r === 'A' ? 'GER' : r === 'E' ? 'POL' : 'NEU');
/** Der Bürgerkrieg in Spanien zählt nicht als Krieg des Reichs: Es bleibt bei Monatsrunden und Friedenswirtschaft. */
export const atWar = (g: GameState) => Object.entries(g.eu!.rel).some(([c, r]) => r === 'E' && c !== 'REP' && exists(g, c));
const enemy = (g: GameState, c: string) => relOf(g, c) === 'E' && exists(g, c);
const neutral = (g: GameState, c: string) => relOf(g, c) === 'N' && exists(g, c);
/** Länge der laufenden Runde: im Frieden ein Monat, im Krieg eine Woche. */
export function turnDays(g: GameState) {
  if (atWar(g)) return 7;
  const d = new Date(Date.UTC(1936, 0, 1 + g.eu!.day));
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - d.getTime()) / 864e5);
}
const rngFor = (g: GameState, salt: number) => new RNG((g.seed + g.eu!.day * 131 + salt) >>> 0);
const news = (g: GameState, title: string, text: string) => (g.eu!.news.push({ title, text }), log(g, title));
const ownedBy = (g: GameState, c: string) => PLIST.filter(p => g.eu!.owner[p.id] === c);
/** Entfernung zweier Provinzorte in km (Großkreis). */
function km(a: string, b: string) {
  const [la1, lo1] = PROV[a].ll!, [la2, lo2] = PROV[b].ll!, R = Math.PI / 180;
  const h = Math.sin(((la2 - la1) * R) / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin(((lo2 - lo1) * R) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** Welt-Szenario (sonst Europa 1936). */
export const isWorld = (g: GameState) => !!g.eu!.flags.world;

export function syncCtrl(g: GameState) {
  const eu = g.eu!;
  for (const p of PLIST) g.ctrl[p.id] = sideOf(eu.rel[eu.owner[p.id]] ?? 'N');
}

// ---- Verbände aufstellen --------------------------------------------------

/** Generation, die ein Staat in einem Jahr führt (−1: die Gattung gibt es dort noch nicht). */
function aiLvl(nation: string, cat: string, year: number) {
  let l = -1;
  GEN_YEAR[cat].forEach((y, i) => y + (COUNTRIES[nation]?.lag ?? 2) <= year && (l = i));
  return l;
}
function aiType(nation: string, base: string, year: number): string {
  const lvl = aiLvl(nation, TYPES[base].cat!, year);
  if (lvl < 0) return aiType(nation, base === 'PZS' ? 'PZM' : 'PZL', year); // noch keine mittleren oder schweren Panzer
  const lad = ladder(nation, base);
  return lad[Math.min(lvl, lad.length - 1)];
}

function makeDiv(g: GameState, nation: string, kind: string, name: string, prov: string, dug = 0): Division {
  const eu = g.eu!, t = TEMPLATES[kind], year = yearOfDay(eu.day);
  eu.flags._id = (eu.flags._id ?? 1000) + 1;
  // das Heer des Spielers steht auch im Frieden auf seiner Seite und führt die Muster seiner Fertigung
  const mine = nation === me(g), sd = sideOf(relOf(g, nation));
  const lvlOf = (b: string) => Math.max(0, eu.eco.lines[TYPES[b].cat!]?.lvl ?? 0);
  const d: Division = {
    id: eu.flags._id, name, side: (mine ? g.player : sd) as Side, nation, kind, army: COUNTRIES[nation]?.name ?? nation,
    q: t.q + (COUNTRIES[nation]?.q ?? 0) + (nation === 'SOV' && year >= 1943 ? 1 : 0), prov,
    units: t.units.map(u => {
      const [b, s] = u.split(':');
      return { t: nation === 'GER' && mine ? ladder('GER', b)[0] : mine ? (l => l[Math.min(lvlOf(b), l.length - 1)])(ladder(nation, b)) : aiType(nation, b, year), s: s ? +s : 10 };
    }),
    mp: t.mp, dug, fought: false, moved: false, order: null, oos: false,
  };
  g.divs.push(d);
  return d;
}
function autoName(g: GameState, nation: string, kind: string) {
  const k = `n_${nation}_${kind}`, eu = g.eu!;
  eu.flags[k] = (eu.flags[k] ?? 0) + 1;
  return `${COUNTRIES[nation].adj} ${eu.flags[k]}. ${TEMPLATES[kind].label}`.replace('- ', '-');
}

/** Verteilt Verbände auf Provinzen: Grenze und wichtige Orte zuerst, nie über die Stapelgrenze. */
function deploy(g: GameState, nation: string, kinds: string[], provs: string[]) {
  if (!provs.length) return;
  const foe = other(sideOf(relOf(g, nation)) as Side);
  // Grenzen, an denen Waffenruhe herrscht, zählen nicht als Front
  const border = new Set(provs.filter(id => PROV[id].adj.some(a => g.ctrl[a] === foe && !quiet(g, nation, other(foe), a))));
  const weight = (id: string) => {
    const p = PROV[id];
    return 1 + (border.has(id) ? 4 : p.adj.some(a => border.has(a)) ? 1.5 : 0) + p.vp * 1.5 + (p.capital ? 3 : 0);
  };
  const load: Record<string, number> = {};
  for (const id of provs) load[id] = divsIn(g, id).length;
  // ortsfeste Truppen zuerst, damit Festungen an der Grenze und Garnisonen in den Städten landen
  kinds.sort((a, b) => TEMPLATES[a].mp - TEMPLATES[b].mp);
  for (const kind of kinds) {
    const fixed = TEMPLATES[kind].mp === 0;
    const score = (id: string) => (kind === 'GF' ? (border.has(id) ? 10 : 1) : kind === 'GG' ? 1 + PROV[id].vp * 3 + (PROV[id].port ? 1 : 0) : weight(id)) / (1 + load[id]);
    const at = provs.filter(id => load[id] < STACK - 2).sort((a, b) => score(b) - score(a))[0];
    if (!at) return;
    load[at]++;
    makeDiv(g, nation, kind, autoName(g, nation, kind), at, fixed ? 3 : border.has(at) ? 2 : 1);
  }
}

/** Stellt das Heer eines Staates beim Kriegseintritt auf. */
function spawnArmy(g: GameState, c: string) {
  const eu = g.eu!, co = COUNTRIES[c], year = yearOfDay(eu.day);
  if (!co || eu.flags[`army_${c}`]) return;
  eu.flags[`army_${c}`] = eu.day + 1;
  let f = Math.min(1, 0.64 + 0.12 * (year - 1936)) + Math.max(0, year - 1939) * 0.05;
  if (c === 'SOV') f = year <= 1939 ? 0.8 : year === 1940 ? 1 : year === 1941 ? 1.2 : 1.4;
  const kinds = Object.entries(co.army).flatMap(([k, n]) => Array<string>(Math.max(1, Math.round(n * f))).fill(k));
  const mine = ownedBy(g, c).map(p => p.id);
  // Mutterland = was von der Hauptstadt aus über eigenes Gebiet erreichbar ist
  const home = new Set<string>(), q = mine.includes(co.cap) ? [co.cap] : mine.slice(0, 1);
  q.forEach(id => home.add(id));
  for (let i = 0; i < q.length; i++) for (const a of PROV[q[i]].adj) if (!home.has(a) && eu.owner[a] === c) home.add(a), q.push(a);
  const far = mine.filter(id => !home.has(id));
  const nFar = far.length ? Math.round(kinds.length * (co.over ?? Math.min(0.15, far.length / mine.length))) : 0;
  const mobile = kinds.filter(k => TEMPLATES[k].mp > 0), abroad = mobile.filter((_, i) => i % Math.max(1, Math.floor(mobile.length / (nFar || 1))) === 0).slice(0, nFar);
  for (const k of abroad) kinds.splice(kinds.indexOf(k), 1);
  deploy(g, c, kinds, [...home]);
  deploy(g, c, abroad, far);
  if (c !== me(g)) eu.airN[c] = { f: Math.round(co.air[0] * f), b: Math.round(co.air[1] * f) };
}

// ---- Bündnisse und Kriegserklärungen --------------------------------------

function join(g: GameState, c: string, r: Rel) {
  const eu = g.eu!;
  if (!exists(g, c) || eu.rel[c] === r) return;
  eu.rel[c] = r;
  eu.flags[`war_${c}`] = eu.day;
  syncCtrl(g);
  spawnArmy(g, c);
  for (const d of g.divs) if (d.nation === c) d.side = (c === me(g) ? g.player : sideOf(r)) as Side;
  expedition(g);
  syncAir(g);
  // Dominions und Indien folgen Großbritannien, die Mongolei der Sowjetunion
  if (c === 'ENG' && r === 'E') for (const d of EMPIRE) if (neutral(g, d) && eu.rel[d]) join(g, d, 'E');
  if (c === 'SOV' && r === 'E' && neutral(g, 'MON') && eu.rel.MON) join(g, 'MON', 'E');
}

/** Britisches Expeditionskorps: steht Frankreich im Krieg, geht ein Teil des britischen Heeres auf den Kontinent. */
function expedition(g: GameState) {
  const eu = g.eu!;
  if (eu.flags.bef || !enemy(g, 'ENG') || !enemy(g, 'FRA') || !PROV.lille) return;
  eu.flags.bef = eu.day + 1;
  const at = ownedBy(g, 'FRA').filter(p => !(p.flags ?? '').includes('k')).sort((a, b) => km(a.id, 'lille') - km(b.id, 'lille')).slice(0, 4).map(p => p.id);
  deploy(g, 'ENG', ['GI', 'GI', 'GI', 'GI', 'GI', 'GI', 'GO', 'GA'], at);
}

/** Kriegserklärung des Reichs an einen neutralen Staat. */
export function declareWar(g: GameState, c: string) {
  const eu = g.eu!;
  if (!neutral(g, c) || c === 'GER') return;
  news(g, `Krieg mit ${COUNTRIES[c].name}`, `Das Deutsche Reich eröffnet am ${fmtDate(eu.day)} die Feindseligkeiten gegen ${COUNTRIES[c].name}.`);
  if (c === 'POL' && neutral(g, 'DZG')) absorb(g, 'DZG', 'GER', true);
  join(g, c, 'E');
  // Die Westmächte nehmen keinen weiteren Angriff auf einen europäischen Staat hin
  if (c !== 'SOV') {
    const who = ['ENG', 'FRA'].filter(a => neutral(g, a));
    for (const a of who) join(g, a, 'E');
    if (who.length) news(g, 'Kriegserklärung der Westmächte', `${who.map(a => COUNTRIES[a].name).join(' und ')} erklären dem Deutschen Reich den Krieg.`);
  } else if (eu.flags.winterkrieg && neutral(g, 'FIN')) {
    join(g, 'FIN', 'A');
    news(g, 'Finnland tritt in den Krieg ein', 'Finnland schließt sich dem Angriff auf die Sowjetunion an, um die 1940 verlorenen Gebiete zurückzugewinnen.');
  }
}

/** Verbände, die nach einem Besitzwechsel auf fremdem Gebiet stehen, ausweichen lassen oder auflösen. */
function evict(g: GameState) {
  for (const d of [...g.divs]) {
    if (friendly(g, d, d.prov)) continue;
    const seen = new Set([d.prov]), q = [d.prov];
    let to: string | null = null;
    for (let i = 0; i < q.length && !to && i < 60; i++)
      for (const a of PROV[q[i]].adj) {
        if (seen.has(a)) continue;
        seen.add(a);
        q.push(a);
        if (g.ctrl[a] === d.side && divsIn(g, a).length < STACK) { to = a; break; }
      }
    const cap = COUNTRIES[d.nation]?.cap;
    if (!to && cap && g.ctrl[cap] === d.side && TEMPLATES[d.kind].mp > 0) {
      // Rückzug über See in die Heimat, unter Verlust des schweren Geräts
      to = [cap, ...PROV[cap].adj].find(a => g.ctrl[a] === d.side && divsIn(g, a).length < STACK) ?? null;
      if (to) for (const u of d.units) u.s = Math.max(1, Math.round(u.s * 0.6));
    }
    if (to && TEMPLATES[d.kind].mp > 0) (d.prov = to), (d.dug = 0), (d.order = null);
    else g.divs.splice(g.divs.indexOf(d), 1);
  }
}

/** Übergibt Provinzen an einen anderen Staat. */
function transfer(g: GameState, ids: string[], to: string, core = false) {
  const eu = g.eu!;
  for (const id of ids) {
    eu.owner[id] = to;
    if (core) eu.core[id] = 1;
    else if (to !== 'GER') delete eu.core[id];
  }
  syncCtrl(g);
  evict(g);
}

/** Ein Staat geht unter: Heer aufgelöst, restliches Gebiet an den Nachfolger. */
function absorb(g: GameState, c: string, to: string | null, core = false) {
  const eu = g.eu!;
  if (!exists(g, c)) return;
  eu.gone.push(c);
  g.divs = g.divs.filter(d => d.nation !== c);
  delete eu.airN[c];
  if (to) transfer(g, ownedBy(g, c).map(p => p.id), to, core);
  eu.rel[c] = 'N';
  syncCtrl(g);
  evict(g);
}

// ---- Unterstellung der Verbündeten ------------------------------------------

/** Anteil von Heer und Luftwaffe, den ein Verbündeter dem Reich unterstellt; der Rest schützt das eigene Land. */
const LEND = 0.8;
/** Verbündete, deren Truppen der Spieler führt. Japans Machtbereich und Francos Bürgerkriegsarmee führt weiter die KI. */
function lenders(g: GameState) {
  const eu = g.eu!;
  // Japan führt die Truppen seiner Schutzstaaten; sonst gibt es Unterstellung nur unter deutscher Führung
  if (me(g) === 'JAP') return ['MAN', 'SIA'].filter(c => eu.rel[c] === 'A' && exists(g, c));
  if (me(g) !== 'GER') return [];
  return Object.keys(eu.rel).filter(c => c !== 'GER' && eu.rel[c] === 'A' && exists(g, c) && !EAST_AXIS.includes(c) && !(c === 'SPA' && civil(g)));
}
const lentAir = (g: GameState, kind: 'f' | 'b') => lenders(g).reduce((x, c) => x + Math.floor((g.eu!.airN[c]?.[kind] ?? 0) * LEND), 0);
/** Hält den unterstellten Anteil jedes Verbündeten bei 80 %; ortsfeste Truppen und die Wache der Hauptstadt bleiben zuletzt. */
function lendUnits(g: GameState) {
  const who = lenders(g);
  for (const d of g.divs) if (d.ctl && !who.includes(d.nation)) d.ctl = false;
  for (const c of who) {
    const ds = g.divs.filter(d => d.nation === c && d.side === 'GER'), cap = COUNTRIES[c]?.cap;
    let need = Math.floor(ds.length * LEND) - ds.filter(d => d.ctl).length;
    const cand = ds.filter(d => !d.ctl && tp(d).mp > 0).sort((a, b) => +(a.prov === cap) - +(b.prov === cap) || a.id - b.id);
    for (const d of cand) if (need-- > 0) d.ctl = true;
  }
}

// ---- Luftstreitkräfte -----------------------------------------------------

/** Führt Staffelzahlen und Mustergüte aus Wirtschaft und Bündnislage zusammen. */
export function syncAir(g: GameState) {
  const eu = g.eu!, e = eu.eco, away = 0, n = me(g);
  const sum = (a: number[]) => a.reduce((x, y) => x + (y ?? 0), 0);
  const avg = (a: number[], cat: 'jg' | 'bo') => (sum(a) ? a.reduce((x, n, i) => x + (n ?? 0) * (MODELS[cat][i].q ?? 1), 0) / sum(a) : 1);
  const exp = eu.flags.condor && eu.flags.spainend ? 1.08 : 1;
  // ohne Treibstoff bleibt die halbe Luftwaffe am Boden
  const fuel = e.short.includes('oil') ? 0.5 : 1;
  const yr = Math.max(0, yearOfDay(eu.day) - 1939);
  const genQ = { f: Math.min(1.8, 1 + 0.12 * yr), b: Math.min(1.6, 0.9 + 0.1 * yr) };
  if (n === 'GER') {
    const lentF = lentAir(g, 'f'), lentB = lentAir(g, 'b');
    g.air.GER = { f: Math.max(0, Math.floor((sum(e.airF) + lentF - away) * fuel)), b: Math.max(0, Math.floor((sum(e.airB) + lentB - away) * fuel)) };
    // Güte über alle Staffeln gemittelt, die der Verbündeten nach dem Stand ihrer Flugzeuge
    const mix = (a: number[], cat: 'jg' | 'bo', kind: 'f' | 'b') => {
      let n = sum(a), q = avg(a, cat) * n;
      for (const c of lenders(g)) {
        const k = Math.floor((eu.airN[c]?.[kind] ?? 0) * LEND);
        let m = MODELS[cat][0].q ?? 1;
        for (const x of MODELS[cat]) if (x.year + (COUNTRIES[c].lag ?? 2) <= yearOfDay(eu.day)) m = x.q ?? 1;
        (n += k), (q += k * m);
      }
      return n ? q / n : 1;
    };
    let f = 0, b = 0;
    for (const [c, a] of Object.entries(eu.airN)) if (enemy(g, c)) (f += a.f), (b += a.b);
    g.air.POL = { f, b };
    g.airQ = { GER: { f: mix(e.airF, 'jg', 'f') * exp, b: mix(e.airB, 'bo', 'b') * exp }, POL: genQ };
  } else {
    // der Spieler führt einen Gegner des Reichs: seine Staffeln fliegen mit denen der Verbündeten, sobald sein Staat im Krieg steht
    const pool = airPools(g), own = atWarMe(g) ? 1 : 0, ms = g.player, fs = other(ms);
    const mf = Math.floor(sum(e.airF) * fuel) * own, mb = Math.floor(sum(e.airB) * fuel) * own;
    g.air[fs] = { ...pool[fs] };
    g.air[ms] = { f: pool[ms].f + mf, b: pool[ms].b + mb };
    const blend = (k: number, q: { f: number; b: number }) => ({ f: k ? (pool[ms].f * q.f + mf * avg(e.airF, 'jg')) / Math.max(1, pool[ms].f + mf) : q.f, b: k ? (pool[ms].b * q.b + mb * avg(e.airB, 'bo')) / Math.max(1, pool[ms].b + mb) : q.b });
    // die Luftwaffe des Reichs fliegt die besseren Muster, die übrigen Staaten folgen dem allgemeinen Stand
    const q = { GER: { f: Math.min(2, 1.05 + 0.15 * yr), b: Math.min(1.6, 1 + 0.1 * yr) }, POL: genQ };
    g.airQ = { ...q, [ms]: blend(1, q[ms]) } as typeof g.airQ;
  }
  for (const side of ['GER', 'POL'] as Side[])
    for (const kind of ['f', 'b'] as const) {
      const as = g.airAssign[side];
      let over = Object.values(as).reduce((x, a) => x + a[kind], 0) - g.air[side][kind];
      for (const s of Object.keys(as)) while (over > 0 && as[s]?.[kind] > 0) (assignAir(g, side, s, kind, -1), over--);
    }
}
/** Staffeln der KI-Staaten je Seite (ohne die des Spielers). */
function airPools(g: GameState) {
  const eu = g.eu!, out = { GER: { f: 0, b: 0 }, POL: { f: 0, b: 0 } };
  for (const [c, a] of Object.entries(eu.airN)) {
    if (c === me(g) || !exists(g, c)) continue;
    const side = relOf(g, c) === 'A' ? 'GER' : relOf(g, c) === 'E' ? 'POL' : null;
    if (side) (out[side].f += a.f), (out[side].b += a.b);
  }
  return out;
}

/** Im Kampf verlorene Staffeln aus den Beständen der Staaten streichen. */
function absorbAirLosses(g: GameState) {
  const eu = g.eu!, e = eu.eco, away = 0, n = me(g);
  const drain = (at: string[], kind: 'f' | 'b', lost: number) => {
    while (lost > 0) {
      const c = at.sort((a, b) => eu.airN[b][kind] - eu.airN[a][kind])[0];
      if (!c || eu.airN[c][kind] <= 0) break;
      eu.airN[c][kind]--;
      lost--;
    }
  };
  if (n !== 'GER') {
    const pool = airPools(g), own = atWarMe(g) && !e.short.includes('oil'), ms = g.player, fs = other(ms);
    const of = (side: Side) => Object.keys(eu.airN).filter(c => c !== n && exists(g, c) && relOf(g, c) === (side === 'GER' ? 'A' : 'E'));
    for (const [arr, kind] of [[e.airF, 'f'], [e.airB, 'b']] as const) {
      drain(of(fs), kind, pool[fs][kind] - g.air[fs][kind]);
      const mine = own ? arr.reduce((x, y) => x + (y ?? 0), 0) : 0;
      let lost = pool[ms][kind] + mine - g.air[ms][kind], part = Math.round((lost * mine) / Math.max(1, pool[ms][kind] + mine));
      lost -= part;
      for (let i = 0; i < arr.length && part > 0; i++) while (arr[i] > 0 && part > 0) (arr[i]--, part--);
      drain(of(ms), kind, lost);
    }
    return;
  }
  for (const [arr, kind] of [[e.airF, 'f'], [e.airB, 'b']] as const) {
    if (e.short.includes('oil')) continue; // Bestand war gedrosselt, Verluste nicht sauber zuzuordnen
    const own = arr.reduce((x, y) => x + (y ?? 0), 0), lent = lentAir(g, kind);
    let lost = own + lent - away - g.air.GER[kind];
    // Verluste treffen Deutsche und Verbündete im Verhältnis ihrer Staffeln
    for (let n = Math.round((lost * lent) / Math.max(1, own + lent)); n > 0; n--) {
      const c = lenders(g).sort((a, b) => (eu.airN[b]?.[kind] ?? 0) - (eu.airN[a]?.[kind] ?? 0))[0];
      if (!c || !eu.airN[c]?.[kind]) break;
      eu.airN[c][kind]--;
      lost--;
    }
    for (let i = 0; i < arr.length && lost > 0; i++) while (arr[i] > 0 && lost > 0) (arr[i]--, lost--);
  }
  for (const kind of ['f', 'b'] as const) {
    const at = Object.keys(eu.airN).filter(c => enemy(g, c));
    drain(at, kind, at.reduce((x, c) => x + eu.airN[c][kind], 0) - g.air.POL[kind]);
  }
}

// ---- Nachschub ------------------------------------------------------------

const SEAS = ['N', 'B', 'M', 'S', 'Z', 'I'];
/** Kürzeste Nachschubwege einer Seite: über eigenes Land, zwischen eigenen Häfen auch über See. */
function supplyDist(g: GameState, side: Side): Record<string, number> {
  const eu = g.eu!, dist: Record<string, number> = {};
  const naval = side === 'POL' && (enemy(g, 'ENG') || enemy(g, 'USA'));
  const src = PLIST.filter(p => {
    if (g.ctrl[p.id] !== side) return false;
    if (naval && p.port) return true; // die Seemächte versorgen jeden Hafen
    if (!p.supply) return false;
    const o = eu.owner[p.id];
    return o === 'GER' ? !!eu.core[p.id] : o === p.country || (o === 'REP' && p.country === 'SPA');
  }).map(p => p.id);
  const q = [...src];
  for (const s of src) dist[s] = 0;
  // Achse: Nachschub über See braucht Transporter im Seegebiet; unter feindlicher Seeherrschaft kommt wenig an
  const lane: Record<string, number> = {};
  for (const z of zonesOf()) lane[z] = side !== g.player || !hasNavy(g) ? 2 : !canShip(g, z) ? 0 : control(g, z) >= 0.4 ? 2 : 4;
  for (let i = 0; i < q.length; i++) {
    const id = q[i], d = dist[id];
    const relax = (to: string, c: number) => {
      if (d + c < (dist[to] ?? Infinity)) (dist[to] = d + c), q.push(to);
    };
    if (id.length === 1) {
      for (const p of PLIST) if (p.port && g.ctrl[p.id] === side && p.sea!.includes(id)) relax(p.id, 2);
      continue;
    }
    const p = PROV[id];
    for (const a of p.adj) if (g.ctrl[a] === side) relax(a, (PROV[a].infra ?? 1) + (PROV[a].terrain === 'm' || PROV[a].terrain === 's' ? 0.5 : 0));
    if (p.port) for (const s of p.sea ?? '') if (SEAS.includes(s) && lane[s]) relax(s, lane[s]);
  }
  return dist;
}

export const supplyRange = (g: GameState) => 10 + (g.eu!.eco.done.includes('log1') ? 2 : 0) + (g.eu!.eco.done.includes('log2') ? 2 : 0);

export function euSupply(g: GameState) {
  const range = supplyRange(g);
  for (const side of ['GER', 'POL'] as Side[]) {
    const dist = supplyDist(g, side);
    for (const d of g.divs) {
      if (d.side !== side) continue;
      const v = dist[d.prov];
      // im Frieden steht das Heer des Spielers im eigenen Land und ist dort versorgt
      d.oos = v === undefined && !(d.nation === me(g) && g.ctrl[d.prov] === 'NEU');
      d.low = side === 'GER' && me(g) === 'GER' && v !== undefined && v > range + (bonus(g, d)?.sup ?? 0);
    }
  }
}

// ---- Seetransport und Bahnverlegung --------------------------------------

/** Im Frieden verlegen Verbände viermal so weit – außer in Spanien, solange dort gekämpft wird. */
const mpFactor = (g: GameState, d: Division) => (atWar(g) || (civil(g) && PROV[d.prov].country === 'SPA') ? 1 : 4);
/** Volle Bewegung eines Verbands; ein General mit „Eilmarsch“ bringt seine Armee weiter. */
const fullMp = (g: GameState, d: Division) => tp(d).mp * mpFactor(g, d) + (tp(d).mp > 0 ? bonus(g, d)?.mar ?? 0 : 0);

function farTargets(g: GameState, d: Division, n = 1): MoveTarget[] {
  const out: MoveTarget[] = [], here = PROV[d.prov], foe = other(d.side);
  if (tp(d).mp === 0 || d.mp < fullMp(g, d) || d.moved) return out;
  const adj = new Set(here.adj);
  if (isOwn(g, d)) {
    // Bahn: beliebig weit durch eigenes Gebiet, kostet die ganze Runde
    const seen = new Set([here.id]), q = [here.id], depth: Record<string, number> = { [here.id]: 0 };
    for (let i = 0; i < q.length; i++)
      for (const a of PROV[q[i]].adj) {
        if (seen.has(a) || !friendly(g, d, a) || depth[q[i]] >= 16) continue;
        seen.add(a);
        depth[a] = depth[q[i]] + 1;
        q.push(a);
        if (!adj.has(a) && divsIn(g, a).length + n <= STACK) out.push({ prov: a, attack: false, kind: 'rail' });
      }
  }
  // deutsche und unterstellte Verbände brauchen eine freie Transportflotte im Seegebiet
  // wer eine eigene Flotte führt, braucht für seine Verbände freie Transportflotten im Seegebiet
  const mine = hasNavy(g) && isOwn(g, d), free: Record<string, number> = {};
  const far = mine && ['USA', 'ENG', 'FRA', 'JAP'].includes(me(g)) ? 9000 : 0; // amerikanische Truppen gehen über den Atlantik und den Pazifik
  if (here.port && mine) for (const s of here.sea ?? '') free[s] = transportsFree(g, s);
  if (here.port)
    for (const p of PLIST) {
      if (p.id === here.id || adj.has(p.id) || !p.sea) continue;
      const zone = [...p.sea].find(s => here.sea!.includes(s) && (!mine || free[s] >= n));
      if (!zone) continue;
      if (civil(g) && p.country === 'SPA' && d.nation === 'GER' && d.army !== LEGION) continue;
      const c = g.ctrl[p.id], dkm = km(here.id, p.id);
      // auf den Ozeanen (Pazifik, Indischer Ozean) sind die Wege länger
      const ocean = ![...p.sea].some(s => here.sea!.includes(s) && s !== 'Z' && s !== 'I');
      if (c === d.side && p.port && dkm <= Math.max(far, ocean ? 6000 : 1800) && divsIn(g, p.id).length + n <= STACK) {
        if (!out.some(o => o.prov === p.id)) out.push({ prov: p.id, attack: false, kind: 'sea', zone });
      } else if (c === foe && dkm <= (ocean ? 1500 : 700)) out.push({ prov: p.id, attack: divsIn(g, p.id, foe).length > 0, kind: 'sea', zone });
    }
  return out;
}

/** Verluste auf See durch feindliche Flotten und Flugzeuge. */
export function seaLoss(g: GameState, d: Division, to: string) {
  const here = PROV[d.prov], rng = rngFor(g, d.id);
  const basin = d.seaZ ?? [...(PROV[to].sea ?? '')].find(s => here.sea?.includes(s)) ?? 'N';
  // die Gefahr folgt aus der Seeherrschaft im Seegebiet; Jäger über dem Ziel decken die Überfahrt
  let p = crossingRisk(g, basin, d.side);
  if (d.side === 'GER') {
    const mine = airAt(g, 'GER', to), theirs = airAt(g, 'POL', to);
    if (mine.f > theirs.f) p -= 0.2;
  } else if (airAt(g, 'GER', to).f > airAt(g, 'POL', to).f) p = Math.max(p, 0.3);
  if (km(d.prov, to) < 150) p /= 2;
  let lost = 0;
  for (const u of d.units)
    if (rng.next() < p) {
      const n = Math.min(u.s - 1, 1 + rng.int(3));
      u.s -= n;
      lost += n;
    }
  if (lost && d.nation === me(g)) log(g, `${d.name}: Verluste bei der Überfahrt (−${lost}).`);
  if (lost && hasNavy(g) && isOwn(g, d) && rng.next() < 0.3) loseTransport(g, basin);
}

function farMove(g: GameState, d: Division, t: MoveTarget) {
  if (t.kind === 'sea') {
    d.sea = true;
    d.seaZ = t.zone;
    seaLoss(g, d, t.prov);
    if (g.ctrl[t.prov] !== d.side) capture(g, t.prov, d);
  }
  d.prov = t.prov;
  d.mp = 0;
  d.moved = true;
  d.dug = 0;
}

// ---- Ereignisse -----------------------------------------------------------

interface Ev { id: string; w?: 0 | 1; on?: [number, number, number]; cond?: (g: GameState) => boolean; run: (g: GameState) => void }
/** Entscheidung für den Spieler. Führt er nicht das Reich, entscheidet dieses wie in der Geschichte; seine eigenen Fragen (us_…, su_…) bekommt er gestellt. */
const ask = (g: GameState, id: string, title: string, text: string, yes: string, no: string) =>
  void (me(g) !== 'GER' && !/^(us|su|en|fr|it|jp|ch)_/.test(id) ? resolveChoice(g, id, true) : g.eu!.news.push({ id, title, text, yes, no }));
const flagged = (p: { flags?: string }, f: string) => (p.flags ?? '').includes(f);
const axisHolds = (g: GameState, country: string) => PLIST.filter(p => p.country === country && g.ctrl[p.id] === 'GER').length;

function eastPoland(g: GameState) {
  const eu = g.eu!;
  if (eu.flags.ostpolen || !eu.flags.pakt || !neutral(g, 'SOV')) return;
  eu.flags.ostpolen = eu.day + 1;
  const east = PLIST.filter(p => eu.owner[p.id] === 'POL' && (p.ll![1] >= 23.6 || (p.ll![0] < 50.6 && p.ll![1] >= 22.9))).map(p => p.id);
  g.divs = g.divs.filter(d => !(d.nation === 'POL' && east.includes(d.prov)));
  transfer(g, east, 'SOV');
  news(g, 'Die Rote Armee besetzt Ostpolen', 'Gemäß dem geheimen Zusatzprotokoll zum Nichtangriffspakt rückt die Sowjetunion in die östlichen Landesteile Polens ein.');
}

function vichy(g: GameState) {
  const eu = g.eu!;
  const fr = ownedBy(g, 'FRA');
  const south = fr.filter(p => flagged(p, 'k') || (p.ll![0] < 46.4 && p.ll![1] > 0.4)).map(p => p.id);
  const north = fr.filter(p => !south.includes(p.id)).map(p => p.id);
  // Heer, Luftwaffe und Vorräte fallen dem Sieger zu, die Flotte nicht
  const got = (me(g) === 'GER' ? loot(g, 'FRA', false) : '') + frenchFleet(g);
  eu.gone = eu.gone.filter(c => c !== 'VIC');
  eu.gone.push('FRA');
  g.divs = g.divs.filter(d => d.nation !== 'FRA');
  delete eu.airN.FRA;
  eu.rel.FRA = 'N';
  eu.rel.VIC = 'N';
  for (const id of south) eu.owner[id] = 'VIC';
  transfer(g, north, 'GER');
  news(g, 'Frankreich kapituliert', 'Nach dem Fall von Paris schließt Frankreich einen Waffenstillstand. Der Norden und die Atlantikküste werden besetzt; im Süden und in den Kolonien regiert die Regierung in Vichy. Britische Truppen auf dem Festland schiffen sich nach England ein.' + got);
}

const EVENTS: Ev[] = [
  { id: 'rhein', on: [1936, 3, 7], run: g => news(g, 'Besetzung des Rheinlands', 'Am 7. März 1936 rücken deutsche Truppen in das entmilitarisierte Rheinland ein. Frankreich und Großbritannien belassen es bei Protesten.') },
  { id: 'spanien', on: [1936, 7, 17], cond: g => neutral(g, 'SPA'), run: g => {
    startCivilWar(g);
    ask(g, 'condor', 'Bürgerkrieg in Spanien',
      'In Spanien erhebt sich ein Teil der Armee unter General Franco gegen die Republik. Der Krieg wird auf der Karte ausgefochten; Francos Truppen führt die KI. Soll die Luftwaffe eingreifen („Legion Condor“)? Dann dürfen Sie Staffeln über Spanien einsetzen (Luftansicht, Sektoren wie gewohnt). Der Einsatz bringt Erfahrung: Flugzeugmuster werden schneller entwickelt, nach dem Krieg kämpfen die Staffeln etwas besser.',
      'Legion Condor entsenden', 'Keine Flugzeuge');
  } },
  { id: 'ctv', on: [1936, 12, 22], cond: civil, run: g => {
    const at = ['cadiz', 'sevilla'].filter(id => g.ctrl[id] === 'GER');
    const n = g.divs.length;
    deploy(g, 'ITA', ['GI', 'GI', 'GI'], at);
    for (const d of g.divs.slice(n)) (d.side = 'GER'), (d.army = 'Corpo Truppe Volontarie');
    news(g, 'Italienische Freiwillige in Spanien', 'Mussolini schickt ein Freiwilligenkorps zu Franco; es landet in Cádiz.');
  } },
  { id: 'achse', on: [1936, 11, 1], run: g => news(g, 'Achse Berlin–Rom', 'Deutschland und Italien stimmen ihre Außenpolitik ab; wenig später folgt der Antikominternpakt mit Japan.') },
  { id: 'anschluss', on: [1938, 3, 12], cond: g => neutral(g, 'AUT'), run: g => {
    const at = ownedBy(g, 'AUT').map(p => p.id);
    absorb(g, 'AUT', 'GER', true);
    deploy(g, 'GER', ['ID2', 'ID2', 'ID2', 'GEBD', 'GEBD', 'LEI'], at);
    for (const d of g.divs.slice(-6)) d.name = nextGerName(g, d.kind);
    if (me(g) === 'GER') g.eu!.eco.men += 120;
    // Zeughäuser des Bundesheeres, Gold- und Devisenschatz der Nationalbank (er bezahlt Einfuhren), eine Jagdstaffel Fiat CR.32
    const got = booty(g, { 'inf:0': 70, 'art:0': 25, 'pak:0': 10, 'kfz:0': 15, 'pzl:0': 10 }, { steel: 450, oil: 120, sup: 150 }, 1, 0);
    news(g, 'Anschluss Österreichs', `Am 12. März 1938 marschiert die Wehrmacht in Österreich ein, das als „Ostmark“ dem Reich angegliedert wird. Industrie, Rohstoffe und das Bundesheer (sechs Verbände) gehen im Reich auf, dazu die Bestände seiner Zeughäuser und der Gold- und Devisenschatz der Nationalbank.${got}`);
  } },
  { id: 'muenchen', on: [1938, 9, 30], cond: g => neutral(g, 'CSR'), run: g => {
    transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'CSR' && flagged(p, 'sud')).map(p => p.id), 'GER', true);
    news(g, 'Münchner Abkommen', 'Großbritannien, Frankreich und Italien stimmen der Abtretung des Sudetenlands an das Deutsche Reich zu. Die Tschechoslowakei verliert ihre Grenzbefestigungen.');
  } },
  { id: 'prag', on: [1939, 3, 15], cond: g => neutral(g, 'CSR'), run: g => {
    const eu = g.eu!, cs = ownedBy(g, 'CSR');
    eu.gone = eu.gone.filter(c => c !== 'SVK');
    eu.gone.push('CSR');
    eu.rel.SVK = 'A';
    for (const p of cs) eu.owner[p.id] = flagged(p, 'slo') ? 'SVK' : flagged(p, 'karp') && exists(g, 'HUN') ? 'HUN' : 'GER';
    for (const p of cs) if (eu.owner[p.id] === 'GER') eu.core[p.id] = 1;
    syncCtrl(g);
    spawnArmy(g, 'SVK');
    const got = czechLoot(g);
    news(g, 'Zerschlagung der Tschechoslowakei', `Deutsche Truppen besetzen Böhmen und Mähren („Reichsprotektorat“). Die Slowakei erklärt sich unter deutschem Schutz für selbständig, Ungarn nimmt die Karpatoukraine. Dem Reich fallen die Rüstungsbetriebe und die Bestände des tschechoslowakischen Heeres zu – darunter der Panzer 38(t), der ab sofort gefertigt werden kann.${got}`);
  } },
  { id: 'memel', on: [1939, 3, 23], cond: g => neutral(g, 'LIT'), run: g => {
    transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'LIT' && flagged(p, 'memel')).map(p => p.id), 'GER', true);
    news(g, 'Memelland', 'Litauen tritt unter Druck das Memelgebiet an das Deutsche Reich ab.');
  } },
  { id: 'garantie', on: [1939, 3, 31], run: g => news(g, 'Britisch-französische Garantie für Polen', 'London und Paris sichern Polen Beistand zu. Ein Angriff auf Polen bedeutet Krieg mit den Westmächten.') },
  { id: 'spainend', on: [1939, 4, 1], cond: g => !g.eu!.flags.civil, run: g => news(g, 'Ende des Spanischen Bürgerkriegs', g.eu!.flags.condor
    ? 'Franco hat gesiegt. Die Legion Condor kehrt zurück; ihre Erfahrungen fließen in Ausbildung und Flugzeugbau ein. Spanien bleibt neutral.'
    : 'Franco hat gesiegt. Spanien bleibt neutral.') },
  { id: 'albanien', on: [1939, 4, 7], cond: g => neutral(g, 'ALB') && exists(g, 'ITA'), run: g => (absorb(g, 'ALB', 'ITA'), news(g, 'Italien besetzt Albanien', 'Italienische Truppen landen in Albanien, das mit Italien vereinigt wird.')) },
  { id: 'pakt', on: [1939, 8, 23], cond: g => neutral(g, 'SOV'), run: g => news(g, 'Deutsch-sowjetischer Nichtangriffspakt', 'Ribbentrop und Molotow unterzeichnen in Moskau einen Nichtangriffspakt. Ein geheimes Zusatzprotokoll grenzt die Interessengebiete in Osteuropa ab; die Sowjetunion liefert Rohstoffe und bietet Öl an (Reich verwalten → Handel).') },
  { id: 'weiss', on: [1939, 9, 1], cond: g => neutral(g, 'POL'), run: g => ask(g, 'weiss', 'Fall Weiß',
    'Der Aufmarsch gegen Polen ist abgeschlossen. Historisch beginnt der Angriff am 1. September 1939 – Großbritannien und Frankreich erklären daraufhin den Krieg. Sie können auch abwarten und Polen später über die Diplomatie den Krieg erklären.',
    'Polen angreifen', 'Abwarten') },
  { id: 'ostpolen', cond: g => !!g.eu!.flags.pakt && neutral(g, 'SOV') && enemy(g, 'POL') && (g.ctrl.warschau === 'GER' || g.eu!.day >= (g.eu!.flags.war_POL ?? 1e9) + 16), run: eastPoland },
  { id: 'winterkrieg', on: [1939, 11, 30], cond: g => !!g.eu!.flags.pakt && neutral(g, 'SOV') && neutral(g, 'FIN'), run: g => news(g, 'Winterkrieg', 'Die Sowjetunion greift Finnland an. Die finnische Armee hält unerwartet lange stand.') },
  { id: 'moskau40', on: [1940, 3, 13], cond: g => !!g.eu!.flags.winterkrieg && neutral(g, 'SOV') && neutral(g, 'FIN'), run: g => {
    transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'FIN' && flagged(p, 'karel')).map(p => p.id), 'SOV');
    news(g, 'Friede von Moskau', 'Finnland muss Karelien mit Wiborg an die Sowjetunion abtreten.');
  } },
  { id: 'weser', on: [1940, 4, 9], cond: g => enemy(g, 'ENG') && (neutral(g, 'NOR') || neutral(g, 'DNK')), run: g => ask(g, 'weser', 'Unternehmen Weserübung',
    'Über Narvik läuft im Winter das schwedische Erz; die Briten bereiten die Verminung der norwegischen Gewässer vor. Historisch besetzt die Wehrmacht am 9. April 1940 Dänemark und landet in Norwegen. Norwegen ist nur über See zu erreichen: Verbände in einem Hafen können übersetzen oder landen, je Runde so viele, wie Transportflotten in der Nordsee stehen (Reich verwalten → Marine).',
    'Dänemark und Norwegen angreifen', 'Verzichten') },
  { id: 'gelb', on: [1940, 5, 10], cond: g => enemy(g, 'FRA') && (neutral(g, 'BEL') || neutral(g, 'NLD')), run: g => ask(g, 'gelb', 'Fall Gelb',
    'Die Maginot-Linie deckt die deutsch-französische Grenze. Historisch greift die Wehrmacht am 10. Mai 1940 durch die Niederlande, Belgien und Luxemburg an.',
    'Benelux-Staaten angreifen', 'Verzichten') },
  { id: 'italien', cond: g => g.eu!.day >= dayOf(1940, 1, 1) && neutral(g, 'ITA') && enemy(g, 'ENG') && (!exists(g, 'FRA') || axisHolds(g, 'FRA') >= 6), run: g => {
    join(g, 'ITA', 'A');
    news(g, 'Italien tritt in den Krieg ein', 'Mussolini erklärt Großbritannien und Frankreich den Krieg. Italienische Truppen stehen in den Alpen, in Libyen und im Dodekanes. Vier Fünftel des Heeres und der Luftwaffe unterstehen Ihrem Befehl, der Rest schützt unter eigener Führung das Land.');
  } },
  { id: 'baltikum', on: [1940, 6, 15], cond: g => !!g.eu!.flags.pakt && neutral(g, 'SOV'), run: g => {
    for (const c of ['EST', 'LAT', 'LIT']) if (neutral(g, c)) absorb(g, c, 'SOV');
    if (neutral(g, 'ROM')) transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'ROM' && flagged(p, 'bess')).map(p => p.id), 'SOV');
    news(g, 'Die Sowjetunion annektiert das Baltikum', 'Estland, Lettland und Litauen werden besetzt und der Sowjetunion eingegliedert; Rumänien muss Bessarabien und die Nordbukowina abtreten.');
  } },
  { id: 'wien2', on: [1940, 8, 30], cond: g => neutral(g, 'ROM') && exists(g, 'HUN'), run: g => {
    transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'ROM' && flagged(p, 'ntrans')).map(p => p.id), 'HUN');
    news(g, 'Zweiter Wiener Schiedsspruch', 'Rumänien tritt Nordsiebenbürgen an Ungarn ab.');
  } },
  { id: 'dreimaechte', on: [1940, 9, 27], run: g => news(g, 'Dreimächtepakt', 'Deutschland, Italien und Japan schließen ein Militärbündnis.') },
  { id: 'griechenland', on: [1940, 10, 28], cond: g => relOf(g, 'ITA') === 'A' && exists(g, 'ITA') && neutral(g, 'GRC'), run: g => {
    join(g, 'GRC', 'E');
    news(g, 'Italien greift Griechenland an', 'Von Albanien aus marschieren italienische Truppen in Griechenland ein. Griechenland steht damit an der Seite Großbritanniens.');
  } },
  { id: 'beitritt', on: [1940, 11, 20], cond: g => atWar(g), run: g => {
    const who = ['HUN', 'ROM', 'SVK'].filter(c => exists(g, c) && (neutral(g, c) || c === 'SVK'));
    for (const c of who) join(g, c, 'A');
    news(g, 'Beitritte zum Dreimächtepakt', 'Ungarn, Rumänien und die Slowakei treten dem Pakt bei. Vier Fünftel ihrer Armeen und Luftwaffen unterstehen Ihrem Befehl, der Rest schützt das eigene Land; rumänisches Öl lässt sich nun reichlicher einkaufen.');
  } },
  { id: 'bulgarien', on: [1941, 3, 1], cond: g => atWar(g) && neutral(g, 'BUL'), run: g => (join(g, 'BUL', 'A'), news(g, 'Bulgarien tritt dem Dreimächtepakt bei', 'Deutsche Truppen dürfen durch Bulgarien marschieren.')) },
  { id: 'putsch', on: [1941, 3, 27], cond: g => atWar(g) && neutral(g, 'YUG'), run: g => ask(g, 'marita', 'Staatsstreich in Belgrad',
    'Offiziere stürzen die Regierung, die eben dem Dreimächtepakt beigetreten war. Historisch greift die Wehrmacht am 6. April 1941 Jugoslawien und Griechenland an.',
    'Jugoslawien angreifen', 'Verzichten') },
  { id: 'barbarossa', on: [1941, 6, 22], cond: g => neutral(g, 'SOV'), run: g => ask(g, 'barbarossa', 'Unternehmen Barbarossa',
    'Der Aufmarsch im Osten ist befohlen. Historisch beginnt am 22. Juni 1941 der Angriff auf die Sowjetunion – die Rote Armee ist zahlenmäßig weit überlegen, ihre Reserven und ihre Industrie sind gewaltig, der Nachschub reicht nur begrenzt weit. Ohne Angriff bleibt der Pakt vorerst bestehen.',
    'Sowjetunion angreifen', 'Pakt einhalten') },
  { id: 'usa', w: 0, on: [1941, 12, 11], cond: g => enemy(g, 'ENG'), run: g => {
    g.eu!.rel.USA = 'E';
    g.eu!.airN.USA = { f: 4, b: 4 };
    news(g, 'Krieg mit den Vereinigten Staaten', 'Nach dem japanischen Angriff auf Pearl Harbor stehen die USA im Krieg. Amerikanische Verbände treffen nach und nach in Großbritannien und im Mittelmeerraum ein.');
  } },
  { id: 'sowjetangriff', on: [1942, 6, 1], cond: g => neutral(g, 'SOV') && atWar(g), run: g => {
    join(g, 'SOV', 'E');
    news(g, 'Die Sowjetunion greift an', 'Stalin hält den Zeitpunkt für gekommen: Die Rote Armee eröffnet den Krieg gegen das Deutsche Reich.');
  } },
  { id: 'torch', on: [1942, 11, 8], cond: g => enemy(g, 'USA') && neutral(g, 'VIC'), run: g => {
    const eu = g.eu!, v = ownedBy(g, 'VIC'), axis = exists(g, 'ITA') && relOf(g, 'ITA') === 'A' ? 'ITA' : 'GER';
    const west = v.filter(p => flagged(p, 'k') && p.ll![1] < 8).map(p => p.id);
    const sunk = scuttleToulon(g);
    eu.gone.push('VIC');
    g.divs = g.divs.filter(d => d.nation !== 'VIC');
    for (const p of v) eu.owner[p.id] = west.includes(p.id) ? 'USA' : p.ll![1] > 30 || (flagged(p, 'k') && p.ll![0] < 28) ? (enemy(g, 'ENG') ? 'ENG' : axis) : flagged(p, 'k') ? axis : 'GER';
    syncCtrl(g);
    evict(g);
    deploy(g, 'USA', ['GI', 'GI', 'GI', 'GO', 'GA'], west.filter(id => PROV[id].port));
    deploy(g, 'ENG', ['GI', 'GI'], west.filter(id => PROV[id].port));
    news(g, 'Landung in Nordafrika', 'Amerikanische und britische Truppen landen in Marokko und Algerien; die dortigen Vichy-Truppen stellen den Kampf ein. Die Wehrmacht besetzt daraufhin auch Südfrankreich, die Achse sichert Tunesien.' + sunk);
  } },
  // ---- nur im Welt-Szenario ----
  { id: 'abessinien', w: 1, on: [1936, 5, 5], cond: g => neutral(g, 'ETH') && exists(g, 'ITA'), run: g => (absorb(g, 'ETH', 'ITA'), news(g, 'Italien annektiert Abessinien', 'Italienische Truppen ziehen in Addis Abeba ein. Abessinien wird mit Eritrea und Somaliland zu Italienisch-Ostafrika vereinigt.')) },
  { id: 'china37', w: 1, on: [1937, 7, 7], cond: g => !eastPlayer(g) && neutral(g, 'JAP') && neutral(g, 'CHI'), run: g => {
    transfer(g, chinese(g, [[35.5, 42, 113, 123], [30, 33.2, 117.5, 123]]), 'JAP');
    news(g, 'Krieg zwischen Japan und China', 'Nach dem Zwischenfall an der Marco-Polo-Brücke besetzen japanische Truppen Peking, Tientsin, Schanghai und Nanking. Die chinesische Regierung weicht nach Tschungking aus. Der Krieg in China wird nicht auf der Karte ausgefochten, solange Japan nicht in den Weltkrieg eintritt.');
  } },
  { id: 'china38', w: 1, on: [1938, 10, 25], cond: g => !eastPlayer(g) && neutral(g, 'JAP') && neutral(g, 'CHI'), run: g => {
    transfer(g, chinese(g, [[29, 35.5, 113, 123], [22, 24.2, 112.3, 115]]), 'JAP');
    news(g, 'Hankau und Kanton gefallen', 'Japan nimmt Hankau und Kanton. Die Front in China erstarrt.');
  } },
  { id: 'hainan', w: 1, on: [1939, 2, 10], cond: g => !eastPlayer(g) && neutral(g, 'JAP') && neutral(g, 'CHI'), run: g => transfer(g, chinese(g, [[18, 20.6, 108, 111.5]]), 'JAP') },
  { id: 'neutral41', w: 1, on: [1941, 4, 13], cond: g => neutral(g, 'JAP'), run: g => news(g, 'Japanisch-sowjetischer Neutralitätspakt', 'Japan und die Sowjetunion sichern sich gegenseitig Neutralität zu. An der Grenze der Mandschurei herrscht Waffenruhe, auch wenn beide in den Weltkrieg eintreten.') },
  { id: 'indochina', w: 1, on: [1941, 7, 28], cond: g => me(g) !== 'JAP' && (neutral(g, 'JAP') || me(g) === 'CHI') && exists(g, 'JAP') && neutral(g, 'VIC'), run: g => {
    transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'VIC' && inBox(p, [8, 24, 100, 110])).map(p => p.id), 'JAP');
    news(g, 'Japan besetzt Indochina', 'Die Regierung in Vichy überlässt Japan Stützpunkte in ganz Indochina. Die Vereinigten Staaten sperren daraufhin die Öllieferungen an Japan.');
  } },
  { id: 'pearl', w: 1, on: [1941, 12, 7], cond: g => me(g) !== 'JAP' && enemy(g, 'ENG') && exists(g, 'JAP') && (neutral(g, 'JAP') || (me(g) === 'CHI' && !g.eu!.flags.x_pacific)), run: g => {
    const eu = g.eu!;
    eu.flags.usa = eu.flags.x_pacific = eu.day + 1;
    for (const c of ['USA', 'CHI', 'NLD']) if (neutral(g, c)) join(g, c, 'E');
    for (const c of ['JAP', 'MAN']) join(g, c, 'A');
    if (me(g) === 'USA') {
      // der Überfall trifft die Schlachtflotte: vier Schlachtschiffe sinken, die Träger sind auf See
      const own = ensureNavy(g).own;
      let hit = 4;
      for (const z of ['Z', 'H', 'N']) while (hit > 0 && own[z]?.bb >= 1) (own[z].bb--, hit--);
      news(g, 'Verluste in Pearl Harbor', 'Arizona, Oklahoma, West Virginia und California sind gesunken, weitere Schiffe beschädigt. Die Flugzeugträger waren nicht im Hafen. Ihre Flotte hat vier Schlachtschiffe weniger.');
    }
    news(g, 'Pearl Harbor', 'Japan greift die amerikanische Pazifikflotte in Pearl Harbor an und eröffnet den Krieg gegen die Vereinigten Staaten, Großbritannien und die Niederlande. Deutschland und Italien erklären den USA den Krieg. Japan und Mandschukuo kämpfen als Verbündete, China steht nun auf der Seite der Alliierten.');
  } },
  { id: 'jap1', w: 1, on: [1941, 12, 25], cond: pacificAI, run: g => {
    seize(g, ['hongkong', 'guam', 'wake'], ['GI', 'GG', 'GG']);
    if (neutral(g, 'SIA')) join(g, 'SIA', 'A'), deploy(g, 'JAP', ['GI', 'GI', 'GI'], ownedBy(g, 'SIA').map(p => p.id));
    news(g, 'Japanischer Vormarsch', 'Hongkong, Guam und Wake sind gefallen. Siam schließt sich Japan an.');
  } },
  { id: 'jap2', w: 1, on: [1942, 2, 15], cond: pacificAI, run: g => {
    seize(g, [...held(g, 'ENG', [-5, 8, 99, 120]), 'rabaul'], ['GI', 'GI', 'GI', 'GI', 'GG', 'GG']);
    news(g, 'Singapur kapituliert', 'Die Festung Singapur ergibt sich. Malaya, Britisch-Borneo und Rabaul sind in japanischer Hand.');
  } },
  { id: 'jap3', w: 1, on: [1942, 3, 9], cond: pacificAI, run: g => {
    seize(g, [...PLIST.filter(p => p.country === 'NLD' && p.ll![1] > 94 && g.ctrl[p.id] === 'POL').map(p => p.id), ...held(g, 'ENG', [9, 20, 92, 99.5])], ['GI', 'GI', 'GI', 'GI', 'GI', 'GI', 'GO', 'GG', 'GG', 'GG']);
    news(g, 'Niederländisch-Indien besetzt', 'Java kapituliert; mit den Ölfeldern von Sumatra und Borneo hat Japan sein wichtigstes Kriegsziel erreicht. Auch Rangun ist gefallen.');
  } },
  { id: 'jap4', w: 1, on: [1942, 5, 6], cond: pacificAI, run: g => {
    seize(g, [...held(g, 'USA', [4, 21, 116, 127]), ...held(g, 'ENG', [20, 26, 92, 99.5]), 'lae', 'guadalcanal', 'arawa'], ['GI', 'GI', 'GI', 'GI', 'GI', 'GI', 'GI', 'GG', 'GG']);
    news(g, 'Die Philippinen und Burma verloren', 'Corregidor hat kapituliert, die Briten haben sich aus Burma nach Indien zurückgezogen. Japan steht an der Grenze Indiens und vor Australien – weiter trägt der Vorstoß nicht.');
  } },
  { id: 'sturm', w: 1, on: [1945, 8, 8], cond: g => me(g) !== 'JAP' && enemy(g, 'SOV') && japanAtWar(g) && exists(g, 'MAN'), run: g => {
    g.divs = g.divs.filter(d => !(d.side === 'GER' && PROV[d.prov].country === 'MAN'));
    absorb(g, 'MAN', 'SOV');
    news(g, 'Die Sowjetunion greift Japan an', 'Die Sowjetunion kündigt den Neutralitätspakt. Die Rote Armee überrennt die Mandschurei, die Kwantung-Armee geht unter.');
  } },
  { id: 'totalerkrieg', on: [1943, 2, 18], cond: g => atWar(g), run: g => news(g, 'Totaler Krieg', 'Die Wirtschaft wird vollständig auf die Rüstung ausgerichtet: +15 % Industriekapazität.') },
  // ---- Der Spieler führt nicht das Reich: Dessen erste Feldzüge laufen nach dem historischen Fahrplan ----
  { id: 'h_polen', on: [1939, 10, 6], cond: g => me(g) !== 'GER' && enemy(g, 'POL'), run: g => surrender(g, 'POL') },
  { id: 'h_nord', on: [1940, 6, 10], cond: g => me(g) !== 'GER' && (enemy(g, 'DNK') || enemy(g, 'NOR')), run: g => { for (const c of ['DNK', 'NOR']) if (enemy(g, c)) surrender(g, c); } },
  { id: 'h_west', on: [1940, 6, 22], cond: g => me(g) !== 'GER' && enemy(g, 'FRA'), run: g => { for (const c of ['NLD', 'BEL', 'LUX', 'FRA']) if (enemy(g, c) && c !== me(g)) surrender(g, c); } },
  { id: 'h_balkan', on: [1941, 4, 30], cond: g => me(g) !== 'GER' && (enemy(g, 'YUG') || enemy(g, 'GRC')), run: g => { for (const c of ['YUG', 'GRC']) if (enemy(g, c)) surrender(g, c); } },

  // ---- Vereinigte Staaten ----
  { id: 'us_cashcarry', on: [1939, 11, 4], cond: g => me(g) === 'USA' && enemy(g, 'ENG'), run: g => ask(g, 'us_cashcarry', 'Neutralitätsgesetz: „Cash and Carry“',
    'Der Kongress berät über das Waffenembargo. Wird es aufgehoben, können Großbritannien und Frankreich gegen Barzahlung in den USA Rüstungsgüter kaufen und selbst abholen. Die Aufträge beleben die Industrie (+4 IK), Großbritannien rüstet schneller.',
    'Embargo aufheben', 'Strikte Neutralität') },
  { id: 'us_draft', on: [1940, 9, 16], cond: g => me(g) === 'USA', run: g => ask(g, 'us_draft', 'Selective Training and Service Act',
    'Nach dem Fall Frankreichs liegt dem Kongress die erste Wehrpflicht in Friedenszeiten vor. Sie bringt 500 Mann Ersatz und sechs neue, noch unerfahrene Infanterie-Divisionen.',
    'Wehrpflicht einführen', 'Beim Freiwilligenheer bleiben') },
  { id: 'us_lendlease', on: [1941, 3, 11], cond: g => me(g) === 'USA' && enemy(g, 'ENG'), run: g => ask(g, 'us_lendlease', 'Leih- und Pachtgesetz',
    'Großbritannien kann nicht mehr bar bezahlen. Mit dem Leih- und Pachtgesetz liefern die USA Kriegsmaterial auf Kredit: Großbritannien und später die Sowjetunion rüsten 15 % schneller, dafür fehlen der eigenen Rüstung 5 % der Industrie.',
    '„Arsenal der Demokratie“', 'Keine Lieferungen auf Kredit') },
  { id: 'us_wpb', on: [1942, 1, 16], cond: g => me(g) === 'USA' && relOf(g, 'USA') === 'E', run: g => {
    g.eu!.flags.x_wpb = 1;
    news(g, 'War Production Board', 'Präsident Roosevelt unterstellt die gesamte Wirtschaft der Rüstungsplanung: Autofabriken bauen Panzer und Bomber. +15 % Industriekapazität.');
  } },

  // ---- Großbritannien ----
  { id: 'en_shadow', on: [1936, 4, 1], cond: g => me(g) === 'ENG', run: g => ask(g, 'en_shadow', 'Schattenfabriken',
    'Das Luftfahrtministerium will Autofabriken für den Flugzeug- und Motorenbau vorbereiten. Der Aufbau kostet 300 Stahl und bringt 4 IK zusätzlich.',
    'Programm auflegen', 'Zu teuer') },
  { id: 'en_draft', on: [1939, 4, 27], cond: g => me(g) === 'ENG', run: g => ask(g, 'en_draft', 'Military Training Act',
    'Nach der Besetzung Prags führt Großbritannien erstmals im Frieden eine begrenzte Wehrpflicht ein: 400 Mann Ersatz und fünf neue, noch unerfahrene Infanterie-Divisionen.',
    'Wehrpflicht einführen', 'Ablehnen') },
  { id: 'en_homeguard', on: [1940, 7, 1], cond: g => me(g) === 'ENG' && !exists(g, 'FRA'), run: g => ask(g, 'en_homeguard', 'Home Guard',
    'Nach dem Fall Frankreichs droht die Invasion. Die Local Defence Volunteers stellen sechs Reserve-Divisionen für die Verteidigung der Insel; sie kosten 150 Mann Ersatz.',
    'Home Guard aufstellen', 'Verzichten') },
  { id: 'en_bases', on: [1940, 9, 2], cond: g => me(g) === 'ENG' && exists(g, 'USA') && enemy(g, 'ENG'), run: g => {
    ensureNavy(g).own.H.dd += 5;
    news(g, 'Zerstörer gegen Stützpunkte', 'Die Vereinigten Staaten überlassen Großbritannien fünfzig alte Zerstörer im Tausch gegen Stützpunkte in der Karibik und auf Neufundland: fünf Zerstörerflottillen liegen im Hafen.');
  } },
  { id: 'en_ultra', on: [1941, 5, 9], cond: g => ['ENG', 'USA'].includes(me(g)) && enemy(g, 'ENG'), run: g => {
    g.eu!.flags.x_ultra = 1;
    news(g, 'Enigma entziffert', 'Mit der Schlüsselmaschine und den Unterlagen von U 110 liest Bletchley Park den Funkverkehr der deutschen U-Boote mit. Geleitzüge weichen den Rudeln aus: deutlich weniger Verluste im Atlantik, mehr versenkte U-Boote.');
  } },

  // ---- Frankreich ----
  { id: 'fr_matignon', on: [1936, 6, 7], cond: g => me(g) === 'FRA', run: g => {
    g.eu!.flags.x_matignon = 1;
    news(g, 'Verträge von Matignon', 'Die Volksfrontregierung führt die 40-Stunden-Woche und bezahlten Urlaub ein und verstaatlicht Rüstungsbetriebe. Die Umstellung kostet vorerst 6 % der Industrieleistung.');
  } },
  { id: 'fr_maginot', on: [1936, 9, 7], cond: g => me(g) === 'FRA', run: g => ask(g, 'fr_maginot', 'Verlängerung der Maginot-Linie',
    'Belgien kehrt zur Neutralität zurück; die Nordgrenze bis zum Meer ist offen. Der Ausbau kostet 400 Stahl und bringt vier Festungsverbände an der belgischen Grenze.',
    'Linie verlängern', 'Bewegliche Reserven genügen') },
  { id: 'fr_reynaud', on: [1938, 11, 12], cond: g => me(g) === 'FRA', run: g => {
    g.eu!.flags.x_matignon = 0;
    news(g, 'Notverordnungen Reynauds', 'Die 40-Stunden-Woche wird für die Rüstung aufgehoben, die Fertigung zieht an: Die Einbuße von 6 % entfällt.');
  } },
  { id: 'fr_dcr', on: [1939, 12, 2], cond: g => me(g) === 'FRA' && enemy(g, 'FRA'), run: g => ask(g, 'fr_dcr', 'Divisions cuirassées',
    'Oberst de Gaulle und General Billotte drängen darauf, die auf die Infanterie verteilten Panzer zu Panzerdivisionen zusammenzufassen. Zwei Panzer-Divisionen entstehen aus vorhandenem Gerät; die Umgliederung kostet 300 Stahl.',
    'Panzerdivisionen bilden', 'Panzer bleiben bei der Infanterie') },
  { id: 'fr_mob', cond: g => me(g) === 'FRA' && enemy(g, 'FRA'), run: g => {
    const n = g.divs.length;
    deploy(g, 'FRA', Array<string>(10).fill('GR'), ownedBy(g, 'FRA').filter(p => p.country === 'FRA' && !flagged(p, 'k')).map(p => p.id));
    for (const d of g.divs.slice(n)) d.xp = XP_NEW;
    g.eu!.eco.men += 400;
    news(g, 'Allgemeine Mobilmachung', 'Frankreich ruft seine Reservisten ein: zehn Reserve-Divisionen der Serie B werden aufgestellt, 400 Mann Ersatz stehen bereit.');
  } },

  // ---- Italien ----
  { id: 'it_ctv', on: [1936, 12, 18], cond: g => me(g) === 'ITA' && civil(g), run: g => ask(g, 'it_ctv', 'Corpo Truppe Volontarie',
    'Franco bittet um Hilfe. Sollen italienische Heeresverbände nach Spanien gehen? Vier Infanterie-Verbände und ein Panzerverband – die jeweils stärksten des stehenden Heeres – werden nach Südspanien verschifft und dort von Ihnen selbst geführt, neben Francos Truppen. Sie fehlen so lange in der Heimat und kehren nach dem Krieg mit Kampferfahrung zurück.',
    'Truppen entsenden', 'Keine Truppen') },
  { id: 'it_autarkie', on: [1936, 3, 23], cond: g => me(g) === 'ITA', run: g => ask(g, 'it_autarkie', 'Autarkie',
    'Die Sanktionen des Völkerbunds treffen die Einfuhren. Mussolini verkündet die wirtschaftliche Selbstversorgung: Der Ausbau kostet 250 Stahl und bringt 3 IK.',
    'Autarkie ausrufen', 'Auf Handel setzen') },
  { id: 'it_stahlpakt', on: [1939, 5, 22], cond: g => me(g) === 'ITA', run: g => {
    const e = g.eu!.eco;
    e.steel += 400;
    e.oil += 200;
    news(g, 'Stahlpakt', 'Italien und das Deutsche Reich schließen ein Militärbündnis. Deutsche Kohle- und Stahllieferungen laufen an (+400 Stahl, +200 Öl).');
  } },
  { id: 'it_taranto', on: [1940, 11, 11], cond: g => me(g) === 'ITA' && enemy(g, 'ENG') && relOf(g, 'ITA') === 'A', run: g => {
    const own = ensureNavy(g).own;
    // getroffen werden nur Schiffe im Hafen: wer in See steht, entgeht dem Angriff
    const hit = Math.min(3, Math.floor(own.H.bb));
    own.H.bb -= hit;
    news(g, 'Angriff auf Tarent', hit ? `Britische Torpedoflugzeuge des Trägers Illustrious greifen in der Nacht die Flotte im Hafen von Tarent an: ${hit} Schlachtschiff${hit === 1 ? '' : 'e'} außer Gefecht.` : 'Britische Torpedoflugzeuge greifen Tarent an, finden den Hafen aber leer: Die Schlachtflotte steht in See.');
  } },
  { id: 'it_dak', on: [1941, 2, 12], cond: g => me(g) === 'ITA' && enemy(g, 'ENG') && relOf(g, 'ITA') === 'A', run: g => ask(g, 'it_dak', 'Deutsches Afrikakorps',
    'Das Reich bietet Hilfe für Nordafrika an: zwei schnelle deutsche Verbände unter General Rommel für Tripolis, dazu Treibstoff (+300 Öl). Sie führt die KI; Italien verliert damit ein Stück Eigenständigkeit im Mittelmeerraum.',
    'Hilfe annehmen', 'Italien kämpft allein') },

  // ---- Japan ----
  { id: 'jp_226', w: 1, on: [1936, 2, 26], cond: g => me(g) === 'JAP', run: g => {
    g.eu!.eco.fac += 2;
    news(g, 'Putschversuch in Tokio', 'Junge Offiziere der Kōdō-Faktion besetzen das Regierungsviertel und ermorden mehrere Minister. Der Aufstand bricht nach drei Tagen zusammen, doch das Heer bestimmt fortan die Politik und setzt sein Rüstungsprogramm durch: +2 IK.');
  } },
  ...[1937, 1938, 1939].map((y, i): Ev => ({ id: `jp_china${i || ''}`, w: 1, on: [y, 7, 7], cond: g => me(g) === 'JAP' && neutral(g, 'CHI') && !g.eu!.flags.x_east, run: g => ask(g, `jp_china${i || ''}`, i ? 'Krieg gegen China?' : 'Zwischenfall an der Marco-Polo-Brücke',
    (i ? 'An der Grenze zu Nordchina kommt es erneut zu Zusammenstößen. ' : 'Bei Peking geraten japanische und chinesische Truppen aneinander. Das Heer drängt darauf, den Zwischenfall zum Krieg auszuweiten. ')
    + 'Japan und Mandschukuo stünden gegen ganz China: ein schwach gerüstetes, aber riesiges Land mit über hundert Divisionen. Die Truppen Mandschukuos unterstehen Ihnen. Der Krieg läuft in Wochenrunden und wird auf der Karte ausgefochten; die Westmächte und die Sowjetunion bleiben vorerst außen vor.',
    'Krieg gegen China', 'Den Zwischenfall beilegen') })),
  { id: 'jp_mob', w: 1, on: [1938, 4, 1], cond: g => me(g) === 'JAP' && !!g.eu!.flags.x_east, run: g => ask(g, 'jp_mob', 'Nationales Mobilisierungsgesetz',
    'Der Krieg in China dauert länger als geplant. Das Gesetz unterstellt Arbeitskräfte, Rohstoffe und Betriebe der Regierung: +4 IK und 300 Mann Ersatz; die Umstellung kostet 200 Stahl.',
    'Gesetz erlassen', 'Die Wirtschaft bleibt frei') },
  { id: 'jp_nomonhan', w: 1, on: [1939, 9, 15], cond: g => me(g) === 'JAP' && exists(g, 'SOV'), run: g => {
    g.eu!.eco.men = Math.max(0, g.eu!.eco.men - 150);
    news(g, 'Niederlage am Chalchin Gol', 'An der mongolischen Grenze zerschlagen sowjetische Panzerverbände unter Schukow die 6. Armee. Die Kwantung-Armee verliert 150 Mann Ersatz; ein Waffenstillstand beendet den Grenzkrieg. Der Weg nach Norden ist fürs Erste versperrt.');
  } },
  { id: 'jp_neutral', w: 1, on: [1941, 4, 13], cond: g => me(g) === 'JAP' && exists(g, 'SOV'), run: g => news(g, 'Japanisch-sowjetischer Neutralitätspakt', 'Japan und die Sowjetunion sichern sich gegenseitig Neutralität zu. An der Grenze der Mandschurei herrscht Waffenruhe, solange keine Seite den Pakt bricht.') },
  { id: 'jp_nord', w: 1, on: [1941, 7, 2], cond: g => me(g) === 'JAP' && enemy(g, 'SOV'), run: g => ask(g, 'jp_nord', 'Kaiserliche Konferenz: Nordstoß?',
    'Das Deutsche Reich hat die Sowjetunion angegriffen und drängt Japan zum Eingreifen. Brechen Sie den Neutralitätspakt, können Ihre Verbände aus der Mandschurei nach Sibirien vorstoßen – die sowjetische Fernostarmee greift dann aber auch Sie an. Lehnen Sie ab, bleibt die Grenze ruhig.',
    'Angriff auf die Sowjetunion', 'Den Pakt halten') },
  { id: 'jp_indochina', w: 1, on: [1941, 7, 28], cond: g => me(g) === 'JAP' && neutral(g, 'VIC') && !g.eu!.flags.x_pacific, run: g => ask(g, 'jp_indochina', 'Besetzung Indochinas',
    'Vichy-Frankreich kann Indochina nicht verteidigen. Mit Saigon und Hanoi gewänne Japan das Sprungbrett nach Malaya und Niederländisch-Indien und sperrte China die Zufuhr. Die Vereinigten Staaten drohen für diesen Fall, alle Öl- und Schrottlieferungen einzustellen – dann reichen die Vorräte nur noch für begrenzte Zeit.',
    'Indochina besetzen', 'Verzichten') },
  ...([[1941, 12, 7], [1942, 6, 1]] as [number, number, number][]).map((on, i): Ev => ({ id: `jp_pearl${i || ''}`, w: 1, on, cond: g => me(g) === 'JAP' && !g.eu!.flags.x_pacific && exists(g, 'USA'), run: g => ask(g, `jp_pearl${i || ''}`, i ? 'Südstoß: letzte Gelegenheit' : 'Südstoß: Angriff auf Pearl Harbor',
    'Die Flotte ist bereit: Ein Überfall auf Pearl Harbor soll die amerikanische Schlachtflotte ausschalten (vier Schlachtschiffe), während das Heer nach Malaya, auf die Philippinen und zu den Ölfeldern von Sumatra und Borneo vorstößt. Damit stünde Japan im Krieg mit den Vereinigten Staaten, Großbritannien und den Niederlanden; Siam schließt sich an. '
    + (i ? 'Warten Sie weiter, treten die Vereinigten Staaten Anfang 1943 von sich aus in den Krieg ein – ohne dass ihre Flotte getroffen wird.' : 'Lehnen Sie ab, stellt sich die Frage in einem halben Jahr noch einmal.'),
    'Angriff befehlen', 'Noch abwarten') })),
  { id: 'jp_usa', w: 1, on: [1943, 1, 1], cond: g => me(g) === 'JAP' && !g.eu!.flags.x_pacific && exists(g, 'USA'), run: g => {
    startPacific(g, false);
    news(g, 'Die Vereinigten Staaten erklären den Krieg', 'Washington nimmt die japanische Vorherrschaft in Ostasien nicht länger hin: Die Vereinigten Staaten, Großbritannien und die Niederlande eröffnen den Krieg gegen Japan. Die amerikanische Flotte ist unversehrt. Siam schließt sich Japan an.');
  } },
  { id: 'jp_kamikaze', w: 1, on: [1944, 10, 25], cond: g => me(g) === 'JAP' && !!g.eu!.flags.x_pacific && enemy(g, 'USA'), run: g => ask(g, 'jp_kamikaze', 'Sonderangriffsverbände',
    'Vizeadmiral Ōnishi schlägt vor, Flieger mit ihren Maschinen auf feindliche Schiffe zu stürzen. Vier Jagdstaffeln würden geopfert; dafür verliert die amerikanische Flotte voraussichtlich einen Träger und mehrere Zerstörerflottillen.',
    'Kamikaze-Verbände aufstellen', 'Ablehnen') },
  { id: 'jp_atom', w: 1, on: [1945, 8, 6], cond: g => me(g) === 'JAP' && !!g.eu!.flags.x_pacific && enemy(g, 'USA'), run: g => {
    const e = g.eu!.eco;
    e.fac = Math.max(0, e.fac - 5);
    ask(g, 'jp_atom', 'Atombomben auf Hiroshima und Nagasaki',
      'Zwei amerikanische Atombomben haben Hiroshima und Nagasaki zerstört (−5 IK). Die Alliierten fordern die bedingungslose Kapitulation. Nehmen Sie an, endet der Krieg sofort mit der Niederlage; kämpfen Sie weiter, entscheidet die Lage zum Jahresende 1945.',
      'Kapitulieren', 'Weiterkämpfen');
  } },
  { id: 'jp_sturm', w: 1, on: [1945, 8, 8], cond: g => me(g) === 'JAP' && enemy(g, 'SOV') && !g.eu!.flags.x_nord, run: g => {
    g.eu!.flags.x_nord = g.eu!.day + 1;
    deploy(g, 'SOV', [...Array<string>(14).fill('GI'), 'GA', 'GA', 'GA', 'GA', 'GO', 'GO', 'GO', 'GO'], ownedBy(g, 'SOV').filter(p => g.ctrl[p.id] === 'POL' && inBox(p, [42, 56, 110, 140])).map(p => p.id));
    news(g, 'Die Sowjetunion greift an', 'Die Sowjetunion kündigt den Neutralitätspakt und greift mit frischen Panzerarmeen die Mandschurei an. Die Waffenruhe im Norden ist beendet.');
  } },

  // ---- China ----
  { id: 'ch_berater', w: 1, on: [1936, 4, 1], cond: g => me(g) === 'CHI', run: g => {
    const n = veterans(g, 'CHI', 8, 30);
    news(g, 'Deutsche Militärberater', `Die Beraterschaft unter General von Falkenhausen bildet die Kerntruppen der Nationalarmee nach deutschem Vorbild aus und rüstet sie mit deutschen Waffen: ${n} Divisionen gewinnen deutlich an Kampfwert.`);
  } },
  { id: 'ch_xian', w: 1, on: [1936, 12, 12], cond: g => me(g) === 'CHI', run: g => ask(g, 'ch_xian', 'Zwischenfall von Sian',
    'Marschall Zhang Xueliang hat Tschiang Kai-schek in Sian festgesetzt und verlangt, den Bürgerkrieg zu beenden und gemeinsam mit den Kommunisten gegen Japan zu stehen. Die Einheitsfront bringt zehn Reserve-Divisionen (darunter die 8. Marscharmee) und 300 Mann Ersatz. Ohne sie geht der Feldzug gegen die Kommunisten weiter: Sechs Divisionen gewinnen dabei Erfahrung.',
    'Einheitsfront schließen', 'Erst die innere Einheit') },
  { id: 'ch_war', w: 1, on: [1937, 7, 7], cond: g => me(g) === 'CHI' && neutral(g, 'CHI') && exists(g, 'JAP'), run: g => {
    startEastWar(g);
    const n = g.divs.length;
    deploy(g, 'CHI', [...Array<string>(16).fill('GR'), ...Array<string>(6).fill('GI')], ownedBy(g, 'CHI').filter(p => p.country === 'CHI' && p.supply && !p.adj.some(a => g.ctrl[a] === 'GER')).map(p => p.id));
    for (const d of g.divs.slice(n)) d.xp = XP_NEW;
    g.eu!.eco.men += 500;
    news(g, 'Krieg mit Japan', 'Nach dem Zwischenfall an der Marco-Polo-Brücke greifen japanische Truppen aus der Mandschurei Nordchina an. China ruft zum Widerstand auf: 22 neue, noch unerfahrene Divisionen, 500 Mann Ersatz. Der Krieg läuft in Wochenrunden. Japans Flotte landet Truppen an der Küste, wo diese schwach besetzt ist (höchstens drei Verbände). Sie verlieren, wenn neben Tschungking auch Sian, Tschengtu, Kunming und Lantschou fallen.');
  } },
  { id: 'ch_schanghai', w: 1, on: [1937, 8, 13], cond: g => me(g) === 'CHI' && enemy(g, 'CHI'), run: g => landing(g, 'schanghai', ['GI', 'GI', 'GI', 'GI', 'GO']) },
  { id: 'ch_sov', w: 1, on: [1937, 8, 21], cond: g => me(g) === 'CHI' && enemy(g, 'CHI') && exists(g, 'SOV'), run: g => {
    const e = g.eu!.eco;
    addAir(e.airF, 1, 4);
    addAir(e.airB, 1, 2);
    e.steel += 200;
    e.neu['pzl:1'] = (e.neu['pzl:1'] ?? 0) + 20;
    news(g, 'Sowjetische Waffenhilfe', 'China und die Sowjetunion schließen einen Nichtangriffspakt. Über Sinkiang treffen Jagdflugzeuge und Bomber mit sowjetischen Freiwilligen ein (vier Jagd-, zwei Bomberstaffeln), dazu Panzer T-26 und 200 Stahl.');
  } },
  { id: 'ch_tsingtau', w: 1, on: [1938, 1, 10], cond: g => me(g) === 'CHI' && enemy(g, 'CHI'), run: g => landing(g, 'tsingtau', ['GI', 'GI']) },
  { id: 'ch_flut', w: 1, on: [1938, 6, 9], cond: g => me(g) === 'CHI' && g.divs.some(d => d.nation === 'JAP' && inBox(PROV[d.prov], [32, 36, 112, 118.5])), run: g => ask(g, 'ch_flut', 'Die Deiche des Gelben Flusses',
    'Japanische Verbände stoßen durch die Ebene auf Tschengtschou und Hankau vor. Der Stab schlägt vor, bei Huayuankou die Deiche zu sprengen: Die Flut träfe die Japaner zwischen Gelbem Fluss und Jangtse schwer und nähme ihnen die Bewegung. Sie verwüstet aber auch das eigene Land – es kostet 200 Mann Ersatz und 1 IK.',
    'Deiche sprengen', 'Das Land schonen') },
  { id: 'ch_kanton', w: 1, on: [1938, 10, 12], cond: g => me(g) === 'CHI' && enemy(g, 'CHI'), run: g => landing(g, 'kanton', ['GI', 'GI', 'GI']) },
  { id: 'ch_umzug', w: 1, on: [1938, 10, 25], cond: g => me(g) === 'CHI' && enemy(g, 'CHI'), run: g => {
    g.eu!.eco.fac += 3;
    news(g, 'Die Industrie zieht nach Westen', 'Arsenale, Werkstätten und Hochschulen sind den Jangtse hinauf nach Szetschuan verlegt worden. In Tschungking und Tschengtu laufen die Werke wieder an: +3 IK, außerhalb der Reichweite der japanischen Armee.');
  } },
  { id: 'ch_burma', w: 1, on: [1938, 12, 2], cond: g => me(g) === 'CHI' && enemy(g, 'CHI'), run: g => {
    g.eu!.flags.x_burma = 1;
    news(g, 'Die Burmastraße ist offen', 'Zweihunderttausend Arbeiter haben die Straße von Kunming nach Lashio fertiggestellt. Über Rangun kommen nun doppelt so viel Stahl und Treibstoff ins Land – solange Rangun nicht in japanische Hand fällt.');
  } },
  { id: 'ch_hainan', w: 1, on: [1939, 2, 10], cond: g => me(g) === 'CHI' && enemy(g, 'CHI'), run: g => landing(g, 'haikou', ['GI']) },
  { id: 'ch_tiger', w: 1, on: [1941, 12, 20], cond: g => me(g) === 'CHI' && enemy(g, 'CHI') && enemy(g, 'USA'), run: g => {
    addAir(g.eu!.eco.airF, 3, 3);
    news(g, 'Die „Flying Tigers“', 'Die amerikanische Freiwilligengruppe unter Claire Chennault fliegt von Kunming aus ihre ersten Einsätze: drei Jagdstaffeln Curtiss P-40.');
  } },
  ...[1942, 1943, 1944].map((y, i): Ev => ({ id: `ch_ll${i + 1}`, w: 1, on: [y, 3, 1], cond: g => me(g) === 'CHI' && enemy(g, 'CHI') && enemy(g, 'USA'), run: g => {
    const e = g.eu!.eco, k = `inf:${Math.max(0, e.lines.inf.lvl)}`, n = 100 + 60 * i;
    e.neu[k] = (e.neu[k] ?? 0) + n;
    e.steel += 250 + 100 * i;
    e.oil += 150 + 100 * i;
    e.sup += 250 + 100 * i;
    news(g, 'Leih- und Pachtlieferungen', `Über die Burmastraße und die Luftbrücke über den Himalaja treffen amerikanische Lieferungen ein: Infanteriewaffen (${n} Stärkepunkte), Stahl, Treibstoff und Versorgungsgüter.`);
  } })),
  { id: 'ch_xforce', w: 1, on: [1943, 10, 1], cond: g => me(g) === 'CHI' && enemy(g, 'CHI') && enemy(g, 'USA'), run: g => {
    const n = veterans(g, 'CHI', 6, 30);
    news(g, 'Amerikanische Ausbildung', `General Stilwell hat in Ramgarh und Kunming chinesische Divisionen nach amerikanischem Muster ausgebildet und ausgerüstet: ${n} Verbände kehren als Kerntruppe zurück.`);
  } },
  { id: 'ch_ichigo', w: 1, on: [1944, 4, 17], cond: g => me(g) === 'CHI' && enemy(g, 'CHI') && japanAtWar(g), run: g => {
    const at = PLIST.filter(p => p.country === 'CHI' && g.ctrl[p.id] === 'GER' && p.adj.some(a => g.ctrl[a] === 'POL')).map(p => p.id);
    if (!at.length) return;
    deploy(g, 'JAP', [...Array<string>(10).fill('GI'), 'GA', 'GO'], at);
    news(g, 'Operation Ichi-gō', 'Japan wirft eine halbe Million Mann in seine größte Offensive in China: Sie soll die Landverbindung nach Indochina öffnen und die amerikanischen Flugplätze ausschalten. Zwölf frische Verbände verstärken die Front.');
  } },

  // ---- Sowjetunion ----
  { id: 'su_spanien', on: [1936, 10, 15], cond: g => me(g) === 'SOV' && civil(g), run: g => ask(g, 'su_spanien', 'Hilfe für die Spanische Republik',
    'Die Republik bittet um Waffen und Berater. Sollen Heeresverbände nach Spanien gehen? Vier Infanterie-Verbände und ein Panzerverband – die jeweils stärksten des stehenden Heeres – werden nach Ostspanien verschifft und dort von Ihnen selbst geführt, neben den Truppen der Republik. Sie fehlen so lange in der Heimat und kehren nach dem Krieg mit Kampferfahrung zurück.',
    'Truppen entsenden', 'Nur Berater und Waffen') },
  { id: 'su_purge', on: [1937, 6, 11], cond: g => me(g) === 'SOV', run: g => {
    for (const d of g.divs) if (d.nation === 'SOV') d.xp = Math.min(d.xp ?? 30, 18);
    news(g, 'Die Große Säuberung', 'Marschall Tuchatschewski und weitere hohe Offiziere werden verurteilt und erschossen; in den folgenden Monaten verliert die Rote Armee den größten Teil ihrer erfahrenen Kommandeure. Alle Verbände fallen auf den Stand „unerfahren“ zurück und müssen neu ausgebildet werden.');
  } },
  { id: 'su_chalchin', on: [1939, 8, 31], cond: g => me(g) === 'SOV', run: g => {
    const best = g.divs.filter(d => d.nation === 'SOV' && tp(d).mp >= 2).slice(0, 6);
    for (const d of best) gainXp(d, 35);
    news(g, 'Sieg am Chalchin Gol', `Schukows Panzer- und motorisierte Verbände schlagen die japanische 6. Armee an der mongolischen Grenze. ${best.length} schnelle Verbände kehren kampferfahren zurück.`);
  } },
  { id: 'su_mob', cond: g => me(g) === 'SOV' && relOf(g, 'SOV') === 'E', run: g => {
    const n = g.divs.length, home = ownedBy(g, 'SOV').filter(p => p.country === 'SOV' && p.supply && !p.adj.some(a => g.ctrl[a] === 'GER')).map(p => p.id);
    deploy(g, 'SOV', Array<string>(24).fill('GI'), home);
    for (const d of g.divs.slice(n)) d.xp = XP_NEW;
    g.eu!.eco.men += 500;
    news(g, 'Mobilmachung', `Die Rote Armee ruft ihre Reserven ein: ${g.divs.length - n} neue, noch unerfahrene Schützendivisionen werden im Hinterland aufgestellt, 500 Mann Ersatz stehen bereit.`);
  } },
  { id: 'su_ural', on: [1941, 7, 15], cond: g => me(g) === 'SOV' && relOf(g, 'SOV') === 'E', run: g => ask(g, 'su_ural', 'Evakuierung der Industrie',
    'Der Evakuierungsrat schlägt vor, die Rüstungswerke aus dem Westen hinter den Ural zu verlegen. Der Abbau kostet 400 Stahl, bringt aber 10 IK an Werken in Sicherheit, die keine Front mehr erreicht, und danach 5 % mehr Industrieleistung.',
    'Werke verlegen', 'Die Werke bleiben') },
  { id: 'su_garde', on: [1941, 9, 18], cond: g => me(g) === 'SOV' && relOf(g, 'SOV') === 'E', run: g => {
    const best = g.divs.filter(d => d.nation === 'SOV').sort((a, b) => (b.xp ?? 30) - (a.xp ?? 30)).slice(0, 8);
    for (const d of best) gainXp(d, 30);
    news(g, 'Die ersten Gardedivisionen', `Für ihre Standhaftigkeit erhalten ${best.length} Verbände den Ehrentitel „Garde“ – bessere Ausstattung, besserer Ersatz, höhere Kampfkraft.`);
  } },
  { id: 'su_227', on: [1942, 7, 28], cond: g => me(g) === 'SOV' && relOf(g, 'SOV') === 'E', run: g => ask(g, 'su_227', 'Befehl Nr. 227',
    '„Keinen Schritt zurück!“ Der Befehl verbietet jeden Rückzug ohne Weisung. Alle Verbände graben sich sofort voll ein und gewinnen an Härte; die Sperrabteilungen und Strafeinheiten kosten 150 Mann Ersatz.',
    'Befehl erlassen', 'Bewegliche Verteidigung') },
  ...[1941, 1942, 1943].map((y, i): Ev => ({ id: `su_ll${i + 1}`, on: [y, 11, 1], cond: g => me(g) === 'SOV' && relOf(g, 'SOV') === 'E' && exists(g, 'ENG'), run: g => {
    const e = g.eu!.eco, k = `kfz:${Math.max(0, e.lines.kfz.lvl)}`, n = 150 + 150 * i;
    e.neu[k] = (e.neu[k] ?? 0) + n;
    e.oil += 300 + 200 * i;
    e.sup += 300 + 200 * i;
    news(g, 'Leih- und Pachtlieferungen', `Über Murmansk, Persien und Wladiwostok treffen westliche Lieferungen ein: Lastwagen und Fahrzeuge (${n} Stärkepunkte), Treibstoff und Verpflegung.`);
  } })),
];

// ---- Hilfen für die Ereignisse in Ostasien ---------------------------------

type Box = [number, number, number, number]; // Breite von–bis, Länge von–bis
const inBox = (p: { ll?: [number, number] }, [la0, la1, lo0, lo1]: Box) => p.ll![0] >= la0 && p.ll![0] <= la1 && p.ll![1] >= lo0 && p.ll![1] <= lo1;
const chinese = (g: GameState, boxes: Box[]) => PLIST.filter(p => g.eu!.owner[p.id] === 'CHI' && boxes.some(b => inBox(p, b))).map(p => p.id);
/** Vom Gegner gehaltene Provinzen eines Staates in einem Gebiet. */
const held = (g: GameState, country: string, box: Box) => PLIST.filter(p => p.country === country && g.ctrl[p.id] === 'POL' && inBox(p, box)).map(p => p.id);
function japanAtWar(g: GameState) {
  return relOf(g, 'JAP') === 'A' && exists(g, 'JAP') && !!g.eu!.rel.JAP;
}
/** Führt der Spieler Japan oder China, wird der Krieg in Ostasien von 1937 an auf der Karte ausgefochten. */
const eastPlayer = (g: GameState) => me(g) === 'JAP' || me(g) === 'CHI';
/** Japans Eroberungen im Pazifik nach Fahrplan – nur, wenn die KI Japan führt und der Pazifikkrieg begonnen hat. */
function pacificAI(g: GameState) {
  return japanAtWar(g) && me(g) !== 'JAP' && (!g.eu!.flags.x_east || !!g.eu!.flags.x_pacific);
}
const RED = ['SOV', 'MON'];
/**
 * Waffenruhen in Ostasien, solange der Spieler Japan oder China führt: Bis zum Pazifikkrieg kämpfen dort nur Japan
 * und China gegeneinander, und zwischen Japan und der Sowjetunion gilt der Neutralitätspakt, bis einer ihn bricht.
 */
function quiet(g: GameState, nation: string, side: Side, prov: string) {
  const eu = g.eu!;
  if (!eu.flags.x_east || g.ctrl[prov] !== other(side)) return false;
  const o = eu.owner[prov], east = EAST_AXIS.includes(nation), red = RED.includes(nation), north = !!eu.flags.x_nord;
  if (!north && ((east && RED.includes(o)) || (red && EAST_AXIS.includes(o)))) return true;
  if (eu.flags.x_pacific) return false;
  if (side === 'GER') return east ? !(o === 'CHI' || (north && RED.includes(o))) : o === 'CHI';
  if (red) return false;
  return nation === 'CHI' ? !EAST_AXIS.includes(o) : EAST_AXIS.includes(o);
}
const barred = (g: GameState, d: Division, prov: string) => quiet(g, d.nation, d.side, prov);
/** Juli 1937: Japan und Mandschukuo gegen China. */
function startEastWar(g: GameState) {
  g.eu!.flags.x_east = g.eu!.day + 1;
  join(g, 'JAP', 'A');
  join(g, 'MAN', 'A');
  join(g, 'CHI', 'E');
}
/** Japan eröffnet den Krieg gegen die Seemächte; ein Überfall trifft die amerikanische Schlachtflotte im Hafen. */
function startPacific(g: GameState, surprise: boolean) {
  const eu = g.eu!;
  eu.flags.x_pacific = eu.day + 1;
  eu.flags.usa ??= eu.day + 1;
  for (const c of ['ENG', 'USA', 'NLD']) if (neutral(g, c)) join(g, c, 'E');
  if (neutral(g, 'SIA')) join(g, 'SIA', 'A');
  const us = ensureNavy(g).other.USA;
  if (surprise && us) us.bb = Math.max(0, us.bb - 4);
}
/** Japanische Landung an der chinesischen Küste (die KI landet nicht von sich aus): Eine starke Besatzung schlägt sie ab. */
function landing(g: GameState, id: string, kinds: string[]) {
  if (!PROV[id] || g.ctrl[id] !== 'POL' || g.eu!.owner[id] !== 'CHI' || !japanAtWar(g)) return;
  const def = divsIn(g, id, 'POL').length, name = PROV[id].name;
  if (def > 3) return news(g, `Landung bei ${name} abgewehrt`, `Japanische Truppen versuchen, bei ${name} zu landen. ${def} chinesische Verbände werfen sie ins Meer zurück.`);
  transfer(g, [id], 'JAP');
  deploy(g, 'JAP', kinds, [id]);
  news(g, `Japanische Landung bei ${name}`, `Unter dem Schutz der Flotte gehen japanische Truppen bei ${name} an Land. Die schwache Besatzung weicht ins Hinterland aus.`);
}
const addAir = (arr: number[], lvl: number, n: number) => {
  while (arr.length <= lvl) arr.push(0);
  arr[lvl] += n;
};
/** Die besten Verbände eines Staates gewinnen Erfahrung. */
function veterans(g: GameState, c: string, n: number, xp: number) {
  const best = g.divs.filter(d => d.nation === c && tp(d).mp > 0).sort((a, b) => (b.xp ?? 30) - (a.xp ?? 30) || strength(b) - strength(a)).slice(0, n);
  for (const d of best) gainXp(d, xp);
  return best.length;
}
/** Städte der „Großostasiatischen Wohlstandssphäre“: an ihnen misst sich Japans Erfolg. */
const SPHERE = ['tokio', 'keijo', 'hsinking', 'peking', 'schanghai', 'nanking', 'hankau', 'kanton', 'hongkong', 'manila', 'singapur', 'batavia', 'rangun', 'saigon'];
/** Berlin ist gefallen, der Spieler kämpft in Ostasien weiter: Die Achse in Europa streckt die Waffen. */
function europeEnds(g: GameState) {
  const eu = g.eu!, victor = eu.owner.berlin;
  const axis = Object.keys(eu.rel).filter(c => eu.rel[c] === 'A' && !EAST_AXIS.includes(c) && exists(g, c));
  for (const c of axis) for (const p of ownedBy(g, c)) eu.owner[p.id] = p.country !== c && enemy(g, p.country) ? p.country : victor;
  for (const c of axis) absorb(g, c, null);
  eu.flags.x_veday = eu.day + 1;
  news(g, 'Das Deutsche Reich kapituliert', 'Berlin ist gefallen, der Krieg in Europa ist zu Ende. Die besetzten Länder sind befreit, Deutschland und seine Verbündeten werden besetzt. In Ostasien und im Pazifik geht der Krieg weiter – nun mit der ganzen Macht der Alliierten.');
}
/** Japanische Eroberung ohne Feldzug auf der Karte: die Verteidiger gehen verloren, Besatzungen rücken ein. */
function seize(g: GameState, list: string[], garrison: string[]) {
  const ids = list.filter(id => PROV[id] && g.ctrl[id] === 'POL');
  if (!ids.length) return;
  g.divs = g.divs.filter(d => !(d.side === 'POL' && ids.includes(d.prov)));
  transfer(g, ids, 'JAP');
  deploy(g, 'JAP', garrison, ids);
}

/** Die Beute aus den tschechischen Zeughäusern und den Škoda-Werken – erst sie bringt dem Reich den Panzer 38(t). */
function czechLoot(g: GameState): string {
  const e = g.eu!.eco;
  if (me(g) !== 'GER' || e.done.includes('pzl2')) return '';
  e.done.push('pzl2');
  e.slots = e.slots.map(s => (s === 'pzl2' ? null : s));
  // Ausrüstung für rund dreißig Divisionen: Panzer 35(t) und 38(t), Škoda-Geschütze, Gewehre und MG; dazu Avia-Jäger und das Gold der Nationalbank
  return booty(g, { 'pzl:2': 30, 'pzl:1': 35, 'inf:0': 200, 'art:0': 80, 'pak:0': 35, 'kfz:0': 30 }, { steel: 600, oil: 100, sup: 300 }, 3, 1);
}
const GEAR_NAME: Record<string, string> = { inf: 'Infanteriewaffen', art: 'Artillerie', pak: 'Panzerabwehr', kfz: 'Fahrzeuge', pzl: 'leichte Panzer' };
/** Übernommenes Gerät, Vorräte und Flugzeuge ins Lager des Reichs; liefert den Text für die Meldung. */
function booty(g: GameState, gear: Record<string, number>, res: { steel: number; oil: number; sup: number }, jg: number, bo: number): string {
  if (me(g) !== 'GER') return '';
  const e = g.eu!.eco, sum: Record<string, number> = {};
  for (const [k, n] of Object.entries(gear)) (e.neu[k] = (e.neu[k] ?? 0) + n), (sum[k.split(':')[0]] = (sum[k.split(':')[0]] ?? 0) + n);
  e.steel += res.steel;
  e.oil += res.oil;
  e.sup += res.sup;
  e.airF[0] = (e.airF[0] ?? 0) + jg;
  e.airB[0] = (e.airB[0] ?? 0) + bo;
  syncAir(g);
  const air = [jg ? `${jg} Jagdstaffel${jg > 1 ? 'n' : ''}` : '', bo ? `${bo} Bomberstaffel${bo > 1 ? 'n' : ''}` : ''].filter(Boolean).join(', ');
  return ` Übernommen (Lager „Neuaufstellung“, in Stärkepunkten): ${Object.entries(sum).map(([c, n]) => `${GEAR_NAME[c] ?? c} ${n}`).join(', ')}${gear['pzl:2'] ? ` – davon ${gear['pzl:2']} Panzer 38(t)` : ''}. Vorräte: ${res.steel} Stahl, ${res.oil} Öl, ${res.sup} Nachschub.${air ? ` Luftwaffe: ${air}.` : ''}`;
}

// ---- Spanischer Bürgerkrieg -------------------------------------------------

const LEGION = 'Legion Condor';
const REPUBLIC = ['madrid', 'barcelona', 'valencia', 'bilbao', 'gijon', 'malaga', 'murcia', 'almeria', 'badajoz', 'linares'];
/** Läuft der Bürgerkrieg gerade auf der Karte? */
function civil(g: GameState) {
  return (g.eu!.flags.civil ?? 0) > 0;
}
const inSpain = (d: Division) => PROV[d.prov].country === 'SPA';

/** Juli 1936: Spanien zerfällt in das Gebiet der Aufständischen (Verbündete, KI) und das der Republik (Gegner). */
function startCivilWar(g: GameState) {
  const eu = g.eu!;
  eu.flags.civil = eu.day + 1;
  eu.gone = eu.gone.filter(c => c !== 'REP');
  eu.rel.SPA = 'A';
  eu.rel.REP = 'E';
  for (const id of REPUBLIC) if (eu.owner[id] === 'SPA') eu.owner[id] = 'REP';
  syncCtrl(g);
  eu.flags.army_SPA = eu.flags.army_REP = eu.day + 1;
  // Aufständische: Kolonialarmee und ein Teil des Heeres; Republik: Milizen, wenige reguläre Verbände, sowjetische Panzer
  deploy(g, 'SPA', ['GI', 'GI', 'GI', 'GI', 'GI', 'GI', 'GR', 'GR', 'GR', 'GR', 'GC', 'GM'], ownedBy(g, 'SPA').filter(p => !flagged(p, 'k') || p.id === 'tetuan').map(p => p.id));
  deploy(g, 'REP', ['GI', 'GI', 'GI', 'GR', 'GR', 'GR', 'GR', 'GR', 'GR', 'GR', 'GR', 'GR', 'GR', 'GO'], ownedBy(g, 'REP').map(p => p.id));
  eu.airN.REP = { f: 2, b: 1 };
  syncAir(g);
}

/** Name des Expeditionskorps in Spanien je Staat. */
const CORPS: Record<string, string> = { GER: LEGION, ITA: 'Corpo Truppe Volontarie', SOV: 'Sowjetische Freiwillige' };
/**
 * Heerestruppen für Spanien: vier Infanterie-Verbände und ein Panzerverband aus dem stehenden Heer des Spielers.
 * Das Reich und Italien landen bei Franco, die Sowjetunion bei der Republik.
 */
function sendLegion(g: GameState) {
  const eu = g.eu!, power = (d: Division) => d.units.reduce((a, u) => a + u.s, 0), n = me(g), side = g.player;
  const mine = g.divs.filter(d => d.nation === n).sort((a, b) => power(b) - power(a));
  const pick = [...mine.filter(d => TEMPLATES[d.kind].units.some(u => TYPES[u.split(':')[0]].cat?.startsWith('pz'))).slice(0, 1)];
  pick.push(...mine.filter(d => !pick.includes(d) && tp(d).mp === 1).slice(0, 4));
  const ports = (side === 'GER' ? ['cadiz', 'sevilla', 'vigo'] : ['valencia', 'barcelona', 'murcia', 'almeria', 'malaga', 'bilbao', 'gijon']).filter(id => PROV[id]?.port && g.ctrl[id] === side);
  if (!ports.length || !pick.length) return news(g, 'Kein Hafen frei', `${side === 'GER' ? 'Francos Truppen halten' : 'Die Republik hält'} keinen Hafen mehr, in dem Ihre Verbände landen könnten.`);
  pick.forEach((d, i) => {
    d.prov = ports.find(id => divsIn(g, id).length < STACK) ?? ports[i % ports.length];
    d.army = CORPS[n] ?? LEGION;
    d.dug = 0;
    d.order = null;
  });
  eu.flags.legion = eu.day + 1;
  news(g, n === 'GER' ? 'Deutsche Truppen in Spanien' : 'Ihre Truppen in Spanien', `${pick.map(d => d.name).join(', ')} sind in ${PROV[pick[0].prov].name} gelandet und unterstehen Ihrem Befehl. ${side === 'GER' ? 'Francos Verbände' : 'Die Verbände der Republik'} führt die KI. Der Krieg läuft in Monatsrunden; Ersatz kommt über See.${n === 'GER' ? ' Andere deutsche Verbände können nicht nach Spanien übersetzen.' : ''} Nach dem Bürgerkrieg kehren die Verbände mit Kampferfahrung heim.`);
}

/** Entscheidet den Bürgerkrieg, sobald eine Seite die Schlüsselstädte hält, spätestens im April 1939. */
function civilWar(g: GameState) {
  const eu = g.eu!;
  if (!civil(g)) return;
  const nat = (id: string) => g.ctrl[id] === 'GER';
  const count = (c: string) => ownedBy(g, c).filter(p => !flagged(p, 'k')).length;
  let franco: boolean | null = null;
  if (['madrid', 'barcelona', 'valencia'].every(nat) || !count('REP')) franco = true;
  else if ((!['valladolid', 'sevilla', 'saragossa'].some(nat) && count('SPA') < 3) || !count('SPA')) franco = false;
  else if (eu.day >= dayOf(1939, 4, 1)) franco = count('SPA') + (nat('madrid') ? 3 : 0) >= count('REP');
  if (franco === null) return;
  const win = franco ? 'SPA' : 'REP', lose = franco ? 'REP' : 'SPA';
  eu.flags.civil = -1;
  eu.flags.spainend = eu.day + 1;
  // Fremde Truppen ziehen ab; die deutschen kehren mit Kampferfahrung in die Heimat zurück
  const mine = me(g), cap = COUNTRIES[mine].cap;
  const back = g.divs.filter(d => d.nation === mine && inSpain(d));
  g.divs = g.divs.filter(d => !(inSpain(d) && d.nation !== mine) && d.nation !== lose && d.nation !== win);
  const home = mine === 'GER' ? PLIST.filter(p => eu.core[p.id] && eu.owner[p.id] === 'GER').sort((a, b) => km(a.id, 'muenchen') - km(b.id, 'muenchen'))
    : PLIST.filter(p => eu.owner[p.id] === mine && p.country === mine).sort((a, b) => km(a.id, cap) - km(b.id, cap));
  for (const d of back) {
    d.prov = home.find(p => divsIn(g, p.id).length < STACK - 1)?.id ?? cap;
    d.army = mine === 'GER' ? 'Heer' : COUNTRIES[mine].name;
    gainXp(d, 40);
    d.order = null;
  }
  for (const p of ownedBy(g, lose)) eu.owner[p.id] = win;
  eu.gone.push(lose);
  delete eu.airN.REP;
  eu.rel.SPA = eu.rel.REP = 'N';
  delete eu.flags.army_SPA;
  delete eu.flags.army_REP;
  for (const s of Object.keys(g.airAssign.GER)) if (PROV[s].country === 'SPA') delete g.airAssign.GER[s];
  syncCtrl(g);
  const vets = back.length ? ` ${mine === 'GER' ? 'Die deutschen' : 'Ihre'} Verbände kehren mit zusätzlicher Kampferfahrung zurück (${back.map(d => d.name).join(', ')}).` : '';
  news(g, 'Ende des Spanischen Bürgerkriegs', (franco
    ? 'Franco hat gesiegt. Spanien bleibt unter seiner Führung neutral.'
    : 'Die Republik hat sich behauptet, der Aufstand ist niedergeschlagen. Spanien bleibt neutral.') + vets + (eu.flags.condor ? ' Die Erfahrungen der Legion Condor fließen in Ausbildung und Flugzeugbau ein.' : ''));
}

function nextGerName(g: GameState, kind: string) {
  const e = g.eu!.eco, stem = kind === 'GEBD' ? 'Gebirgs-Division' : kind === 'LEI' ? 'leichte Division' : 'Infanterie-Division';
  e.num[stem] = (e.num[stem] ?? 0) + 1;
  return `${e.num[stem]}. ${stem}`;
}

function runEvents(g: GameState) {
  const eu = g.eu!;
  for (const ev of EVENTS) {
    if (ev.w !== undefined && !!ev.w !== isWorld(g)) continue;
    if (eu.flags[ev.id] || (ev.on && eu.day < dayOf(...ev.on)) || (ev.cond && !ev.cond(g))) continue;
    // verpasste Stichtage (Bedingung erst viel später erfüllt) verfallen nach einem Vierteljahr
    if (ev.on && eu.day > dayOf(...ev.on) + 92) { eu.flags[ev.id] = -1; continue; }
    eu.flags[ev.id] = eu.day + 1;
    ev.run(g);
  }
}

/** Antwort des Spielers auf eine Entscheidung. */
export function resolveChoice(g: GameState, id: string, yes: boolean) {
  const eu = g.eu!;
  if (id === 'condor') {
    if (yes) (eu.flags.condor = eu.day + 1), syncAir(g);
    if (me(g) !== 'GER') return;
    if (civil(g)) ask(g, 'legion', 'Heerestruppen nach Spanien?',
      'Sollen zusätzlich Heeresverbände nach Spanien gehen? Vier Infanterie-Verbände und ein Panzerverband – die jeweils stärksten des stehenden Heeres – werden nach Südspanien verschifft und dort von Ihnen selbst geführt, neben Francos Truppen. Sie fehlen so lange in der Heimat und kehren nach dem Krieg mit Kampferfahrung zurück.',
      'Truppen entsenden', 'Keine Truppen');
  }
  if (id === 'ch_xian' && !yes) veterans(g, 'CHI', 6, 20);
  if (id === 'jp_atom' && yes) g.over = { winner: 'POL', text: `Japan hat am ${fmtDate(eu.day)} kapituliert. Der Krieg ist verloren.` };
  if (!yes) return;
  if (id === 'legion' || id === 'it_ctv' || id === 'su_spanien') sendLegion(g);
  if (id.startsWith('jp_china')) {
    startEastWar(g);
    news(g, 'Krieg mit China', 'Japan und Mandschukuo stehen im Krieg mit China. Die Truppen Mandschukuos unterstehen Ihrem Befehl; Ihre Verbände erreichen das Festland per Bahn durch Mandschukuo oder über See. China gibt erst auf, wenn neben Tschungking auch Sian, Tschengtu, Kunming und Lantschou gefallen sind.');
  }
  if (id === 'jp_mob') (eu.eco.fac += 4), (eu.eco.men += 300), (eu.eco.steel = Math.max(0, eu.eco.steel - 200));
  if (id === 'jp_nord') eu.flags.x_nord = eu.day + 1;
  if (id === 'jp_indochina') {
    transfer(g, PLIST.filter(p => eu.owner[p.id] === 'VIC' && inBox(p, [8, 24, 100, 110])).map(p => p.id), 'JAP');
    eu.flags.x_embargo = eu.day + 1;
    news(g, 'Indochina besetzt – Ölembargo', 'Japanische Truppen rücken in Saigon und Hanoi ein. Die Vereinigten Staaten, Großbritannien und die Niederlande frieren die japanischen Guthaben ein und sperren alle Öl- und Schrottlieferungen. Von nun an zehrt Japan von seinen Vorräten.');
  }
  if (id.startsWith('jp_pearl')) {
    startPacific(g, true);
    news(g, 'Pearl Harbor', 'Trägerflugzeuge greifen die amerikanische Pazifikflotte in Pearl Harbor an: Vier Schlachtschiffe sinken, die Träger waren nicht im Hafen. Japan steht im Krieg mit den Vereinigten Staaten, Großbritannien und den Niederlanden; Siam schließt sich an, seine Truppen unterstehen Ihnen. Die Waffenruhe mit den Westmächten ist beendet – der Weg nach Hongkong, Malaya, auf die Philippinen und zu den Ölfeldern ist frei.');
  }
  if (id === 'jp_kamikaze') {
    let n = 4;
    for (let i = eu.eco.airF.length - 1; i >= 0 && n > 0; i--) while (eu.eco.airF[i] > 0 && n > 0) (eu.eco.airF[i]--, n--);
    const us = ensureNavy(g).other.USA;
    if (us) (us.cv = Math.max(0, us.cv - 1)), (us.dd = Math.max(0, us.dd - 4));
    syncAir(g);
  }
  if (id === 'ch_xian') {
    eu.eco.men += 300;
    const n = g.divs.length, north = ownedBy(g, 'CHI').filter(p => p.country === 'CHI').sort((a, b) => km(a.id, 'sian') - km(b.id, 'sian')).slice(0, 8).map(p => p.id);
    deploy(g, 'CHI', Array<string>(10).fill('GR'), north);
    for (const d of g.divs.slice(n)) d.xp = XP_NEW;
  }
  if (id === 'ch_flut') {
    eu.eco.men = Math.max(0, eu.eco.men - 200);
    eu.eco.fac = Math.max(0, eu.eco.fac - 1);
    for (const d of g.divs) {
      if (d.side !== 'GER' || !inBox(PROV[d.prov], [32, 36, 112, 118.5])) continue;
      for (const u of d.units) u.s = Math.max(1, Math.round(u.s * 0.65));
      d.dug = 0;
      d.mp = 0;
    }
  }
  if (id === 'weiss') declareWar(g, 'POL');
  if (id === 'weser') (declareWar(g, 'DNK'), declareWar(g, 'NOR'));
  if (id === 'gelb') for (const c of ['NLD', 'BEL', 'LUX']) declareWar(g, c);
  if (id === 'marita') declareWar(g, 'YUG');
  if (id === 'barbarossa') declareWar(g, 'SOV');
  const e = eu.eco;
  if (id === 'us_cashcarry') (e.fac += 4), (eu.pts.ENG = (eu.pts.ENG ?? 0) + 300);
  if (id === 'us_draft') {
    e.men += 500;
    const n = g.divs.length;
    deploy(g, 'USA', Array<string>(6).fill('GI'), ownedBy(g, 'USA').filter(p => p.country === 'USA').map(p => p.id));
    for (const d of g.divs.slice(n)) d.xp = XP_NEW;
  }
  if (id === 'us_lendlease') eu.flags.x_lendlease = 1;
  const raise = (c: string, kinds: string[], at: string[]) => {
    const n = g.divs.length;
    deploy(g, c, kinds, at);
    for (const d of g.divs.slice(n)) d.xp = XP_NEW;
  };
  const homeOf = (c: string) => ownedBy(g, c).filter(p => p.country === c && !flagged(p, 'k')).map(p => p.id);
  if (id === 'en_shadow') (e.fac += 4), (e.steel = Math.max(0, e.steel - 300));
  if (id === 'en_draft') (e.men += 400), raise('ENG', Array<string>(5).fill('GI'), homeOf('ENG'));
  if (id === 'en_homeguard') (e.men = Math.max(0, e.men - 150)), raise('ENG', Array<string>(6).fill('GR'), homeOf('ENG'));
  if (id === 'fr_maginot') {
    e.steel = Math.max(0, e.steel - 400);
    const north = homeOf('FRA').filter(p => PROV[p].adj.some(a => PROV[a].country === 'BEL' || PROV[a].country === 'LUX'));
    raise('FRA', Array<string>(4).fill('GF'), north.length ? north : homeOf('FRA'));
  }
  if (id === 'fr_dcr') (e.steel = Math.max(0, e.steel - 300)), raise('FRA', ['GA', 'GA'], homeOf('FRA'));
  if (id === 'it_autarkie') (e.fac += 3), (e.steel = Math.max(0, e.steel - 250));
  if (id === 'it_dak') {
    e.oil += 300;
    const libya = PLIST.filter(p => g.ctrl[p.id] === 'GER' && p.port && eu.owner[p.id] === 'ITA' && p.country !== 'ITA' && p.ll![0] < 36 && p.ll![1] > 8 && p.ll![1] < 26).map(p => p.id);
    if (libya.length) deploy(g, 'GER', ['GA', 'GO'], libya);
  }
  if (id === 'su_ural') (eu.flags.x_ural = 1), (e.fac += 10), (e.steel = Math.max(0, e.steel - 400));
  if (id === 'su_227') {
    e.men = Math.max(0, e.men - 150);
    for (const d of g.divs) if (d.nation === 'SOV') (d.dug = 3), gainXp(d, 5);
  }
  euSupply(g);
  resetMoves(g);
}

// ---- Kapitulationen -------------------------------------------------------

/** Ein Gegner der Achse streckt die Waffen: Kolonien gehen an die Seemächte, das Land an den Sieger, die Beute an das Reich. */
function surrender(g: GameState, c: string) {
  const eu = g.eu!, co = COUNTRIES[c];
  if (c === 'FRA') return vichy(g);
  if (c === 'POL') eastPoland(g);
  // Welt: Kolonien führen den Krieg unter britischer Obhut weiter; was Japan niederwirft, fällt an Japan
  const heir = enemy(g, 'ENG') && c !== 'ENG' ? 'ENG' : enemy(g, 'USA') ? 'USA' : null;
  if (isWorld(g) && heir) for (const p of ownedBy(g, c)) if (flagged(p, 'k')) eu.owner[p.id] = heir;
  // führt der Spieler eine Achsenmacht und nimmt die Hauptstadt selbst, fällt das Land an ihn
  const to = isWorld(g) && EAST_AXIS.includes(eu.owner[co.cap]) ? 'JAP' : g.player === 'GER' && eu.owner[co.cap] === me(g) ? me(g) : 'GER';
  // Vichys Schiffe versenken sich selbst, alles andere fällt dem Reich zu
  const sunk = c === 'VIC' ? scuttleToulon(g) : '';
  const got = to === 'GER' && me(g) === 'GER' ? loot(g, c, c !== 'VIC') + sunk : '';
  // was der Besiegte einem noch kämpfenden Achsenstaat abgenommen hatte, fällt an diesen zurück
  for (const p of ownedBy(g, c)) if (p.country !== c && relOf(g, p.country) === 'A' && exists(g, p.country)) eu.owner[p.id] = p.country;
  absorb(g, c, to);
  news(g, `${co.name} kapituliert`, `Mit dem Verlust von ${PROV[co.cap].name} bricht der Widerstand zusammen. Das restliche Staatsgebiet wird besetzt.${got}`);
}

function checkCapitulations(g: GameState) {
  const eu = g.eu!, axis = (id: string) => g.ctrl[id] === 'GER';
  for (const c of Object.keys(COUNTRIES)) {
    const co = COUNTRIES[c];
    if (!exists(g, c) || !co.cap || c === 'GER' || !PROV[co.cap]) continue;
    if (civil(g) && (c === 'SPA' || c === 'REP')) continue; // entscheidet civilWar()
    if (c === 'CSR' && eu.rel[c] === 'E' && axis(co.cap)) czechLoot(g);
    if (eu.rel[c] === 'E' && axis(co.cap)) {
      if (c === 'SOV' && !['moskau', 'leningrad', 'stalingrad', 'gorki'].every(axis)) continue;
      if (c === 'ENG' && !['london', 'birmingham', 'manchester', 'glasgow'].every(axis)) continue;
      if (c === 'CHI' && !['kunming', 'sian', 'tschengtu', 'lantschou'].every(axis)) continue;
      if (c === 'USA') continue; // die Vereinigten Staaten sind über See nicht niederzuwerfen
      surrender(g, c);
    } else if (eu.rel[c] === 'A' && g.ctrl[co.cap] === 'POL' && eu.owner[co.cap] !== c) {
      if (EAST_AXIS.includes(c)) {
        // besetzte Gebiete fallen an ihre früheren Herren zurück, das Stammland an den Sieger
        const victor = eu.owner[co.cap];
        for (const p of ownedBy(g, c)) eu.owner[p.id] = p.country !== c && enemy(g, p.country) ? p.country : victor;
        absorb(g, c, null);
        news(g, `${co.name} kapituliert`, `${PROV[co.cap].name} ist gefallen. Die besetzten Gebiete werden geräumt.`);
        continue;
      }
      absorb(g, c, 'GER');
      news(g, `${co.name} scheidet aus dem Krieg aus`, `${PROV[co.cap].name} ist gefallen. Deutsche Truppen übernehmen, was vom Land noch gehalten wird.`);
    }
  }
}

// ---- Aufbau der KI-Staaten ------------------------------------------------

function aiTick(g: GameState, days: number) {
  const eu = g.eu!, year = yearOfDay(eu.day), rng = rngFor(g, 77);
  const counts: Record<string, number> = {};
  for (const d of g.divs) counts[d.nation] = (counts[d.nation] ?? 0) + 1;
  for (const d of g.divs) {
    if (d.nation === me(g)) continue;
    // Ersatz und allmähliche Umrüstung
    if (!d.oos && !d.fought) {
      const before = strength(d);
      for (const u of d.units) u.s = Math.max(u.s, Math.min(maxS(d), u.s + (days >= 28 ? 5 : 1)));
      diluteXp(d, strength(d) - before);
    }
    for (const u of d.units) {
      const base = TYPES[u.t].base;
      if (base && rng.next() < 0.015 * days) {
        const t = aiType(d.nation, base, year);
        if ((TYPES[t].lvl ?? 0) > (TYPES[u.t].lvl ?? 0) && TYPES[t].cat === TYPES[u.t].cat) u.t = t;
      }
    }
  }
  for (const c of Object.keys(eu.rel)) {
    const co = COUNTRIES[c];
    // führt der Spieler nicht das Reich, rüstet dieses wie die anderen Staaten selbst
    // gegen einen Spieler in Ostasien rüsten Japan und China verhaltener: Der Spieler muss sein Heer aus der eigenen Wirtschaft bestreiten
    const mob = c === 'GER' ? (me(g) === 'SOV' ? 0.75 : 0.8) : (c === 'JAP' && me(g) === 'CHI') || (c === 'CHI' && me(g) === 'JAP') ? 0.45 : co?.mob;
    if (c === me(g) || eu.rel[c] === 'N' || !exists(g, c) || !mob) continue;
    const side = sideOf(eu.rel[c]) as Side;
    let ind = PLIST.reduce((a, p) => a + (eu.owner[p.id] === c ? indLeft(g, p.id) : 0), 0);
    if (c === 'ENG') ind += 25; // Empire und Leih-Pacht
    if (c === 'CHI') ind += 12; // Hilfslieferungen über die Burmastraße und den „Hump“
    if (c === 'SOV') ind += (year >= 1942 ? 70 : 40) - (isWorld(g) ? 14 : 0); // Werke hinter dem Ural, Leih-Pacht
    if (c === 'USA') ind = Math.min(260, 60 + (eu.day - (eu.flags.usa ?? eu.day)) * 0.35);
    eu.pts[c] = (eu.pts[c] ?? 0) + ind * mob * 0.3 * days * (['ENG', 'SOV'].includes(c) && eu.flags.x_lendlease ? 1.15 : 1);
    // Mobilmachung: Mit dem Kriegseintritt ruft die Sowjetunion ihre Reserven ein (1941 über fünf Millionen Mann)
    if (c === 'SOV' && eu.rel.SOV === 'E' && !eu.flags.sovmob) {
      eu.flags.sovmob = eu.day + 1;
      eu.pts.SOV += 80 * 30;
      news(g, 'Mobilmachung in der Sowjetunion', 'Die Rote Armee ruft ihre Reserven ein: Millionen Reservisten rücken ein, Dutzende neuer Schützendivisionen werden aufgestellt.');
    }
    const base = Object.values(co.army).reduce((a, n) => a + n, 0);
    // gegen einen Spieler an der Ostfront rüstet das Reich der KI verhaltener als gegen die fernen USA
    const cap = c === 'GER' ? ([45, 60, 80, 110, 140, 170][Math.max(0, year - 1936)] ?? 200) * (me(g) === 'SOV' ? 1.12 : 1.25) : c === 'USA' ? (isWorld(g) ? 95 : 70) : c === 'SOV' ? base * 2.5 : eastPlayer(g) && (c === 'JAP' || c === 'CHI') ? base * (c === 'JAP' && !eu.flags.x_pacific ? 0.95 : 1.25) : base * 1.5;
    const air = eu.airN[c];
    if (air && ['ENG', 'SOV', 'USA', 'GER'].includes(c) && rng.next() < days / 30) {
      if (air.f < 110) air.f += c === 'ENG' ? 2 : 4;
      if (air.b < 50) air.b += 1;
    }
    // Aufstellungsorte: eigene (bei den USA: britische) Versorgungsplätze abseits der Front
    // (Welt: amerikanische Verbände treffen in Großbritannien, Australien und auf zurückgewonnenem Boden ein)
    const usHome = (p: (typeof PLIST)[number]) => p.port && (isWorld(g)
      ? (eu.owner[p.id] === 'ENG' && p.supply) || eu.owner[p.id] === 'AST' || (eu.owner[p.id] === 'USA' && p.country !== 'USA')
      : ['ENG', 'USA'].includes(eu.owner[p.id]) && (p.supply || eu.owner[p.id] === 'USA'));
    const homes = PLIST.filter(p => g.ctrl[p.id] === side && (c === 'USA' ? usHome(p) : eu.owner[p.id] === c && p.supply)
      && divsIn(g, p.id).length < STACK - 1 && !p.adj.some(a => g.ctrl[a] === other(side)));
    while (eu.pts[c] >= 80 && (counts[c] ?? 0) < cap && homes.length) {
      // die Rote Armee ist vor allem ein Heer von Schützendivisionen
      const r0 = rng.next(), r = c === 'SOV' && r0 < 0.3 && rng.next() < 0.5 ? 0.5 : r0;
      const kind = r < 0.14 && (year >= 1940 || c === 'GER') && c !== 'FIN' ? 'GA' : r < 0.26 ? 'GO' : r < 0.3 && year >= 1943 && ['SOV', 'USA', 'ENG'].includes(c) ? 'GH' : r < 0.85 ? 'GI' : 'GR';
      eu.pts[c] -= kind === 'GA' || kind === 'GH' ? 160 : kind === 'GO' ? 120 : 80;
      const room = homes.filter(p => divsIn(g, p.id).length < STACK);
      if (!room.length) break;
      const at = room[rng.int(room.length)];
      makeDiv(g, c, kind, autoName(g, c, kind), at.id).xp = XP_NEW;
      counts[c] = (counts[c] ?? 0) + 1;
    }
    eu.pts[c] = Math.min(eu.pts[c], c === 'SOV' ? 2400 : 400);
  }
}

// ---- Rundenabschluss ------------------------------------------------------

function resetMoves(g: GameState) {
  lendUnits(g);
  const war = atWar(g);
  const dry = g.eu!.eco.short.includes('oil');
  for (const d of g.divs) {
    d.mp = fullMp(g, d);
    if (dry && d.nation === me(g) && war) d.mp = Math.min(d.mp, 1); // Treibstoffmangel lähmt die schnellen Verbände
    d.moved = d.fought = d.done = false;
    d.order = d.follow = null;
    d.sea = false;
  }
  g.asked = false;
}

export function vpEurope(g: GameState) {
  let axis = 0, total = 0;
  for (const p of PLIST) if (p.vp) (total += p.vp), g.ctrl[p.id] === 'GER' && (axis += p.vp);
  return { axis, total };
}

function euEndTurn(g: GameState) {
  const eu = g.eu!, war = atWar(g), days = turnDays(g);
  euSupply(g);
  bombTick(g, days, war);
  absorbAirLosses(g);
  pruneArmies(g);
  aiArmies(g);
  for (const d of g.divs) {
    if (d.oos && war) for (const u of d.units) u.s -= 2;
    d.units = d.units.filter(u => u.s > 0);
    if (!d.moved && !d.fought) d.dug = Math.min(3, d.dug + 1);
    trainXp(d, days);
  }
  g.divs = g.divs.filter(d => {
    if (d.units.length) return true;
    if (d.nation === me(g)) log(g, `${d.name} löst sich ohne Versorgung auf.`);
    return false;
  });
  ecoTick(g, days);
  aiTick(g, days);
  aidTick(g, days);
  navyTick(g, days, war);
  eu.day += days;
  g.turn++;
  runEvents(g);
  checkCapitulations(g);
  civilWar(g);
  syncCtrl(g);
  syncAir(g);
  computeIK(g);
  euSupply(g);
  resetMoves(g);
  const v = vpEurope(g);
  const n = me(g), reich = n === 'GER';
  if (g.over) return; // Kapitulation durch eigene Entscheidung
  if (eastPlayer(g)) {
    // der Krieg in Ostasien endet nicht mit dem Fall Berlins
    if (g.ctrl.berlin !== 'GER' && exists(g, 'GER')) (europeEnds(g), syncCtrl(g), syncAir(g), euSupply(g), resetMoves(g));
    const lost = PLIST.filter(p => p.country === 'CHI' && g.ctrl[p.id] === 'GER').length, held = SPHERE.filter(id => g.ctrl[id] === 'GER').length;
    if (!exists(g, n)) g.over = { winner: other(g.player), text: `${COUNTRIES[n].name} ist niedergeworfen. Der Krieg ist verloren.` };
    else if (n === 'CHI' && !exists(g, 'JAP')) g.over = { winner: 'POL', text: `Japan hat am ${fmtDate(eu.day)} die Waffen gestreckt. China ist befreit.` };
    else if (eu.day >= END_DAY)
      g.over = n === 'CHI'
        ? (lost ? { winner: 'GER', text: `Anfang 1946 hält Japan noch ${lost} chinesische Provinzen. China hat überlebt, aber den Krieg nicht gewonnen.` } : { winner: 'POL', text: 'Anfang 1946 steht kein japanischer Soldat mehr auf chinesischem Boden. China hat sich behauptet.' })
        : held >= 8 ? { winner: 'GER', text: `Anfang 1946 hält Japan ${held} der ${SPHERE.length} Schlüsselstädte Ostasiens – das Kaiserreich hat sich behauptet.` }
        : { winner: 'POL', text: `Anfang 1946 hält Japan nur noch ${held} der ${SPHERE.length} Schlüsselstädte Ostasiens. Der Krieg ist verloren.` };
    return;
  }
  if (g.ctrl.berlin !== 'GER') g.over = { winner: 'POL', text: `Berlin ist am ${fmtDate(eu.day)} gefallen. ${g.player === 'GER' ? 'Der Krieg ist verloren.' : 'Das Deutsche Reich ist besiegt.'}` };
  else if (!reich && !exists(g, n)) g.over = { winner: other(g.player), text: `${COUNTRIES[n].name} ist niedergeworfen. Der Krieg ist verloren.` };
  else if (!exists(g, 'ENG') && !exists(g, 'SOV') && eu.flags.army_SOV)
    g.over = { winner: 'GER', text: 'Großbritannien und die Sowjetunion sind niedergeworfen. Auf dem Kontinent gibt es keinen Gegner mehr.' };
  else if (eu.day >= END_DAY)
    g.over = v.axis * 2 >= v.total
      ? { winner: 'GER', text: `Anfang 1946 hält die Achse ${v.axis} von ${v.total} Siegpunkten – das Reich hat sich behauptet.` }
      : { winner: 'POL', text: `Anfang 1946 hält die Achse nur ${v.axis} von ${v.total} Siegpunkten. Berlin steht noch, doch der Krieg ist ${reich ? 'nicht mehr zu gewinnen' : 'für die Achse verloren'}.` };
}

// ---- Spielbeginn ----------------------------------------------------------

export function nearestProv(lat: number, lon: number, ok: (id: string) => boolean): string {
  let best = '', bd = Infinity;
  for (const p of PLIST) {
    if (!ok(p.id)) continue;
    const d = Math.hypot(p.ll![0] - lat, (p.ll![1] - lon) * Math.cos((lat * Math.PI) / 180));
    if (d < bd) (bd = d), (best = p.id);
  }
  return best;
}

/** Spielbare Staaten, die auf der Seite der Achse stehen. */
export const AXIS_PLAYERS = ['GER', 'ITA', 'JAP'];
/** Neues Spiel am 1. Januar 1936. Die Europakarte muss aktiv sein (useWorld('europa')). */
export function newEurope(seed = (Date.now() & 0x7fffffff) || 1, world = false, nation = 'GER'): GameState {
  const owner: Record<string, string> = {}, core: Record<string, 1> = {};
  for (const p of PLIST) {
    owner[p.id] = p.country;
    if (p.country === 'GER') core[p.id] = 1;
  }
  const eu: EuState = { day: 0, owner, rel: { GER: 'A' }, gone: [], flags: {}, news: [], pts: {}, airN: {}, eco: initEco(), core };
  // Staaten ohne Gebiet auf dieser Karte gibt es im Szenario nicht (Ausnahmen entstehen durch Ereignisse)
  const present = new Set(Object.values(owner));
  for (const c of Object.keys(COUNTRIES)) if (present.has(c) || ['SVK', 'VIC', 'USA', 'REP'].includes(c)) eu.rel[c] ??= 'N';
  if (world) eu.flags.world = 1;
  if (nation !== 'GER') eu.me = nation;
  eu.gone.push('SVK', 'VIC', 'REP'); // entstehen erst durch Ereignisse
  const g: GameState = {
    turn: 1, player: AXIS_PLAYERS.includes(nation) ? 'GER' : 'POL', ctrl: {}, divs: [], log: [], over: null, seed,
    air: { GER: { f: 6, b: 6 }, POL: { f: 0, b: 0 } }, airAssign: { GER: {}, POL: {} }, eu,
  };
  syncCtrl(g);
  ensureNavy(g);
  for (const [name, kind, lat, lon] of GER_OOB) makeDiv(g, 'GER', kind, name, nearestProv(lat, lon, id => owner[id] === 'GER'), 1).army = 'Heer';
  if (nation !== 'GER') {
    // das Reich führt die KI; der Spieler beginnt mit dem Friedensheer und der Luftwaffe seines Staates
    const co = COUNTRIES[nation], e = eu.eco;
    eu.airN.GER = { f: 6, b: 6 };
    spawnArmy(g, nation);
    e.airF = [co.air[0]];
    e.airB = [co.air[1]];
    e.trade = {};
    e.num = {};
    Object.assign(e.w, { syn: 0, mar: ({ USA: 8, ENG: 10, ITA: 6, FRA: 5, JAP: 12 } as Record<string, number>)[nation] ?? 0, tf: 0, tank: 0 });
    if (nation === 'USA') Object.assign(e, { steel: 2500, oil: 3000, men: 500, sup: 600, tank: 6000 });
    // Empire und Kolonien liefern, was die Karte des Mutterlands nicht zeigt
    if (nation === 'ENG') Object.assign(e, { steel: 1500, oil: 2000, men: 500, sup: 600, tank: 4000, fac: 22 }), (e.w.sup = 8);
    if (nation === 'FRA') Object.assign(e, { steel: 1200, oil: 800, men: 600, sup: 500, tank: 2000, fac: 6 }), (e.w.sup = 9);
    if (nation === 'ITA') Object.assign(e, { steel: 700, oil: 500, men: 450, sup: 400, tank: 1500, fac: 8 }), (e.w.sup = 9);
    if (nation === 'SOV') Object.assign(e, { steel: 1500, oil: 2000, men: 900, sup: 800, tank: 4000 }), (e.w.sup = 14), (e.fac = 40); // Werke jenseits der Karte: Ural, Sibirien, Mittelasien
    if (nation === 'USA') e.w.sup = 8;
    // Japan: große Ölvorräte, aber kaum eigene Quellen; die Schwerindustrie in Mandschukuo und Korea arbeitet mit
    if (nation === 'JAP') Object.assign(e, { steel: 900, oil: 3500, men: 500, sup: 500, tank: 5000, fac: 18 }), Object.assign(e.w, { res: 12, sup: 8, ind: 4, fix: 4, inf: 20, kfz: 8, art: 16, pak: 7, pzl: 3, pzm: 4, pzs: 0, jg: 10, bo: 8, sb: 3 });
    // China: Arsenale und Werkstätten, die die Karte nicht zeigt; viel Mannschaft, wenig Gerät
    if (nation === 'CHI') Object.assign(e, { steel: 500, oil: 200, men: 900, sup: 800, tank: 600, fac: 30 }), Object.assign(e.w, { res: 8, sup: 12, ind: 6, fix: 3, inf: 28, kfz: 5, art: 19, pak: 8, pzl: 1, pzm: 0, pzs: 0, jg: 4, bo: 1, sb: 0 });
  }
  syncAir(g);
  computeIK(g);
  euSupply(g);
  resetMoves(g);
  eu.news.push({
    title: world ? 'Die Welt, 1. Januar 1936' : 'Europa, 1. Januar 1936',
    text: (world ? `Die Karte umfasst die ganze Welt; Mausrad zoomt. ${['JAP', 'CHI'].includes(nation) ? '' : 'Der Krieg in Ostasien und im Pazifik läuft ohne Ihr Zutun: Japan tritt historisch im Dezember 1941 an die Seite der Achse. '}` : '') + (nation === 'GER'
      ? 'Sie führen das Deutsche Reich. Im Frieden dauert eine Runde einen Monat, im Krieg eine Woche. Unter „Reich verwalten“ verteilen Sie die Industrie auf Forschung, Nachschub und Fertigungslinien, stellen Verbände auf und erklären über die Diplomatie den Krieg. Die historischen Ereignisse treten zu ihren Stichtagen ein; bei einigen entscheiden Sie selbst.'
      : `Sie führen ${({ USA: 'die Vereinigten Staaten', SOV: 'die Sowjetunion', ENG: 'Großbritannien', FRA: 'Frankreich', ITA: 'Italien', JAP: 'Japan', CHI: 'China' } as Record<string, string>)[nation]}. Ihr Land ist neutral: Bis zum Kriegseintritt (${({ USA: 'historisch im Dezember 1941', SOV: 'historisch mit dem deutschen Angriff im Juni 1941', ENG: 'historisch am 3. September 1939', FRA: 'historisch am 3. September 1939', ITA: 'historisch im Juni 1940', JAP: 'historisch mit dem Krieg gegen China im Juli 1937', CHI: 'historisch mit dem japanischen Angriff im Juli 1937' } as Record<string, string>)[nation]}) rüsten und forschen Sie unter „Staat verwalten“ und verlegen Ihr Heer im eigenen Land. Das Deutsche Reich und alle übrigen Staaten führt die KI; die ersten deutschen Feldzüge laufen nach dem historischen Fahrplan. „Vorspulen“ überspringt ruhige Runden bis zur nächsten Meldung. ${nation === 'JAP' ? 'Der Krieg in Ostasien wird auf der Karte ausgefochten: Sie entscheiden über den Krieg gegen China, den Vorstoß nach Süden und den Angriff auf Pearl Harbor. Ihre Verbände dürfen schon im Frieden in Mandschukuo stehen. Fällt Berlin, kämpfen Sie allein weiter. Sie gewinnen, wenn Japan Anfang 1946 mindestens acht der vierzehn Schlüsselstädte Ostasiens hält, und verlieren, wenn Tokio fällt.' : nation === 'CHI' ? 'Der Krieg in Ostasien wird auf der Karte ausgefochten; bis zum Pazifikkrieg stehen Sie Japan allein gegenüber. Sie gewinnen, wenn Japan die Waffen streckt oder Anfang 1946 keine chinesische Provinz mehr hält, und verlieren, wenn neben Tschungking auch Sian, Tschengtu, Kunming und Lantschou fallen.' : nation === 'ITA' ? 'Sie kämpfen an der Seite des Reichs: Fällt Berlin oder Rom, ist der Krieg verloren.' : nation === 'FRA' ? 'Sie gewinnen, wenn Berlin fällt – und verlieren, wenn Paris fällt.' : 'Sie gewinnen, wenn Berlin fällt.'}`),
  });
  return g;
}

/** Provinzen, deren Kennung sich mit der Neufassung der Weltkarte geändert hat (alt → neu). */
const RENAMED: Record<string, string> = {
  lianshan: 'kintschou', daejeon: 'taiden', duschanbe: 'stalinabad', a_nang: 'tourane', naypyidaw: 'pyinmana',
  bischkek: 'frunse', kota_kinabalu: 'jesselton', banda_aceh: 'kutaradja', mawlamyaing: 'moulmein',
};
/** Ältere Spielstände an die aktuelle Karte anpassen: umbenannte Provinzen umhängen, neue dem Nachbarn im selben Land zuschlagen. */
export function migrateMap(g: GameState) {
  const eu = g.eu;
  if (!eu) return;
  const move = (rec?: Record<string, unknown>) => {
    if (rec) for (const [a, b] of Object.entries(RENAMED)) if (a in rec && !PROV[a] && PROV[b]) (rec[b] = rec[a]), delete rec[a];
  };
  for (const rec of [eu.owner, eu.core, g.ctrl, g.airAssign?.GER, g.airAssign?.POL, eu.raid, eu.bomb, eu.dmg]) move(rec as Record<string, unknown> | undefined);
  const fix = (id: string | null | undefined) => (id && !PROV[id] && PROV[RENAMED[id]] ? RENAMED[id] : id);
  for (const d of g.divs) (d.prov = fix(d.prov)!), (d.order = fix(d.order) ?? null), (d.follow = fix(d.follow) ?? null);
  for (const p of PLIST) {
    if (eu.owner[p.id]) continue;
    const from = p.adj.find(a => eu.owner[a] && PROV[a].country === p.country) ?? p.adj.find(a => eu.owner[a]);
    eu.owner[p.id] = from ? eu.owner[from] : p.country;
    if (from ? eu.core[from] : p.country === 'GER') eu.core[p.id] = 1;
  }
  syncCtrl(g);
}

/** Namen und Einhängepunkte auf das Europa-Szenario umstellen. */
export function installEurope() {
  hooks.capture = (g, prov, d) => {
    const eu = g.eu!, home = PROV[prov].country;
    if (civil(g) && home === 'SPA') return void (eu.owner[prov] = d.side === 'GER' ? 'SPA' : 'REP');
    // was dem Reich unterstellte Verbündete erobern, fällt an das Reich und liefert ihm Rohstoffe
    if (d.side === 'GER') eu.owner[prov] = eu.core[prov] ? 'GER' : relOf(g, home) === 'A' && exists(g, home) ? home : d.ctl ? me(g) : d.nation;
    else eu.owner[prov] = enemy(g, home) ? home : d.nation;
  };
  hooks.targets = farTargets;
  hooks.bar = barred;
  hooks.special = farMove;
  hooks.capital = (g, d) => {
    const cap = COUNTRIES[d.nation]?.cap;
    return cap && g.ctrl[cap] === d.side ? cap : d.side === 'GER' ? 'berlin' : 'moskau';
  };
  hooks.endTurn = euEndTurn;
  // über Spanien fliegt die Luftwaffe nur, wenn die Legion Condor entsandt ist
  hooks.air = (g, side, prov) => !(side === 'GER' && civil(g) && PROV[prov].country === 'SPA' && !g.eu!.flags.condor);
  WORDS.GER = { adj: 'Eigene', by: 'Truppen der Achse' };
  WORDS.POL = { adj: 'Feindliche', by: 'gegnerischen Truppen' };
}

/** Zurück zum Polenfeldzug 1939. */
export function uninstallEurope() {
  for (const k of Object.keys(hooks) as (keyof typeof hooks)[]) delete hooks[k];
  WORDS.GER = { adj: 'Deutsche', by: 'deutschen Truppen' };
  WORDS.POL = { adj: 'Polnische', by: 'polnischen Truppen' };
}
