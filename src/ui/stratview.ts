// Strategiekarte: Provinzen, Truppenzähler, Befehle per Rechtsklick oder Seitenleiste.
import type { Division, GameState, UnitType } from '../core/types';
import { MAP, PLIST, PROV, TERRAIN_NAME } from '../data/world';
import { TEMPLATES, TYPES } from '../data/units';
import { STACK, divsIn, moveTargets, orderMove, strength, tp } from '../core/game';
import { SIDE_NAME, counter, esc, fitCanvas } from './draw';

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

export class StratView {
  k = 1; ox = 0; oy = 0;
  sel: string | null = null;
  selDivs = new Set<number>();
  private land = ringPath(MAP.land);
  private lakes = ringPath(MAP.lakes);
  private rivers = new Path2D();
  private paths: Record<string, Path2D> = {};
  private fitted = false;

  constructor(
    private cv: HTMLCanvasElement,
    private panel: HTMLElement,
    private game: () => GameState,
    private locked: () => boolean,
    private changed: () => void,
  ) {
    for (const r of MAP.rivers) {
      this.rivers.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) this.rivers.lineTo(r[i], r[i + 1]);
    }
    for (const p of PLIST) this.paths[p.id] = ringPath([p.poly]);
    this.bind();
  }

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
      const nk = Math.min(6, Math.max(0.35, this.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      this.ox = mx - ((mx - this.ox) * nk) / this.k;
      this.oy = my - ((my - this.oy) * nk) / this.k;
      this.k = nk;
      this.draw();
    }, { passive: false });
    this.panel.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      const g = this.game(), id = +(t.dataset.div ?? 0);
      if (t.dataset.act === 'toggle') this.selDivs.has(id) ? this.selDivs.delete(id) : this.selDivs.add(id);
      else if (t.dataset.act === 'go') this.orderTo(t.dataset.prov!);
      else if (t.dataset.act === 'cancel' && !this.locked()) {
        const d = g.divs.find(d => d.id === id);
        if (d) d.order = null;
      } else if (t.dataset.act === 'jump') return this.select(t.dataset.prov!);
      this.changed();
    });
  }

  private pick(e: MouseEvent): string | null {
    const r = this.cv.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.k, y = (e.clientY - r.top - this.oy) / this.k;
    let best: string | null = null, bd = 80;
    for (const p of PLIST) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) (bd = d), (best = p.id);
    }
    return best;
  }

  select(id: string | null) {
    const g = this.game();
    this.sel = id;
    this.selDivs = new Set(id ? divsIn(g, id, g.player).filter(d => d.mp > 0 && !d.order).map(d => d.id) : []);
    this.changed();
  }

  private chosen(): Division[] {
    const g = this.game();
    return g.divs.filter(d => this.selDivs.has(d.id) && d.prov === this.sel && d.side === g.player);
  }

  private targets(): Map<string, boolean> {
    const out = new Map<string, boolean>();
    if (this.locked()) return out;
    for (const d of this.chosen()) for (const t of moveTargets(this.game(), d)) out.set(t.prov, t.attack);
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
    } else this.selDivs = new Set(this.chosen().filter(d => !d.order).map(d => d.id));
    this.changed();
  }

  private fit() {
    const pol = PLIST.filter(p => p.side0 === 'POL');
    const x0 = Math.min(...pol.map(p => p.x)) - 260, x1 = Math.max(...pol.map(p => p.x)) + 40;
    const y0 = Math.min(...pol.map(p => p.y)) - 40, y1 = Math.max(...pol.map(p => p.y)) + 40;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
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
      ctx.fillStyle = c === 'NEU' ? '#d3cfc5'
        : c === 'GER' ? (p.side0 === 'POL' ? '#9c9a78' : p.country === 'GER' ? '#a7ad98' : '#b6baa4')
        : p.side0 === 'POL' ? '#e4d3a0' : '#e6bf86';
      ctx.fill(this.paths[p.id]);
      if (targets.has(p.id)) {
        ctx.fillStyle = targets.get(p.id) ? '#c8553d66' : '#ffffff55';
        ctx.fill(this.paths[p.id]);
      }
    }
    const thin = new Path2D(), nat = new Path2D(), front = new Path2D();
    for (const [a, b, x1, y1, x2, y2] of MAP.edges) {
      const pa = PROV[a], pb = PROV[b];
      const t = g.ctrl[a] !== g.ctrl[b] && g.ctrl[a] !== 'NEU' && g.ctrl[b] !== 'NEU' ? front : pa.country !== pb.country ? nat : thin;
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
      if (p.vp || k > 0.95) {
        ctx.font = `${p.vp ? '600 12px' : '10px'} system-ui, sans-serif`;
        ctx.fillStyle = g.ctrl[p.id] === 'NEU' ? '#77736b' : '#1f1f1d';
        ctx.fillText(p.name + (p.vp ? ` ★${p.vp}` : ''), x, y + 14);
      }
    }
    // Angriffsbefehle
    ctx.strokeStyle = ctx.fillStyle = '#b3261a';
    ctx.lineWidth = 3;
    const seen = new Set<string>();
    for (const d of g.divs) {
      if (!d.order || d.side !== g.player || seen.has(d.prov + d.order)) continue;
      seen.add(d.prov + d.order);
      const a = PROV[d.prov], b = PROV[d.order];
      const x1 = sx(a.x), y1 = sy(a.y) - 16, x2 = sx(b.x), y2 = sy(b.y) - 16, an = Math.atan2(y2 - y1, x2 - x1);
      const ex = x2 - Math.cos(an) * 20, ey = y2 - Math.sin(an) * 20;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(an) * 9, ey + Math.sin(an) * 9);
      ctx.lineTo(ex + Math.cos(an + 2.5) * 9, ey + Math.sin(an + 2.5) * 9);
      ctx.lineTo(ex + Math.cos(an - 2.5) * 9, ey + Math.sin(an - 2.5) * 9);
      ctx.fill();
    }
    // Truppenzähler je Provinz
    const stacks = new Map<string, Division[]>();
    for (const d of g.divs) stacks.set(d.prov, [...(stacks.get(d.prov) ?? []), d]);
    for (const [id, ds] of stacks) {
      const p = PROV[id], x = sx(p.x), y = sy(p.y) - 16;
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
      const sym = SYM_RANK[Math.max(...ds.map(d => SYM_RANK.indexOf(divSym(d))))];
      const ready = ds[0].side === g.player && ds.some(d => d.mp > 0 && !d.order);
      if (ds.length > 1) counter(ctx, x + 3, y - 3, 30, 20, ds[0].side, 'art', { dim: true });
      counter(ctx, x, y, 30, 20, ds[0].side, sym, { edge: ready ? '#fff' : '#1b1d20', lw: ready ? 2 : 1.2 });
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillStyle = '#111';
      ctx.fillText(String(ds.length), x + 21, y - 4);
      if (ds.some(d => d.oos)) {
        ctx.fillStyle = '#b3261a';
        ctx.fillText('!', x - 20, y + 4);
      }
    }
  }

  private card(d: Division): string {
    const g = this.game(), own = d.side === g.player;
    const max = d.units.length * 10;
    const meta = [
      esc(tp(d).label), esc(d.army), `Stärke ${strength(d)}/${max}`,
      tp(d).mp === 0 ? 'ortsfest' : own ? `Bewegung ${d.mp}/${tp(d).mp}` : '',
      d.dug ? `eingegraben ${d.dug}` : '',
    ].filter(Boolean).join(' · ');
    const chips = d.units.map(u => `<span class="chip${u.s <= 5 ? ' low' : ''}" title="${esc(TYPES[u.t].name[d.side])}">${u.t} ${u.s}</span>`).join('');
    const box = own && tp(d).mp > 0 && !this.locked()
      ? `<input type="checkbox" data-act="toggle" data-div="${d.id}" ${this.selDivs.has(d.id) ? 'checked' : ''} ${d.mp < 1 || d.order ? 'disabled' : ''}>` : '';
    const order = d.order && own
      ? `<div class="meta bad">Angriff auf ${esc(PROV[d.order].name)} <button data-act="cancel" data-div="${d.id}">zurücknehmen</button></div>` : '';
    return `<div class="div ${d.side}"><label>${box}${esc(d.name)}</label><div class="meta">${meta}${d.oos ? ' · <span class="bad">abgeschnitten</span>' : ''}</div>${order}<div class="chips">${chips}</div></div>`;
  }

  renderPanel() {
    const g = this.game();
    const logHtml = `<h3>Meldungen</h3><div id="log">${g.log.slice(-14).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
    if (!this.sel) {
      const idle = PLIST.filter(p => divsIn(g, p.id, g.player).some(d => d.mp > 0 && !d.order));
      this.panel.innerHTML = `<h2>${SIDE_NAME[g.player]}</h2>
        <p class="dim">Provinz anklicken, Verbände auswählen, dann mit <b>Rechtsklick</b> auf eine Nachbarprovinz ziehen oder angreifen. Mausrad zoomt, Ziehen verschiebt die Karte.</p>
        <p class="dim">Angriffe werden vorgemerkt und beim Beenden der Runde ausgefochten – wahlweise von Hand oder per Auto-Resolve.</p>
        <h3>Verbände mit freien Befehlen</h3><div class="row">${idle.map(p => `<button data-act="jump" data-prov="${p.id}">${esc(p.name)}</button>`).join('') || '<span class="dim">keine</span>'}</div>${logHtml}`;
      return;
    }
    const p = PROV[this.sel], ctrl = g.ctrl[p.id];
    const ds = divsIn(g, p.id);
    const tg = [...this.targets()];
    const info = [COUNTRY[p.country] ?? p.country, TERRAIN_NAME[p.terrain], p.river ? 'Fluss' : '', p.supply ? 'Versorgungsquelle' : '']
      .filter(Boolean).join(' · ');
    this.panel.innerHTML = `<h2>${esc(p.name)}${p.vp ? ` <span style="color:var(--acc)">★${p.vp}</span>` : ''}</h2>
      <div class="dim">${info}</div>
      <div class="dim">${ctrl === 'NEU' ? 'neutral – nicht betretbar' : `kontrolliert von: ${SIDE_NAME[ctrl]}`}</div>
      ${tg.length ? `<h3>Befehl für die Auswahl</h3><div class="row">${tg.map(([id, att]) => `<button data-act="go" data-prov="${id}">${att ? '⚔' : '→'} ${esc(PROV[id].name)}</button>`).join('')}</div>` : ''}
      <h3>Verbände (${ds.length}/${STACK})</h3>${ds.map(d => this.card(d)).join('') || '<div class="dim">keine</div>'}${logHtml}`;
  }
}
