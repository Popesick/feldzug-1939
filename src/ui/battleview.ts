// Schlachtkarte: Hexfelder, Einheiten ziehen und angreifen lassen.
import type { Side } from '../core/types';
import { other } from '../core/types';
import {
  type BUnit, type Battle, BH, BW, HEX_NAME, MAX_BATTLE_TURNS, TURNS_PER_DAY,
  aiBattleTurn, place, setupZone, airStrike, alive, attack, autoResolve, canAttack, concede, endBattleTurn, hexDist, idx, isArt,
  move, neighbors, pos, predict, reachable, sideStrength, sight, unitAt, visibleEnemies,
} from '../core/battle';
import { TYPES } from '../data/units';
import { PROV } from '../data/world';
import { SIDE_COLOR, SIDE_NAME, counter, esc, fitCanvas } from './draw';

const HEX_COLOR = ['#c9cf9e', '#7f9a63', '#b7a676', '#8b7f72', '#93ab9c', '#7fa8c4', '#c9b8a8', '#b3a094'];

export function airSituation(b: Battle, me: Side): string {
  const eff = b.beff?.[me] ?? 1, note = eff < 1 ? ` Feindliche Jäger drücken die Wirkung Ihrer Bomber auf ${eff * 100} %.` : '';
  return (b.sup === me ? 'Du hast die Luftüberlegenheit.'
    : b.sup ? 'Der Gegner hat die Luftüberlegenheit.' : 'Keine Seite hat die Luftüberlegenheit.') + note;
}

import { moveSfx, sfx } from './sound';

export class BattleView {
  b!: Battle;
  private me: Side = 'GER';
  private sel: BUnit | null = null;
  private reach = new Map<number, number>();
  private vis = new Set<number>();
  private hover = -1;
  private airMode = false;
  private asked = false;
  private setup = false; // Verteidiger stellt seine Truppen vor der Schlacht selbst auf
  private done: () => void = () => {};
  private size = 20; private offX = 0; private offY = 0;

  constructor(private cv: HTMLCanvasElement, private panel: HTMLElement, private ask: (text: string, yes: () => void) => void) {
    cv.addEventListener('click', e => this.click(this.pick(e)));
    cv.addEventListener('mousemove', e => {
      const h = this.pick(e);
      if (h !== this.hover) (this.hover = h), this.refresh();
    });
    cv.addEventListener('contextmenu', e => (e.preventDefault(), this.choose(null)));
    panel.addEventListener('click', e => {
      if (cv.hidden) return;
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-bact]')?.dataset.bact;
      if (act === 'ready') this.ready();
      else if (act === 'end') this.endTurn();
      else if (act === 'air') (this.airMode = !this.airMode), this.refresh();
      else if (act === 'auto') (autoResolve(this.b), sfx('battle'), this.finish());
      else if (act === 'quit' && confirm('Schlacht wirklich verloren geben?')) (concede(this.b, this.me), this.finish());
    });
  }

  open(b: Battle, me: Side, done: () => void, setup = false) {
    this.b = b; this.me = me; this.done = done;
    this.sel = null; this.reach.clear(); this.airMode = false; this.hover = -1; this.asked = false;
    this.setup = setup && me !== b.attacker;
    if (this.setup) return this.refresh();
    this.ready();
  }

  /** Aufstellung abgeschlossen (oder gar nicht gewünscht): die Schlacht beginnt. */
  private ready() {
    const b = this.b;
    this.setup = false;
    this.sel = null; this.reach.clear();
    if (b.active !== this.me) this.aiTurn();
    if (b.winner) return this.finish();
    this.refresh();
  }

  /** Zug der KI; was dabei geschossen wird, ist zu hören. */
  private aiTurn() {
    const b = this.b, n = b.log.length;
    aiBattleTurn(b, b.active);
    const lines = b.log.slice(n);
    if (lines.some(l => l.startsWith('Luftangriff'))) sfx('bomb');
    if (lines.some(l => /Art\.-Abt|Artillerie/.test(l.split(' greift ')[0]) && l.includes(' greift '))) sfx('artillery', 0.2);
    if (lines.some(l => /Panzer-Abt|Panzer \(/.test(l.split(' greift ')[0]) && l.includes(' greift '))) sfx('tank', 0.5);
    if (lines.some(l => l.includes(' greift '))) sfx('rifle', 0.8);
  }

  key(k: 'tab' | 'space' | 'enter') {
    const b = this.b;
    if (!b || b.winner || this.setup || b.active !== this.me) return;
    if (k === 'enter') return this.endTurn();
    if (k === 'space' && this.sel) this.sel.done = true;
    this.next();
    this.checkAllDone();
  }

  /** Eine Einheit ist fertig, wenn sie ausgesetzt, gefeuert oder gezogen hat und nichts mehr angreifen kann. */
  private spent(u: BUnit): boolean {
    if (u.done || u.fired) return true;
    return u.moved && !alive(this.b, other(u.side)).some(e => this.vis.has(e.id) && canAttack(this.b, u, e));
  }

  private next() {
    const mine = alive(this.b, this.me), from = this.sel ? mine.indexOf(this.sel) : -1;
    const order = [...mine.slice(from + 1), ...mine.slice(0, from + 1)];
    this.choose(order.find(u => !this.spent(u)) ?? null);
  }

  private checkAllDone() {
    if (this.asked || this.b.winner || alive(this.b, this.me).some(u => !this.spent(u))) return;
    this.asked = true;
    this.ask('Alle Einheiten gezogen. Zug beenden?', () => this.endTurn());
  }

  private finish() {
    this.sel = null;
    this.done();
  }

  private center(i: number): [number, number] {
    const c = i % BW, r = (i / BW) | 0, s = this.size;
    return [this.offX + s * Math.sqrt(3) * (c + 0.5 * (r & 1) + 0.5), this.offY + s * (1.5 * r + 1)];
  }

  private pick(e: MouseEvent): number {
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = this.size;
    for (let i = 0; i < BW * BH; i++) {
      const [cx, cy] = this.center(i), d = Math.hypot(cx - x, cy - y);
      if (d < bd) (bd = d), (best = i);
    }
    return best;
  }

  private choose(u: BUnit | null) {
    this.sel = u;
    this.reach = !u ? new Map() : this.setup ? new Map([...setupZone(this.b)].map(h => [h, 0])) : reachable(this.b, u);
    this.airMode = false;
    this.refresh();
  }

  /** Einheit auf einem Feld, soweit der Spieler sie sehen kann. */
  private shown(h: number): BUnit | undefined {
    const u = unitAt(this.b, h);
    return u && (u.side === this.me || this.vis.has(u.id) || this.b.winner) ? u : undefined;
  }

  private click(h: number) {
    const b = this.b;
    if (this.setup) {
      const u = h >= 0 ? unitAt(b, h) : undefined;
      if (u?.side === this.me) return this.choose(u === this.sel ? null : u);
      if (this.sel && this.reach.has(h)) (place(b, this.sel, h), this.choose(null));
      return;
    }
    if (h < 0 || b.winner || b.active !== this.me) return;
    const u = this.shown(h);
    if (this.airMode) {
      // der Modus bleibt an, bis er abgewählt wird oder die Einsätze des Tages verbraucht sind
      if (u && u.side !== this.me) (airStrike(b, this.me, u), sfx('bomb'));
      if (b.air[this.me] < 1) this.airMode = false;
      return this.refresh();
    }
    if (u && u.side === this.me) return this.choose(u === this.sel ? null : u);
    const s = this.sel;
    if (!s) return;
    if (u && canAttack(b, s, u)) {
      attack(b, s, u);
      sfx(isArt(s) ? 'artillery' : TYPES[s.t].hard ? 'tank' : 'rifle');
      this.choose(null);
      return this.checkAllDone();
    }
    if (!u && this.reach.has(h)) {
      move(b, s, h);
      sfx(moveSfx(TYPES[s.t].move));
      this.vis = visibleEnemies(b, this.me);
      // nach dem Zug ausgewählt lassen, falls noch ein Angriff möglich ist
      this.choose(this.spent(s) ? null : s);
      return this.checkAllDone();
    }
  }

  private endTurn() {
    const b = this.b;
    if (b.winner || b.active !== this.me) return;
    endBattleTurn(b);
    if (!b.winner) this.aiTurn();
    this.sel = null; this.reach.clear(); this.asked = false; this.airMode = false;
    if (b.winner) return this.finish();
    this.refresh();
  }

  refresh() {
    if (!this.b) return;
    this.vis = visibleEnemies(this.b, this.me);
    this.draw();
    this.renderPanel();
  }

  draw() {
    const cv = this.cv, b = this.b;
    if (!b || !cv.clientWidth) return;
    const ctx = fitCanvas(cv), W = cv.clientWidth, H = cv.clientHeight;
    const s = (this.size = Math.min(W / (Math.sqrt(3) * (BW + 0.5)), H / (1.5 * BH + 0.5)));
    this.offX = (W - s * Math.sqrt(3) * (BW + 0.5)) / 2;
    this.offY = (H - s * (1.5 * BH + 0.5)) / 2;
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, W, H);
    const hexPath = (i: number, k = 1) => {
      const [x, y] = this.center(i);
      ctx.beginPath();
      for (let a = 0; a < 6; a++) ctx.lineTo(x + s * k * Math.sin((a * Math.PI) / 3), y - s * k * Math.cos((a * Math.PI) / 3));
      ctx.closePath();
    };
    const mine = alive(b, this.me);
    for (let i = 0; i < BW * BH; i++) {
      hexPath(i);
      ctx.fillStyle = HEX_COLOR[b.terr[i]];
      ctx.fill();
      // Nebel des Krieges: Felder außerhalb der eigenen Sicht abdunkeln
      if (!b.winner && !mine.some(u => hexDist(pos(u), i) <= sight(b, u))) {
        ctx.fillStyle = '#1b1e2466';
        ctx.fill();
      }
      ctx.strokeStyle = '#0000002a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Straßen
    ctx.strokeStyle = '#7a5a36';
    ctx.lineWidth = Math.max(2, s * 0.14);
    ctx.beginPath();
    for (let i = 0; i < BW * BH; i++) {
      if (!b.road[i]) continue;
      const [x, y] = this.center(i);
      for (const n of neighbors(i)) {
        if (n < i || !b.road[n]) continue;
        const [nx, ny] = this.center(n);
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
      }
    }
    ctx.stroke();
    // Ziele
    for (const o of b.obj) {
      hexPath(idx(o.c, o.r), 0.86);
      ctx.strokeStyle = SIDE_COLOR[o.owner];
      ctx.lineWidth = o.main ? 5 : 3;
      ctx.stroke();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Zugreichweite und mögliche Ziele
    const sel = this.sel;
    if (sel) {
      ctx.fillStyle = '#ffffff4d';
      for (const h of this.reach.keys()) {
        // Artillerie: Nachbarfelder lassen noch einen Feuerbefehl zu
        ctx.fillStyle = isArt(sel) && hexDist(pos(sel), h) === 1 ? '#fff3a8aa' : '#ffffff4d';
        hexPath(h, 0.92);
        ctx.fill();
      }
      hexPath(pos(sel), 0.95);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    }
    const cw = s * 1.25, ch = s * 0.9;
    for (const u of alive(b)) {
      if (u.side !== this.me && !this.vis.has(u.id) && !b.winner) continue;
      const [x, y] = this.center(pos(u));
      counter(ctx, x, y - 1, cw, ch, u.side, TYPES[u.t].sym, { dim: u.side === b.active && u.side === this.me && this.spent(u) });
      ctx.font = `700 ${Math.max(9, s * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2.5;
      ctx.strokeText(String(u.s), x + cw / 2 - 2, y + ch / 2 + 2);
      ctx.fillText(String(u.s), x + cw / 2 - 2, y + ch / 2 + 2);
      for (let e = 0; e < u.ent; e++) {
        ctx.fillStyle = '#3b2f1e';
        ctx.fillRect(x - cw / 2 + e * 5, y + ch / 2, 4, 3);
      }
      if (u.cut || u.oos) {
        // eingeschlossen bzw. ohne Nachschub
        ctx.fillStyle = '#d8301f';
        ctx.strokeText('!', x - cw / 2 + 1, y - ch / 2 + 6);
        ctx.fillText('!', x - cw / 2 + 1, y - ch / 2 + 6);
      }
      if (u.setup > 0) {
        // Artillerie ist aufgeprotzt und feuert in diesem Zug nicht
        ctx.fillStyle = '#f0a020';
        ctx.beginPath(); ctx.arc(x + cw / 2 - 2, y - ch / 2 + 1, 3.5, 0, 7); ctx.fill(); ctx.stroke();
      }
      const target = this.airMode ? u.side !== this.me : sel && canAttack(b, sel, u);
      if (target) {
        hexPath(pos(u), 0.95);
        ctx.strokeStyle = '#d8301f'; ctx.lineWidth = 3; ctx.stroke();
      }
    }
  }

  private unitInfo(u: BUnit): string {
    const t = TYPES[u.t], b = this.b;
    const state = [
      u.cut ? '<span class="bad">eingeschlossen: kämpft schlechter, verliert Stärke</span>' : '',
      u.oos ? '<span class="bad">Division ohne Nachschub</span>' : '',
      u.setup > 0 ? 'aufgeprotzt verlegt: feuert erst im nächsten Zug wieder' : isArt(u) && u.moved && !u.fired ? 'ein Feld nachgerückt: noch feuerbereit' : '',
      isArt(u) && !u.moved && u.side === this.me ? 'Ein Feld ziehen (gelb): feuert noch. Weiter ziehen: feuert erst nächsten Zug.' : '',
      u.done ? 'setzt aus' : '',
    ].filter(Boolean).join(' · ');
    return `<div class="div ${u.side}"><label>${esc(t.name[u.side])}</label>
      <div class="meta">${esc(b.divNames[u.div])}${u.side === this.me && b.divLvl?.[u.div] ? ` · ${b.divLvl[u.div]}` : ''}</div>
      <div class="meta">Stärke ${u.s} · Angriff ${t.sa}/${t.ha} · Abwehr ${t.def} · Bewegung ${t.mp} · Sicht ${sight(b, u)}${isArt(u) ? ` · Reichweite ${t.rng}` : ''}${u.ent ? ` · eingegraben ${u.ent}` : ''}${u.ga || u.gd ? ` · General: Angriff +${u.ga ?? 0}, Abwehr +${u.gd ?? 0}` : ''}</div>
      <div class="meta">${HEX_NAME[b.terr[pos(u)]]}${b.road[pos(u)] ? ' · Straße' : ''}</div>${state ? `<div class="meta">${state}</div>` : ''}</div>`;
  }

  renderPanel() {
    const b = this.b, me = this.me, en = other(me);
    const bar = (side: Side) => {
      const pct = Math.round((100 * sideStrength(b, side)) / b.init[side]);
      // die genaue Feindstärke kennt man nicht, nur den eigenen Balken
      const num = side === me || b.winner ? `${sideStrength(b, side)}/${b.init[side]}` : `ca. ${Math.round(pct / 10) * 10} %`;
      return `<div>${SIDE_NAME[side]}${side === b.attacker ? ' (Angreifer)' : ' (Verteidiger)'}: ${num}</div><div class="bar"><i style="width:${pct}%;background:${SIDE_COLOR[side]}"></i><u></u></div>`;
    };
    const hu = this.hover >= 0 ? this.shown(this.hover) : undefined;
    let pred = '';
    if (this.sel && hu && hu.side === en && canAttack(b, this.sel, hu)) {
      const p = predict(b, this.sel, hu);
      pred = `<div class="meta">Erwartete Verluste: Gegner <b>−${p.dl.toFixed(1)}</b>, eigene <b>−${p.al.toFixed(1)}</b></div>`;
    }
    const myTurn = b.active === me && !b.winner && !this.setup;
    const turn = Math.min(b.turn, MAX_BATTLE_TURNS);
    const objs = b.obj.map(o => `<span class="chip" style="border-left:4px solid ${SIDE_COLOR[o.owner]}">${o.main ? 'Hauptort' : 'Ortschaft'}</span>`).join(' ');
    this.panel.innerHTML = `<h2>Schlacht um ${esc(PROV[b.prov].name)}</h2>
      <div class="dim">Zug ${turn} von ${MAX_BATTLE_TURNS} · Tag ${Math.ceil(turn / TURNS_PER_DAY)} von ${MAX_BATTLE_TURNS / TURNS_PER_DAY}</div>
      <h3>Lage</h3>${bar(b.attacker)}${bar(other(b.attacker))}
      <div class="chips">${objs}</div>
      <h3>Luftlage</h3>
      <div class="${b.sup === en ? 'bad' : ''}"><b>${airSituation(b, me)}</b></div>
      <div class="meta">Jäger ${b.fighters[me]} : ${b.fighters[en]} · eigene Bomberstaffeln ${b.bombers[me]}, heute noch ${b.air[me]} ${b.air[me] === 1 ? 'Einsatz' : 'Einsätze'}${b.lostB[me] ? ` · <span class="bad">${b.lostB[me]} verloren</span>` : ''}</div>
      ${this.setup ? `<h3>Aufstellung</h3><div>Einheit anklicken, dann ein helles Feld: Dorthin wird sie gestellt. Die Verschanzung bleibt erhalten. Der Angreifer kommt von ${b.edges.map(e => ({ W: 'Westen', E: 'Osten', N: 'Norden', S: 'Süden' })[e]).filter((x, i, a) => a.indexOf(x) === i).join(' und ')}.</div>
        <div class="row"><button class="primary" data-bact="ready">Aufstellung abschließen</button></div>` : ''}
      <div class="row"${this.setup ? ' style="display:none"' : ''}>
        <button class="primary" data-bact="end" ${myTurn ? '' : 'disabled'}>Zug beenden</button>
        <button data-bact="air" class="${this.airMode ? 'on' : ''}" ${myTurn && (b.air[me] > 0 || this.airMode) ? '' : 'disabled'}>${this.airMode ? `Luftangriff abbrechen (${b.air[me]})` : `Luftangriff (${b.air[me]})`}</button>
        <button data-bact="auto">Rest automatisch</button>
        <button data-bact="quit">${me === b.attacker ? 'Angriff abbrechen' : 'Feld räumen'}</button>
      </div>
      ${this.airMode ? `<div class="bad">Jeder Klick auf ein sichtbares Ziel ist ein Luftangriff, bis Sie „Luftangriff abbrechen“ wählen.</div>` : ''}
      <h3>Auswahl</h3>${this.sel ? this.unitInfo(this.sel) : '<div class="dim">Eigene Einheit anklicken. Helle Felder sind erreichbar, rot umrandete Gegner angreifbar. Dunkle Felder liegen außerhalb der Sicht.</div>'}
      ${hu && hu !== this.sel ? this.unitInfo(hu) : this.hover >= 0 && !hu ? `<div class="meta">${HEX_NAME[b.terr[this.hover]]}${b.terr[this.hover] === 5 ? (b.road[this.hover] ? ' · Brücke' : ' · nur für Pioniere; wo ein Pionier im Fluss steht, können eigene Truppen hinüber') : b.road[this.hover] ? ' · Straße' : ''}</div>` : ''}${pred}
      <div class="hint"><b>Tab</b> nächste Einheit · <b>Leertaste</b> Einheit setzt aus · <b>Enter</b> Zug beenden. Flüsse überquert man nur auf Brücken (Straße) oder über Pioniere, die im Fluss stehen; auf einem Pionier bleibt niemand stehen. Der Angreifer gewinnt, wenn er alle Ziele nimmt, den Hauptort am Ende hält oder die Verteidiger unter 35 % drückt.</div>
      <h3>Gefechtsmeldungen</h3><div class="blog">${b.log.slice(-12).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
  }
}
