// Ablaufsteuerung: Befehlsphase → eigene Schlachten → Zug der KI → Rundenabschluss.
import type { GameState, Side } from './core/types';
import { other } from './core/types';
import { MAX_TURNS, VP_TO_WIN, type PendingBattle, collectBattles, endTurn, estimate, newGame, strength, turnDate, vpStatus } from './core/game';
import { strategicAI } from './core/stratai';
import { finishBattle, startBattle } from './core/flow';
import { type Battle, autoResolve, losses } from './core/battle';
import { PROV, TERRAIN_NAME } from './data/world';
import { StratView } from './ui/stratview';
import { BattleView, airSituation } from './ui/battleview';
import { SIDE_NAME, esc } from './ui/draw';

const SAVE_KEY = 'feldzug1939';
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
  const v = vpStatus(g);
  $('date').innerHTML = `Runde <b>${Math.min(g.turn, MAX_TURNS)}</b>/${MAX_TURNS} · ${turnDate(Math.min(g.turn, MAX_TURNS))}`;
  $('vp').innerHTML = `Siegpunkte <b>${v.ger}</b>/${v.total} (Ziel ${VP_TO_WIN} + Warschau)`;
  $('phase').textContent = g.over ? 'Feldzug beendet' : busy ? 'Schlachten laufen …' : `${SIDE_NAME[g.player]} am Zug`;
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
    localStorage.setItem(SAVE_KEY, JSON.stringify(g));
  } catch { /* Speichern ist Komfort, kein Muss */ }
}

function menu() {
  const has = !!localStorage.getItem(SAVE_KEY);
  show(`<h2>Feldzug 1939</h2>
    <p>Der deutsche Angriff auf Polen ab dem 1. September 1939 als rundenbasierte Strategie: Divisionen auf der Provinzkarte, Regimenter und Abteilungen auf der Schlachtkarte. Eine Runde entspricht drei Tagen, der Feldzug endet nach ${MAX_TURNS} Runden am 6. Oktober.</p>
    <p class="dim">Deutschland gewinnt mit Warschau und ${VP_TO_WIN} Siegpunkten. Polen gewinnt, wenn Warschau bis zum Schluss hält.</p>
    <div class="row">
      <button class="primary" data-m="ger">Neues Spiel: Deutsches Reich</button>
      <button data-m="pol">Neues Spiel: Polen</button>
      ${has ? '<button data-m="load">Spielstand fortsetzen</button>' : ''}
      ${g ? '<button data-m="back">Zurück</button>' : ''}
    </div>
    <div class="hint">Spielstand wird zu Beginn jeder Runde im Browser gespeichert. Grafik und Zahlenwerte sind Platzhalter.</div>`, {
    ger: () => start(newGame('GER')),
    pol: () => start(newGame('POL')),
    load: () => start(JSON.parse(localStorage.getItem(SAVE_KEY)!)),
    back: () => {},
  });
}

function start(state: GameState) {
  g = state;
  // ältere Spielstände kennen noch keine Luftwaffe
  g.air ??= { GER: { f: 8, b: 12 }, POL: { f: 4, b: 3 } };
  g.airAssign ??= { GER: {}, POL: {} };
  // Divisionen in Befehlen und Schlachten werden per Referenz verglichen – nach dem Laden passt das von selbst
  busy = false;
  battleCv.hidden = true;
  mapCv.hidden = false;
  strat.sel = null;
  strat.selDivs.clear();
  refresh();
  if (g.over) gameOver();
  else if (g.player === 'POL' && g.turn === 1 && !g.log.length) aiPhase(() => ((busy = false), save(), refresh()));
}

// Polen zieht als Spieler nach dem deutschen Angriff: Runde = erst Deutschland, dann Polen.
function endPlayerPhase() {
  if (busy || g.over) return;
  busy = true;
  strat.select(null);
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
    localStorage.removeItem(SAVE_KEY);
    refresh();
    return gameOver();
  }
  if (g.player === 'GER') save();
  refresh();
}

function runBattles(queue: PendingBattle[], done: () => void) {
  autoAll = false;
  report = [];
  const next = () => {
    refresh();
    const pb = queue.shift();
    if (!pb) {
      if (!report.length) return done();
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
