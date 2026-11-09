// Procedurally drawn playing cards: pips, indices, original court-card figures and 12 card-back designs.
// Works with CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
import { mulberry32 } from '../../util/noise';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type DeckStyle = 'classic' | 'large' | 'four';

export const CARD_W = 224;
export const CARD_H = 312;
const RADIUS = 14;
const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';

export function suitColor(suit: number, style: DeckStyle): string {
  if (style === 'four') return ['#1d7a33', '#1d4fa8', '#c0201c', '#141414'][suit];
  return suit === 1 || suit === 2 ? '#c0201c' : '#141414';
}

/** Suit shape as a path in a box centered at (0,0) with size 1 (roughly -0.5..0.5). */
export function suitPath(ctx: Ctx, suit: number) {
  ctx.beginPath();
  switch (suit) {
    case 2: // heart
      ctx.moveTo(0, 0.45);
      ctx.bezierCurveTo(-0.08, 0.32, -0.5, 0.08, -0.5, -0.17);
      ctx.bezierCurveTo(-0.5, -0.42, -0.25, -0.5, -0.12, -0.44);
      ctx.bezierCurveTo(-0.05, -0.41, 0, -0.33, 0, -0.27);
      ctx.bezierCurveTo(0, -0.33, 0.05, -0.41, 0.12, -0.44);
      ctx.bezierCurveTo(0.25, -0.5, 0.5, -0.42, 0.5, -0.17);
      ctx.bezierCurveTo(0.5, 0.08, 0.08, 0.32, 0, 0.45);
      break;
    case 1: // diamond
      ctx.moveTo(0, -0.5);
      ctx.quadraticCurveTo(0.14, -0.2, 0.38, 0);
      ctx.quadraticCurveTo(0.14, 0.2, 0, 0.5);
      ctx.quadraticCurveTo(-0.14, 0.2, -0.38, 0);
      ctx.quadraticCurveTo(-0.14, -0.2, 0, -0.5);
      break;
    case 3: // spade
      ctx.moveTo(0, -0.5);
      ctx.bezierCurveTo(0.1, -0.32, 0.5, -0.12, 0.5, 0.12);
      ctx.bezierCurveTo(0.5, 0.33, 0.28, 0.4, 0.12, 0.3);
      ctx.bezierCurveTo(0.07, 0.27, 0.04, 0.22, 0.03, 0.18);
      ctx.bezierCurveTo(0.05, 0.32, 0.1, 0.42, 0.2, 0.5);
      ctx.lineTo(-0.2, 0.5);
      ctx.bezierCurveTo(-0.1, 0.42, -0.05, 0.32, -0.03, 0.18);
      ctx.bezierCurveTo(-0.04, 0.22, -0.07, 0.27, -0.12, 0.3);
      ctx.bezierCurveTo(-0.28, 0.4, -0.5, 0.33, -0.5, 0.12);
      ctx.bezierCurveTo(-0.5, -0.12, -0.1, -0.32, 0, -0.5);
      break;
    default: // club
      ctx.arc(0, -0.24, 0.21, 0, Math.PI * 2);
      ctx.moveTo(-0.05, 0.08);
      ctx.arc(-0.24, 0.08, 0.21, 0, Math.PI * 2);
      ctx.moveTo(0.45, 0.08);
      ctx.arc(0.24, 0.08, 0.21, 0, Math.PI * 2);
      ctx.moveTo(0.06, -0.05);
      ctx.lineTo(0.08, 0.2);
      ctx.bezierCurveTo(0.1, 0.36, 0.14, 0.44, 0.22, 0.5);
      ctx.lineTo(-0.22, 0.5);
      ctx.bezierCurveTo(-0.14, 0.44, -0.1, 0.36, -0.08, 0.2);
      ctx.lineTo(-0.06, -0.05);
      ctx.closePath();
  }
}

export function drawSuit(ctx: Ctx, suit: number, x: number, y: number, size: number, color: string, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  ctx.scale(size, size);
  suitPath(ctx, suit);
  ctx.fillStyle = color;
  ctx.fill('nonzero');
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Pip positions in a unit box (0..1 by 0..1 within the pip area), flipped = drawn upside-down (lower half).
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export interface FaceOpts {
  style: DeckStyle;
  wear: number; // 0..3
  seed?: number;
}

function paper(ctx: Ctx, x: number, y: number, w: number, h: number, wear: number, seed: number) {
  // card stock with subtle fiber noise and slightly warm tint
  roundRect(ctx, x, y, w, h, RADIUS);
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#fbf9f3');
  g.addColorStop(1, '#f1ece0');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const rnd = mulberry32(seed);
  ctx.globalAlpha = 0.035 + wear * 0.01;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#000' : '#7a6a4a';
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2, 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function wearOverlay(ctx: Ctx, x: number, y: number, w: number, h: number, wear: number, seed: number) {
  if (wear <= 0) return;
  const rnd = mulberry32(seed * 7 + 3);
  ctx.save();
  roundRect(ctx, x, y, w, h, RADIUS);
  ctx.clip();
  // edge grime
  const eg = ctx.createLinearGradient(x, 0, x + 10, 0);
  ctx.globalAlpha = 0.05 * wear;
  ctx.strokeStyle = '#6b5a3a';
  ctx.lineWidth = 5;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, RADIUS);
  ctx.stroke();
  void eg;
  // corner scuffs (lighter, worn ink at corners)
  ctx.globalAlpha = 0.12 * wear;
  for (const [cx, cy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]) {
    const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
    r.addColorStop(0, 'rgba(120,100,70,0.9)');
    r.addColorStop(1, 'rgba(120,100,70,0)');
    ctx.fillStyle = r;
    ctx.fillRect(cx - 22, cy - 22, 44, 44);
  }
  // finger smudges
  const n = wear * 2;
  for (let i = 0; i < n; i++) {
    const sx = x + w * (0.15 + rnd() * 0.7);
    const sy = y + h * (rnd() < 0.5 ? 0.1 + rnd() * 0.2 : 0.7 + rnd() * 0.2);
    const r = 12 + rnd() * 18;
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    gr.addColorStop(0, 'rgba(90,80,60,0.10)');
    gr.addColorStop(1, 'rgba(90,80,60,0)');
    ctx.globalAlpha = 0.5 + wear * 0.15;
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.75, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // tiny nicks along edge
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#d8d0bf';
  for (let i = 0; i < wear * 6; i++) {
    const side = Math.floor(rnd() * 4);
    const t = rnd();
    const px = side === 0 ? x + t * w : side === 1 ? x + w - 2 : side === 2 ? x + t * w : x;
    const py = side === 0 ? y : side === 1 ? y + t * h : side === 2 ? y + h - 2 : y + t * h;
    ctx.fillRect(px, py, 2 + rnd() * 3, 2);
  }
  ctx.restore();
}

function drawIndex(ctx: Ctx, rank: number, suit: number, x: number, y: number, w: number, h: number, o: FaceOpts) {
  const col = suitColor(suit, o.style);
  const large = o.style === 'large';
  const label = RANK_LABEL[rank];
  const corner = (flip: boolean) => {
    ctx.save();
    if (flip) {
      ctx.translate(x + w, y + h);
      ctx.rotate(Math.PI);
    } else ctx.translate(x, y);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (large) {
      const fs = label === '10' ? 56 : 66;
      ctx.font = `700 ${fs}px ${SERIF}`;
      if (label === '10') {
        ctx.save();
        ctx.scale(0.78, 1);
        ctx.fillText(label, 40 / 0.78, 62);
        ctx.restore();
      } else ctx.fillText(label, 38, 64);
      drawSuit(ctx, suit, 38, 94, 40, col);
    } else {
      const fs = 36;
      ctx.font = `700 ${fs}px ${SERIF}`;
      if (label === '10') {
        ctx.save();
        ctx.scale(0.72, 1);
        ctx.fillText(label, 22 / 0.72, 40);
        ctx.restore();
      } else ctx.fillText(label, 22, 40);
      drawSuit(ctx, suit, 22, 60, 24, col);
    }
    ctx.restore();
  };
  corner(false);
  corner(true);
}

// ---------------- Court cards (original figures) ----------------
const COURT_COLORS = { red: '#b72a24', blue: '#24418a', gold: '#e2b23a', black: '#1b1b1b', skin: '#f3d3ac', cream: '#fbf3df', green: '#2f7a46' };

function courtHalf(ctx: Ctx, rank: number, suit: number, w: number, h: number, col: string) {
  // Draws the upper half figure within (0,0)-(w,h). Coordinates normalized.
  const C = COURT_COLORS;
  const S = (v: number) => v * w;
  const T = (v: number) => v * h;
  const outline = () => {
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  };
  const primary = suit === 1 || suit === 2 ? C.red : C.blue;
  const secondary = suit === 1 || suit === 2 ? C.blue : C.red;
  // shoulders / robe
  ctx.beginPath();
  ctx.moveTo(S(0.02), T(1));
  ctx.lineTo(S(0.02), T(0.74));
  ctx.quadraticCurveTo(S(0.2), T(0.56), S(0.4), T(0.58));
  ctx.lineTo(S(0.6), T(0.58));
  ctx.quadraticCurveTo(S(0.8), T(0.56), S(0.98), T(0.74));
  ctx.lineTo(S(0.98), T(1));
  ctx.closePath();
  ctx.fillStyle = primary;
  ctx.fill();
  outline();
  // robe panels
  ctx.beginPath();
  ctx.moveTo(S(0.38), T(0.6));
  ctx.lineTo(S(0.62), T(0.6));
  ctx.lineTo(S(0.7), T(1));
  ctx.lineTo(S(0.3), T(1));
  ctx.closePath();
  ctx.fillStyle = C.gold;
  ctx.fill();
  outline();
  // pattern on gold panel
  ctx.fillStyle = secondary;
  for (let i = 0; i < 4; i++) {
    const yy = T(0.66 + i * 0.09);
    ctx.beginPath();
    ctx.moveTo(S(0.5), yy - 6);
    ctx.lineTo(S(0.5) + 6, yy);
    ctx.lineTo(S(0.5), yy + 6);
    ctx.lineTo(S(0.5) - 6, yy);
    ctx.closePath();
    ctx.fill();
  }
  // collar
  ctx.beginPath();
  ctx.ellipse(S(0.5), T(0.6), S(0.2), T(0.05), 0, 0, Math.PI * 2);
  ctx.fillStyle = rank === 10 ? C.cream : C.cream;
  ctx.fill();
  outline();
  ctx.fillStyle = secondary;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(S(0.5 + i * 0.05), T(0.6), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // face
  ctx.beginPath();
  ctx.ellipse(S(0.5), T(0.43), S(0.13), T(0.14), 0, 0, Math.PI * 2);
  ctx.fillStyle = C.skin;
  ctx.fill();
  outline();
  // hair
  ctx.fillStyle = rank === 10 ? '#5a3a1a' : rank === 11 ? '#c8962e' : '#d8d0c0';
  ctx.beginPath();
  if (rank === 11) {
    // queen long hair
    ctx.moveTo(S(0.36), T(0.36));
    ctx.quadraticCurveTo(S(0.3), T(0.52), S(0.34), T(0.6));
    ctx.lineTo(S(0.39), T(0.58));
    ctx.quadraticCurveTo(S(0.36), T(0.48), S(0.39), T(0.38));
    ctx.closePath();
    ctx.moveTo(S(0.64), T(0.36));
    ctx.quadraticCurveTo(S(0.7), T(0.52), S(0.66), T(0.6));
    ctx.lineTo(S(0.61), T(0.58));
    ctx.quadraticCurveTo(S(0.64), T(0.48), S(0.61), T(0.38));
    ctx.closePath();
  } else {
    ctx.moveTo(S(0.37), T(0.38));
    ctx.quadraticCurveTo(S(0.34), T(0.48), S(0.38), T(0.52));
    ctx.lineTo(S(0.4), T(0.4));
    ctx.closePath();
    ctx.moveTo(S(0.63), T(0.38));
    ctx.quadraticCurveTo(S(0.66), T(0.48), S(0.62), T(0.52));
    ctx.lineTo(S(0.6), T(0.4));
    ctx.closePath();
  }
  ctx.fill();
  outline();
  // eyes, nose, mouth
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(S(0.44), T(0.41));
  ctx.quadraticCurveTo(S(0.46), T(0.395), S(0.48), T(0.41));
  ctx.moveTo(S(0.52), T(0.41));
  ctx.quadraticCurveTo(S(0.54), T(0.395), S(0.56), T(0.41));
  ctx.moveTo(S(0.5), T(0.42));
  ctx.lineTo(S(0.49), T(0.47));
  ctx.lineTo(S(0.51), T(0.475));
  ctx.stroke();
  ctx.fillStyle = '#141414';
  ctx.beginPath();
  ctx.arc(S(0.46), T(0.413), 1.8, 0, Math.PI * 2);
  ctx.arc(S(0.54), T(0.413), 1.8, 0, Math.PI * 2);
  ctx.fill();
  if (rank === 11) {
    ctx.fillStyle = C.red;
    ctx.beginPath();
    ctx.ellipse(S(0.5), T(0.505), 5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // mustache (+ beard for king)
    ctx.fillStyle = rank === 12 ? '#d8d0c0' : '#5a3a1a';
    ctx.beginPath();
    ctx.moveTo(S(0.5), T(0.49));
    ctx.quadraticCurveTo(S(0.44), T(0.47), S(0.42), T(0.51));
    ctx.quadraticCurveTo(S(0.46), T(0.5), S(0.5), T(0.505));
    ctx.quadraticCurveTo(S(0.54), T(0.5), S(0.58), T(0.51));
    ctx.quadraticCurveTo(S(0.56), T(0.47), S(0.5), T(0.49));
    ctx.fill();
    if (rank === 12) {
      ctx.beginPath();
      ctx.moveTo(S(0.4), T(0.48));
      ctx.quadraticCurveTo(S(0.42), T(0.6), S(0.5), T(0.62));
      ctx.quadraticCurveTo(S(0.58), T(0.6), S(0.6), T(0.48));
      ctx.quadraticCurveTo(S(0.5), T(0.54), S(0.4), T(0.48));
      ctx.fill();
      outline();
    }
  }
  // headwear
  if (rank === 12) {
    // crown
    ctx.beginPath();
    ctx.moveTo(S(0.36), T(0.33));
    ctx.lineTo(S(0.36), T(0.2));
    ctx.lineTo(S(0.41), T(0.27));
    ctx.lineTo(S(0.455), T(0.16));
    ctx.lineTo(S(0.5), T(0.26));
    ctx.lineTo(S(0.545), T(0.16));
    ctx.lineTo(S(0.59), T(0.27));
    ctx.lineTo(S(0.64), T(0.2));
    ctx.lineTo(S(0.64), T(0.33));
    ctx.closePath();
    ctx.fillStyle = C.gold;
    ctx.fill();
    outline();
    ctx.fillStyle = C.red;
    for (const xx of [0.43, 0.5, 0.57]) {
      ctx.beginPath();
      ctx.arc(S(xx), T(0.3), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (rank === 11) {
    // tiara + veil
    ctx.beginPath();
    ctx.moveTo(S(0.35), T(0.37));
    ctx.quadraticCurveTo(S(0.5), T(0.18), S(0.65), T(0.37));
    ctx.quadraticCurveTo(S(0.5), T(0.3), S(0.35), T(0.37));
    ctx.fillStyle = secondary;
    ctx.fill();
    outline();
    ctx.beginPath();
    ctx.moveTo(S(0.4), T(0.3));
    ctx.lineTo(S(0.45), T(0.22));
    ctx.lineTo(S(0.5), T(0.28));
    ctx.lineTo(S(0.55), T(0.22));
    ctx.lineTo(S(0.6), T(0.3));
    ctx.closePath();
    ctx.fillStyle = C.gold;
    ctx.fill();
    outline();
  } else {
    // jack's cap with feather
    ctx.beginPath();
    ctx.moveTo(S(0.34), T(0.36));
    ctx.quadraticCurveTo(S(0.38), T(0.2), S(0.56), T(0.22));
    ctx.quadraticCurveTo(S(0.7), T(0.25), S(0.67), T(0.36));
    ctx.closePath();
    ctx.fillStyle = secondary;
    ctx.fill();
    outline();
    ctx.beginPath();
    ctx.moveTo(S(0.6), T(0.24));
    ctx.quadraticCurveTo(S(0.8), T(0.08), S(0.88), T(0.14));
    ctx.quadraticCurveTo(S(0.78), T(0.18), S(0.62), T(0.28));
    ctx.fillStyle = C.gold;
    ctx.fill();
    outline();
    ctx.fillStyle = C.cream;
    ctx.fillRect(S(0.35), T(0.34), S(0.32), 4);
  }
  // held item
  ctx.save();
  if (rank === 12) {
    // sword
    ctx.fillStyle = '#d9dde3';
    ctx.beginPath();
    ctx.moveTo(S(0.2), T(0.08));
    ctx.lineTo(S(0.23), T(0.04));
    ctx.lineTo(S(0.26), T(0.08));
    ctx.lineTo(S(0.26), T(0.7));
    ctx.lineTo(S(0.2), T(0.7));
    ctx.closePath();
    ctx.fill();
    outline();
    ctx.fillStyle = C.gold;
    ctx.fillRect(S(0.14), T(0.7), S(0.18), 6);
  } else if (rank === 11) {
    // flower
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(S(0.78), T(0.72));
    ctx.quadraticCurveTo(S(0.8), T(0.4), S(0.76), T(0.22));
    ctx.stroke();
    ctx.fillStyle = C.red;
    ctx.beginPath();
    ctx.moveTo(S(0.76), T(0.22));
    ctx.quadraticCurveTo(S(0.68), T(0.12), S(0.72), T(0.06));
    ctx.quadraticCurveTo(S(0.76), T(0.12), S(0.76), T(0.06));
    ctx.quadraticCurveTo(S(0.8), T(0.12), S(0.84), T(0.06));
    ctx.quadraticCurveTo(S(0.86), T(0.14), S(0.76), T(0.22));
    ctx.fill();
    outline();
  } else {
    // halberd
    ctx.fillStyle = '#7a5530';
    ctx.fillRect(S(0.8), T(0.06), 5, T(0.66));
    ctx.fillStyle = '#d9dde3';
    ctx.beginPath();
    ctx.moveTo(S(0.8) + 2, T(0.02));
    ctx.lineTo(S(0.8) + 14, T(0.1));
    ctx.lineTo(S(0.8) + 2, T(0.16));
    ctx.lineTo(S(0.8) - 10, T(0.1));
    ctx.closePath();
    ctx.fill();
    outline();
  }
  ctx.restore();
  // suit emblem near the figure
  drawSuit(ctx, suit, S(0.16), T(0.18), 26, col);
}

function drawCourt(ctx: Ctx, rank: number, suit: number, x: number, y: number, w: number, h: number, o: FaceOpts) {
  const col = suitColor(suit, o.style);
  const ix = x + (o.style === 'large' ? 70 : 44);
  const iy = y + 34;
  const iw = w - (o.style === 'large' ? 140 : 88);
  const ih = h - 68;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  ctx.fillStyle = '#fbf3df';
  ctx.fillRect(ix, iy, iw, ih);
  // upper half
  ctx.save();
  ctx.translate(ix, iy);
  courtHalf(ctx, rank, suit, iw, ih / 2, col);
  ctx.restore();
  // lower half: rotated copy
  ctx.save();
  ctx.translate(ix + iw, iy + ih);
  ctx.rotate(Math.PI);
  courtHalf(ctx, rank, suit, iw, ih / 2, col);
  ctx.restore();
  // diagonal divider
  ctx.strokeStyle = 'rgba(20,20,20,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(ix, iy + ih * 0.53);
  ctx.lineTo(ix + iw, iy + ih * 0.47);
  ctx.stroke();
  ctx.restore();
  // frame
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(ix, iy, iw, ih);
  ctx.strokeStyle = '#c9a54a';
  ctx.lineWidth = 1;
  ctx.strokeRect(ix + 3, iy + 3, iw - 6, ih - 6);
}

export function drawCardFace(ctx: Ctx, card: number, x: number, y: number, o: FaceOpts) {
  const rank = card >> 2;
  const suit = card & 3;
  const w = CARD_W,
    h = CARD_H;
  const seed = (o.seed ?? 1) * 131 + card;
  paper(ctx, x, y, w, h, o.wear, seed);
  const col = suitColor(suit, o.style);
  const large = o.style === 'large';
  if (rank >= 9 && rank <= 11) {
    drawCourt(ctx, rank + 1, suit, x, y, w, h, o); // pass 10..12 => J,Q,K
  } else if (rank === 12) {
    // Ace: big central pip with ornament
    const size = large ? 90 : suit === 3 ? 120 : 100;
    if (suit === 3 && !large) {
      ctx.save();
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 72, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + w / 2 + Math.cos(a) * 72, y + h / 2 + Math.sin(a) * 72, 6, 3, a, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawSuit(ctx, suit, x + w / 2, y + h / 2, size, col);
  } else {
    const n = rank + 2;
    const pipSize = large ? 34 : 44;
    const ax = x + (large ? 84 : 62);
    const aw = w - (large ? 168 : 124);
    const ay = y + (large ? 62 : 52);
    const ah = h - (large ? 124 : 104);
    for (const [px, py] of PIPS[n]) {
      drawSuit(ctx, suit, ax + px * aw, ay + py * ah, pipSize, col, py > 0.5);
    }
  }
  drawIndex(ctx, rank, suit, x, y, w, h, o);
  wearOverlay(ctx, x, y, w, h, o.wear, seed);
}

// ---------------- Card backs ----------------
export function drawCardBack(ctx: Ctx, id: number, x: number, y: number, wear = 1, seed = 5) {
  const w = CARD_W,
    h = CARD_H;
  paper(ctx, x, y, w, h, wear, seed + 999);
  const m = 12; // white border
  const ix = x + m,
    iy = y + m,
    iw = w - 2 * m,
    ih = h - 2 * m;
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, 8);
  ctx.clip();
  const cx = ix + iw / 2,
    cy = iy + ih / 2;
  const lines = (color: string, lw: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
  };
  switch (id % 12) {
    case 0:
    case 1: {
      const base = id % 12 === 0 ? '#a3191e' : '#1d3f8f';
      ctx.fillStyle = base;
      ctx.fillRect(ix, iy, iw, ih);
      lines('rgba(255,255,255,0.55)', 1);
      for (let k = -ih; k < iw + ih; k += 9) {
        ctx.beginPath();
        ctx.moveTo(ix + k, iy);
        ctx.lineTo(ix + k - ih, iy + ih);
        ctx.moveTo(ix + k - ih, iy);
        ctx.lineTo(ix + k, iy + ih);
        ctx.stroke();
      }
      // central rosette
      lines('rgba(255,255,255,0.9)', 1.2);
      for (let r = 10; r < 60; r += 7) {
        ctx.beginPath();
        for (let a = 0; a <= 360; a += 3) {
          const t = (a * Math.PI) / 180;
          const rr = r + Math.sin(t * 8) * 4;
          const px = cx + Math.cos(t) * rr,
            py = cy + Math.sin(t) * rr;
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 2: {
      ctx.fillStyle = '#15553a';
      ctx.fillRect(ix, iy, iw, ih);
      lines('rgba(230,240,220,0.6)', 0.8);
      for (let k = 0; k < 18; k++) {
        ctx.beginPath();
        const R = 70,
          r = 23 + k * 0.9,
          d = 40;
        for (let a = 0; a <= 720; a += 2) {
          const t = (a * Math.PI) / 180;
          const px = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
          const py = cy + ((R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)) * 1.35;
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      break;
    }
    case 3: {
      ctx.fillStyle = '#111';
      ctx.fillRect(ix, iy, iw, ih);
      lines('#d4af5a', 1.4);
      for (const sy of [iy + ih, iy]) {
        for (let k = 0; k < 9; k++) {
          ctx.beginPath();
          ctx.arc(cx, sy, 20 + k * 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let a = 0; a < 24; a++) {
          const t = (a / 24) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, sy);
          ctx.lineTo(cx + Math.cos(t) * 140, sy + Math.sin(t) * 140);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#111';
      ctx.fillRect(ix + 20, cy - 20, iw - 40, 40);
      ctx.strokeRect(ix + 20, cy - 20, iw - 40, 40);
      drawSuit(ctx, 3, cx, cy, 26, '#d4af5a');
      break;
    }
    case 4: {
      ctx.fillStyle = '#16264a';
      ctx.fillRect(ix, iy, iw, ih);
      const s = 22;
      for (let yy = 0; yy < ih / s + 1; yy++)
        for (let xx = -1; xx < iw / s + 1; xx++) {
          const px = ix + xx * s + (yy % 2) * (s / 2),
            py = iy + yy * s * 0.87;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + s / 2, py + s * 0.87);
          ctx.lineTo(px - s / 2, py + s * 0.87);
          ctx.closePath();
          ctx.fillStyle = (xx + yy) % 3 === 0 ? '#2a4a8a' : (xx + yy) % 3 === 1 ? '#1d3566' : '#c9a54a';
          ctx.globalAlpha = (xx + yy) % 3 === 2 ? 0.35 : 1;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      break;
    }
    case 5: {
      const rnd = mulberry32(seed);
      ctx.fillStyle = '#5a3420';
      ctx.fillRect(ix, iy, iw, ih);
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.06)';
        ctx.beginPath();
        ctx.arc(ix + rnd() * iw, iy + rnd() * ih, 1 + rnd() * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      lines('rgba(0,0,0,0.5)', 3);
      ctx.strokeRect(ix + 14, iy + 14, iw - 28, ih - 28);
      lines('rgba(255,220,170,0.35)', 1);
      ctx.strokeRect(ix + 16, iy + 16, iw - 28, ih - 28);
      ctx.setLineDash([5, 4]);
      lines('rgba(240,210,160,0.7)', 1.5);
      ctx.strokeRect(ix + 22, iy + 22, iw - 44, ih - 44);
      ctx.setLineDash([]);
      drawSuit(ctx, 3, cx + 1, cy + 1, 50, 'rgba(255,220,170,0.25)');
      drawSuit(ctx, 3, cx, cy, 50, 'rgba(0,0,0,0.45)');
      break;
    }
    case 6: {
      ctx.fillStyle = '#5e1424';
      ctx.fillRect(ix, iy, iw, ih);
      const rnd = mulberry32(seed + 6);
      for (let i = 0; i < 40; i++) {
        const px = ix + rnd() * iw,
          py = iy + rnd() * ih,
          r = 10 + rnd() * 10,
          a = rnd() * 6.28;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.bezierCurveTo(r, -r, r, r * 0.8, 0, r);
        ctx.bezierCurveTo(-r * 0.6, r * 0.6, -r * 0.2, 0, 0, -r);
        ctx.fillStyle = 'rgba(240,200,150,0.25)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(240,200,150,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.3, r * 0.2, r * 0.25, 0, 6.28);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 7: {
      ctx.fillStyle = '#0d0d0f';
      ctx.fillRect(ix, iy, iw, ih);
      lines('rgba(235,235,240,0.55)', 0.7);
      for (let k = 0; k < 36; k++) {
        ctx.beginPath();
        const ph = (k / 36) * Math.PI * 2;
        for (let a = 0; a <= 360; a += 2) {
          const t = (a * Math.PI) / 180;
          const rr = 60 + 28 * Math.sin(5 * t + ph);
          const px = cx + Math.cos(t) * rr,
            py = cy + Math.sin(t) * rr * 1.3;
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      break;
    }
    case 8: {
      ctx.fillStyle = '#7a1c1c';
      ctx.fillRect(ix, iy, iw, ih);
      const s = 28;
      for (let yy = -1; yy < ih / s + 1; yy++)
        for (let xx = -1; xx < iw / s + 1; xx++) {
          const px = ix + xx * s + s / 2,
            py = iy + yy * s + s / 2;
          ctx.beginPath();
          ctx.moveTo(px, py - s / 2);
          ctx.lineTo(px + s / 2, py);
          ctx.lineTo(px, py + s / 2);
          ctx.lineTo(px - s / 2, py);
          ctx.closePath();
          ctx.fillStyle = (xx + yy) % 2 ? '#8f2a2a' : '#5e1414';
          ctx.fill();
        }
      lines('rgba(240,220,170,0.6)', 1);
      for (let k = -ih; k < iw + ih; k += s) {
        ctx.beginPath();
        ctx.moveTo(ix + k, iy);
        ctx.lineTo(ix + k + ih, iy + ih);
        ctx.stroke();
      }
      break;
    }
    case 9: {
      ctx.fillStyle = '#0f5e60';
      ctx.fillRect(ix, iy, iw, ih);
      for (let a = 0; a < 48; a++) {
        const t = (a / 48) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(t) * 300, cy + Math.sin(t) * 300);
        ctx.lineTo(cx + Math.cos(t + 0.06) * 300, cy + Math.sin(t + 0.06) * 300);
        ctx.closePath();
        ctx.fillStyle = 'rgba(200,240,230,0.18)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, 6.28);
      ctx.fillStyle = '#e8c76a';
      ctx.fill();
      break;
    }
    case 10: {
      ctx.fillStyle = '#4a4d52';
      ctx.fillRect(ix, iy, iw, ih);
      const s = 12;
      for (let yy = 0; yy < ih / s + 2; yy++)
        for (let xx = 0; xx < iw / (s * 2) + 2; xx++) {
          const px = ix + xx * s * 2,
            py = iy + yy * s;
          ctx.fillStyle = (xx + yy) % 2 ? '#5d6066' : '#3c3f44';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + s, py + s);
          ctx.lineTo(px + s, py + 2 * s);
          ctx.lineTo(px, py + s);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = (xx + yy) % 2 ? '#43464b' : '#666a70';
          ctx.beginPath();
          ctx.moveTo(px + s, py + s);
          ctx.lineTo(px + 2 * s, py);
          ctx.lineTo(px + 2 * s, py + s);
          ctx.lineTo(px + s, py + 2 * s);
          ctx.closePath();
          ctx.fill();
        }
      break;
    }
    default: {
      ctx.fillStyle = '#16402c';
      ctx.fillRect(ix, iy, iw, ih);
      lines('#d9c27a', 2.2);
      const r = 26;
      for (let yy = 0; yy < 7; yy++)
        for (let xx = 0; xx < 5; xx++) {
          ctx.beginPath();
          ctx.arc(ix + 20 + xx * 40, iy + 20 + yy * 42, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      lines('#16402c', 5);
      for (let yy = 0; yy < 7; yy++)
        for (let xx = 0; xx < 5; xx++) {
          ctx.beginPath();
          ctx.arc(ix + 20 + xx * 40, iy + 20 + yy * 42, r, 0.2 + (xx + yy) * 0.5, 0.5 + (xx + yy) * 0.5);
          ctx.stroke();
        }
    }
  }
  ctx.restore();
  // inner frame line
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  roundRect(ctx, ix, iy, iw, ih, 8);
  ctx.stroke();
  wearOverlay(ctx, x, y, w, h, wear, seed + 17);
}

// ---------------- Atlas ----------------
export const ATLAS = { size: 2048, cols: 9, rows: 6, cellW: 2048 / 9, cellH: 2048 / 6 };
export const BACK_SLOT = 52;
export const EDGE_SLOT = 53;

export function atlasCell(slot: number) {
  const col = slot % ATLAS.cols;
  const row = Math.floor(slot / ATLAS.cols);
  return { x: col * ATLAS.cellW, y: row * ATLAS.cellH };
}

/** Draws all 52 faces, the chosen back and a paper-edge swatch into a 2048×2048 atlas with transparent corners. */
export function drawCardAtlas(ctx: Ctx, opts: FaceOpts & { back: number }) {
  ctx.clearRect(0, 0, ATLAS.size, ATLAS.size);
  for (let c = 0; c < 52; c++) {
    const { x, y } = atlasCell(c);
    drawCardFace(ctx, c, x, y, opts);
  }
  const b = atlasCell(BACK_SLOT);
  drawCardBack(ctx, opts.back, b.x, b.y, opts.wear, opts.seed ?? 5);
  const e = atlasCell(EDGE_SLOT);
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(e.x, e.y, CARD_W, CARD_H);
}
