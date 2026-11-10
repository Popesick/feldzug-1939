// Europa-Szenario ab 1936: Staaten und Bündnisse, historische Ereignisse, Kapitulationen,
// Nachschub mit Reichweite, Seetransport, Bahnverlegung und der Rundenabschluss.
// Gespielt wird das Deutsche Reich; alle übrigen Staaten führt die KI.
import type { Division, EuState, GameState, Rel, Side } from './types';
import { other } from './types';
import { KM_PX, PLIST, PROV } from '../data/world';
import { GEN_YEAR, MODELS, TEMPLATES, TYPES, ladder } from '../data/units';
import { COUNTRIES, GER_OOB } from '../data/europa';
import { type MoveTarget, STACK, WORDS, airAt, assignAir, capture, divsIn, hooks, log, tp } from './game';
import { computeIK, ecoTick, initEco, yearOfDay } from './economy';
import { RNG } from './rng';

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
export const atWar = (g: GameState) => Object.entries(g.eu!.rel).some(([c, r]) => r === 'E' && exists(g, c));
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
const km = (a: string, b: string) => Math.hypot(PROV[a].x - PROV[b].x, PROV[a].y - PROV[b].y) * KM_PX;

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
  const d: Division = {
    id: eu.flags._id, name, side: sideOf(relOf(g, nation)) as Side, nation, kind, army: COUNTRIES[nation]?.name ?? nation,
    q: t.q + (COUNTRIES[nation]?.q ?? 0) + (nation === 'SOV' && year >= 1943 ? 1 : 0), prov,
    units: t.units.map(u => {
      const [b, s] = u.split(':');
      return { t: nation === 'GER' ? ladder('GER', b)[0] : aiType(nation, b, year), s: s ? +s : 10 };
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
  const border = new Set(provs.filter(id => PROV[id].adj.some(a => g.ctrl[a] === foe)));
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
  eu.airN[c] = { f: Math.round(co.air[0] * f), b: Math.round(co.air[1] * f) };
}

// ---- Bündnisse und Kriegserklärungen --------------------------------------

function join(g: GameState, c: string, r: Rel) {
  const eu = g.eu!;
  if (!exists(g, c) || eu.rel[c] === r) return;
  eu.rel[c] = r;
  eu.flags[`war_${c}`] = eu.day;
  syncCtrl(g);
  spawnArmy(g, c);
  for (const d of g.divs) if (d.nation === c) d.side = sideOf(r) as Side;
  expedition(g);
  syncAir(g);
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
    if (g.ctrl[d.prov] === d.side) continue;
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

// ---- Luftstreitkräfte -----------------------------------------------------

/** Führt Staffelzahlen und Mustergüte aus Wirtschaft und Bündnislage zusammen. */
export function syncAir(g: GameState) {
  const eu = g.eu!, e = eu.eco, away = eu.flags.condor && !eu.flags.spainend ? 2 : 0;
  const sum = (a: number[]) => a.reduce((x, y) => x + (y ?? 0), 0);
  const avg = (a: number[], cat: 'jg' | 'bo') => (sum(a) ? a.reduce((x, n, i) => x + (n ?? 0) * (MODELS[cat][i].q ?? 1), 0) / sum(a) : 1);
  const exp = eu.flags.condor && eu.flags.spainend ? 1.08 : 1;
  // ohne Treibstoff bleibt die halbe Luftwaffe am Boden
  const fuel = e.short.includes('oil') ? 0.5 : 1;
  g.air.GER = { f: Math.max(0, Math.floor((sum(e.airF) - away) * fuel)), b: Math.max(0, Math.floor((sum(e.airB) - away) * fuel)) };
  let f = 0, b = 0;
  for (const [c, a] of Object.entries(eu.airN)) if (enemy(g, c)) (f += a.f), (b += a.b);
  g.air.POL = { f, b };
  const yr = Math.max(0, yearOfDay(eu.day) - 1939);
  g.airQ = { GER: { f: avg(e.airF, 'jg') * exp, b: avg(e.airB, 'bo') * exp }, POL: { f: Math.min(1.8, 1 + 0.12 * yr), b: Math.min(1.6, 0.9 + 0.1 * yr) } };
  for (const side of ['GER', 'POL'] as Side[])
    for (const kind of ['f', 'b'] as const) {
      const as = g.airAssign[side];
      let over = Object.values(as).reduce((x, a) => x + a[kind], 0) - g.air[side][kind];
      for (const s of Object.keys(as)) while (over > 0 && as[s]?.[kind] > 0) (assignAir(g, side, s, kind, -1), over--);
    }
}

/** Im Kampf verlorene Staffeln aus den Beständen der Staaten streichen. */
function absorbAirLosses(g: GameState) {
  const eu = g.eu!, e = eu.eco, away = eu.flags.condor && !eu.flags.spainend ? 2 : 0;
  for (const [arr, kind] of [[e.airF, 'f'], [e.airB, 'b']] as const) {
    if (e.short.includes('oil')) continue; // Bestand war gedrosselt, Verluste nicht sauber zuzuordnen
    let lost = arr.reduce((x, y) => x + (y ?? 0), 0) - away - g.air.GER[kind];
    for (let i = 0; i < arr.length && lost > 0; i++) while (arr[i] > 0 && lost > 0) (arr[i]--, lost--);
  }
  for (const kind of ['f', 'b'] as const) {
    const at = Object.keys(eu.airN).filter(c => enemy(g, c));
    let lost = at.reduce((x, c) => x + eu.airN[c][kind], 0) - g.air.POL[kind];
    while (lost > 0) {
      const c = at.sort((a, b) => eu.airN[b][kind] - eu.airN[a][kind])[0];
      if (!c || eu.airN[c][kind] <= 0) break;
      eu.airN[c][kind]--;
      lost--;
    }
  }
}

// ---- Nachschub ------------------------------------------------------------

const SEAS = ['N', 'B', 'M', 'S'];
/** Kürzeste Nachschubwege einer Seite: über eigenes Land, zwischen eigenen Häfen auch über See. */
function supplyDist(g: GameState, side: Side): Record<string, number> {
  const eu = g.eu!, dist: Record<string, number> = {};
  const naval = side === 'POL' && (enemy(g, 'ENG') || enemy(g, 'USA'));
  const src = PLIST.filter(p => {
    if (g.ctrl[p.id] !== side) return false;
    if (naval && p.port) return true; // die Seemächte versorgen jeden Hafen
    if (!p.supply) return false;
    const o = eu.owner[p.id];
    return o === 'GER' ? !!eu.core[p.id] : o === p.country;
  }).map(p => p.id);
  const q = [...src];
  for (const s of src) dist[s] = 0;
  const blockade = side === 'GER' && enemy(g, 'ENG');
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
    if (p.port) for (const s of p.sea ?? '') if (SEAS.includes(s)) relax(s, blockade && s !== 'B' ? 4 : 2);
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
      d.oos = v === undefined;
      d.low = side === 'GER' && v !== undefined && v > range;
    }
  }
}

// ---- Seetransport und Bahnverlegung --------------------------------------

const fullMp = (g: GameState, d: Division) => tp(d).mp * (atWar(g) ? 1 : 4);

function farTargets(g: GameState, d: Division): MoveTarget[] {
  const out: MoveTarget[] = [], here = PROV[d.prov], foe = other(d.side);
  if (tp(d).mp === 0 || d.mp < fullMp(g, d) || d.moved) return out;
  const adj = new Set(here.adj);
  if (d.nation === 'GER') {
    // Bahn: beliebig weit durch eigenes Gebiet, kostet die ganze Runde
    const seen = new Set([here.id]), q = [here.id], depth: Record<string, number> = { [here.id]: 0 };
    for (let i = 0; i < q.length; i++)
      for (const a of PROV[q[i]].adj) {
        if (seen.has(a) || g.ctrl[a] !== d.side || depth[q[i]] >= 16) continue;
        seen.add(a);
        depth[a] = depth[q[i]] + 1;
        q.push(a);
        if (!adj.has(a) && divsIn(g, a).length < STACK) out.push({ prov: a, attack: false, kind: 'rail' });
      }
  }
  if (here.port)
    for (const p of PLIST) {
      if (p.id === here.id || adj.has(p.id) || !p.sea || ![...p.sea].some(s => here.sea!.includes(s))) continue;
      const c = g.ctrl[p.id], dkm = km(here.id, p.id);
      if (c === d.side && p.port && dkm <= 1800 && divsIn(g, p.id).length < STACK) {
        if (!out.some(o => o.prov === p.id)) out.push({ prov: p.id, attack: false, kind: 'sea' });
      } else if (c === foe && dkm <= 700) out.push({ prov: p.id, attack: divsIn(g, p.id, foe).length > 0, kind: 'sea' });
    }
  return out;
}

/** Verluste auf See durch feindliche Flotten und Flugzeuge. */
export function seaLoss(g: GameState, d: Division, to: string) {
  const here = PROV[d.prov], rng = rngFor(g, d.id);
  const basin = [...(PROV[to].sea ?? '')].find(s => here.sea?.includes(s)) ?? 'N';
  let p = 0;
  if (d.side === 'GER') {
    if ((enemy(g, 'ENG') || enemy(g, 'USA')) && (basin === 'N' || basin === 'M')) p = basin === 'N' ? 0.5 : relOf(g, 'ITA') === 'A' && exists(g, 'ITA') ? 0.2 : 0.35;
    else if (enemy(g, 'SOV') && basin === 'S') p = 0.15;
    const mine = airAt(g, 'GER', to), theirs = airAt(g, 'POL', to);
    if (mine.f > theirs.f) p -= 0.2;
  } else if (airAt(g, 'GER', to).f > airAt(g, 'POL', to).f) p = 0.3;
  if (km(d.prov, to) < 150) p /= 2;
  let lost = 0;
  for (const u of d.units)
    if (rng.next() < p) {
      const n = Math.min(u.s - 1, 1 + rng.int(3));
      u.s -= n;
      lost += n;
    }
  if (lost && d.nation === 'GER') log(g, `${d.name}: Verluste bei der Überfahrt (−${lost}).`);
}

function farMove(g: GameState, d: Division, t: MoveTarget) {
  if (t.kind === 'sea') {
    seaLoss(g, d, t.prov);
    if (g.ctrl[t.prov] !== d.side) capture(g, t.prov, d);
  }
  d.prov = t.prov;
  d.mp = 0;
  d.moved = true;
  d.dug = 0;
}

// ---- Ereignisse -----------------------------------------------------------

interface Ev { id: string; on?: [number, number, number]; cond?: (g: GameState) => boolean; run: (g: GameState) => void }
const ask = (g: GameState, id: string, title: string, text: string, yes: string, no: string) => g.eu!.news.push({ id, title, text, yes, no });
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
  eu.gone = eu.gone.filter(c => c !== 'VIC');
  eu.gone.push('FRA');
  g.divs = g.divs.filter(d => d.nation !== 'FRA');
  delete eu.airN.FRA;
  eu.rel.FRA = 'N';
  eu.rel.VIC = 'N';
  for (const id of south) eu.owner[id] = 'VIC';
  transfer(g, north, 'GER');
  news(g, 'Frankreich kapituliert', 'Nach dem Fall von Paris schließt Frankreich einen Waffenstillstand. Der Norden und die Atlantikküste werden besetzt; im Süden und in den Kolonien regiert die Regierung in Vichy. Britische Truppen auf dem Festland schiffen sich nach England ein.');
}

const EVENTS: Ev[] = [
  { id: 'rhein', on: [1936, 3, 7], run: g => news(g, 'Besetzung des Rheinlands', 'Am 7. März 1936 rücken deutsche Truppen in das entmilitarisierte Rheinland ein. Frankreich und Großbritannien belassen es bei Protesten.') },
  { id: 'spanien', on: [1936, 7, 17], run: g => ask(g, 'condor', 'Bürgerkrieg in Spanien',
    'In Spanien erhebt sich ein Teil der Armee unter General Franco gegen die Republik. Soll die Luftwaffe einen Verband entsenden („Legion Condor“)? Zwei Jagd- und zwei Bomberstaffeln fehlen dann bis zum Ende des Bürgerkriegs, bringen aber Einsatzerfahrung mit: Flugzeugmuster werden schneller entwickelt, die Staffeln kämpfen danach etwas besser.',
    'Legion Condor entsenden', 'Nicht eingreifen') },
  { id: 'achse', on: [1936, 11, 1], run: g => news(g, 'Achse Berlin–Rom', 'Deutschland und Italien stimmen ihre Außenpolitik ab; wenig später folgt der Antikominternpakt mit Japan.') },
  { id: 'anschluss', on: [1938, 3, 12], cond: g => neutral(g, 'AUT'), run: g => {
    const at = ownedBy(g, 'AUT').map(p => p.id);
    absorb(g, 'AUT', 'GER', true);
    deploy(g, 'GER', ['ID2', 'ID2', 'ID2', 'GEBD', 'GEBD', 'LEI'], at);
    for (const d of g.divs.slice(-6)) d.name = nextGerName(g, d.kind);
    g.eu!.eco.men += 120;
    news(g, 'Anschluss Österreichs', 'Am 12. März 1938 marschiert die Wehrmacht in Österreich ein, das als „Ostmark“ dem Reich angegliedert wird. Industrie, Rohstoffe und das Bundesheer (sechs Verbände) gehen im Reich auf.');
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
    // die Beute aus den tschechischen Zeughäusern und den Škoda-Werken
    const e = eu.eco;
    if (!e.done.includes('pzl2')) e.done.push('pzl2'), (e.slots = e.slots.map(s => (s === 'pzl2' ? null : s)));
    e.neu['pzl:2'] = (e.neu['pzl:2'] ?? 0) + 30;
    e.neu['inf:0'] = (e.neu['inf:0'] ?? 0) + 120;
    e.neu['art:0'] = (e.neu['art:0'] ?? 0) + 40;
    news(g, 'Zerschlagung der Tschechoslowakei', 'Deutsche Truppen besetzen Böhmen und Mähren („Reichsprotektorat“). Die Slowakei erklärt sich unter deutschem Schutz für selbständig, Ungarn nimmt die Karpatoukraine. Dem Reich fallen die Rüstungsbetriebe und die Bestände des tschechoslowakischen Heeres zu – darunter der Panzer 38(t), der ab sofort gefertigt werden kann.');
  } },
  { id: 'memel', on: [1939, 3, 23], cond: g => neutral(g, 'LIT'), run: g => {
    transfer(g, PLIST.filter(p => g.eu!.owner[p.id] === 'LIT' && flagged(p, 'memel')).map(p => p.id), 'GER', true);
    news(g, 'Memelland', 'Litauen tritt unter Druck das Memelgebiet an das Deutsche Reich ab.');
  } },
  { id: 'garantie', on: [1939, 3, 31], run: g => news(g, 'Britisch-französische Garantie für Polen', 'London und Paris sichern Polen Beistand zu. Ein Angriff auf Polen bedeutet Krieg mit den Westmächten.') },
  { id: 'spainend', on: [1939, 4, 1], run: g => news(g, 'Ende des Spanischen Bürgerkriegs', g.eu!.flags.condor
    ? 'Franco hat gesiegt. Die Legion Condor kehrt zurück; ihre Erfahrungen fließen in Ausbildung und Flugzeugbau ein. Spanien bleibt neutral.'
    : 'Franco hat gesiegt. Spanien bleibt neutral.') },
  { id: 'albanien', on: [1939, 4, 7], cond: g => neutral(g, 'ALB') && exists(g, 'ITA'), run: g => (absorb(g, 'ALB', 'ITA'), news(g, 'Italien besetzt Albanien', 'Italienische Truppen landen in Albanien, das mit Italien vereinigt wird.')) },
  { id: 'pakt', on: [1939, 8, 23], cond: g => neutral(g, 'SOV'), run: g => news(g, 'Deutsch-sowjetischer Nichtangriffspakt', 'Ribbentrop und Molotow unterzeichnen in Moskau einen Nichtangriffspakt. Ein geheimes Zusatzprotokoll grenzt die Interessengebiete in Osteuropa ab; die Sowjetunion liefert Rohstoffe und bietet Öl an (Wirtschaft → Handel).') },
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
    'Über Narvik läuft im Winter das schwedische Erz; die Briten bereiten die Verminung der norwegischen Gewässer vor. Historisch besetzt die Wehrmacht am 9. April 1940 Dänemark und landet in Norwegen. Norwegen ist nur über See zu erreichen: Verbände in einem Hafen können übersetzen oder landen.',
    'Dänemark und Norwegen angreifen', 'Verzichten') },
  { id: 'gelb', on: [1940, 5, 10], cond: g => enemy(g, 'FRA') && (neutral(g, 'BEL') || neutral(g, 'NLD')), run: g => ask(g, 'gelb', 'Fall Gelb',
    'Die Maginot-Linie deckt die deutsch-französische Grenze. Historisch greift die Wehrmacht am 10. Mai 1940 durch die Niederlande, Belgien und Luxemburg an.',
    'Benelux-Staaten angreifen', 'Verzichten') },
  { id: 'italien', cond: g => g.eu!.day >= dayOf(1940, 1, 1) && neutral(g, 'ITA') && enemy(g, 'ENG') && (!exists(g, 'FRA') || axisHolds(g, 'FRA') >= 6), run: g => {
    join(g, 'ITA', 'A');
    news(g, 'Italien tritt in den Krieg ein', 'Mussolini erklärt Großbritannien und Frankreich den Krieg. Italienische Truppen stehen in den Alpen, in Libyen und im Dodekanes; die KI führt sie als Verbündete.');
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
    news(g, 'Beitritte zum Dreimächtepakt', 'Ungarn, Rumänien und die Slowakei treten dem Pakt bei. Ihre Armeen kämpfen als Verbündete; rumänisches Öl fließt nun reichlicher.');
  } },
  { id: 'bulgarien', on: [1941, 3, 1], cond: g => atWar(g) && neutral(g, 'BUL'), run: g => (join(g, 'BUL', 'A'), news(g, 'Bulgarien tritt dem Dreimächtepakt bei', 'Deutsche Truppen dürfen durch Bulgarien marschieren.')) },
  { id: 'putsch', on: [1941, 3, 27], cond: g => atWar(g) && neutral(g, 'YUG'), run: g => ask(g, 'marita', 'Staatsstreich in Belgrad',
    'Offiziere stürzen die Regierung, die eben dem Dreimächtepakt beigetreten war. Historisch greift die Wehrmacht am 6. April 1941 Jugoslawien und Griechenland an.',
    'Jugoslawien angreifen', 'Verzichten') },
  { id: 'barbarossa', on: [1941, 6, 22], cond: g => neutral(g, 'SOV'), run: g => ask(g, 'barbarossa', 'Unternehmen Barbarossa',
    'Der Aufmarsch im Osten ist befohlen. Historisch beginnt am 22. Juni 1941 der Angriff auf die Sowjetunion – die Rote Armee ist zahlenmäßig weit überlegen, ihre Reserven und ihre Industrie sind gewaltig, der Nachschub reicht nur begrenzt weit. Ohne Angriff bleibt der Pakt vorerst bestehen.',
    'Sowjetunion angreifen', 'Pakt einhalten') },
  { id: 'usa', on: [1941, 12, 11], cond: g => enemy(g, 'ENG'), run: g => {
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
    eu.gone.push('VIC');
    g.divs = g.divs.filter(d => d.nation !== 'VIC');
    for (const p of v) eu.owner[p.id] = west.includes(p.id) ? 'USA' : p.ll![1] > 30 ? (enemy(g, 'ENG') ? 'ENG' : axis) : flagged(p, 'k') ? axis : 'GER';
    syncCtrl(g);
    evict(g);
    deploy(g, 'USA', ['GI', 'GI', 'GI', 'GO', 'GA'], west.filter(id => PROV[id].port));
    deploy(g, 'ENG', ['GI', 'GI'], west.filter(id => PROV[id].port));
    news(g, 'Landung in Nordafrika', 'Amerikanische und britische Truppen landen in Marokko und Algerien; die dortigen Vichy-Truppen stellen den Kampf ein. Die Wehrmacht besetzt daraufhin auch Südfrankreich, die Achse sichert Tunesien.');
  } },
  { id: 'totalerkrieg', on: [1943, 2, 18], cond: g => atWar(g), run: g => news(g, 'Totaler Krieg', 'Die Wirtschaft wird vollständig auf die Rüstung ausgerichtet: +15 % Industriekapazität.') },
];

function nextGerName(g: GameState, kind: string) {
  const e = g.eu!.eco, stem = kind === 'GEBD' ? 'Gebirgs-Division' : kind === 'LEI' ? 'leichte Division' : 'Infanterie-Division';
  e.num[stem] = (e.num[stem] ?? 0) + 1;
  return `${e.num[stem]}. ${stem}`;
}

function runEvents(g: GameState) {
  const eu = g.eu!;
  for (const ev of EVENTS) {
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
  if (id === 'condor' && yes) (eu.flags.condor = eu.day + 1), syncAir(g);
  if (!yes) return;
  if (id === 'weiss') declareWar(g, 'POL');
  if (id === 'weser') (declareWar(g, 'DNK'), declareWar(g, 'NOR'));
  if (id === 'gelb') for (const c of ['NLD', 'BEL', 'LUX']) declareWar(g, c);
  if (id === 'marita') declareWar(g, 'YUG');
  if (id === 'barbarossa') declareWar(g, 'SOV');
  euSupply(g);
  resetMoves(g);
}

// ---- Kapitulationen -------------------------------------------------------

function checkCapitulations(g: GameState) {
  const eu = g.eu!, axis = (id: string) => g.ctrl[id] === 'GER';
  for (const c of Object.keys(COUNTRIES)) {
    const co = COUNTRIES[c];
    if (!exists(g, c) || !co.cap || c === 'GER' || !PROV[co.cap]) continue;
    if (eu.rel[c] === 'E' && axis(co.cap)) {
      if (c === 'FRA') { vichy(g); continue; }
      if (c === 'SOV' && !['moskau', 'leningrad', 'stalingrad', 'gorki'].every(axis)) continue;
      if (c === 'ENG' && !['london', 'birmingham', 'manchester', 'glasgow'].every(axis)) continue;
      if (c === 'POL') eastPoland(g);
      absorb(g, c, 'GER');
      news(g, `${co.name} kapituliert`, `Mit dem Verlust von ${PROV[co.cap].name} bricht der Widerstand zusammen. Das restliche Staatsgebiet wird besetzt.`);
    } else if (eu.rel[c] === 'A' && g.ctrl[co.cap] === 'POL' && eu.owner[co.cap] !== c) {
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
    if (d.nation === 'GER') continue;
    // Ersatz und allmähliche Umrüstung
    if (!d.oos && !d.fought) for (const u of d.units) u.s = Math.min(10, u.s + (days >= 28 ? 5 : 1));
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
    if (c === 'GER' || eu.rel[c] === 'N' || !exists(g, c) || !co?.mob) continue;
    const side = sideOf(eu.rel[c]) as Side;
    let ind = PLIST.reduce((a, p) => a + (eu.owner[p.id] === c ? p.ind ?? 0 : 0), 0);
    if (c === 'ENG') ind += 25; // Empire und Leih-Pacht
    if (c === 'SOV') ind += year >= 1942 ? 45 : 20; // Werke hinter dem Ural, Leih-Pacht
    if (c === 'USA') ind = Math.min(260, 60 + (eu.day - (eu.flags.usa ?? eu.day)) * 0.35);
    eu.pts[c] = (eu.pts[c] ?? 0) + ind * co.mob * 0.3 * days;
    const base = Object.values(co.army).reduce((a, n) => a + n, 0);
    const cap = c === 'USA' ? 70 : c === 'SOV' ? base * 2 : base * 1.5;
    const air = eu.airN[c];
    if (air && ['ENG', 'SOV', 'USA'].includes(c) && rng.next() < days / 30) {
      if (air.f < 70) air.f += c === 'ENG' ? 1 : 2;
      if (air.b < 50) air.b += 1;
    }
    // Aufstellungsorte: eigene (bei den USA: britische) Versorgungsplätze abseits der Front
    const homes = PLIST.filter(p => g.ctrl[p.id] === side && (c === 'USA' ? p.port && ['ENG', 'USA'].includes(eu.owner[p.id]) && (p.supply || eu.owner[p.id] === 'USA') : eu.owner[p.id] === c && p.supply)
      && divsIn(g, p.id).length < STACK - 1 && !p.adj.some(a => g.ctrl[a] === other(side)));
    while (eu.pts[c] >= 80 && (counts[c] ?? 0) < cap && homes.length) {
      const r = rng.next();
      const kind = r < 0.14 && year >= 1940 && c !== 'FIN' ? 'GA' : r < 0.26 ? 'GO' : r < 0.3 && year >= 1943 && ['SOV', 'USA', 'ENG'].includes(c) ? 'GH' : r < 0.85 ? 'GI' : 'GR';
      eu.pts[c] -= kind === 'GA' || kind === 'GH' ? 160 : kind === 'GO' ? 120 : 80;
      const at = homes[rng.int(homes.length)];
      makeDiv(g, c, kind, autoName(g, c, kind), at.id);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    eu.pts[c] = Math.min(eu.pts[c], 400);
  }
}

// ---- Rundenabschluss ------------------------------------------------------

function resetMoves(g: GameState) {
  const k = atWar(g) ? 1 : 4;
  const dry = g.eu!.eco.short.includes('oil');
  for (const d of g.divs) {
    d.mp = tp(d).mp * k;
    if (dry && d.nation === 'GER' && k === 1) d.mp = Math.min(d.mp, 1); // Treibstoffmangel lähmt die schnellen Verbände
    d.moved = d.fought = d.done = false;
    d.order = null;
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
  absorbAirLosses(g);
  for (const d of g.divs) {
    if (d.oos && war) for (const u of d.units) u.s -= 2;
    d.units = d.units.filter(u => u.s > 0);
    if (!d.moved && !d.fought) d.dug = Math.min(3, d.dug + 1);
  }
  g.divs = g.divs.filter(d => {
    if (d.units.length) return true;
    if (d.nation === 'GER') log(g, `${d.name} löst sich ohne Versorgung auf.`);
    return false;
  });
  ecoTick(g, days);
  aiTick(g, days);
  eu.day += days;
  g.turn++;
  runEvents(g);
  checkCapitulations(g);
  syncCtrl(g);
  syncAir(g);
  computeIK(g);
  euSupply(g);
  resetMoves(g);
  const v = vpEurope(g);
  if (g.ctrl.berlin !== 'GER') g.over = { winner: 'POL', text: `Berlin ist am ${fmtDate(eu.day)} gefallen. Der Krieg ist verloren.` };
  else if (!exists(g, 'ENG') && !exists(g, 'SOV') && eu.flags.army_SOV)
    g.over = { winner: 'GER', text: 'Großbritannien und die Sowjetunion sind niedergeworfen. Auf dem Kontinent gibt es keinen Gegner mehr.' };
  else if (eu.day >= END_DAY)
    g.over = v.axis * 2 >= v.total
      ? { winner: 'GER', text: `Anfang 1946 hält die Achse ${v.axis} von ${v.total} Siegpunkten – das Reich hat sich behauptet.` }
      : { winner: 'POL', text: `Anfang 1946 hält die Achse nur ${v.axis} von ${v.total} Siegpunkten. Berlin steht noch, doch der Krieg ist nicht mehr zu gewinnen.` };
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

/** Neues Spiel am 1. Januar 1936. Die Europakarte muss aktiv sein (useWorld('europa')). */
export function newEurope(seed = (Date.now() & 0x7fffffff) || 1): GameState {
  const owner: Record<string, string> = {}, core: Record<string, 1> = {};
  for (const p of PLIST) {
    owner[p.id] = p.country;
    if (p.country === 'GER') core[p.id] = 1;
  }
  const eu: EuState = { day: 0, owner, rel: { GER: 'A' }, gone: [], flags: {}, news: [], pts: {}, airN: {}, eco: initEco(), core };
  for (const c of Object.keys(COUNTRIES)) eu.rel[c] ??= 'N';
  eu.gone.push('SVK', 'VIC'); // entstehen erst durch Ereignisse
  const g: GameState = {
    turn: 1, player: 'GER', ctrl: {}, divs: [], log: [], over: null, seed,
    air: { GER: { f: 6, b: 6 }, POL: { f: 0, b: 0 } }, airAssign: { GER: {}, POL: {} }, eu,
  };
  syncCtrl(g);
  for (const [name, kind, lat, lon] of GER_OOB) makeDiv(g, 'GER', kind, name, nearestProv(lat, lon, id => owner[id] === 'GER'), 1).army = 'Heer';
  syncAir(g);
  computeIK(g);
  euSupply(g);
  resetMoves(g);
  eu.news.push({
    title: 'Europa, 1. Januar 1936',
    text: 'Sie führen das Deutsche Reich. Im Frieden dauert eine Runde einen Monat, im Krieg eine Woche. Unter „Wirtschaft“ verteilen Sie die Industrie auf Forschung, Nachschub und Fertigungslinien, stellen Verbände auf und erklären über die Diplomatie den Krieg. Die historischen Ereignisse treten zu ihren Stichtagen ein; bei einigen entscheiden Sie selbst.',
  });
  return g;
}

/** Namen und Einhängepunkte auf das Europa-Szenario umstellen. */
export function installEurope() {
  hooks.capture = (g, prov, d) => {
    const eu = g.eu!, home = PROV[prov].country;
    if (d.side === 'GER') eu.owner[prov] = eu.core[prov] ? 'GER' : relOf(g, home) === 'A' && exists(g, home) ? home : d.nation;
    else eu.owner[prov] = enemy(g, home) ? home : d.nation;
  };
  hooks.targets = farTargets;
  hooks.special = farMove;
  hooks.capital = (g, d) => {
    const cap = COUNTRIES[d.nation]?.cap;
    return cap && g.ctrl[cap] === d.side ? cap : d.side === 'GER' ? 'berlin' : 'moskau';
  };
  hooks.endTurn = euEndTurn;
  WORDS.GER = { adj: 'Eigene', by: 'Truppen der Achse' };
  WORDS.POL = { adj: 'Feindliche', by: 'gegnerischen Truppen' };
}

/** Zurück zum Polenfeldzug 1939. */
export function uninstallEurope() {
  for (const k of Object.keys(hooks) as (keyof typeof hooks)[]) delete hooks[k];
  WORDS.GER = { adj: 'Deutsche', by: 'deutschen Truppen' };
  WORDS.POL = { adj: 'Polnische', by: 'polnischen Truppen' };
}
