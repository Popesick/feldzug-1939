// Ablaufsteuerung: Befehlsphase → eigene Schlachten → Zug der KI → Rundenabschluss.
import type { GameState, Side } from './core/types';
import { other } from './core/types';
import { BATTLE_MAX, MAX_TURNS, VP_TO_WIN, XP_LEVELS, type PendingBattle, collectBattles, divPower, isOwn, maxS, maxStrength, me, tp, xpLevel, endTurn, runFollows, WORDS, estimate, newGame, strength, turnDate, vpStatus } from './core/game';
import { strategicAI } from './core/stratai';
import { finishBattle, resolveAuto, startBattle } from './core/flow';
import { type Battle, autoResolve, losses } from './core/battle';
import { MAP, PLIST, PROV, SCEN, type Scenario, TERRAIN_NAME, preload, useWorld } from './data/world';
import { TYPES, setTypeNames } from './data/units';
import { armyOf, inTransfer, rankName, traitText } from './core/army';
import { GENERAL } from './data/generals';
import type { Division } from './core/types';
import { COUNTRIES } from './data/europa';
import { atWar, declareWar, euSupply, fmtDate, installEurope, migrateMap, newEurope, resolveChoice, uninstallEurope, vpEurope } from './core/europa';
import { euAI } from './core/euai';
import { openEco } from './ui/ecoview';
import { atWarMe, computeIK, migrateEco } from './core/economy';
import { bestLvl, researchable } from './core/economy';
import { StratView } from './ui/stratview';
import { BattleView, airSituation } from './ui/battleview';
import { SIDE_NAME, esc, fitCanvas } from './ui/draw';
import { setSound, sfx, soundOn } from './ui/sound';

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
    const idle = free > 0 && researchable(e, me(g)).some(t => !e.slots.includes(t));
    $('btnEco').innerHTML = `${me(g) === 'GER' ? 'Reich' : 'Staat'} verwalten${idle ? '<span class="alert" title="Forschungsplatz frei">!</span>' : ''}`;
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
  $('btnSkip').hidden = !(g.eu && me(g) !== 'GER' && !atWarMe(g)) || busy || !!g.over;
  // gespeichert wird zwischen den Zügen, nicht mitten in einer Schlacht
  $<HTMLButtonElement>('btnSave').disabled = busy || !!g.over || !battleCv.hidden;
  $<HTMLButtonElement>('btnLoad').disabled = busy || !battleCv.hidden;
  if (!battleCv.hidden) return;
  strat.draw();
  strat.renderPanel();
}

function show(html: string, handlers: Record<string, () => void>, cls = '') {
  modal.innerHTML = `<div class="box ${cls}">${html}</div>`;
  // ohne laufendes Spiel und im Startbereich füllt das Titelbild das Fenster
  modal.classList.toggle('screen', cls.includes('screen') || !g);
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
    localStorage.setItem(LAST, saveKey());
  } catch { /* Speichern ist Komfort, kein Muss */ }
}

const LAST = 'generalstab_last'; // welcher selbsttätige Spielstand zuletzt geschrieben wurde
const AUTOSAVES: [string, string][] = [[SAVE_WELT, 'Welt 1936'], [SAVE_EU, 'Europa 1936'], [SAVE_POLEN, 'Polenfeldzug 1939']];
const NATION_NAME: Record<string, string> = { GER: 'Deutsches Reich', USA: 'Vereinigte Staaten', SOV: 'Sowjetunion', ENG: 'Großbritannien', FRA: 'Frankreich', ITA: 'Italien', JAP: 'Japan', CHI: 'China' };
const load = (key: string) => start(JSON.parse(localStorage.getItem(key)!));
/** Kurzbeschreibung eines gespeicherten Standes, ohne ihn zu starten. */
function describe(key: string): string | null {
  try {
    const st = JSON.parse(localStorage.getItem(key) ?? 'null') as GameState | null;
    if (!st) return null;
    return st.eu ? `${NATION_NAME[st.eu.me ?? 'GER'] ?? st.eu.me} · ${fmtDate(st.eu.day)}` : `${st.player === 'GER' ? 'Deutsches Reich' : 'Polen'} · Runde ${st.turn}`;
  } catch {
    return null;
  }
}
/** Startbereich: das Titelbild füllt das Fenster, die vier Einstiege liegen darüber. */
function menu() {
  const last = [localStorage.getItem(LAST), ...AUTOSAVES.map(a => a[0])].find(k => k && localStorage.getItem(k)) ?? null;
  const info = last ? describe(last) : null, name = AUTOSAVES.find(a => a[0] === last)?.[1];
  show(`<div class="mainmenu">
      <button class="primary" data-m="neu">Neues Spiel</button>
      <button data-m="weiter" ${info ? '' : 'disabled'}>Spiel fortsetzen${info ? `<small>${esc(name ?? '')} · ${esc(info)}</small>` : '<small>kein Spielstand vorhanden</small>'}</button>
      <button data-m="laden" ${anySlot() || AUTOSAVES.some(a => localStorage.getItem(a[0])) ? '' : 'disabled'}>Spiel laden</button>
      <button data-m="opt">Optionen</button>
      ${g ? '<button data-m="back">Zurück zum Spiel</button>' : ''}
    </div>
    <div class="hint">Rundenstrategie 1936–1945. Der Spielstand wird zu Beginn jeder Runde im Browser gespeichert.</div>`, {
    neu: newGameMenu,
    weiter: () => load(last!),
    laden: () => slots('load'),
    opt: options,
    back: () => {},
  }, 'screen menu');
}

// ---- Neues Spiel: erst das Szenario, dann der Staat ---------------------------

interface Pick { id: string; name: string; side: string; text: string }
const SCENARIOS: { id: Scenario; name: string; span: string; text: string; nations: Pick[] }[] = [
  {
    id: 'welt', name: 'Welt 1936', span: '1. Januar 1936 – Anfang 1946',
    text: 'Die ganze Welt: Wirtschaft, Fertigung, Forschung und Nachschub, dazu Amerika, Afrika, Asien und der Pazifik. Acht Staaten stehen zur Wahl; alle übrigen führt die KI.',
    nations: [
      { id: 'GER', name: 'Deutsches Reich', side: 'Achse', text: 'Das Reich rüstet auf. Sie bestimmen selbst, wann und gegen wen der Krieg beginnt; die historischen Ereignisse treten zu ihren Stichtagen ein.' },
      { id: 'ITA', name: 'Italien', side: 'Achse', text: 'Große Flotte, schwache Industrie. Kriegseintritt historisch im Juni 1940 an der Seite des Reichs, das die KI führt.' },
      { id: 'JAP', name: 'Japan', side: 'Achse', text: 'Krieg gegen China ab 1937, dann die Entscheidung über Nordstoß, Indochina und Pearl Harbor. Der Krieg in Ostasien wird auf der Karte ausgefochten.' },
      { id: 'ENG', name: 'Großbritannien', side: 'Alliierte', text: 'Weltreich und größte Flotte. Krieg historisch ab September 1939; der Handelskrieg im Atlantik entscheidet über die Zufuhr.' },
      { id: 'FRA', name: 'Frankreich', side: 'Alliierte', text: 'Großes Heer hinter der Maginot-Linie. Krieg historisch ab September 1939 – Sie verlieren, wenn Paris fällt.' },
      { id: 'USA', name: 'Vereinigte Staaten', side: 'Alliierte', text: 'Die größte Industrie der Welt, zunächst neutral und kaum gerüstet. Kriegseintritt historisch im Dezember 1941.' },
      { id: 'SOV', name: 'Sowjetunion', side: 'Alliierte', text: 'Riesiges Heer, durch die Säuberungen geschwächt. Der deutsche Angriff kommt historisch im Juni 1941.' },
      { id: 'CHI', name: 'China', side: 'Alliierte', text: 'Viel Mannschaft, wenig Gerät. Von 1937 an steht China Japan allein gegenüber – durchhalten, bis die Alliierten eingreifen.' },
    ],
  },
  {
    id: 'europa', name: 'Europa 1936', span: '1. Januar 1936 – Anfang 1946',
    text: 'Ganz Europa, Nordafrika und Vorderasien. Im Frieden dauert eine Runde einen Monat, im Krieg eine Woche. Spanischer Bürgerkrieg, Anschluss, München und weitere Ereignisse treten zu ihren Stichtagen ein.',
    nations: [{ id: 'GER', name: 'Deutsches Reich', side: 'Achse', text: 'Sie führen das Reich vom Beginn der Aufrüstung an und bestimmen selbst, wann und gegen wen der Krieg beginnt.' }],
  },
  {
    id: 'polen', name: 'Polenfeldzug 1939', span: `1. September – 6. Oktober 1939 · ${MAX_TURNS} Runden`,
    text: 'Der deutsche Angriff auf Polen mit historischer Aufstellung. Eine Runde entspricht drei Tagen. Ein kurzes Szenario ohne Wirtschaft – gut zum Kennenlernen.',
    nations: [
      { id: 'GER', name: 'Deutsches Reich', side: 'Angreifer', text: `Sie gewinnen mit Warschau und ${VP_TO_WIN} Siegpunkten bis zum 6. Oktober.` },
      { id: 'POL', name: 'Polen', side: 'Verteidiger', text: 'Sie gewinnen, wenn Warschau bis zum Schluss hält.' },
    ],
  },
];

const star = (cx: number, cy: number, R: number, r: number, n: number) =>
  Array.from({ length: n * 2 }, (_, i) => { const a = (Math.PI * i) / n - Math.PI / 2, d = i % 2 ? r : R; return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}`; }).join(' ');
const V3 = (a: string, b: string, c: string) => `<rect width="20" height="40" fill="${a}"/><rect x="20" width="20" height="40" fill="${b}"/><rect x="40" width="20" height="40" fill="${c}"/>`;
const H3 = (a: string, b: string, c: string) => `<rect width="60" height="13.4" fill="${a}"/><rect y="13.33" width="60" height="13.4" fill="${b}"/><rect y="26.66" width="60" height="13.34" fill="${c}"/>`;
/** Flaggen der spielbaren Staaten um 1936, selbst gezeichnet. Für das Reich die Reichskriegsflagge von 1933–1935. */
const FLAGS: Record<string, string> = {
  GER: `${H3('#111', '#fff', '#d2202a')}<path d="M30 20L24 8.5Q30 10.5 36 8.5ZM30 20L36 31.5Q30 29.5 24 31.5ZM30 20L18.5 14Q20.5 20 18.5 26ZM30 20L41.5 26Q39.5 20 41.5 14Z" fill="#111" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>`,
  ITA: `${V3('#1f8a4c', '#fff', '#d2202a')}<path d="M25.5 13.5h9v8q0 4.5-4.5 6.5q-4.5-2-4.5-6.5z" fill="#d2202a" stroke="#1d4fa8" stroke-width="1.3"/><path d="M30 14.5v12M26.3 19.5h7.4" stroke="#fff" stroke-width="1.8"/>`,
  ENG: '<rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0L60 40M60 0L0 40" stroke="#c8102e" stroke-width="2.8"/><path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="12"/><path d="M30 0V40M0 20H60" stroke="#c8102e" stroke-width="7"/>',
  FRA: V3('#0b4ea2', '#fff', '#e1303a'),
  USA: `<rect width="60" height="40" fill="#fff"/>${Array.from({ length: 7 }, (_, i) => `<rect y="${(i * 80) / 13}" width="60" height="${40 / 13}" fill="#b22234"/>`).join('')}<rect width="26" height="${(40 / 13) * 7}" fill="#3c3b6e"/>${Array.from({ length: 30 }, (_, i) => `<circle cx="${2.6 + (i % 6) * 4.2}" cy="${2.4 + Math.floor(i / 6) * 4.2}" r=".9" fill="#fff"/>`).join('')}`,
  SOV: `<rect width="60" height="40" fill="#cc1a1a"/><polygon points="${star(13, 6.5, 3, 1.2, 5)}" fill="none" stroke="#f6c945" stroke-width=".8"/><path d="M9.5 20.5a5.6 5.6 0 1 0 5-9.6a7.6 7.6 0 0 1-5 9.6z" fill="#f6c945"/><path d="M8 13.2l8.3 8.3M7.2 15.2l3.6-3.6" stroke="#f6c945" stroke-width="1.7" stroke-linecap="round"/>`,
  JAP: '<rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="12" fill="#bc002d"/>',
  CHI: `<rect width="60" height="40" fill="#d6001c"/><rect width="30" height="20" fill="#0a1a8c"/><polygon points="${star(15, 10, 7.6, 4.4, 12)}" fill="#fff"/><circle cx="15" cy="10" r="4.3" fill="#0a1a8c"/><circle cx="15" cy="10" r="3.6" fill="#fff"/>`,
  POL: '<rect width="60" height="40" fill="#fff"/><rect y="20" width="60" height="20" fill="#dc143c"/>',
};
const flag = (id: string) => `<svg viewBox="0 0 60 40" preserveAspectRatio="none" aria-hidden="true">${FLAGS[id] ?? ''}</svg>`;

function newGameMenu() {
  const handlers: Record<string, () => void> = { back: menu };
  for (const sc of SCENARIOS) handlers[`sc_${sc.id}`] = () => void pickNation(sc.id);
  show(`<h2>Neues Spiel</h2><p class="dim">Wählen Sie ein Szenario. Im nächsten Schritt bestimmen Sie den Staat, den Sie führen.</p>
    <div class="scen-grid">${SCENARIOS.map(sc => `<button class="scen-card" data-m="sc_${sc.id}"><b>${sc.name}</b><small>${esc(sc.span)}</small><span>${esc(sc.text)}</span>
      <span class="scen-flags">${sc.nations.map(n => flag(n.id)).join('')}</span></button>`).join('')}</div>
    <p class="dim">Ein neues Spiel überschreibt den selbsttätigen Spielstand desselben Szenarios. Eigene Spielstände (Speichern) bleiben erhalten.</p>
    <div class="row"><button data-m="back">Zurück</button></div>`, handlers, 'screen scenbox');
}

let pickDraw: (() => void) | null = null;
window.addEventListener('resize', () => !modal.hidden && pickDraw?.());

/** Staatenwahl: die Karte des Szenarios, darauf das Gebiet des gewählten Staates; darunter die Flaggen. */
async function pickNation(scen: Scenario, sel?: string) {
  const sc = SCENARIOS.find(x => x.id === scen)!, nat = sc.nations.find(n => n.id === sel) ?? sc.nations[0];
  if (scen === 'welt') {
    show('<h2>Welt 1936</h2><p class="dim">Die Weltkarte wird geladen …</p>', {}, 'screen scenbox');
    await preload('welt');
  }
  // die Karte des Szenarios nur zum Zeichnen holen; das laufende Spiel behält seine eigene
  const prev = SCEN;
  useWorld(scen);
  const m = MAP, list = PLIST;
  useWorld(prev);
  const mine = (p: (typeof list)[number]) => (scen === 'polen' ? p.side0 === nat.id : p.country === nat.id);
  const own = list.filter(mine), ind = own.reduce((a, p) => a + (p.ind ?? 0), 0);
  const stats = scen === 'polen' ? `${own.length} Provinzen` : `${own.length} Provinzen · Industrie ${Math.round(ind)}`;
  const handlers: Record<string, () => void> = {
    back: () => ((pickDraw = null), newGameMenu()),
    go: () => {
      pickDraw = null;
      if (scen === 'polen') (world('polen'), void start(newGame(nat.id as Side)));
      else (world(scen), void start(newEurope(undefined, scen === 'welt', nat.id)));
    },
  };
  for (const n of sc.nations) handlers[`n_${n.id}`] = () => void pickNation(scen, n.id);
  show(`<div class="pick-head"><h2>${sc.name}</h2><span class="dim">${esc(sc.span)}</span></div>
    <div class="pick-map"><canvas id="pickCv"></canvas>
      <div class="pick-info">${flag(nat.id)}<div><b>${esc(nat.name)}</b><span class="dim">${esc(nat.side)} · ${stats}</span></div><p>${esc(nat.text)}</p></div></div>
    <div class="pick-bar"><div class="flags">${sc.nations.map(n => `<button class="flag${n.id === nat.id ? ' on' : ''}" data-m="n_${n.id}" title="${esc(n.name)}">${flag(n.id)}<span>${esc(n.name)}</span></button>`).join('')}</div>
      <div class="row"><button data-m="back">Zurück</button><button class="primary" data-m="go" data-enter>Spiel starten</button></div></div>`, handlers, 'screen pick');
  const cv = $<HTMLCanvasElement>('pickCv');
  const path = (poly: number[]) => {
    const q = new Path2D();
    q.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) q.lineTo(poly[i], poly[i + 1]);
    q.closePath();
    return q;
  };
  const land = new Path2D();
  for (const r of m.land) land.addPath(path(r));
  const paths = list.map(p => ({ p, q: path(p.poly) }));
  pickDraw = () => {
    if (!cv.isConnected) return void (pickDraw = null);
    const ctx = fitCanvas(cv), W = cv.clientWidth, H = cv.clientHeight, k = Math.min(W / m.w, H / m.h);
    ctx.fillStyle = '#1f2f3b';
    ctx.fillRect(0, 0, W, H);
    ctx.translate((W - m.w * k) / 2, (H - m.h * k) / 2);
    ctx.scale(k, k);
    ctx.fillStyle = '#4a4d45';
    ctx.fill(land, 'evenodd');
    ctx.clip(land, 'evenodd'); // die Provinzflächen reichen über die Küste hinaus
    ctx.lineWidth = 0.6 / k;
    ctx.strokeStyle = '#0000002e';
    ctx.globalAlpha = 0.55;
    for (const { p, q } of paths) {
      if (mine(p)) continue;
      ctx.fillStyle = scen === 'polen' ? (p.side0 === 'NEU' ? '#5c6058' : p.side0 === 'GER' ? '#7d8672' : '#c9a24b') : COUNTRIES[p.country]?.color ?? '#6a6d64';
      ctx.fill(q);
      ctx.stroke(q);
    }
    ctx.globalAlpha = 1;
    // das eigene Gebiet leuchtet
    ctx.shadowColor = '#f3c95a';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#e9bd52';
    for (const { p, q } of paths) if (mine(p)) ctx.fill(q);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#3b2c0a88';
    for (const { p, q } of paths) if (mine(p)) ctx.stroke(q);
  };
  pickDraw();
}

function options() {
  show(`<h2>Optionen</h2>
    <div class="line"><b>Ton</b><div class="dim">Geräusche für Bewegung, Gefecht und Meldungen. Derzeit: <b>${soundOn() ? 'an' : 'aus'}</b></div><div class="row"><button data-m="ton">${soundOn() ? 'Ton ausschalten' : 'Ton einschalten'}</button></div></div>
    <div class="line"><b>Vollbild</b><div class="dim">Auch mit der Taste F. Derzeit: <b>${document.fullscreenElement ? 'an' : 'aus'}</b></div><div class="row"><button data-m="voll">${document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild einschalten'}</button></div></div>
    <div class="row"><button class="primary" data-m="back">Zurück</button></div>`, {
    ton: () => (setSound(!soundOn()), soundLabel(), sfx('turn'), options()),
    voll: () => void toggleFull().then(options),
    back: menu,
  });
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
  const autos = mode === 'load' ? AUTOSAVES.map(([key, name]) => {
    const info = describe(key);
    handlers[`a_${key}`] = () => load(key);
    return info ? `<div class="slot"><div><b>Selbsttätig · ${name}</b><span class="dim">${esc(info)}</span></div><span class="sp"></span><button class="primary" data-m="a_${key}">laden</button></div>` : '';
  }).join('') : '';
  show(`<h2>${mode === 'save' ? 'Spiel speichern' : 'Spielstand laden'}</h2>
    <p class="dim">${mode === 'save' ? 'Eigene Spielstände liegen neben dem selbsttätigen Speichern zu Rundenbeginn.' : 'Der laufende Stand geht beim Laden verloren, sofern er nicht gespeichert ist.'} Alle Spielstände liegen nur in diesem Browser.</p>
    ${autos}${rows}<div class="row"><button data-m="back">${mode === 'save' ? 'Schließen' : 'Abbrechen'}</button></div>`, handlers);
}

function saveSlot(i: number) {
  const scen = g.eu ? `${g.eu.flags.world ? 'Welt 1936' : 'Europa 1936'}${g.eu.me ? ` (${NATION_NAME[g.eu.me] ?? g.eu.me})` : ''}` : `Polenfeldzug 1939 (${SIDE_NAME[g.player]})`;
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
  if (state.eu) migrateMap(state), migrateEco(state.eu.eco), computeIK(state);
  g = state;
  // Sicht des Spielers: Führt er einen Gegner des Reichs, sind die Alliierten die eigene Seite
  if (state.eu?.me && state.eu.me !== 'GER') {
    if (state.player === 'POL') {
      Object.assign(SIDE_NAME, { GER: 'Achse', POL: 'Alliierte' });
      WORDS.GER = { adj: 'Feindliche', by: 'Truppen der Achse' };
      WORDS.POL = { adj: 'Eigene', by: 'alliierten Truppen' };
    }
    $('title').textContent = `${$('title').textContent} · ${state.eu.me === 'USA' ? 'USA' : NATION_NAME[state.eu.me] ?? state.eu.me}`;
  }
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

/** Eigenes Gebiet: was die eigene Seite hält – in Europa Reichsgebiet und besetztes Gebiet, nicht das der Verbündeten. */
let held: string[] = [];
const heldNow = () => Object.keys(g.ctrl).filter(id => g.ctrl[id] === g.player && (!g.eu || g.eu.owner[id] === me(g)));

/** Meldet zu Beginn der Runde, was der Gegner seit dem eigenen Zug genommen hat; „Gehe zu“ springt auf die Karte. */
function reportLosses(then: () => void) {
  const lost = held.filter(id => g.ctrl[id] === other(g.player)).map(id => ({ id, by: g.eu ? COUNTRIES[g.eu.owner[id]]?.name ?? 'Gegner' : SIDE_NAME[other(g.player)] }));
  held = [];
  strat.lost = lost;
  if (!lost.length || g.over) return then();
  sfx('alarm');
  lost.sort((a, b) => PROV[b.id].vp - PROV[a.id].vp);
  const handlers: Record<string, () => void> = { ok: then };
  for (const l of lost) handlers[`go_${l.id}`] = () => (strat.focus(l.id), refresh(), then());
  const core = (id: string) => (g.eu ? (g.eu.core[id] ? 'Reichsgebiet' : 'besetztes Gebiet') : '');
  show(`<h2>Gebiet verloren</h2><p>Der Gegner hat in dieser Runde ${lost.length === 1 ? 'eine Provinz' : `${lost.length} Provinzen`} genommen:</p>
    ${lost.map(l => `<div class="line new"><div><b>${esc(PROV[l.id].name)}</b>${PROV[l.id].vp ? ` <span style="color:var(--acc)">★${PROV[l.id].vp}</span>` : ''} <span class="dim">${[core(l.id), `erobert von ${esc(l.by)}`].filter(Boolean).join(' · ')}</span>
      <button data-m="go_${l.id}" style="float:right">Gehe zu</button></div></div>`).join('')}
    <p class="dim">Die Liste bleibt diese Runde in der Seitenleiste stehen, solange keine Provinz ausgewählt ist.</p>
    <div class="row"><button class="primary" data-m="ok" data-enter>Weiter</button></div>`, handlers);
}

// Polen zieht als Spieler nach dem deutschen Angriff: Runde = erst Deutschland, dann Polen.
function endPlayerPhase() {
  if (busy || g.over) return;
  busy = true;
  strat.select(null);
  strat.lost = [];
  held = heldNow();
  sfx('turn');
  if (g.eu) {
    // erst die Verbündeten, dann alle Schlachten der Achse, dann der Gegner
    const mine = g.player, foe = other(mine);
    euAI(g, mine);
    return runBattles(collectBattles(g, mine), () => {
      runFollows(g, mine);
      euAI(g, foe);
      runBattles(collectBattles(g, foe), finishRound);
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
  if (g.eu || g.player === 'GER') save();
  refresh();
  reportLosses(() => g.eu && showNews());
}

function runBattles(queue: PendingBattle[], done: () => void) {
  autoAll = false;
  report = [];
  let others = 0;
  const mine = (pb: PendingBattle) => !g.eu || [...pb.attackers, ...pb.defenders].some(d => isOwn(g, d));
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
      sfx('battle');
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
  sfx(won ? 'win' : 'lose', 0.3);
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
// Vorspulen: solange der eigene Staat neutral ist, Runden abschließen, bis eine Meldung kommt oder der Krieg beginnt
$('btnSkip').onclick = () => {
  for (let i = 0; i < 60 && g?.eu && !busy && !g.over && modal.hidden && !atWarMe(g); i++) endPlayerPhase();
};
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
const soundLabel = () => ($('btnSound').textContent = soundOn() ? 'Ton an' : 'Ton aus');
$('btnSound').onclick = () => (setSound(!soundOn()), soundLabel(), sfx('turn'));
soundLabel();
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
Object.assign(window, { feldzug: { get g() { return g; }, strat, battleView, endPlayerPhase, testLosses: (ids: string[]) => ((held = ids), reportLosses(() => {})) } });
menu();
