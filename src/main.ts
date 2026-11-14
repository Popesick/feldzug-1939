// Ablaufsteuerung: Befehlsphase → eigene Schlachten → Zug der KI → Rundenabschluss.
import type { GameState, Side } from './core/types';
import { other } from './core/types';
import { BATTLE_MAX, MAX_TURNS, VP_TO_WIN, XP_LEVELS, type PendingBattle, collectBattles, divPower, maxS, maxStrength, tp, xpLevel, endTurn, runFollows, estimate, newGame, strength, turnDate, vpStatus } from './core/game';
import { strategicAI } from './core/stratai';
import { finishBattle, resolveAuto, startBattle } from './core/flow';
import { type Battle, autoResolve, losses } from './core/battle';
import { PROV, type Scenario, TERRAIN_NAME, preload, useWorld } from './data/world';
import { TYPES, setTypeNames } from './data/units';
import { armyOf, inTransfer, rankName, traitText } from './core/army';
import { GENERAL } from './data/generals';
import type { Division } from './core/types';
import { COUNTRIES } from './data/europa';
import { atWar, declareWar, euSupply, fmtDate, installEurope, newEurope, resolveChoice, uninstallEurope, vpEurope } from './core/europa';
import { euAI } from './core/euai';
import { openEco } from './ui/ecoview';
import { computeIK, migrateEco } from './core/economy';
import { bestLvl, researchable } from './core/economy';
import { StratView } from './ui/stratview';
import { BattleView, airSituation } from './ui/battleview';
import { SIDE_NAME, esc } from './ui/draw';

const SAVE_POLEN = 'feldzug1939', SAVE_EU = 'feldzug_eu', SAVE_WELT = 'feldzug_welt';
const saveKey = () => (g?.eu ? (g.eu.flags.world ? SAVE_WELT : SAVE_EU) : SAVE_POLEN);
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
    const stat = (label: string, val: string, k = '', title = '') => `<span class="stat${bad(k) ? ' bad' : ''}${k === 'gold' ? ' gold' : ''}" title="${title}"><i>${label}</i><b>${val}</b></span>`;
    $('date').innerHTML = `<b>${fmtDate(g.eu.day)}</b><small>${atWar(g) ? 'Krieg · Wochenrunden' : 'Frieden · Monatsrunden'}</small>`;
    $('vp').innerHTML = stat('IK', e.ik.toFixed(0), '', 'Industriekapazität') + stat('Stahl', `${e.steel | 0}`, 'steel') + stat('Öl', `${e.oil | 0}<small> / ${e.tank}</small>`, 'oil', 'Vorrat / Tanklager')
      + stat('Mann', `${e.men | 0}`, '', 'Mannschaften in Tausend') + stat('Nachschub', `${e.sup | 0}`, 'sup') + stat('Siegpunkte', `${v.axis}<small> / ${v.total}</small>`, 'gold');
    const free = e.slots.filter(x => !x).length, stale = Object.keys(e.lines).filter(c => e.lines[c].lvl >= 0 && bestLvl(e, c) > e.lines[c].lvl).length;
    // Ausrufezeichen am Knopf, solange ein Forschungsplatz leer steht und es noch etwas zu erforschen gibt
    const idle = free > 0 && researchable(e).some(t => !e.slots.includes(t));
    $('btnEco').innerHTML = `Reich verwalten${idle ? '<span class="alert" title="Forschungsplatz frei">!</span>' : ''}`;
    $('phase').innerHTML = g.over ? 'Spiel beendet' : busy ? 'Schlachten laufen …'
      : [free ? `${free} ${free === 1 ? 'Forschungsplatz' : 'Forschungsplätze'} frei` : '', stale ? `${stale} ${stale === 1 ? 'Linie' : 'Linien'} mit neuerem Muster` : ''].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
  } else {
    const v = vpStatus(g);
    $('date').innerHTML = `<b>${turnDate(Math.min(g.turn, MAX_TURNS))}</b><small>Runde ${Math.min(g.turn, MAX_TURNS)} von ${MAX_TURNS}</small>`;
    $('vp').innerHTML = `<span class="stat gold" title="Ziel: ${VP_TO_WIN} Siegpunkte und Warschau"><i>Siegpunkte</i><b>${v.ger}<small> / ${v.total}</small></b></span>`;
    $('phase').textContent = g.over ? 'Feldzug beendet' : busy ? 'Schlachten laufen …' : `${SIDE_NAME[g.player]} am Zug`;
  }
  $<HTMLButtonElement>('btnEco').disabled = busy || !!g.over;
  $<HTMLButtonElement>('btnEnd').disabled = busy || !!g.over;
  // gespeichert wird zwischen den Zügen, nicht mitten in einer Schlacht
  $<HTMLButtonElement>('btnSave').disabled = busy || !!g.over || !battleCv.hidden;
  $<HTMLButtonElement>('btnLoad').disabled = busy || !battleCv.hidden;
  if (!battleCv.hidden) return;
  strat.draw();
  strat.renderPanel();
}

function show(html: string, handlers: Record<string, () => void>, cls = '') {
  modal.innerHTML = `<div class="box ${cls}">${html}</div>`;
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
  const hasPl = !!localStorage.getItem(SAVE_POLEN), hasEu = !!localStorage.getItem(SAVE_EU), hasW = !!localStorage.getItem(SAVE_WELT);
  show(`<img class="cover" src="./title.webp" alt="Generalstab – Europa 1936"><div class="dim" style="margin-top:12px">Rundenstrategie 1936–1945: Divisionen auf der Provinzkarte, Bataillone auf der Hex-Schlachtkarte.</div>
    <div class="menu-card"><h3>Welt 1936</h3>
      <p class="dim">Wie Europa 1936, aber auf der ganzen Welt: Amerika, Afrika, Asien und der Pazifik mit Japan, China, den USA und dem britischen Empire. Japans Krieg in China und der Pazifikkrieg ab Dezember 1941 laufen nach historischem Fahrplan; alle Staaten außer dem Reich führt die KI.</p>
      <div class="row"><button class="primary" data-m="welt">Neues Spiel: Deutsches Reich</button>${hasW ? '<button data-m="loadWelt">Spielstand fortsetzen</button>' : ''}</div></div>
    <div class="menu-card"><h3>Europa 1936</h3>
      <p class="dim">Das Deutsche Reich vom 1. Januar 1936 an: ganz Europa, Nordafrika und Vorderasien, Wirtschaft, Fertigung, Forschung und Nachschub. Im Frieden dauert eine Runde einen Monat, im Krieg eine Woche. Die historischen Ereignisse – Spanischer Bürgerkrieg, Anschluss Österreichs, Zerschlagung der Tschechoslowakei und weitere – treten zu ihren Stichtagen ein.</p>
      <div class="row"><button data-m="eu">Neues Spiel: Deutsches Reich</button>${hasEu ? '<button data-m="loadEu">Spielstand fortsetzen</button>' : ''}</div></div>
    <div class="menu-card"><h3>Polenfeldzug 1939</h3>
      <p class="dim">Der deutsche Angriff auf Polen ab dem 1. September 1939 mit historischer Aufstellung. Eine Runde entspricht drei Tagen, der Feldzug endet nach ${MAX_TURNS} Runden am 6. Oktober. Deutschland gewinnt mit Warschau und ${VP_TO_WIN} Siegpunkten, Polen, wenn Warschau bis zum Schluss hält.</p>
      <div class="row"><button data-m="ger">Neues Spiel: Deutsches Reich</button><button data-m="pol">Neues Spiel: Polen</button>${hasPl ? '<button data-m="load">Spielstand fortsetzen</button>' : ''}</div></div>
    <div class="row">${anySlot() ? '<button data-m="slots">Eigenen Spielstand laden …</button>' : ''}${g ? '<button data-m="back">Zurück</button>' : ''}</div>
    <div class="hint">Der Spielstand wird zu Beginn jeder Runde im Browser gespeichert. Grafik und Zahlenwerte sind Platzhalter.</div>`, {
    welt: () => void preload('welt').then(() => (world('welt'), start(newEurope(undefined, true)))),
    loadWelt: () => start(JSON.parse(localStorage.getItem(SAVE_WELT)!)),
    eu: () => (world('europa'), start(newEurope())),
    loadEu: () => start(JSON.parse(localStorage.getItem(SAVE_EU)!)),
    ger: () => (world('polen'), start(newGame('GER'))),
    pol: () => (world('polen'), start(newGame('POL'))),
    load: () => start(JSON.parse(localStorage.getItem(SAVE_POLEN)!)),
    slots: () => slots('load'),
    back: () => {},
  }, 'title');
}

// ---- eigene Spielstände ------------------------------------------------------

const SLOTS = 5, slotKey = (i: number) => `generalstab_slot${i}`;
// Spielstände aus der kurzen Zeit unter dem früheren Namen übernehmen
for (let i = 0; i < SLOTS; i++)
  for (const sfx of ['', '_info']) {
    const old = localStorage.getItem(`ironfront_slot${i}${sfx}`);
    if (old && !localStorage.getItem(slotKey(i) + sfx)) localStorage.setItem(slotKey(i) + sfx, old);
    localStorage.removeItem(`ironfront_slot${i}${sfx}`);
  }
interface SlotInfo { scen: string; date: string; saved: number }
function slotInfo(i: number): SlotInfo | null {
  try {
    return JSON.parse(localStorage.getItem(`${slotKey(i)}_info`) ?? 'null');
  } catch {
    return null;
  }
}
const anySlot = () => Array.from({ length: SLOTS }, (_, i) => slotInfo(i)).some(Boolean);

/** Liste der Speicherplätze zum Sichern oder Laden; das selbsttätige Speichern je Runde bleibt davon unberührt. */
function slots(mode: 'save' | 'load') {
  const handlers: Record<string, () => void> = { back: () => (g ? refresh() : menu()) };
  const rows = Array.from({ length: SLOTS }, (_, i) => {
    const info = slotInfo(i);
    handlers[`s${i}`] = () => (mode === 'save' ? saveSlot(i) : start(JSON.parse(localStorage.getItem(slotKey(i))!)));
    handlers[`d${i}`] = () => (localStorage.removeItem(slotKey(i)), localStorage.removeItem(`${slotKey(i)}_info`), slots(mode));
    const when = info ? new Date(info.saved).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `<div class="slot"><div><b>Platz ${i + 1}${info ? ` · ${esc(info.scen)}` : ''}</b><span class="dim">${info ? `${esc(info.date)} · gespeichert ${when}` : 'leer'}</span></div><span class="sp"></span>
      ${mode === 'save' ? `<button class="${info ? '' : 'primary'}" data-m="s${i}">${info ? 'überschreiben' : 'hier speichern'}</button>` : `<button class="primary" data-m="s${i}" ${info ? '' : 'disabled'}>laden</button>`}
      ${info ? `<button data-m="d${i}" title="Spielstand löschen">✕</button>` : ''}</div>`;
  }).join('');
  show(`<h2>${mode === 'save' ? 'Spiel speichern' : 'Spielstand laden'}</h2>
    <p class="dim">${mode === 'save' ? 'Eigene Spielstände liegen neben dem selbsttätigen Speichern zu Rundenbeginn.' : 'Der laufende Stand geht beim Laden verloren, sofern er nicht gespeichert ist.'} Alle Spielstände liegen nur in diesem Browser.</p>
    ${rows}<div class="row"><button data-m="back">${mode === 'save' ? 'Schließen' : 'Abbrechen'}</button></div>`, handlers);
}

function saveSlot(i: number) {
  const scen = g.eu ? (g.eu.flags.world ? 'Welt 1936' : 'Europa 1936') : `Polenfeldzug 1939 (${SIDE_NAME[g.player]})`;
  const date = g.eu ? fmtDate(g.eu.day) : `${turnDate(Math.min(g.turn, MAX_TURNS))}, Runde ${g.turn}`;
  try {
    localStorage.setItem(slotKey(i), JSON.stringify(g));
    localStorage.setItem(`${slotKey(i)}_info`, JSON.stringify({ scen, date, saved: Date.now() } satisfies SlotInfo));
    slots('save');
  } catch {
    localStorage.removeItem(slotKey(i));
    show('<h2>Speichern fehlgeschlagen</h2><p>Der Speicher des Browsers ist voll. Löschen Sie einen älteren Spielstand und versuchen Sie es erneut.</p><div class="row"><button class="primary" data-m="ok">Zurück</button></div>', { ok: () => slots('save') });
  }
}

/** Karte, Bezeichnungen und Regeln des Szenarios einschalten. */
function world(scen: Scenario) {
  const eu = scen !== 'polen';
  useWorld(scen);
  setTypeNames(eu);
  if (eu) installEurope();
  else uninstallEurope();
  Object.assign(SIDE_NAME, eu ? { GER: 'Achse', POL: 'Gegner' } : { GER: 'Deutsches Reich', POL: 'Polen' });
  $('title').textContent = scen === 'welt' ? 'Welt 1936' : eu ? 'Europa 1936' : 'Polenfeldzug 1939';
  $('btnEco').hidden = !eu;
  strat.reload();
}

async function start(state: GameState) {
  const scen: Scenario = state.eu ? (state.eu.flags.world ? 'welt' : 'europa') : 'polen';
  await preload(scen);
  world(scen);
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
      runFollows(g, 'GER');
      euAI(g, 'POL');
      runBattles(collectBattles(g, 'POL'), finishRound);
    });
  }
  runBattles(collectBattles(g, g.player), () => {
    runFollows(g, g.player);
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
  const mine = (pb: PendingBattle) => !g.eu || [...pb.attackers, ...pb.defenders].some(d => d.nation === 'GER' || d.ctl);
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
    const b0 = startBattle(g, pb);
    if (!b0) return next();
    let b = b0;
    const auto = () => {
      autoResolve(b);
      conclude(pb, b, next, !autoAll);
    };
    if (autoAll) return auto();
    const fight = (setup: boolean) => {
      mapCv.hidden = true;
      battleCv.hidden = false;
      battleView.open(b, g.player, () => {
        battleCv.hidden = true;
        mapCv.hidden = false;
        conclude(pb, b, next, true);
      }, setup);
    };
    const ask = () => prompt(pb, b, {
      manual: () => fight(false),
      // eingegrabene Verteidiger dürfen ihre Truppen vor der Schlacht selbst aufstellen
      place: () => fight(true),
      auto,
      all: () => ((autoAll = true), auto()),
      // andere Verbände in die Schlacht schicken: die Schlacht wird mit ihnen neu aufgestellt
      pick: () => pickDivs(pb, () => ((b = startBattle(g, pb) ?? b), ask())),
    });
    ask();
  };
  next();
}

function prompt(pb: PendingBattle, b: Battle, h: Record<string, () => void>) {
  const p = PROV[pb.prov];
  const list = (ds: typeof pb.attackers, extra: number) =>
    ds.map(d => `<div class="div ${d.side}"><label>${esc(d.name)}</label><div class="meta">Stärke ${d.side === g.player ? `${strength(d)}/${maxStrength(d)}` : `ca. ${estimate(d, g.turn)}`}${d.dug && d.side !== pb.side ? ` · eingegraben ${d.dug}` : ''}${d.oos ? ' · <span class="bad">abgeschnitten</span>' : ''}</div></div>`).join('') +
    (extra ? `<div class="dim">+ ${extra} weitere in Reserve${ds[0]?.side === g.player ? ' <button data-m="pick" title="Selbst bestimmen, welche Verbände kämpfen. Ohne Wahl gehen wie bisher die stärksten in die Schlacht.">Verbände wählen</button>' : ''}</div>` : '');
  const est = (ds: typeof pb.attackers) => ds.reduce((a, d) => a + (d.side === g.player ? strength(d) : estimate(d, g.turn)), 0);
  const ratio = est(pb.attackers) / est(pb.defenders);
  const dugIn = pb.side !== g.player && pb.defenders.some(d => d.dug > 0);
  show(`<h2>Schlacht um ${esc(p.name)}</h2>${pb.from && PROV[pb.from] ? `<div class="dim">Angriff aus ${esc(PROV[pb.from].name)}</div>` : ''}
    <div class="dim">${TERRAIN_NAME[p.terrain]}${p.river ? ' · Fluss' : ''} · Kräfteverhältnis etwa ${ratio.toFixed(1)} : 1 · ${pb.side === g.player ? 'Sie greifen an' : 'Sie verteidigen'}</div>
    <div class="${b.sup === other(g.player) ? 'bad' : ''}"><b>${airSituation(b, g.player)}</b> <span class="dim">Jäger ${b.fighters[g.player]} : ${b.fighters[other(g.player)]} · eigene Bomberstaffeln ${b.bombers[g.player]}</span></div>
    <div class="cols"><div><h3>Angreifer</h3>${list(pb.attackers, pb.followers.length)}</div><div><h3>Verteidiger</h3>${list(pb.defenders, pb.reserve.length)}</div></div>
    <div class="row">
      ${dugIn ? '<button class="primary" data-m="place" title="Sie stellen Ihre eingegrabenen Truppen vor der Schlacht selbst auf und führen sie dann.">Truppen manuell aufstellen</button>' : ''}
      <button class="${dugIn ? '' : 'primary'}" data-m="manual"${dugIn ? ' title="Die Truppen stehen wie bisher um die Ziele; Sie führen die Schlacht selbst."' : ''}>${dugIn ? 'Truppen automatisch platzieren' : 'Schlacht selbst führen'}</button>
      <button data-m="auto">Auto-Resolve</button>
      <button data-m="all">Alle übrigen automatisch</button>
    </div>`, h);
}

/** Was ein Verband mitbringt: Zusammensetzung, Ausrüstung, Erfahrung, Armee. */
function divDetails(d: Division) {
  const a = armyOf(g, d), lvl = XP_LEVELS[xpLevel(d)];
  const rows = d.units.map(u => {
    const t = TYPES[u.t];
    return `<tr><td>${esc(t.name[d.side])}</td><td><b>${u.s}</b>/${maxS(d)}</td><td class="dim">Angriff ${t.sa}/${t.ha} · Abwehr ${t.def}${t.rng > 1 ? ` · Reichweite ${t.rng}` : ''}</td></tr>`;
  }).join('');
  return `<b>${esc(d.name)}</b><div class="dim">${esc(tp(d).label)} · Stärke ${strength(d)}/${maxStrength(d)} · Kampfkraft ${Math.round(divPower(d))}</div>
    <div class="dim">Erfahrung: ${lvl.name} (Güte ${lvl.q > 0 ? '+' : ''}${lvl.q})${d.dug ? ` · eingegraben ${d.dug}` : ''}${d.oos ? ' · <span class="bad">abgeschnitten</span>' : d.low ? ' · <span class="bad">Nachschub überdehnt</span>' : ''}</div>
    ${a ? `<div class="dim">⚑ ${esc(a.name)}${a.gen ? ` · ${esc(rankName(g, a.gen))} ${esc(GENERAL[a.gen].name)}${inTransfer(g, a) ? ' (in Transfer)' : ` · ${traitText(g, a.gen)}`}` : ' · ohne General'}</div>` : ''}
    <table>${rows}</table><div class="dim">Angriff gegen weiche/gepanzerte Ziele je Bataillon.</div>`;
}

/** Der Spieler bestimmt, welche seiner Verbände kämpfen; die übrigen bleiben in Reserve. */
function pickDivs(pb: PendingBattle, done: () => void) {
  const att = pb.side === g.player, pool = att ? [...pb.attackers, ...pb.followers] : [...pb.defenders, ...pb.reserve];
  const sel = new Set((att ? pb.attackers : pb.defenders).map(d => d.id));
  let hover = pool[0].id;
  const apply = (ids: Set<number>) => {
    const inn = pool.filter(d => ids.has(d.id)), out = pool.filter(d => !ids.has(d.id));
    if (att) (pb.attackers = inn), (pb.followers = out);
    else (pb.defenders = inn), (pb.reserve = out), (pb.picked = true);
  };
  const render = () => {
    const sum = pool.filter(d => sel.has(d.id)).reduce((a, d) => a + strength(d), 0);
    modal.innerHTML = `<div class="box wide" style="padding-top:20px"><h2>Verbände für die Schlacht um ${esc(PROV[pb.prov].name)}</h2>
      <div class="dim">Bis zu ${BATTLE_MAX} Verbände kämpfen, die übrigen bleiben in Reserve${att ? ' und rücken nach einem Sieg mit ein' : ''}. Gewählt: <b>${sel.size}/${BATTLE_MAX}</b> · Stärke <b>${sum}</b></div>
      <div class="cols"><div>${pool.map(d => {
        const on = sel.has(d.id), pct = Math.round((100 * strength(d)) / maxStrength(d));
        return `<div class="div ${d.side}" data-hov="${d.id}"><label><input type="checkbox" data-pk="${d.id}" ${on ? 'checked' : ''} ${!on && sel.size >= BATTLE_MAX ? 'disabled' : ''}>${esc(d.name)}<span class="sp"></span><span class="dim">Stärke ${strength(d)}/${maxStrength(d)}</span></label>
          <div class="meta">${esc(tp(d).label)} · ${XP_LEVELS[xpLevel(d)].name} · Kampfkraft ${Math.round(divPower(d))}</div><div class="str"><i class="${pct < 40 ? 'low' : pct < 75 ? 'mid' : ''}" style="width:${pct}%"></i></div></div>`;
      }).join('')}</div><div id="pkinfo">${divDetails(pool.find(d => d.id === hover)!)}</div></div>
      <div class="row"><button data-pk="auto" title="Die stärksten Verbände kämpfen, wie bisher">Automatisch wählen</button><button class="primary" data-pk="ok" ${sel.size ? '' : 'disabled'}>Mit dieser Auswahl kämpfen</button></div></div>`;
  };
  const finish = () => {
    modal.onclick = modal.onmouseover = null;
    done();
  };
  modal.hidden = false;
  modal.onmouseover = e => {
    const id = +((e.target as HTMLElement).closest<HTMLElement>('[data-hov]')?.dataset.hov ?? 0);
    if (!id || id === hover) return;
    hover = id;
    document.getElementById('pkinfo')!.innerHTML = divDetails(pool.find(d => d.id === id)!);
  };
  modal.onclick = e => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-pk]')?.dataset.pk;
    if (!k) return;
    if (k === 'ok') return apply(sel), finish();
    if (k === 'auto') return apply(new Set([...pool].sort((a, b) => divPower(b) - divPower(a)).slice(0, BATTLE_MAX).map(d => d.id))), finish();
    sel.has(+k) ? sel.delete(+k) : sel.size < BATTLE_MAX && sel.add(+k);
    render();
  };
  render();
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
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest?.('input, select, textarea')) return void toggleFull();
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
// Vollbild: Knopf oder Taste F; Esc beendet es wie im Browser üblich
const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
$('btnFull').onclick = toggleFull;
document.addEventListener('fullscreenchange', () => {
  $('btnFull').textContent = document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild';
  refresh();
});
$('btnSave').onclick = () => {
  if (g && !busy && battleCv.hidden) slots('save');
};
$('btnLoad').onclick = () => {
  if (g && !busy && battleCv.hidden) slots('load');
};
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
