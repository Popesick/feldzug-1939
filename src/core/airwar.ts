// Kampf um den Luftraum und strategischer Bombenkrieg.
import type { GameState, Side } from './types';
import { PLIST, PROV } from '../data/world';
import { MODELS } from '../data/units';
import { RNG } from './rng';
import { airAt, airLoss, log } from './game';

/**
 * Lufthoheit: own = Jäger dessen, der den Luftraum verteidigt, foe = Jäger der Gegenseite.
 * eff = Wirkung der gegnerischen Bomber (1, 0,75 oder 0,5); killB und killF = erwartete Abschüsse
 * von Bombern und Jägern durch die eigenen Jäger in Überzahl (10 % bzw. 5 % je Jäger,
 * doppelt bei doppelter, dreifach bei dreifacher Übermacht).
 */
export function airEdge(own: number, foe: number) {
  const eff = own <= 0 ? 1 : own >= foe ? 0.5 : own >= foe / 2 ? 0.75 : 1;
  const over = Math.max(0, own - foe), mult = foe <= 0 || own >= 3 * foe ? 3 : own >= 2 * foe ? 2 : 1;
  return { eff, killB: over * 0.1 * mult, killF: over * 0.05 * mult };
}
/** Erwartungswert in ganze Abschüsse umsetzen: der Bruchteil ist die Wahrscheinlichkeit für einen weiteren. */
export const roll = (rng: RNG, x: number) => Math.floor(x) + (rng.next() < x % 1 ? 1 : 0);

// ---- Strategische Bomber ----------------------------------------------------

export const BOMB_IK = 0.1; // zerstörte IK je Staffel und Woche
export const BOMB_RANGE = 1500; // km vom nächsten eigenen Gebiet
const sum = (a: number[]) => a.reduce((x, y) => x + (y ?? 0), 0);

export const sbTotal = (g: GameState) => sum((g.eu!.eco.airS ??= []));
export const sbFree = (g: GameState) => sbTotal(g) - sum(Object.values((g.eu!.bomb ??= {})));
/** Schlagkraft der eigenen strategischen Bomber nach Muster. */
export function sbQ(g: GameState) {
  const a = (g.eu!.eco.airS ??= []), n = sum(a);
  return n ? a.reduce((x, k, i) => x + (k ?? 0) * (MODELS.sb[i].q ?? 1), 0) / n : 1;
}
export const damageAt = (g: GameState, prov: string) => g.eu?.dmg?.[prov] ?? 0;
export const indLeft = (g: GameState, prov: string) => Math.max(0, (PROV[prov].ind ?? 0) - damageAt(g, prov));

function dist(a: string, b: string) {
  const [la1, lo1] = PROV[a].ll!, [la2, lo2] = PROV[b].ll!, r = Math.PI / 180;
  const h = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export const inBombRange = (g: GameState, prov: string, side: Side) => PLIST.some(p => g.ctrl[p.id] === side && dist(p.id, prov) <= BOMB_RANGE);
/** Ziel für die eigenen strategischen Bomber: feindliche Industrie in Reichweite. */
export const canBomb = (g: GameState, prov: string) => !!g.eu && g.ctrl[prov] === 'POL' && (PROV[prov].ind ?? 0) > 0 && inBombRange(g, prov, 'GER');

export function setBomb(g: GameState, prov: string, n: number) {
  const b = (g.eu!.bomb ??= {}), cur = b[prov] ?? 0;
  n = Math.max(0, Math.min(Math.round(n), cur + sbFree(g)));
  if (n && canBomb(g, prov)) b[prov] = n;
  else delete b[prov];
}

function hit(g: GameState, prov: string, ik: number) {
  const d = (g.eu!.dmg ??= {}), done = Math.min(ik, indLeft(g, prov));
  if (done > 0) d[prov] = (d[prov] ?? 0) + done;
  return done;
}

/** Stellt zerstörte Industrie im eigenen Gebiet wieder her, die am schwersten getroffenen Orte zuerst. */
export function repair(g: GameState, ik: number) {
  const d = (g.eu!.dmg ??= {});
  for (const id of Object.keys(d).filter(id => g.eu!.owner[id] === 'GER').sort((a, b) => d[b] - d[a])) {
    const n = Math.min(ik, d[id]);
    d[id] -= n;
    ik -= n;
    if (d[id] < 0.005) delete d[id];
    if (ik <= 0) break;
  }
}

/** Ein Rundenabschnitt des Bombenkriegs: Aufbau der gegnerischen Bomberflotten, eigene und feindliche Angriffe. */
export function bombTick(g: GameState, days: number, war: boolean) {
  const eu = g.eu!, e = eu.eco, w = days / 7, year = 1936 + eu.day / 365.25;
  const rng = new RNG((g.seed + eu.day * 977 + 5) >>> 0);
  const en = (c: string) => eu.rel[c] === 'E' && !eu.gone.includes(c);
  const dmg = (eu.dmg ??= {}), bomb = (eu.bomb ??= {}), sbN = (eu.sbN ??= {});
  e.rate.bombed = 0;
  eu.raid = {};
  // was der Gegner selbst repariert
  for (const id of Object.keys(dmg)) if (eu.owner[id] !== 'GER' && (dmg[id] -= 0.15 * w) <= 0) delete dmg[id];
  if (!war) return;

  // Bomber Command ab 1940, die 8. US-Luftflotte ab 1942
  const grow = (c: string, from: number, per: number, cap: number) => {
    if (en(c) && year >= from && (sbN[c] ?? 0) < cap && rng.next() < days / 30) sbN[c] = Math.min(cap, (sbN[c] ?? 0) + per);
  };
  grow('ENG', 1940, year >= 1942 ? 2 : 1, year >= 1943 ? 30 : 20);
  grow('USA', 1942, year >= 1943 ? 3 : 2, year >= 1944 ? 40 : 25);

  // eigene Angriffe
  let lostOwn = 0, done = 0;
  for (const [prov, n0] of Object.entries(bomb)) {
    if (!canBomb(g, prov)) { delete bomb[prov]; continue; }
    const n = Math.min(n0, sbTotal(g)), mine = airAt(g, 'GER', prov).f, theirs = airAt(g, 'POL', prov).f, edge = airEdge(theirs, mine);
    done += hit(g, prov, n * BOMB_IK * w * edge.eff * sbQ(g));
    const lost = Math.min(n, roll(rng, edge.killB * w));
    for (let k = lost; k > 0; k--) {
      const i = e.airS.findIndex(x => x > 0);
      if (i >= 0) e.airS[i]--;
    }
    lostOwn += lost;
    if ((bomb[prov] = n - lost) <= 0) delete bomb[prov];
    airLoss(g, 'GER', prov, 'f', Math.min(mine, roll(rng, edge.killF * w)));
    airLoss(g, 'POL', prov, 'f', Math.min(theirs, roll(rng, airEdge(mine, theirs).killF * w)));
  }
  if (done > 0.05) log(g, `Strategische Bomber zerstören ${done.toFixed(1).replace('.', ',')} IK beim Gegner${lostOwn ? `, ${lostOwn} Staffel(n) gehen verloren` : ''}.`);
  else if (lostOwn) log(g, `${lostOwn} Staffel(n) strategischer Bomber gehen verloren.`);

  // feindliche Angriffe auf die Industrie des Reichs; Stützpunkt ist Großbritannien
  const fleet = en('ENG') ? Object.keys(sbN).filter(en).reduce((a, c) => a + sbN[c], 0) : 0;
  if (fleet <= 0) return;
  const targets = PLIST.filter(p => eu.owner[p.id] === 'GER' && g.ctrl[p.id] === 'GER' && indLeft(g, p.id) > 0.05 && inBombRange(g, p.id, 'POL'))
    .sort((a, b) => indLeft(g, b.id) - indLeft(g, a.id)).slice(0, 3);
  let shot = 0, lostF = 0;
  targets.forEach((p, i) => {
    const n = Math.floor(fleet / targets.length) + (i < fleet % targets.length ? 1 : 0);
    if (!n) return;
    eu.raid![p.id] = n;
    // ab 1944 begleiten Langstreckenjäger die Verbände bis ins Reich
    const real = airAt(g, 'POL', p.id).f, esc = real + (year >= 1944 ? Math.round(n / 2) : 0), def = airAt(g, 'GER', p.id).f, edge = airEdge(def, esc);
    e.rate.bombed += hit(g, p.id, n * BOMB_IK * w * edge.eff);
    let down = Math.min(n, roll(rng, edge.killB * w));
    shot += down;
    for (; down > 0; down--) {
      const c = Object.keys(sbN).filter(c => en(c) && sbN[c] > 0).sort((a, b) => sbN[b] - sbN[a])[0];
      if (c) sbN[c]--;
    }
    airLoss(g, 'POL', p.id, 'f', Math.min(real, roll(rng, edge.killF * w)));
    const lf = Math.min(def, roll(rng, airEdge(esc, def).killF * w));
    airLoss(g, 'GER', p.id, 'f', lf);
    lostF += lf;
  });
  if (e.rate.bombed > 0.05 || shot)
    log(g, `Bombenangriffe auf ${Object.keys(eu.raid).map(id => PROV[id].name).join(', ')}: −${e.rate.bombed.toFixed(1).replace('.', ',')} IK${shot ? `, ${shot} Bomberstaffel(n) abgeschossen` : ''}${lostF ? `, ${lostF} eigene Jagdstaffel(n) verloren` : ''}.`);
  if (e.rate.bombed > 0.05 && !eu.flags.bombwar) {
    eu.flags.bombwar = eu.day + 1;
    eu.news.push({ title: 'Bomben auf das Reich', text: 'Feindliche Bomberverbände greifen die Industrie des Reichs an. Jede Staffel zerstört etwa 0,1 IK je Woche. Jäger über den getroffenen Provinzen (Luftansicht) halbieren die Wirkung, sobald sie den Begleitjägern mindestens gleichkommen, und schießen Bomber ab. Zerstörte Industrie lässt sich unter Reich verwalten → Produktion → „Industrie reparieren“ wieder aufbauen.' });
  }
}
