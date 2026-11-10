// Ablaufsteuerung: Befehlsphase → eigene Schlachten → Zug der KI → Rundenabschluss.
import type { GameState, Side } from './core/types';
import { other } from './core/types';
import { MAX_TURNS, VP_TO_WIN, type PendingBattle, collectBattles, endTurn, estimate, newGame, strength, turnDate, vpStatus } from './core/game';
import { strategicAI } from './core/stratai';
import { finishBattle, resolveAuto, startBattle } from './core/flow';
import { type Battle, autoResolve, losses } from './core/battle';
import { PROV, TERRAIN_NAME, useWorld } from './data/world';
import { setTypeNames } from './data/units';
import { COUNTRIES } from './data/europa';
import { atWar, declareWar, euSupply, fmtDate, installEurope, newEurope, resolveChoice, uninstallEurope, vpEurope } from './core/europa';
import { euAI } from './core/euai';
import { openEco } from './ui/ecoview';
import { computeIK, migrateEco } from './core/economy';
import { bestLvl } from './core/economy';
import { StratView } from './ui/stratview';
import { BattleView, airSituation } from './ui/battleview';
import { SIDE_NAME, esc } from './ui/draw';

const SAVE_POLEN = 'feldzug1939', SAVE_EU = 'feldzug_eu';
const saveKey = () => (g?.eu ? SAVE_EU : SAVE_POLEN);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mapCv = $<HTMLCanvasElement>('map'), battleCv = $<HTMLCanvasElement>('battle');
const side = $('side'), modal = $('modal');

let g: GameState;
let busy = false; // während Schlachten und KI-Zug sind keine Befehle möglich
let autoAll = false;
let report: string[] = [];

const strat = new StratView(mapCv, side, () => g, () => busy || !!g.over, () => (refresh(), checkAllMoved()));
const battleView = new BattleView(battleCv, side, ask);

function ask(text: string, yes: () => void) {
  show(`<p>${esc(text)}</p><div class="row"><button class="primary" data-m="yes" data-enter>Ja</button><button data-m="no">Nein</button></div>`, { yes, no: () => {} });
}

/** Sind alle Verbände versorgt, einmal je Runde nachfragen, ob die Runde enden soll. */
function checkAllMoved() {
  if (busy || g.over || g.asked || !modal.hidden || strat.freeProvs().length) return;
  g.asked = true;
  ask('Alle Einheiten gezogen. Runde beenden?', endPlayerPhase);
}

function refresh() {
  if (!g) return;
  if (g.eu) {
    const e = g.eu.eco, v = vpEurope(g), bad = (k: string) => (e.short.includes(k) ? ' class="bad"' : '');
    $('date').innerHTML = `<b>${fmtDate(g.eu.day)}</b> · ${atWar(g) ? 'Krieg, Runde = 1 Woche' : 'Frieden, Runde = 1 Monat'}`;
    $('vp').innerHTML = `IK <b>${e.ik.toFixed(0)}</b> · <span${bad('steel')}>Stahl <b>${e.steel | 0}</b></span> · <span${bad('oil')}>Öl <b>${e.oil | 0}</b>/${e.tank}</span> · Mann <b>${e.men | 0}</b> · <span${bad('sup')}>Nachschub <b>${e.sup | 0}</b></span> · Siegpunkte <b>${v.axis}</b>/${v.total}`;
    const free = e.slots.filter(x => !x).length, stale = Object.keys(e.lines).filter(c => e.lines[c].lvl >= 0 && bestLvl(e, c) > e.lines[c].lvl).length;
    $('phase').textContent = g.over ? 'Spiel beendet' : busy ? 'Schlachten laufen …'
      : [free ? `${free} Forschungsplatz/-plätze frei` : '', stale ? `${stale} Linie(n) mit neuerem Muster` : ''].filter(Boolean).join(' · ');
  } else {
    const v = vpStatus(g);
    $('date').innerHTML = `Runde <b>${Math.min(g.turn, MAX_TURNS)}</b>/${MAX_TURNS} · ${turnDate(Math.min(g.turn, MAX_TURNS))}`;
    $('vp').innerHTML = `Siegpunkte <b>${v.ger}</b>/${v.total} (Ziel ${VP_TO_WIN} + Warschau)`;
    $('phase').textContent = g.over ? 'Feldzug beendet' : busy ? 'Schlachten laufen …' : `${SIDE_NAME[g.player]} am Zug`;
  }
  $<HTMLButtonElement>('btnEco').disabled = busy || !!g.over;
  $<HTMLButtonElement>('btnEnd').disabled = busy || !!g.over;
  if (!battleCv.hidden) return;
  strat.draw();
  strat.renderPanel();
}

function show(html: string, handlers: Record<string, () => void>) {
  modal.innerHTML = `<div class="box">${html}</div>`;
  modal.hidden = false;
  modal.onclick = e => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
    if (!k || !handlers[k]) return;
    modal.hidden = true;
    handlers[k]();
  };
}

function save() {
  try {
    localStorage.setItem(saveKey(), JSON.stringify(g));
  } catch { /* Speichern ist Komfort, kein Muss */ }
}

function menu() {
  const hasPl = !!localStorage.getItem(SAVE_POLEN), hasEu = !!localStorage.getItem(SAVE_EU);
  show(`<h2>Feldzug</h2>
    <div class="menu-card"><h3>Europa 1936</h3>
      <p class="dim">Das Deutsche Reich vom 1. Januar 1936 an: ganz Europa, Nordafrika und Vorderasien, Wirtschaft, Fertigung, Forschung und Nachschub. Im Frieden dauert eine Runde einen Monat, im Krieg eine Woche. Die historischen Ereignisse – Spanischer Bürgerkrieg, Anschluss Österreichs, Zerschlagung der Tschechoslowakei und weitere – treten zu ihren Stichtagen ein.</p>
      <div class="row"><button class="primary" data-m="eu">Neues Spiel: Deutsches Reich</button>${hasEu ? '<button data-m="loadEu">Spielstand fortsetzen</button>' : ''}</div></div>
    <div class="menu-card"><h3>Polenfeldzug 1939</h3>
      <p class="dim">Der deutsche Angriff auf Polen ab dem 1. September 1939 mit historischer Aufstellung. Eine Runde entspricht drei Tagen, der Feldzug endet nach ${MAX_TURNS} Runden am 6. Oktober. Deutschland gewinnt mit Warschau und ${VP_TO_WIN} Siegpunkten, Polen, wenn Warschau bis zum Schluss hält.</p>
      <div class="row"><button data-m="ger">Neues Spiel: Deutsches Reich</button><button data-m="pol">Neues Spiel: Polen</button>${hasPl ? '<button data-m="load">Spielstand fortsetzen</button>' : ''}</div></div>
    <div class="row">${g ? '<button data-m="back">Zurück</button>' : ''}</div>
    <div class="hint">Der Spielstand wird zu Beginn jeder Runde im Browser gespeichert. Grafik und Zahlenwerte sind Platzhalter.</div>`, {
    eu: () => (world(true), start(newEurope())),
    loadEu: () => start(JSON.parse(localStorage.getItem(SAVE_EU)!)),
    ger: () => (world(false), start(newGame('GER'))),
    pol: () => (world(false), start(newGame('POL'))),
    load: () => start(JSON.parse(localStorage.getItem(SAVE_POLEN)!)),
    back: () => {},
  });
}

/** Karte, Bezeichnungen und Regeln des Szenarios einschalten. */
function world(eu: boolean) {
  useWorld(eu ? 'europa' : 'polen');
  setTypeNames(eu);
  if (eu) installEurope();
  else uninstallEurope();
  Object.assign(SIDE_NAME, eu ? { GER: 'Achse', POL: 'Gegner' } : { GER: 'Deutsches Reich', POL: 'Polen' });
  $('title').textContent = eu ? 'Europa 1936' : 'Feldzug 1939';
  $('btnEco').hidden = !eu;
  strat.reload();
}

function start(state: GameState) {
  world(!!state.eu);
  if (state.eu) migrateEco(state.eu.eco), computeIK(state);
  g = state;
  // ältere Spielstände kennen noch keine Luftwaffe
  g.air ??= { GER: { f: 8, b: 12 }, POL: { f: 4, b: 3 } };
  g.airAssign ??= { GER: {}, POL: {} };
  // Divisionen in Befehlen und Schlachten werden per Referenz verglichen – nach dem Laden passt das von selbst
  busy = false;
  battleCv.hidden = true;
  mapCv.hidden = false;
  refresh();
  if (g.over) gameOver();
  else if (g.eu) showNews();
  else if (g.player === 'POL' && g.turn === 1 && !g.log.length) aiPhase(() => ((busy = false), save(), refresh()));
}

/** Europa: Meldungen und Entscheidungen der Reihe nach vorlegen. */
function showNews() {
  const n = g.eu?.news.shift();
  if (!n) return save(), refresh();
  const next = () => (refresh(), showNews());
  if (n.id)
    show(`<h2>${esc(n.title)}</h2><p>${esc(n.text)}</p><div class="row"><button class="primary" data-m="yes">${esc(n.yes!)}</button><button data-m="no">${esc(n.no!)}</button></div>`, {
      yes: () => (resolveChoice(g, n.id!, true), next()),
      no: () => (resolveChoice(g, n.id!, false), next()),
    });
  else show(`<h2>${esc(n.title)}</h2><p>${esc(n.text)}</p><div class="row"><button class="primary" data-m="ok" data-enter>Weiter</button></div>`, { ok: next });
}

function askWar(c: string) {
  if (busy || g.over || !g.eu) return;
  ask(`${COUNTRIES[c].name} den Krieg erklären? Das Heer des Landes wird sofort aufgestellt${c === 'SOV' ? '' : '; Großbritannien und Frankreich treten gegen das Reich in den Krieg ein, falls sie es noch nicht sind'}.`, () => {
    declareWar(g, c);
    euSupply(g);
    refresh();
    showNews();
  });
}

// Polen zieht als Spieler nach dem deutschen Angriff: Runde = erst Deutschland, dann Polen.
function endPlayerPhase() {
  if (busy || g.over) return;
  busy = true;
  strat.select(null);
  if (g.eu) {
    // erst die Verbündeten, dann alle Schlachten der Achse, dann der Gegner
    euAI(g, 'GER');
    return runBattles(collectBattles(g, 'GER'), () => {
      euAI(g, 'POL');
      runBattles(collectBattles(g, 'POL'), finishRound);
    });
  }
  runBattles(collectBattles(g, g.player), () => {
    if (g.player === 'GER') aiPhase(finishRound);
    else {
      finishRound();
      if (!g.over) aiPhase(() => ((busy = false), save(), refresh()));
    }
  });
}

function aiPhase(done: () => void) {
  busy = true;
  const ai = other(g.player);
  strategicAI(g, ai);
  runBattles(collectBattles(g, ai), done);
}

function finishRound() {
  endTurn(g);
  busy = false;
  if (g.over) {
    localStorage.removeItem(saveKey());
    refresh();
    return gameOver();
  }
  if (g.player === 'GER') save();
  refresh();
  if (g.eu) showNews();
}

function runBattles(queue: PendingBattle[], done: () => void) {
  autoAll = false;
  report = [];
  let others = 0;
  const mine = (pb: PendingBattle) => !g.eu || [...pb.attackers, ...pb.defenders].some(d => d.nation === 'GER');
  const next = () => {
    // Europa: Gefechte ohne deutsche Beteiligung laufen still im Hintergrund
    while (queue.length && !mine(queue[0])) if (resolveAuto(g, queue.shift()!)) others++;
    refresh();
    const pb = queue.shift();
    if (!pb) {
      if (others) report.push(`<span class="dim">${others} Gefechte ohne deutsche Beteiligung</span>`);
      if (!report.length || (others && report.length === 1)) return done();
      return show(`<h2>Gefechtsbericht</h2>${report.map(r => `<div>${r}</div>`).join('')}<div class="row"><button class="primary" data-m="ok" data-enter>Weiter</button></div>`, { ok: done });
    }
    const b = startBattle(g, pb);
    if (!b) return next();
    const auto = () => {
      autoResolve(b);
      conclude(pb, b, next, !autoAll);
    };
    if (autoAll) return auto();
    prompt(pb, b, {
      manual: () => {
        mapCv.hidden = true;
        battleCv.hidden = false;
        battleView.open(b, g.player, () => {
          battleCv.hidden = true;
          mapCv.hidden = false;
          conclude(pb, b, next, true);
        });
      },
      auto,
      all: () => ((autoAll = true), auto()),
    });
  };
  next();
}

function prompt(pb: PendingBattle, b: Battle, h: Record<string, () => void>) {
  const p = PROV[pb.prov];
  const list = (ds: typeof pb.attackers, extra: number) =>
    ds.map(d => `<div class="div ${d.side}"><label>${esc(d.name)}</label><div class="meta">Stärke ${d.side === g.player ? `${strength(d)}/${d.units.length * 10}` : `ca. ${estimate(d, g.turn)}`}${d.dug && d.side !== pb.side ? ` · eingegraben ${d.dug}` : ''}${d.oos ? ' · <span class="bad">abgeschnitten</span>' : ''}</div></div>`).join('') +
    (extra ? `<div class="dim">+ ${extra} weitere in Reserve</div>` : '');
  const est = (ds: typeof pb.attackers) => ds.reduce((a, d) => a + (d.side === g.player ? strength(d) : estimate(d, g.turn)), 0);
  const ratio = est(pb.attackers) / est(pb.defenders);
  show(`<h2>Schlacht um ${esc(p.name)}</h2>
    <div class="dim">${TERRAIN_NAME[p.terrain]}${p.river ? ' · Fluss' : ''} · Kräfteverhältnis etwa ${ratio.toFixed(1)} : 1 · ${pb.side === g.player ? 'Sie greifen an' : 'Sie verteidigen'}</div>
    <div class="${b.sup === other(g.player) ? 'bad' : ''}"><b>${airSituation(b, g.player)}</b> <span class="dim">Jäger ${b.fighters[g.player]} : ${b.fighters[other(g.player)]} · eigene Bomberstaffeln ${b.bombers[g.player]}</span></div>
    <div class="cols"><div><h3>Angreifer</h3>${list(pb.attackers, pb.followers.length)}</div><div><h3>Verteidiger</h3>${list(pb.defenders, pb.reserve.length)}</div></div>
    <div class="row">
      <button class="primary" data-m="manual">Schlacht selbst führen</button>
      <button data-m="auto">Auto-Resolve</button>
      <button data-m="all">Alle übrigen automatisch</button>
    </div>`, h);
}

function conclude(pb: PendingBattle, b: Battle, next: () => void, showResult: boolean) {
  finishBattle(g, pb, b);
  const won = b.winner === g.player;
  const line = `<b class="${won ? '' : 'bad'}">${esc(PROV[pb.prov].name)}</b>: ${won ? 'Sieg' : 'Niederlage'} – Verluste ${SIDE_NAME[g.player]} ${losses(b, g.player)}, ${SIDE_NAME[other(g.player)]} ${losses(b, other(g.player))}${b.lostB[g.player] + b.lostF[g.player] ? ` · <span class="bad">${b.lostB[g.player] + b.lostF[g.player]} Staffel(n) verloren</span>` : ''}`;
  if (!showResult) {
    report.push(line);
    return next();
  }
  refresh();
  show(`<h2>${won ? 'Sieg' : 'Niederlage'} bei ${esc(PROV[pb.prov].name)}</h2><p>${esc(b.reason)}</p><p>${line}</p>
    <div class="row"><button class="primary" data-m="ok" data-enter>Weiter</button></div>`, { ok: next });
}

function gameOver() {
  const o = g.over!;
  show(`<h2>${o.winner === g.player ? 'Sieg' : 'Niederlage'}</h2><p>${esc(o.text)}</p>
    <div class="row"><button class="primary" data-m="menu">Neues Spiel</button><button data-m="look">Karte ansehen</button></div>`, { menu, look: () => {} });
}

$('btnEnd').onclick = endPlayerPhase;
window.addEventListener('keydown', e => {
  if (!g) return;
  if (!modal.hidden) {
    // Enter bestätigt nur harmlose Rückfragen, nie Menü oder Schlachtauswahl
    if (e.key === 'Enter') (e.preventDefault(), modal.querySelector<HTMLElement>('[data-enter]')?.click());
    return;
  }
  const k = e.key === 'Tab' ? 'tab' : e.key === ' ' ? 'space' : e.key === 'Enter' ? 'enter' : null;
  if (!k) return;
  e.preventDefault();
  if (!battleCv.hidden) return battleView.key(k);
  if (busy || g.over) return;
  if (k === 'tab') strat.nextFree();
  else if (k === 'space') strat.skip();
  else endPlayerPhase();
});
$('btnMenu').onclick = menu;
$('btnEco').onclick = () => {
  if (g?.eu && !busy && !g.over) openEco(modal, g, { prov: strat.sel, done: refresh, war: askWar });
};
strat.onWar = askWar;
$('btnView').onclick = () => {
  strat.mode = strat.mode === 'air' ? 'ground' : 'air';
  // der Knopf nennt immer die Ansicht, zu der er wechselt
  $('btnView').textContent = strat.mode === 'air' ? 'Bodenansicht' : 'Luftansicht';
  refresh();
};
window.addEventListener('resize', () => (battleCv.hidden ? refresh() : battleView.refresh()));
// für Tests und Fehlersuche in der Konsole
Object.assign(window, { feldzug: { get g() { return g; }, strat, battleView, endPlayerPhase } });
menu();
