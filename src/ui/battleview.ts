// Schlachtkarte: Hexfelder, Einheiten ziehen und angreifen lassen.
import type { Side } from '../core/types';
import { other } from '../core/types';
import {
  type BUnit, type Battle, BH, BW, HEX_NAME, MAX_BATTLE_TURNS,
  aiBattleTurn, airStrike, alive, attack, autoResolve, canAttack, concede, endBattleTurn, idx, isArt,
  move, neighbors, pos, predict, reachable, sideStrength, unitAt,
} from '../core/battle';
import { TYPES } from '../data/units';
import { PROV } from '../data/world';
import { SIDE_COLOR, SIDE_NAME, counter, esc, fitCanvas } from './draw';

const HEX_COLOR = ['#c9cf9e', '#7f9a63', '#b7a676', '#8b7f72', '#93ab9c', '#7fa8c4', '#c9b8a8', '#b3a094'];

export class BattleView {
  b!: Battle;
  private me: Side = 'GER';
  private sel: BUnit | null = null;
  private reach = new Map<number, number>();
  private hover = -1;
  private airMode = false;
  private done: () => void = () => {};
  private size = 20; private offX = 0; private offY = 0;

  constructor(private cv: HTMLCanvasElement, private panel: HTMLElement) {
    cv.addEventListener('click', e => this.click(this.pick(e)));
    cv.addEventListener('mousemove', e => {
      const h = this.pick(e);
      if (h !== this.hover) (this.hover = h), this.refresh();
    });
    cv.addEventListener('contextmenu', e => (e.preventDefault(), this.choose(null)));
    panel.addEventListener('click', e => {
      if (cv.hidden) return;
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-bact]')?.dataset.bact;
      if (act === 'end') this.endTurn();
      else if (act === 'air') (this.airMode = !this.airMode), this.refresh();
      else if (act === 'auto') (autoResolve(this.b), this.finish());
      else if (act === 'quit' && confirm('Schlacht wirklich verloren geben?')) (concede(this.b, this.me), this.finish());
    });
  }

  open(b: Battle, me: Side, done: () => void) {
    this.b = b; this.me = me; this.done = done;
    this.sel = null; this.reach.clear(); this.airMode = false; this.hover = -1;
    if (b.active !== me) aiBattleTurn(b, b.active);
    if (b.winner) return this.finish();
    this.refresh();
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
    this.reach = u ? reachable(this.b, u) : new Map();
    this.airMode = false;
    this.refresh();
  }

  private click(h: number) {
    const b = this.b;
    if (h < 0 || b.winner || b.active !== this.me) return;
    const u = unitAt(b, h);
    if (this.airMode) {
      if (u && u.side !== this.me) airStrike(b, this.me, u);
      this.airMode = false;
      return this.refresh();
    }
    if (u && u.side === this.me) return this.choose(u === this.sel ? null : u);
    const s = this.sel;
    if (!s) return;
    if (u && canAttack(b, s, u)) {
      attack(b, s, u);
      return this.choose(null);
    }
    if (!u && this.reach.has(h)) {
      move(b, s, h);
      // nach dem Zug gleich ausgewählt lassen, falls noch ein Angriff möglich ist
      const can = alive(b, other(this.me)).some(e => canAttack(b, s, e));
      return this.choose(can ? s : null);
    }
  }

  private endTurn() {
    const b = this.b;
    if (b.winner || b.active !== this.me) return;
    endBattleTurn(b);
    if (!b.winner) aiBattleTurn(b, b.active);
    this.sel = null; this.reach.clear();
    if (b.winner) return this.finish();
    this.refresh();
  }

  refresh() {
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
    for (let i = 0; i < BW * BH; i++) {
      hexPath(i);
      ctx.fillStyle = HEX_COLOR[b.terr[i]];
      ctx.fill();
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
      for (const h of this.reach.keys()) (hexPath(h, 0.92), ctx.fill());
      hexPath(pos(sel), 0.95);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    }
    const cw = s * 1.25, ch = s * 0.9;
    for (const u of alive(b)) {
      const [x, y] = this.center(pos(u));
      const spent = u.side === b.active && (u.fired || (u.moved && !alive(b, other(u.side)).some(e => canAttack(b, u, e))));
      counter(ctx, x, y - 1, cw, ch, u.side, TYPES[u.t].sym, { dim: spent });
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
      const target = this.airMode ? u.side !== this.me : sel && canAttack(b, sel, u);
      if (target) {
        hexPath(pos(u), 0.95);
        ctx.strokeStyle = '#d8301f'; ctx.lineWidth = 3; ctx.stroke();
      }
    }
  }

  private unitInfo(u: BUnit): string {
    const t = TYPES[u.t], b = this.b;
    return `<div class="div ${u.side}"><label>${esc(t.name[u.side])}</label>
      <div class="meta">${esc(b.divNames[u.div])}</div>
      <div class="meta">Stärke ${u.s} · Angriff ${t.sa}/${t.ha} · Abwehr ${t.def} · Bewegung ${t.mp}${isArt(u) ? ` · Reichweite ${t.rng}` : ''}${u.ent ? ` · eingegraben ${u.ent}` : ''}</div>
      <div class="meta">${HEX_NAME[b.terr[pos(u)]]}${b.road[pos(u)] ? ' · Straße' : ''}</div></div>`;
  }

  renderPanel() {
    const b = this.b, me = this.me, en = other(me);
    const bar = (side: Side) => {
      const pct = Math.round((100 * sideStrength(b, side)) / b.init[side]);
      return `<div>${SIDE_NAME[side]}${side === b.attacker ? ' (Angreifer)' : ' (Verteidiger)'}: ${sideStrength(b, side)}/${b.init[side]}</div><div class="bar"><i style="width:${pct}%;background:${SIDE_COLOR[side]}"></i><u></u></div>`;
    };
    const hu = this.hover >= 0 ? unitAt(b, this.hover) : undefined;
    let pred = '';
    if (this.sel && hu && hu.side === en && canAttack(b, this.sel, hu)) {
      const p = predict(b, this.sel, hu);
      pred = `<div class="meta">Erwartete Verluste: Gegner <b>−${p.dl.toFixed(1)}</b>, eigene <b>−${p.al.toFixed(1)}</b></div>`;
    }
    const myTurn = b.active === me && !b.winner;
    const objs = b.obj.map(o => `<span class="chip" style="border-left:4px solid ${SIDE_COLOR[o.owner]}">${o.main ? 'Hauptort' : 'Ortschaft'}</span>`).join(' ');
    this.panel.innerHTML = `<h2>Schlacht um ${esc(PROV[b.prov].name)}</h2>
      <div class="dim">Zug ${Math.min(b.turn, MAX_BATTLE_TURNS)} von ${MAX_BATTLE_TURNS} · je Zug rund 6 Stunden</div>
      <h3>Lage</h3>${bar(b.attacker)}${bar(other(b.attacker))}
      <div class="chips">${objs}</div>
      <div class="hint">Der Angreifer gewinnt, wenn er alle Ziele nimmt, den Hauptort am Ende hält oder die Verteidiger unter 35 % ihrer Stärke drückt (Marke im Balken).</div>
      <div class="row">
        <button class="primary" data-bact="end" ${myTurn ? '' : 'disabled'}>Zug beenden</button>
        <button data-bact="air" class="${this.airMode ? 'on' : ''}" ${myTurn && b.air[me] > 0 ? '' : 'disabled'}>Luftangriff (${b.air[me]})</button>
        <button data-bact="auto">Rest automatisch</button>
        <button data-bact="quit">${me === b.attacker ? 'Angriff abbrechen' : 'Feld räumen'}</button>
      </div>
      ${this.airMode ? '<div class="bad">Ziel für den Luftangriff anklicken.</div>' : ''}
      <h3>Auswahl</h3>${this.sel ? this.unitInfo(this.sel) : '<div class="dim">Eigene Einheit anklicken. Helle Felder sind erreichbar, rot umrandete Gegner angreifbar. Artillerie schießt nur, wenn sie nicht gezogen ist.</div>'}
      ${hu && hu !== this.sel ? this.unitInfo(hu) : this.hover >= 0 && !hu ? `<div class="meta">${HEX_NAME[b.terr[this.hover]]}${b.road[this.hover] ? ' · Straße' : ''}</div>` : ''}${pred}
      <h3>Gefechtsmeldungen</h3><div class="blog">${b.log.slice(-12).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
  }
}
