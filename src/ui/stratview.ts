// Strategiekarte: Provinzen, Truppenzähler, Befehle per Rechtsklick oder Seitenleiste.
import type { Division, GameState, UnitType } from '../core/types';
import { other } from '../core/types';
import { MAP, PLIST, PROV, TERRAIN_NAME } from '../data/world';
import { TEMPLATES, TYPES } from '../data/units';
import { type MoveTarget, STACK, XP_LEVELS, XP_MAX, airAt, airFree, assignAir, divsIn, estimate, airVal, isFree, moveTargets, orderMove, pruneFollows, seenProvs, strength, tp, xpLevel, xpOf } from '../core/game';
import { COUNTRIES, UNIT_COLOR } from '../data/europa';
import { SIDE_NAME, counter, esc, fitCanvas } from './draw';
import { ARMY_MAX, ownArmies as armies, armyOf, formArmy, joinArmy, leaveArmy, members, rankName, traitText } from '../core/army';
import { GENERAL } from '../data/generals';
import { airEdge, airVals, canBomb, damageAt, indLeft, sbFree, sbQ, sbTotal, setBomb } from '../core/airwar';

const COUNTRY: Record<string, string> = {
  GER: 'Deutsches Reich', DZG: 'Freie Stadt Danzig', SVK: 'Slowakei', POL: 'Polen', LTU: 'Litauen', LVA: 'Lettland',
  SOV: 'Sowjetunion', ROM: 'Rumänien', HUN: 'Ungarn', DNK: 'Dänemark', SWE: 'Schweden', CHE: 'Schweiz', ITA: 'Italien', YUG: 'Jugoslawien',
};
const SYM_RANK: UnitType['sym'][] = ['inf', 'mtn', 'cav', 'mot', 'arm'];
export const divSym = (d: Division) => TYPES[TEMPLATES[d.kind].units[0].split(':')[0] as keyof typeof TYPES].sym;

function ringPath(rings: number[][]): Path2D {
  const p = new Path2D();
  for (const r of rings) {
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    p.closePath();
  }
  return p;
}

interface Plan { from: string; to: string; divs: Division[]; follow?: boolean }

export class StratView {
  k = 1; ox = 0; oy = 0;
  sel: string | null = null;
  selDivs = new Set<number>();
  mode: 'ground' | 'air' = 'ground'; // Boden- oder Luftansicht
  private land = new Path2D();
  private lakes = new Path2D();
  private rivers = new Path2D();
  private paths: Record<string, Path2D> = {};
  private fitted = false;
  /** Europa: Kriegserklärung aus der Seitenleiste. */
  onWar: (country: string) => void = () => {};
  private helpOpen = false;

  constructor(
    private cv: HTMLCanvasElement,
    private panel: HTMLElement,
    private game: () => GameState,
    private locked: () => boolean,
    private changed: () => void,
  ) {
    this.reload();
    this.bind();
  }

  /** Nach einem Wechsel der Karte (Szenario) die Zeichenpfade neu aufbauen. */
  reload() {
    this.land = ringPath(MAP.land);
    this.lakes = ringPath(MAP.lakes);
    this.rivers = new Path2D();
    for (const r of MAP.rivers) {
      this.rivers.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) this.rivers.lineTo(r[i], r[i + 1]);
    }
    this.paths = {};
    for (const p of PLIST) this.paths[p.id] = ringPath([p.poly]);
    this.fitted = false;
    this.sel = null;
    this.selDivs.clear();
  }

  /** Verbände, die der Spieler selbst führt (in Europa nur die deutschen, nicht die der Verbündeten). */
  private own = (d: Division) => d.side === this.game().player && (!this.game().eu || d.nation === 'GER' || !!d.ctl);

  private bind() {
    const cv = this.cv;
    let down: { x: number; y: number; ox: number; oy: number; drag: boolean } | null = null;
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, drag: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.drag && Math.hypot(dx, dy) < 5) return;
      down.drag = true;
      this.ox = down.ox + dx;
      this.oy = down.oy + dy;
      this.draw();
    });
    cv.addEventListener('pointerup', e => {
      if (down && !down.drag) this.select(this.pick(e));
      down = null;
    });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = this.pick(e);
      if (id) this.orderTo(id);
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const nk = Math.min(6, Math.max(MAP.w > 5000 ? 0.07 : 0.35, this.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      this.ox = mx - ((mx - this.ox) * nk) / this.k;
      this.oy = my - ((my - this.oy) * nk) / this.k;
      this.k = nk;
      this.draw();
    }, { passive: false });
    this.panel.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      const g = this.game(), id = +(t.dataset.div ?? 0), act = t.dataset.act;
      if (act === 'jump') return this.select(t.dataset.prov!);
      if (act === 'war') return this.onWar(t.dataset.c!);
      if (act === 'toggle') this.selDivs.has(id) ? this.selDivs.delete(id) : this.selDivs.add(id);
      else if (act === 'army-sel') this.selDivs = new Set(divsIn(g, this.sel!, g.player).filter(d => d.arm === +t.dataset.army! && this.own(d)).map(d => d.id));
      else if (act === 'army-new') formArmy(g, this.chosen());
      else if (act === 'army-join') joinArmy(g, armies(g).find(a => a.id === +t.dataset.army!)!, this.chosen());
      else if (act === 'army-leave') leaveArmy(g, this.chosen());
      else if (this.locked()) return;
      else if (act === 'go') return this.orderTo(t.dataset.prov!);
      else if (act === 'cancel') {
        // einzelner Verband oder der ganze Angriff auf eine Provinz
        const hit = (d: Division, to?: string | null) => !!to && (id ? d.id === id : to === t.dataset.prov && (!t.dataset.from || d.prov === t.dataset.from));
        for (const d of g.divs) {
          if (!this.own(d)) continue;
          if (t.dataset.follow) hit(d, d.follow) && (d.follow = null);
          else if (hit(d, d.order)) d.order = null;
        }
        // ohne den Angriff wird kein Platz frei: wer dafür nachrücken sollte, bleibt stehen
        pruneFollows(g);
      }
      this.changed();
    });
    // Staffeln je Sektor per Schieberegler: beim Ziehen läuft die Zahl mit, beim Loslassen wird zugeteilt
    // die Hilfe bleibt auf- oder zugeklappt, auch wenn die Leiste neu gezeichnet wird
    this.panel.addEventListener('toggle', e => {
      const t = e.target as HTMLDetailsElement;
      if (t.classList?.contains('help')) this.helpOpen = t.open;
    }, true);
    this.panel.addEventListener('input', e => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.air || t.dataset.sb) t.parentElement!.querySelector('b')!.textContent = t.value;
    });
    this.panel.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.sb && !this.locked()) {
        setBomb(this.game(), t.dataset.sb, +t.value);
        return this.changed();
      }
      if (!t.dataset.air || this.locked()) return;
      const g = this.game(), kind = t.dataset.air as 'f' | 'b', prov = t.dataset.prov!;
      const now = () => g.airAssign[g.player][prov]?.[kind] ?? 0;
      for (let i = 0; i < 200 && now() !== +t.value; i++) {
        const before = now();
        assignAir(g, g.player, prov, kind, +t.value > before ? 1 : -1);
        if (now() === before) break;
      }
      this.changed();
    });
  }

  private pick(e: MouseEvent): string | null {
    const r = this.cv.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.k, y = (e.clientY - r.top - this.oy) / this.k;
    let best: string | null = null, bd = this.game().eu ? 260 : 80;
    for (const p of PLIST) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) (bd = d), (best = p.id);
    }
    return best;
  }

  select(id: string | null) {
    const g = this.game();
    this.sel = id;
    this.selDivs = new Set(id ? divsIn(g, id, g.player).filter(d => this.own(d) && d.mp > 0 && !d.order && !d.follow).map(d => d.id) : []);
    this.changed();
  }

  /** Provinzen, in denen noch Verbände ohne Befehl stehen. */
  freeProvs(): string[] {
    const g = this.game();
    const has = new Set(g.divs.filter(d => this.own(d) && isFree(d)).map(d => d.prov));
    return PLIST.filter(p => has.has(p.id)).map(p => p.id);
  }

  /** Tab: zur nächsten Provinz mit freien Verbänden springen. */
  nextFree() {
    const list = this.freeProvs();
    if (!list.length) return this.select(null);
    const all = PLIST.map(p => p.id), from = this.sel ? all.indexOf(this.sel) : -1;
    const next = list.find(id => all.indexOf(id) > from) ?? list[0];
    const p = PROV[next], W = this.cv.clientWidth, H = this.cv.clientHeight;
    const x = p.x * this.k + this.ox, y = p.y * this.k + this.oy;
    if (x < 60 || y < 60 || x > W - 60 || y > H - 60) (this.ox = W / 2 - p.x * this.k), (this.oy = H / 2 - p.y * this.k);
    this.select(next);
    this.selDivs = new Set(divsIn(this.game(), next, this.game().player).filter(d => this.own(d) && isFree(d)).map(d => d.id));
    this.changed();
  }

  /** Leertaste: die ausgewählten Verbände setzen diese Runde aus. */
  skip() {
    if (this.locked()) return;
    for (const d of this.chosen()) if (isFree(d)) d.done = true;
    this.nextFree();
  }

  private chosen(): Division[] {
    const g = this.game();
    return g.divs.filter(d => this.selDivs.has(d.id) && d.prov === this.sel && this.own(d));
  }

  private targets(): Map<string, MoveTarget> {
    const out = new Map<string, MoveTarget>();
    if (this.locked()) return out;
    for (const d of this.chosen()) for (const t of moveTargets(this.game(), d)) if (!out.has(t.prov) || t.attack) out.set(t.prov, t);
    return out;
  }

  orderTo(prov: string) {
    if (this.locked() || !this.targets().has(prov)) return;
    const g = this.game();
    let moved = false;
    for (const d of this.chosen()) if (orderMove(g, d, prov) === 'moved') moved = true;
    if (moved) {
      // Auswahl folgt den Verbänden, die noch weiterziehen können
      this.sel = prov;
      this.selDivs = new Set(divsIn(g, prov, g.player).filter(d => d.mp > 0 && this.selDivs.has(d.id)).map(d => d.id));
    } else this.selDivs = new Set(this.chosen().filter(d => !d.order && !d.follow).map(d => d.id));
    this.changed();
  }

  /** Vorgemerkte Angriffe, gebündelt nach Ausgangs- und Zielprovinz. */
  private plans(): Plan[] {
    const g = this.game(), out: Plan[] = [];
    for (const d of g.divs) {
      const to = d.order ?? d.follow, follow = !d.order;
      if (!this.own(d) || !to) continue;
      let p = out.find(p => p.from === d.prov && p.to === to && !p.follow === !follow);
      if (!p) out.push((p = { from: d.prov, to, divs: [], follow }));
      p.divs.push(d);
    }
    return out;
  }

  /** Geschätzte Feindstärke in einer Provinz; null ohne Aufklärung. */
  private enemyEstimate(prov: string, seen: Set<string>): number | null {
    const g = this.game();
    if (!seen.has(prov)) return null;
    return divsIn(g, prov, other(g.player)).reduce((a, d) => a + estimate(d, g.turn), 0);
  }

  private fit() {
    const eu = !!this.game().eu, W = this.cv.clientWidth, H = this.cv.clientHeight;
    // Europa: Ausschnitt um das Reich; Polen 1939: das ganze Kampfgebiet
    const pol = eu ? [PROV.berlin] : PLIST.filter(p => p.side0 === 'POL');
    const m = eu ? 430 : 40;
    const x0 = Math.min(...pol.map(p => p.x)) - (eu ? m : 260), x1 = Math.max(...pol.map(p => p.x)) + m;
    const y0 = Math.min(...pol.map(p => p.y)) - m, y1 = Math.max(...pol.map(p => p.y)) + m;
    this.k = Math.min(W / (x1 - x0), H / (y1 - y0));
    this.ox = (W - (x0 + x1) * this.k) / 2;
    this.oy = (H - (y0 + y1) * this.k) / 2;
    this.fitted = true;
  }

  draw() {
    const g = this.game(), cv = this.cv;
    if (!cv.clientWidth) return;
    const ctx = fitCanvas(cv);
    if (!this.fitted) this.fit();
    const { k, ox, oy } = this, W = cv.clientWidth, H = cv.clientHeight;
    const seen = seenProvs(g, g.player);
    ctx.fillStyle = '#a9c2d1';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    ctx.save();
    ctx.clip(this.land, 'evenodd');
    const targets = this.targets();
    for (const p of PLIST) {
      const c = g.ctrl[p.id];
      ctx.fillStyle = g.eu ? COUNTRIES[g.eu.owner[p.id]]?.color ?? '#d3cfc5' : c === 'NEU' ? '#d3cfc5'
        : c === 'GER' ? (p.side0 === 'POL' ? '#9c9a78' : p.country === 'GER' ? '#a7ad98' : '#b6baa4')
        : p.side0 === 'POL' ? '#e4d3a0' : '#e6bf86';
      ctx.fill(this.paths[p.id]);
      if (c === other(g.player) && !seen.has(p.id) && !g.over) {
        ctx.fillStyle = '#3a342c33'; // nicht aufgeklärt
        ctx.fill(this.paths[p.id]);
      }
      if (this.mode === 'air' && c !== 'NEU') {
        // je mehr eigene Staffeln hier wirken, desto kräftiger das Blau
        const eff = airAt(g, g.player, p.id), n = eff.f + eff.b;
        if (n) {
          ctx.fillStyle = `rgba(40, 90, 160, ${Math.min(0.6, 0.18 + n * 0.05)})`;
          ctx.fill(this.paths[p.id]);
        }
      } else if (targets.has(p.id)) {
        const t = targets.get(p.id)!;
        ctx.fillStyle = t.attack ? '#c8553d77' : t.kind === 'rail' ? '#3f9a5544' : t.kind === 'sea' ? '#2f6fb866' : t.kind === 'follow' ? '#3f9a5588' : '#ffffff66';
        ctx.fill(this.paths[p.id]);
      }
    }
    const thin = new Path2D(), nat = new Path2D(), front = new Path2D();
    for (const [a, b, x1, y1, x2, y2] of MAP.edges) {
      const pa = PROV[a], pb = PROV[b];
      const t = g.ctrl[a] !== g.ctrl[b] && g.ctrl[a] !== 'NEU' && g.ctrl[b] !== 'NEU' ? front : (g.eu ? g.eu.owner[a] !== g.eu.owner[b] : pa.country !== pb.country) ? nat : thin;
      t.moveTo(x1, y1);
      t.lineTo(x2, y2);
    }
    ctx.lineWidth = 0.7 / k; ctx.strokeStyle = '#0000002e'; ctx.stroke(thin);
    ctx.lineWidth = 2.2 / k; ctx.strokeStyle = '#3c3a36'; ctx.stroke(nat);
    ctx.lineWidth = 3.5 / k; ctx.strokeStyle = '#a02a1c'; ctx.stroke(front);
    if (this.sel) {
      ctx.lineWidth = 3 / k; ctx.strokeStyle = '#fff';
      ctx.stroke(this.paths[this.sel]);
    }
    ctx.restore();
    ctx.lineWidth = 1 / k; ctx.strokeStyle = '#4a6578'; ctx.stroke(this.land);
    ctx.fillStyle = '#a9c2d1'; ctx.fill(this.lakes, 'evenodd');
    ctx.lineWidth = 1.3 / k; ctx.strokeStyle = '#6f9cba'; ctx.stroke(this.rivers);
    ctx.restore();

    const sx = (x: number) => x * k + ox, sy = (y: number) => y * k + oy;
    ctx.textAlign = 'center';
    for (const p of PLIST) {
      const x = sx(p.x), y = sy(p.y);
      if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      ctx.fillStyle = '#2a2a28';
      ctx.beginPath();
      ctx.arc(x, y, p.vp ? 3.5 : 2, 0, 7);
      ctx.fill();
      if (k > 0.95 || (p.vp && (k > 0.22 || p.vp >= 3))) {
        ctx.font = `${p.vp ? '600 12px' : '10px'} system-ui, sans-serif`;
        ctx.fillStyle = g.ctrl[p.id] === 'NEU' ? '#77736b' : '#1f1f1d';
        ctx.fillText(p.name + (p.vp ? ` ★${p.vp}` : ''), x, y + 14);
      }
      const air = g.airAssign[g.player][p.id];
      if (air && this.mode === 'ground') {
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillStyle = '#1d3f66';
        ctx.fillText(`✈ ${air.f}J ${air.b}B`, x, y + 26);
      }
    }
    if (this.mode === 'air') return this.drawAir(ctx, sx, sy);
    // Angriffsbefehle
    ctx.lineWidth = 3;
    const plans = this.plans();
    for (const pl of plans) {
      ctx.strokeStyle = ctx.fillStyle = pl.follow ? '#2f7d46' : '#b3261a';
      ctx.setLineDash(pl.follow ? [7, 5] : []);
      const a = PROV[pl.from], b = PROV[pl.to];
      const x1 = sx(a.x), y1 = sy(a.y) - 16, x2 = sx(b.x), y2 = sy(b.y) - 16, an = Math.atan2(y2 - y1, x2 - x1);
      const ex = x2 - Math.cos(an) * 20, ey = y2 - Math.sin(an) * 20;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(an) * 9, ey + Math.sin(an) * 9);
      ctx.lineTo(ex + Math.cos(an + 2.5) * 9, ey + Math.sin(an + 2.5) * 9);
      ctx.lineTo(ex + Math.cos(an - 2.5) * 9, ey + Math.sin(an - 2.5) * 9);
      ctx.fill();
    }
    ctx.setLineDash([]);
    // Truppenzähler je Provinz
    const stacks = new Map<string, Division[]>();
    for (const d of g.divs) {
      if (d.side !== g.player && !seen.has(d.prov) && !g.over) continue;
      stacks.set(d.prov, [...(stacks.get(d.prov) ?? []), d]);
    }
    for (const [id, ds] of stacks) {
      const p = PROV[id], x = sx(p.x), y = sy(p.y) - 16;
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
      const sym = SYM_RANK[Math.max(...ds.map(d => SYM_RANK.indexOf(divSym(d))))];
      const ready = ds.some(d => this.own(d) && isFree(d));
      // Europa: Farbe nach Staat, deutsche Verbände bestimmen den Stapel
      const lead = ds.find(d => d.nation === 'GER') ?? ds[0];
      const fill = g.eu ? UNIT_COLOR[lead.nation] ?? (lead.side === 'GER' ? '#a3a886' : '#c9a24b') : undefined;
      if (ds.length > 1) counter(ctx, x + 3, y - 3, 30, 20, ds[0].side, 'art', { dim: true, fill });
      counter(ctx, x, y, 30, 20, ds[0].side, sym, { edge: ready ? '#fff' : '#1b1d20', lw: ready ? 2 : 1.2, fill });
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillStyle = '#111';
      ctx.fillText(String(ds.length), x + 21, y - 4);
      if (ds.some(d => d.oos)) {
        ctx.fillStyle = '#b3261a';
        ctx.fillText('!', x - 20, y + 4);
      }
    }
    // Kräftevergleich über jedem Angriffsziel: eigene Stärke gegen geschätzte Feindstärke
    for (const to of new Set(plans.map(p => p.to))) {
      const own = plans.filter(p => p.to === to).flatMap(p => p.divs).reduce((a, d) => a + strength(d), 0);
      const en = this.enemyEstimate(to, seen);
      const txt = `${own} : ${en === null ? '?' : '~' + en}`;
      const x = sx(PROV[to].x), y = sy(PROV[to].y) - 34;
      ctx.font = '700 11px system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 8;
      ctx.fillStyle = '#fffdf2';
      ctx.strokeStyle = '#b3261a';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(x - w / 2, y - 11, w, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a1a12';
      ctx.fillText(txt, x, y);
    }
  }

  /** Luftansicht: statt der Truppen die Staffeln je Sektor und die Wirkung in jeder Provinz. */
  private drawAir(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number) {
    const g = this.game(), W = this.cv.clientWidth, H = this.cv.clientHeight;
    ctx.textAlign = 'center';
    for (const p of PLIST) {
      if (g.ctrl[p.id] === 'NEU') continue;
      const x = sx(p.x), y = sy(p.y) - 16;
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      const a = g.airAssign[g.player][p.id];
      if (a) {
        // hier stationiert: Jäger links, Bomber rechts
        ctx.font = '700 11px system-ui, sans-serif';
        const txt = `✈ J ${a.f} · B ${a.b}`, w = ctx.measureText(txt).width + 10;
        ctx.fillStyle = '#1d3f66';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(x - w / 2, y - 12, w, 17); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, x, y + 1);
      } else if (this.k > 0.95) {
        const eff = airAt(g, g.player, p.id);
        if (!eff.f && !eff.b) continue;
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#16304f';
        ctx.fillText(`${eff.f}J ${eff.b}B`, x, y + 1);
      }
    }
  }

  private card(d: Division): string {
    const g = this.game(), own = d.side === g.player, mine = this.own(d);
    if (!own && !g.over) {
      // vom Gegner kennt man nur Art und ungefähre Stärke
      return `<div class="div ${d.side}"><label>${esc(d.name)}</label><div class="meta">${esc(tp(d).label)} · Stärke ca. ${estimate(d, g.turn)}${d.dug ? ' · eingegraben' : ''}</div></div>`;
    }
    const max = d.units.length * 10, pct = Math.round((100 * strength(d)) / max);
    const arm = armyOf(g, d);
    const meta = [
      esc(tp(d).label), arm ? `<b title="${arm.gen ? esc(`${rankName(g, arm.gen)} ${GENERAL[arm.gen].name}: ${traitText(g, arm.gen)}`) : 'ohne General'}">⚑ ${esc(arm.name)}${arm.gen ? ` (${esc(GENERAL[arm.gen].name.split(' ').pop()!)})` : ''}</b>` : esc(d.army), `Stärke ${strength(d)}/${max}`,
      tp(d).mp === 0 ? 'ortsfest' : own ? `Bewegung ${d.mp}/${tp(d).mp}` : '',
      d.dug ? `eingegraben ${d.dug}` : '', d.done ? 'setzt aus' : '', own && !mine ? 'Verbündete (KI)' : '', d.ctl ? 'Verbündete, Ihnen unterstellt' : '',
    ].filter(Boolean).join(' · ');
    // Erfahrung: Stufe und Fortschritt bis zur nächsten
    const lvl = xpLevel(d), next = XP_LEVELS[lvl + 1], xp = xpOf(d);
    const part = Math.round((100 * (xp - XP_LEVELS[lvl].at)) / ((next?.at ?? XP_MAX) - XP_LEVELS[lvl].at));
    const bonus = XP_LEVELS[lvl].q;
    const xpTip = `Erfahrung ${Math.round(xp)}${next ? ` – ab ${next.at}: ${next.name}` : ' – höchste Stufe'}. Güte ${bonus > 0 ? '+' : ''}${bonus} durch Erfahrung. Gefechte bringen Erfahrung, Ersatz nach Verlusten verwässert sie.`;
    const xpTag = `<span class="xp l${lvl}" title="${xpTip}">${'★'.repeat(lvl) || '○'} ${XP_LEVELS[lvl].name}<i style="width:${Math.max(0, Math.min(100, part))}%"></i></span>`;
    const chips = d.units.map(u => `<span class="chip${u.s <= 5 ? ' low' : ''}" title="${esc(TYPES[u.t].name[d.side])}">${u.t} ${u.s}</span>`).join('');
    const box = mine && tp(d).mp > 0 && !this.locked()
      ? `<input type="checkbox" data-act="toggle" data-div="${d.id}" ${this.selDivs.has(d.id) ? 'checked' : ''} ${d.mp < 1 || d.order || d.follow ? 'disabled' : ''}>` : '';
    const order = d.order && mine
      ? `<div class="meta bad">Angriff auf ${esc(PROV[d.order].name)} <button data-act="cancel" data-div="${d.id}">abbrechen</button></div>`
      : d.follow && mine ? `<div class="meta good">rückt nach ${esc(PROV[d.follow].name)} nach, sobald dort Platz frei wird <button data-act="cancel" data-follow="1" data-div="${d.id}">abbrechen</button></div>` : '';
    return `<div class="div ${d.side}"><label>${box}${esc(d.name)}<span class="sp"></span>${xpTag}</label><div class="meta">${meta}${d.oos ? ' · <span class="bad">abgeschnitten, kein Nachschub</span>' : d.low ? ' · <span class="bad">Nachschub überdehnt</span>' : ''}</div>${order}<div class="str"><i class="${pct < 40 ? 'low' : pct < 75 ? 'mid' : ''}" style="width:${pct}%"></i></div><div class="chips">${chips}</div></div>`;
  }

  private plansHtml(seen: Set<string>): string {
    const list = this.plans().filter(p => !this.sel || p.from === this.sel || p.to === this.sel);
    if (!list.length) return '';
    const n = (p: Plan) => `${p.divs.length} ${p.divs.length === 1 ? 'Verband' : 'Verbände'}`;
    const att = list.filter(p => !p.follow), fol = list.filter(p => p.follow);
    const folHtml = fol.length ? `<h3>Nachrücken</h3>${fol.map(p => `<div class="div"><label>${esc(PROV[p.from].name)} ↪ ${esc(PROV[p.to].name)}</label>
        <div class="meta">${n(p)} · rückt nach den Schlachten ein, soweit dort Platz frei geworden ist</div>
        <div class="row"><button data-act="cancel" data-follow="1" data-prov="${p.to}" data-from="${p.from}" ${this.locked() ? 'disabled' : ''}>Nachrücken abbrechen</button></div></div>`).join('')}` : '';
    if (!att.length) return folHtml;
    return `<h3>Geplante Angriffe</h3>${att.map(p => {
      const en = this.enemyEstimate(p.to, seen);
      return `<div class="div"><label>${esc(PROV[p.from].name)} ⚔ ${esc(PROV[p.to].name)}</label>
        <div class="meta">${p.divs.length} ${p.divs.length === 1 ? 'Verband' : 'Verbände'} · eigene Stärke <b>${p.divs.reduce((a, d) => a + strength(d), 0)}</b> · Gegner ${en === null ? 'unbekannt' : `ca. <b>${en}</b>`}</div>
        <div class="row"><button data-act="cancel" data-prov="${p.to}" data-from="${p.from}" ${this.locked() ? 'disabled' : ''}>Angriff abbrechen</button></div></div>`;
    }).join('')}${folHtml}`;
  }

  private airHtml(prov: string | null): string {
    const g = this.game(), me = g.player, free = airFree(g, me);
    const head = `<h3>Luftwaffe</h3><div class="meta">Frei: ${free.f} Jagdstaffeln, ${free.b} Bomberstaffeln (von ${g.air[me].f} / ${g.air[me].b})</div>${g.airQ ? `<div class="meta" title="Die Abschusschancen gelten für gleichwertige Flugzeuge. Jeder Punkt Unterschied zwischen dem Angriff der Jäger und der Abwehr des Ziels ändert sie um 10 %.">Kampfwert (10 = Durchschnitt): eigene Jäger <b>${airVal(g, me, 'f')}</b>, Bomber <b>${airVal(g, me, 'b')}</b> · Gegner Jäger ${airVal(g, other(me), 'f')}, Bomber ${airVal(g, other(me), 'b')}</div>` : ''}`;
    const n1 = (v: number) => v.toFixed(1).replace('.', ',');
    const eu = g.eu, jump = (id: string, text: string) => `<button data-act="jump" data-prov="${id}">${text}</button>`;
    if (!prov) {
      const rows = Object.entries(g.airAssign[me]).map(([id, a]) => jump(id, `✈ ${esc(PROV[id].name)}: ${a.f}J ${a.b}B`)).join('');
      const own = Object.entries(eu?.bomb ?? {}).map(([id, n]) => jump(id, `💣 ${esc(PROV[id].name)}: ${n}`)).join('');
      const raids = Object.entries(eu?.raid ?? {}).map(([id, n]) => jump(id, `⚠ ${esc(PROV[id].name)}: ${n} Bomber`)).join('');
      return `${head}<div class="row">${rows || '<span class="dim">keine Sektoren zugeteilt</span>'}</div>
        ${eu && sbTotal(g) ? `<div class="meta">Strategische Bomber: ${sbFree(g)} von ${sbTotal(g)} Staffeln frei</div><div class="row">${own || '<span class="dim">kein Ziel gewählt</span>'}</div>` : ''}
        ${raids ? `<div class="meta bad">Feindliche Bombenangriffe der letzten Runde (−${n1(eu!.eco.rate.bombed ?? 0)} IK):</div><div class="row">${raids}</div>` : ''}`;
    }
    // strategischer Bombenkrieg: eigene Ziele beim Gegner, Schäden und Angriffe im eigenen Gebiet
    let strat = '';
    if (eu && (PROV[prov].ind ?? 0) > 0) {
      const dmg = damageAt(g, prov), ind = `Industrie ${n1(indLeft(g, prov))} IK${dmg > 0.05 ? ` <span class="bad">(${n1(dmg)} zerstört)</span>` : ''}`;
      if (g.ctrl[prov] === me) {
        const n = eu.raid?.[prov] ?? 0, edge = airEdge(airAt(g, me, prov).f, airAt(g, other(me), prov).f, airVals(g, me));
        if (n || dmg > 0.05) strat = `<div class="meta">${ind}${n ? ` · <span class="bad">letzte Runde von ${n} Bomberstaffeln angegriffen</span> · ${edge.eff < 1 || edge.killB > 0 ? `eigene Jäger drücken die Wirkung auf ${edge.eff * 100} % und schießen im Mittel ${n1(Math.min(n, edge.killB))} Staffeln je Woche ab (ohne Begleitjäger gerechnet)` : 'keine eigenen Jäger im Sektor: volle Wirkung'}` : ''}</div>`;
      } else if (g.ctrl[prov] === other(me) && sbTotal(g)) {
        const cur = eu.bomb?.[prov] ?? 0, max = cur + sbFree(g), ok = canBomb(g, prov), edge = airEdge(airAt(g, other(me), prov).f, airAt(g, me, prov).f, airVals(g, other(me), Math.round(10 * sbQ(g))));
        strat = `<div class="air"><span>Strat. Bomber</span> <input type="range" min="0" max="${max}" value="${cur}" data-sb="${prov}" ${this.locked() || !ok || !max ? 'disabled' : ''}> <b>${cur}</b> <span class="dim">von ${max}</span></div>
          <div class="meta">${ind} · ${ok ? `je Staffel 0,1 IK je Woche, hier derzeit ${edge.eff * 100} % Wirkung${edge.killB > 0 ? ` · feindliche Jäger schießen im Mittel ${n1(edge.killB)} Staffeln je Woche ab` : ''}` : 'außer Reichweite (1500 km vom eigenen Gebiet)'}</div>`;
      }
    }
    const a = g.airAssign[me][prov] ?? { f: 0, b: 0 }, eff = airAt(g, me, prov), off = this.locked() ? 'disabled' : '';
    const ctl = (kind: 'f' | 'b', label: string) =>
      `<div class="air"><span>${label}</span> <input type="range" min="0" max="${a[kind] + free[kind]}" value="${a[kind]}" data-air="${kind}" data-prov="${prov}" ${off || (a[kind] + free[kind] ? '' : 'disabled')}> <b>${a[kind]}</b> <span class="dim">von ${a[kind] + free[kind]}</span></div>`;
    return `${head}<div class="meta">In diesem Sektor stationiert:</div>
      ${ctl('f', 'Jäger')}${ctl('b', 'Bomber')}${strat}
      <div class="meta">Ein Sektor deckt die Provinz und ihre Nachbarn. Hier wirksam: ${eff.f} Jäger, ${eff.b} Bomber${g.airQ ? ` · Schlagkraft der Bomber ×${g.airQ[me].b.toFixed(2).replace('.', ',')} (nach Muster)` : ''}.</div>`;
  }

  renderPanel() {
    const g = this.game(), seen = seenProvs(g, g.player);
    const logHtml = `<h3>Meldungen</h3><div id="log">${g.log.slice(-14).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
    if (!this.sel) {
      this.panel.innerHTML = `<h2>${g.eu ? 'Deutsches Reich' : SIDE_NAME[g.player]}</h2>
        <div class="dim">Provinz auf der Karte anklicken.</div>
        <details class="help" ${this.helpOpen ? 'open' : ''}><summary>Bedienung und Tastenkürzel</summary>
          <p>Provinz anklicken, Verbände auswählen, dann mit <b>Rechtsklick</b> auf eine Nachbarprovinz ziehen oder angreifen. Mausrad zoomt, Ziehen verschiebt die Karte.</p>
          <p><kbd>Tab</kbd> nächster freier Verband · <kbd>Leertaste</kbd> Auswahl setzt aus · <kbd>Enter</kbd> Runde beenden</p>
          ${g.eu ? '<p>Verbände, die noch nicht gezogen haben, können per <b>Bahn</b> weit durch eigenes Gebiet verlegen (grün) und aus Häfen <b>über See</b> übersetzen oder landen (blau) – dafür muss im Seegebiet eine Transportflotte frei sein (Reich verwalten → Marine).</p>' : ''}
        </details>
        <h3>Verbände mit freien Befehlen</h3><div class="row">${this.freeProvs().map(id => `<button data-act="jump" data-prov="${id}">${esc(PROV[id].name)}</button>`).join('') || '<span class="dim">keine</span>'}</div>
        ${this.plansHtml(seen)}${this.airHtml(null)}${logHtml}`;
      return;
    }
    const p = PROV[this.sel], ctrl = g.ctrl[p.id];
    const known = ctrl === g.player || seen.has(p.id) || !!g.over;
    const ds = divsIn(g, p.id).filter(d => d.side === g.player || known);
    const tg = [...this.targets()];
    // Armeen: aus der Auswahl bilden, ergänzen, auflösen
    let armyHtml = '';
    if (g.eu && ctrl === g.player && !g.over) {
      const sel = this.chosen(), here = armies(g).filter(a => ds.some(d => d.arm === a.id));
      const btn = [
        ...here.map(a => `<button data-act="army-sel" data-army="${a.id}" title="alle Verbände der Armee in dieser Provinz auswählen">⚑ ${esc(a.name)} (${members(g, a).length}/${ARMY_MAX})</button>`),
        sel.length ? `<button data-act="army-new" title="Die ausgewählten Verbände bilden eine neue Armee. Den General bestimmen Sie unter Reich verwalten → Armeen.">Armee bilden (${Math.min(sel.length, ARMY_MAX)})</button>` : '',
        ...(sel.length ? here.filter(a => members(g, a).length < ARMY_MAX && sel.some(d => d.arm !== a.id)).map(a => `<button data-act="army-join" data-army="${a.id}">→ zu ${esc(a.name)}</button>`) : []),
        sel.some(d => d.arm) ? '<button data-act="army-leave">aus Armee lösen</button>' : '',
      ].filter(Boolean).join('');
      if (btn) armyHtml = `<h3>Armeen</h3><div class="row">${btn}</div>`;
    }
    const ownSel = this.chosen().reduce((a, d) => a + strength(d), 0);
    const info = [g.eu ? '' : COUNTRY[p.country] ?? p.country, TERRAIN_NAME[p.terrain], p.river ? 'Fluss' : '', p.supply ? 'Versorgungsquelle' : '',
      p.port ? 'Hafen' : '', p.ind ? `Industrie ${p.ind.toFixed(1)}` : '', p.steel ? `Stahl ${p.steel}` : '', p.oil ? `Öl ${p.oil}` : '']
      .filter(Boolean).map(t => `<span>${t}</span>`).join('');
    const goBtn = ([id, t]: [string, MoveTarget]) => {
      const en = this.enemyEstimate(id, seen);
      return `<button data-act="go" data-prov="${id}" ${t.kind === 'follow' ? 'title="Die Provinz ist voll. Der Verband rückt nach den Schlachten ein, wenn die Angreifer von dort vorgerückt sind."' : ''}>${t.kind === 'sea' ? '⚓' : ''}${t.attack ? '⚔' : t.kind === 'follow' ? '↪' : '→'} ${esc(PROV[id].name)}${t.attack ? ` (Gegner ${en === null ? '?' : 'ca. ' + en})` : t.kind === 'follow' ? ' (nachrücken)' : ''}</button>`;
    };
    const rail = tg.filter(([, t]) => t.kind === 'rail').length;
    const near = tg.filter(([, t]) => t.kind !== 'rail');
    let state = `<div class="dim">${ctrl === 'NEU' ? 'neutral – nicht betretbar' : `kontrolliert von: ${SIDE_NAME[ctrl]}`}</div>`;
    if (g.eu) {
      const o = g.eu.owner[p.id], co = COUNTRIES[o], rel = g.eu.rel[o] ?? 'N';
      state = `<div class="dim">${esc(co?.name ?? o)}${o !== p.country ? ` (1936: ${esc(COUNTRIES[p.country]?.name ?? p.country)})` : ''} · ${o === 'GER' ? (g.eu.core[p.id] ? 'Reichsgebiet' : 'besetzt') : rel === 'A' ? 'verbündet' : rel === 'E' ? '<span class="bad">im Krieg</span>' : 'neutral – nicht betretbar'}</div>`
        + (rel === 'N' && o !== 'GER' && !this.locked() ? `<div class="row"><button data-act="war" data-c="${o}">Krieg erklären …</button></div>` : '');
    }
    this.panel.innerHTML = `<h2>${esc(p.name)}${p.vp ? ` <span style="color:var(--acc)">★${p.vp}</span>` : ''}</h2>
      ${state}
      <div class="tagline">${info}</div>
      ${ctrl === 'NEU' ? '' : this.airHtml(p.id)}
      <h3>Verbände${ctrl === g.player ? ` (${ds.length}/${STACK})` : ''}</h3>${known ? ds.map(d => this.card(d)).join('') || '<div class="dim">keine</div>' : '<div class="dim">Keine Aufklärung. Ein Luftsektor über der Provinz oder ihrer Nachbarschaft schafft Einblick.</div>'}
      ${armyHtml}
      ${tg.length ? `<h3>Mögliche Wege (eigene Stärke ${ownSel})</h3><div class="row">${near.map(goBtn).join('')}</div>${rail ? `<div class="dim">Bahnverlegung: Rechtsklick auf eine der ${rail} grün markierten Provinzen (kostet die ganze Runde).</div>` : ''}` : ''}
      ${this.plansHtml(seen)}${logHtml}`;
  }
}
