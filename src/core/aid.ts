// Waffenhilfe an Verbündete und Beute aus Kapitulationen.
import type { GameState } from './types';
import { PLIST } from '../data/world';
import { type Cat, GROUND, MODELS, TYPES, ladder, stockKey } from '../data/units';
import { COUNTRIES } from '../data/europa';
import { airFree, strength } from './game';
import { bestLvl } from './economy';
import { ensureNavy, fleetOf, SHIP_KINDS, SHIPS, type ShipKind } from './navy';
import { sbFree } from './airwar';
import { syncAir } from './europa';

export const LOOT = 0.8; // Anteil an Gerät und Vorräten, der bei einer Kapitulation erbeutet wird
const RESERVE_DAYS = 45; // Vorräte eines Staates: so viele Tage seiner Förderung liegen auf Lager
export const AID_BUILD = 30; // Stärkepunkte je Woche, die ein Verbündeter aus geliefertem Gerät für neue Verbände verwendet
const POOLS = ['neu', 'upg', 'rep'] as const;
export const AIR_KINDS = { jg: 'airF', bo: 'airB', sb: 'airS' } as const;
export type AirCat = keyof typeof AIR_KINDS;

/** Verbündete, denen das Reich Gerät überlassen kann. */
export const allies = (g: GameState) => Object.keys(g.eu!.rel).filter(c => c !== 'GER' && g.eu!.rel[c] === 'A' && !g.eu!.gone.includes(c) && COUNTRIES[c]);
/** Geliefertes Gerät eines Verbündeten, das noch nicht bei der Truppe ist (Schlüssel "Gattung:Generation"). */
export const storeOf = (g: GameState, c: string) => ((g.eu!.store ??= {})[c] ??= {});
/** Eigenes Heeresgerät auf Lager, über alle drei Lager. */
export const stockOf = (g: GameState, key: string) => POOLS.reduce((a, p) => a + (g.eu!.eco[p][key] ?? 0), 0);
/** Staffeln einer Gattung und Generation, die abgegeben werden können: nur solche, die keinem Sektor zugeteilt sind. */
export function airSpare(g: GameState, cat: AirCat, lvl: number) {
  const have = g.eu!.eco[AIR_KINDS[cat]][lvl] ?? 0;
  return Math.max(0, Math.min(have, cat === 'sb' ? sbFree(g) : airFree(g, 'GER')[cat === 'jg' ? 'f' : 'b']));
}
export const shipSpare = (g: GameState, k: ShipKind) => Math.floor(ensureNavy(g).own.H[k]);
/** Schiffe nimmt nur, wer selbst eine Flotte unterhält. */
export const hasFleet = (g: GameState, c: string) => !!fleetOf(g, c);

/** Heeresgerät übergeben; genommen wird zuerst aus dem Neulager, dann aus Umrüst- und Ersatzlager. */
export function giveGear(g: GameState, c: string, key: string, n: number) {
  const e = g.eu!.eco, st = storeOf(g, c);
  n = Math.min(Math.floor(n), Math.floor(stockOf(g, key)));
  for (const p of POOLS) {
    const take = Math.min(n, e[p][key] ?? 0);
    if (take <= 0) continue;
    e[p][key] -= take;
    st[key] = (st[key] ?? 0) + take;
    n -= take;
  }
}
/** Staffeln übergeben; strategische Bomber fliegen beim Verbündeten als Bomber. */
export function giveAir(g: GameState, c: string, cat: AirCat, lvl: number, n: number) {
  const eu = g.eu!, arr = eu.eco[AIR_KINDS[cat]];
  n = Math.min(Math.floor(n), airSpare(g, cat, lvl));
  if (n <= 0) return;
  arr[lvl] -= n;
  const a = (eu.airN[c] ??= { f: 0, b: 0 });
  a[cat === 'jg' ? 'f' : 'b'] += n;
  syncAir(g);
}
export function giveShips(g: GameState, c: string, k: ShipKind, n: number) {
  const navy = ensureNavy(g), to = navy.other[c];
  n = Math.min(Math.floor(n), shipSpare(g, k));
  if (!to || n <= 0) return;
  navy.own.H[k] -= n;
  to[k] += n;
}

/** Die Verbündeten verwenden geliefertes Gerät: erst Umrüstung, dann Ersatz, der Rest geht in neue Verbände. */
export function aidTick(g: GameState, days: number) {
  const eu = g.eu!;
  for (const c of Object.keys(eu.store ?? {})) {
    const st = eu.store![c];
    if (eu.rel[c] !== 'A' || eu.gone.includes(c)) { delete eu.store![c]; continue; }
    const units = g.divs.filter(d => d.nation === c && !d.oos).flatMap(d => d.units);
    for (const cat of GROUND)
      for (let lvl = MODELS[cat].length - 1; lvl >= 0; lvl--) {
        const k = `${cat}:${lvl}`;
        if (!st[k]) continue;
        // Umrüstung der ältesten Bataillone auf das gelieferte Muster
        for (const u of units.filter(u => TYPES[u.t].cat === cat && (TYPES[u.t].lvl ?? 0) < lvl).sort((a, b) => (TYPES[a.t].lvl ?? 0) - (TYPES[b.t].lvl ?? 0))) {
          const t = ladder(c, TYPES[u.t].base!)[lvl];
          if (st[k] < u.s || !t) break;
          st[k] -= u.s;
          u.t = t;
        }
        // Ersatz für angeschlagene Bataillone gleichen oder älteren Musters
        for (const u of units.filter(u => TYPES[u.t].cat === cat && (TYPES[u.t].lvl ?? 0) <= lvl && u.s < 10)) {
          const n = Math.min(10 - u.s, Math.floor(st[k]));
          u.s += n;
          st[k] -= n;
        }
      }
    // was die Truppe nicht braucht, rüstet neue Verbände aus
    let left = (AID_BUILD * days) / 7;
    for (const k of Object.keys(st)) {
      const n = Math.min(left, st[k]);
      st[k] -= n;
      left -= n;
      if (COUNTRIES[c]?.mob) eu.pts[c] = (eu.pts[c] ?? 0) + n * 1.3;
      if (st[k] < 0.5) delete st[k];
    }
    if (!Object.keys(st).length) delete eu.store![c];
  }
}

/**
 * Beute aus einer Kapitulation: 80 % der Waffen, Fahrzeuge, Flugzeuge und Schiffe sowie der Vorräte an Stahl, Öl
 * und Nachschub gehen an das Reich. Aufzurufen, bevor das Heer des Staates aufgelöst wird. Liefert den Meldungstext.
 * Die französische Flotte fällt nie in deutsche Hand (ships = false).
 */
export function loot(g: GameState, c: string, ships = true): string {
  const eu = g.eu!, e = eu.eco, navy = ensureNavy(g), parts: string[] = [];
  let gear = 0;
  for (const d of g.divs)
    if (d.nation === c)
      for (const u of d.units) {
        if (!TYPES[u.t].cat || !GROUND.includes(TYPES[u.t].cat as Cat)) continue;
        const k = stockKey(u.t), n = Math.round(u.s * LOOT);
        e.neu[k] = (e.neu[k] ?? 0) + n;
        gear += n;
      }
  if (gear) parts.push(`${gear} Stärkepunkte Waffen und Fahrzeuge`);
  // Beuteflugzeuge entsprechen einer Generation vor dem eigenen Stand
  const air = eu.airN[c];
  for (const [kind, cat] of [['f', 'jg'], ['b', 'bo']] as const) {
    const n = Math.floor((air?.[kind] ?? 0) * LOOT), lvl = Math.max(0, bestLvl(e, cat) - 1), arr = e[AIR_KINDS[cat]];
    if (!n) continue;
    arr[lvl] = (arr[lvl] ?? 0) + n;
    parts.push(`${n} ${kind === 'f' ? 'Jagd' : 'Bomber'}staffeln`);
  }
  const fleet = navy.other[c];
  if (fleet && ships) {
    const got = SHIP_KINDS.map(k => [k, Math.floor(fleet[k] * LOOT)] as const).filter(x => x[1] > 0);
    for (const [k, n] of got) navy.own.H[k] += n;
    if (got.length) parts.push(got.map(([k, n]) => `${n} ${n === 1 ? SHIPS[k].name : SHIPS[k].plural}`).join(', '));
  }
  if (fleet && ships) for (const k of SHIP_KINDS) fleet[k] = 0;
  // Vorräte: 45 Tage der Förderung des Stammlandes
  let steel = 0, oil = 0, ind = 0;
  for (const p of PLIST) if (p.country === c) (steel += p.steel ?? 0), (oil += p.oil ?? 0), (ind += p.ind ?? 0);
  const st = Math.round(steel * RESERVE_DAYS * LOOT), ol = Math.round(oil * RESERVE_DAYS * LOOT), su = Math.round(ind * 15 * LOOT);
  e.steel += st;
  e.oil += ol;
  e.sup += su;
  if (st + ol + su) parts.push(`Vorräte: ${st} Stahl, ${ol} Öl, ${su} Nachschub`);
  syncAir(g);
  return parts.length ? ` Beute: ${parts.join(' · ')}.` : '';
}

/**
 * Juni/Juli 1940: Die französische Flotte bleibt nach dem Waffenstillstand bei Vichy. Großbritannien will verhindern,
 * dass sie in deutsche Hand fällt (Operation Catapult, 3. Juli 1940): Die Schiffe in britischen Häfen werden beschlagnahmt,
 * das Geschwader in Alexandria wird stillgelegt, das in Mers-el-Kébir beschossen (Bretagne gesunken, Dunkerque und
 * Provence schwer getroffen, Strasbourg entkommt nach Toulon). Liefert den Meldungstext.
 */
export function frenchFleet(g: GameState): string {
  const eu = g.eu!, navy = ensureNavy(g), fr = navy.other.FRA;
  if (!fr) return '';
  const vic = (navy.other.VIC ??= { tr: 0, ub: 0, dd: 0, bb: 0, cv: 0 });
  const catapult = eu.rel.ENG === 'E' && !eu.gone.includes('ENG') && !!navy.other.ENG;
  // Anteile: [an Vichy, von Großbritannien beschlagnahmt]; der Rest ist versenkt oder stillgelegt
  const share: Record<ShipKind, [number, number]> = catapult
    ? { bb: [4 / 7, 2 / 7], cv: [0, 0], dd: [0.65, 0.2], ub: [0.65, 0.2], tr: [0.6, 0.4] }
    : { bb: [1, 0], cv: [1, 0], dd: [1, 0], ub: [1, 0], tr: [1, 0] };
  for (const k of SHIP_KINDS) {
    vic[k] += Math.round(fr[k] * share[k][0]);
    if (catapult) navy.other.ENG[k] += Math.round(fr[k] * share[k][1]);
    fr[k] = 0;
  }
  return catapult
    ? ' Die Flotte bleibt nach dem Waffenstillstand unter französischem Befehl. Um sie dem deutschen Zugriff zu entziehen, beschlagnahmt Großbritannien die Schiffe in seinen Häfen, legt das Geschwader in Alexandria still und beschießt am 3. Juli das Geschwader in Mers-el-Kébir: Die Bretagne sinkt, Dunkerque und Provence werden schwer getroffen, die Strasbourg entkommt nach Toulon. Kein französisches Kriegsschiff fällt an das Reich.'
    : ' Die Flotte bleibt nach dem Waffenstillstand unter dem Befehl der Regierung in Vichy; kein französisches Kriegsschiff fällt an das Reich.';
}
/** 27. November 1942: Beim Einmarsch in Südfrankreich versenkt sich die Flotte in Toulon selbst. */
export function scuttleToulon(g: GameState): string {
  const v = ensureNavy(g).other.VIC;
  if (!v || !SHIP_KINDS.some(k => v[k] > 0)) return '';
  for (const k of SHIP_KINDS) v[k] = 0;
  return ' Als deutsche Truppen den Kriegshafen Toulon erreichen, versenkt sich die französische Flotte selbst: 77 Schiffe, darunter drei Schlachtschiffe und sieben Kreuzer, gehen auf Grund.';
}
