// Platzhaltergrafik: taktische Zeichen im Stil der NATO-Symbole, direkt auf den Canvas gezeichnet.
import type { Side, UnitType } from '../core/types';

export const SIDE_COLOR: Record<Side, string> = { GER: '#7d8672', POL: '#c9a24b' };
export const SIDE_NAME: Record<Side, string> = { GER: 'Deutsches Reich', POL: 'Polen' };

export function fitCanvas(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) (cv.width = w), (cv.height = h);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Zeichnet einen Truppenzähler mit Mittelpunkt (x, y). */
export function counter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, side: Side, sym: UnitType['sym'], opts: { dim?: boolean; edge?: string; lw?: number; fill?: string } = {}) {
  const l = x - w / 2, t = y - h / 2;
  ctx.globalAlpha = opts.dim ? 0.55 : 1;
  ctx.fillStyle = opts.fill ?? SIDE_COLOR[side];
  ctx.strokeStyle = opts.edge ?? '#1b1d20';
  ctx.lineWidth = opts.lw ?? 1.2;
  ctx.beginPath();
  ctx.rect(l, t, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = ctx.fillStyle = '#16181b';
  ctx.lineWidth = 1.3;
  const p = 3, a = l + p, b = t + p, c = l + w - p, d = t + h - p;
  ctx.beginPath();
  const cross = () => (ctx.moveTo(a, b), ctx.lineTo(c, d), ctx.moveTo(c, b), ctx.lineTo(a, d));
  switch (sym) {
    case 'inf': cross(); break;
    case 'mot': cross(); ctx.moveTo(x - w / 5 + 2, d + 1); ctx.arc(x - w / 5, d + 1, 2, 0, 7); ctx.moveTo(x + w / 5 + 2, d + 1); ctx.arc(x + w / 5, d + 1, 2, 0, 7); break;
    case 'mtn': cross(); ctx.moveTo(x - 3, d); ctx.lineTo(x, d - 4); ctx.lineTo(x + 3, d); break;
    case 'cav': ctx.moveTo(a, d); ctx.lineTo(c, b); break;
    case 'rec': ctx.moveTo(a, d); ctx.lineTo(c, b); ctx.moveTo(x + 2, y); ctx.arc(x, y, 2, 0, 7); break;
    case 'arm': ctx.ellipse(x, y, Math.max(1, w / 2 - p - 1), Math.max(1, h / 2 - p), 0, 0, 7); break;
    case 'art': ctx.moveTo(x + 3, y); ctx.arc(x, y, 3, 0, 7); ctx.fill(); break;
    case 'at': ctx.moveTo(a, d); ctx.lineTo(x, b); ctx.lineTo(c, d); break;
    case 'eng': ctx.moveTo(a + 2, d - 1); ctx.lineTo(a + 2, b + 2); ctx.lineTo(c - 2, b + 2); ctx.lineTo(c - 2, d - 1); ctx.moveTo(x, b + 2); ctx.lineTo(x, d - 1); break;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
