// Strategische KI des Europa-Szenarios: führt alle Staaten außer dem Deutschen Reich.
import type { Division, GameState, Side } from './types';
import { other } from './types';
import { PLIST, PROV } from '../data/world';
import { STACK, assignAir, defenseMult, divPower, divsIn, moveTargets, orderMove, tp } from './game';
import { type Pick, assignAirAI, distMap, planAttacks, sumPower } from './stratai';
import { yearOfDay } from './economy';
import { EAST_AXIS } from '../data/europa';
import { dayOf } from './europa';

/** Bewegungen: leeres Feindgebiet besetzen, Aussichtsloses räumen, Reserven an die Front. */
function moves(g: GameState, side: Side, pick: Pick, allow: (prov: string) => boolean) {
  const en = other(side), own = (id: string) => g.ctrl[id] === side;
  const front = PLIST.filter(p => own(p.id) && p.adj.some(a => g.ctrl[a] === en)).map(p => p.id);
  if (!front.length) return;
  const toFront = distMap(g, front, own);
  const rear = PLIST.filter(p => own(p.id) && p.vp >= 2).map(p => p.id);
  const toRear = distMap(g, rear, own);
  for (const d of g.divs) {
    if (d.side !== side || !pick(d) || d.order || tp(d).mp === 0) continue;
    for (let step = 0; step < 2 && d.mp > 0; step++) {
      const p = PROV[d.prov], mates = divsIn(g, p.id, side);
      const foes = p.adj.filter(a => g.ctrl[a] === en);
      const threat = sumPower(foes.flatMap(a => divsIn(g, a, en)));
      const keep = p.vp > 0 && mates.filter(m => tp(m).mp > 0 || m === d).length <= 1; // wichtige Orte nie ganz entblößen
      let to: string | undefined;
      const empty = foes.filter(a => allow(a) && !divsIn(g, a, en).length).sort((a, b) => PROV[b].vp - PROV[a].vp)[0];
      if (empty && !keep) to = empty;
      else if (threat > sumPower(mates) * defenseMult(p.id) * 3.5 && p.vp < 2) {
        const here = toRear[p.id] ?? 99;
        to = p.adj.filter(a => own(a) && divsIn(g, a, side).length < STACK && (toRear[a] ?? 99) < here)[0];
      } else if (!foes.length && !keep) {
        const here = toFront[p.id] ?? 99;
        to = p.adj.filter(a => own(a) && divsIn(g, a, side).length < STACK - 1 && (toFront[a] ?? 99) < here).sort((a, b) => divsIn(g, a, side).length - divsIn(g, b, side).length)[0];
      }
      if (!to || !orderMove(g, d, to)) break;
    }
  }
}

/** Landungen über See: ein starker Stapel in einem Hafen greift eine schwach besetzte Küstenprovinz an. */
function landings(g: GameState, side: Side, pick: Pick, ocean: boolean) {
  const eu = g.eu!, year = yearOfDay(eu.day), en = other(side);
  if (side === 'GER' || eu.rel.USA !== 'E' || eu.day % 28 >= 7) return;
  // Pazifik und Indischer Ozean bilden einen eigenen Kriegsschauplatz mit eigenem Zeitplan
  const far = (id: string) => ![...PROV[id].sea!].some(s => s !== 'Z' && s !== 'I');
  for (const p of PLIST) {
    if (!p.port || g.ctrl[p.id] !== side) continue;
    const stack = divsIn(g, p.id, side).filter(d => pick(d) && tp(d).mp > 0 && d.mp > 0 && !d.order && !d.moved);
    if (stack.length < 4) continue;
    const force = stack.sort((a, b) => divPower(b) - divPower(a)).slice(0, ocean ? 6 : 5);
    const opts = moveTargets(g, force[0]).filter(t => t.kind === 'sea' && g.ctrl[t.prov] === en)
      // Mittelmeer ab Ende 1942, Atlantikküste erst ab Mitte 1943
      .filter(t => far(t.prov) === ocean)
      .filter(t => (ocean ? eu.day > dayOf(1942, 8, 1) && (PROV[t.prov].country !== 'JAP' || (PROV[t.prov].flags ?? '').includes('k') || year >= 1945)
        : PROV[t.prov].sea!.includes('M') ? eu.day > 2500 : year >= 1944 || eu.day > 2740))
      .map(t => ({ t, def: sumPower(divsIn(g, t.prov, en).slice(0, 3)) * defenseMult(t.prov) }))
      .sort((a, b) => a.def - b.def);
    const best = opts[0];
    if (!best || sumPower(force.slice(0, 3)) < best.def * (ocean ? 1.4 : 1.8)) continue;
    for (const d of force) orderMove(g, d, best.t.prov);
    return;
  }
}

const kmLL = (a: string, b: string) => {
  const [la1, lo1] = PROV[a].ll!, [la2, lo2] = PROV[b].ll!, r = Math.PI / 180;
  const h = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
/** Küste von der Bretagne bis Holland: dort versucht Großbritannien, Brückenköpfe zu bilden. */
const channelCoast = (id: string) => {
  const p = PROV[id];
  return ['FRA', 'BEL', 'NLD'].includes(p.country) && !(p.flags ?? '').includes('k') && !!p.sea && p.ll![0] > 46.5 && [...p.sea].some(s => s === 'N');
};

/**
 * Britische Expeditionstruppen: Solange die Achse die Kanalküste hält, sammelt Großbritannien Verbände in den
 * Häfen Südenglands und setzt alle paar Wochen über, wo die Küste am schwächsten besetzt ist. Hält es schon einen
 * Hafen drüben, wird der Brückenkopf verstärkt.
 */
function expeditions(g: GameState, pick: Pick) {
  const eu = g.eu!;
  if (eu.rel.ENG !== 'E' || eu.gone.includes('ENG') || !PROV.london) return;
  const coast = PLIST.filter(p => channelCoast(p.id));
  if (!coast.some(p => g.ctrl[p.id] === 'GER')) return;
  const home = (id: string) => PROV[id].country === 'ENG' && !(PROV[id].flags ?? '').includes('k') && g.ctrl[id] === 'POL';
  const brit = (d: Division) => d.nation === 'ENG' && pick(d) && tp(d).mp > 0;
  const ports = PLIST.filter(p => home(p.id) && p.port && [...(p.sea ?? '')].includes('N'))
    .sort((a, b) => Math.min(...coast.map(c => kmLL(a.id, c.id))) - Math.min(...coast.map(c => kmLL(b.id, c.id)))).slice(0, 2).map(p => p.id);
  if (!ports.length) return;
  // sammeln: was auf der Insel entbehrlich ist, zieht in die Einschiffungshäfen
  const toPort = distMap(g, ports, home);
  for (const d of g.divs) {
    if (!brit(d) || !home(d.prov) || d.order || d.mp < 1 || ports.includes(d.prov)) continue;
    const p = PROV[d.prov];
    if (p.vp > 0 && divsIn(g, p.id, 'POL').filter(brit).length <= 2) continue; // die Städte behalten ihre Besatzung
    const to = p.adj.filter(a => home(a) && divsIn(g, a, 'POL').length < STACK && (toPort[a] ?? 99) < (toPort[p.id] ?? 99))[0];
    if (to) orderMove(g, d, to);
  }
  if (eu.day % 21 >= 7) return;
  for (const port of ports) {
    const stack = divsIn(g, port, 'POL').filter(d => brit(d) && d.mp > 0 && !d.order && !d.moved).sort((a, b) => divPower(b) - divPower(a));
    if (stack.length < 3) continue;
    const force = stack.slice(0, Math.min(6, stack.length - 1));
    const sea = moveTargets(g, force[0]).filter(t => t.kind === 'sea' && channelCoast(t.prov));
    // Brückenkopf verstärken, solange er Platz hat
    const held = sea.filter(t => !t.attack && g.ctrl[t.prov] === 'POL' && PROV[t.prov].adj.some(a => g.ctrl[a] === 'GER'))
      .sort((a, b) => divsIn(g, a.prov, 'POL').length - divsIn(g, b.prov, 'POL').length)[0];
    if (held) {
      for (const d of force.slice(0, STACK - divsIn(g, held.prov, 'POL').length)) orderMove(g, d, held.prov);
      continue;
    }
    const best = sea.filter(t => g.ctrl[t.prov] === 'GER')
      .map(t => ({ t, def: sumPower(divsIn(g, t.prov, 'GER').sort((a, b) => divPower(b) - divPower(a)).slice(0, 3)) * defenseMult(t.prov) }))
      .sort((a, b) => a.def - b.def)[0];
    if (!best || sumPower(force.slice(0, 3)) < best.def * 1.3) continue;
    for (const d of force) orderMove(g, d, best.t.prov);
  }
}

/** Luftwaffe der Gegner: Bomber geballt über den eigenen Angriffen, Jäger dort und über den bedrohten Abschnitten. */
function airFocus(g: GameState, side: Side) {
  const en = other(side);
  const attacks = [...new Set(g.divs.filter(d => d.side === side && d.order).map(d => d.order!))]
    .sort((a, b) => sumPower(divsIn(g, b, en)) + PROV[b].vp * 100 - (sumPower(divsIn(g, a, en)) + PROV[a].vp * 100));
  if (!attacks.length) return assignAirAI(g, side, false);
  const threat = (id: string) => PROV[id].vp * 100 + sumPower(PROV[id].adj.flatMap(a => divsIn(g, a, en)));
  const held = PLIST.filter(p => g.ctrl[p.id] === side && divsIn(g, p.id, side).length && p.adj.some(a => divsIn(g, a, en).length)).map(p => p.id)
    .sort((a, b) => threat(b) - threat(a)).slice(0, 6);
  const focus = attacks.slice(0, 3);
  g.airAssign[side] = {};
  for (let i = 0; i < g.air[side].b; i++) assignAir(g, side, focus[i % focus.length], 'b', 1);
  const spots = [...focus, ...focus, ...held];
  for (let i = 0; i < g.air[side].f; i++) assignAir(g, side, spots[i % spots.length], 'f', 1);
}

/** Zug aller KI-Staaten einer Seite. Auf der Achsenseite bleiben die deutschen Verbände dem Spieler (all = Probelauf). */
export function euAI(g: GameState, side: Side, all = false) {
  // dem Spieler unterstellte Verbände der Verbündeten rührt die KI nicht an
  // Spanischer Bürgerkrieg: in jeder Provinz bleibt ein Verband als Besatzung stehen, sonst läuft der Gegner ins Leere hinein
  const hold = new Set<number>();
  if ((g.eu!.flags.civil ?? 0) > 0)
    for (const p of PLIST) {
      if (p.country !== 'SPA' || g.ctrl[p.id] !== side) continue;
      const first = divsIn(g, p.id, side).filter(d => d.nation !== 'GER').sort((a, b) => a.id - b.id)[0];
      if (first) hold.add(first.id);
    }
  const pick: Pick = (d: Division) => !hold.has(d.id) && (all || side !== 'GER' || !(d.nation === 'GER' || d.ctl));
  const year = yearOfDay(g.eu!.day);
  const need = side === 'GER' ? 1.3 : year < 1942 ? 1.5 : year < 1943 ? 1.35 : 1.2;
  // Bis 1943 (Rote Armee: 1942) bleiben die Gegner des Reichs in der Verteidigung: Sie holen verlorenes Gebiet zurück
  // und kämpfen in den Kolonien, tragen den Krieg aber nicht in die Stammländer der Achse.
  const AXIS = ['GER', 'AUT', 'CSR', 'ITA', 'HUN', 'ROM', 'BUL', 'FIN', 'DZG', ...EAST_AXIS];
  const allow = (id: string) => side === 'GER' || year >= 1943 || !AXIS.includes(PROV[id].country) || (PROV[id].flags ?? '').includes('k')
    || (year >= 1942 && g.eu!.rel.SOV === 'E' && PROV[id].ll![1] > 20 && PROV[id].ll![1] < 60);
  // Waffenruhe zwischen Japans Machtbereich und der Sowjetunion (Neutralitätspakt)
  const owner = g.eu!.owner, truce = true, RED = ['SOV', 'MON'];
  const apart = side === 'GER' ? EAST_AXIS : RED, them = side === 'GER' ? RED : EAST_AXIS;
  // Japans Vorstoß endet, wo der Nachschub endet: vor dem chinesischen Bergland und an der Grenze Indiens
  const inReach = (id: string) => {
    const p = PROV[id];
    return !(p.country === 'CHI' && p.ll![1] < 109.5) && !(p.country === 'IND' && p.ll![1] < 93) && !['TIB', 'NEP'].includes(p.country);
  };
  // Die Rote Armee führt den Krieg vom ersten Tag an offensiv: Sie greift schon bei knapper Überlegenheit an,
  // sucht die schwächsten Stellen der Front und macht vor den Grenzen der Achse nicht halt.
  const red = side === 'POL';
  const groups: [Pick, (id: string) => boolean, number][] = [
    [d => pick(d) && !apart.includes(d.nation), allow, need],
    [d => pick(d) && apart.includes(d.nation), id => (red || allow(id)) && !(truce && them.includes(owner[id])) && (side !== 'GER' || inReach(id)), side === 'GER' ? 1.7 : 1.25],
  ];
  landings(g, side, pick, false);
  landings(g, side, pick, true);
  if (side === 'POL') expeditions(g, pick);
  // Japans Heer ist in China gebunden und greift nur mit deutlicher Überlegenheit an
  for (const [pk, al, nd] of groups) planAttacks(g, side, nd, false, pk, al, side === 'POL');
  if (side === 'POL') airFocus(g, side);
  else if (all) assignAirAI(g, side, true);
  for (const [pk, al] of groups) moves(g, side, pk, al);
}
