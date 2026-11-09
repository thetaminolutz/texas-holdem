// Procedural casino chip artwork: cap faces (with denomination inlay) and edge strips with spot inserts.
import { CHIP_SETS, DENOMS, type ChipStyle } from '../catalog';
import { mulberry32 } from '../../util/noise';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const SERIF = '"Playfair Display", Georgia, serif';

export const CHIP_ATLAS = { size: 2048, capCols: 4, capRows: 3, cap: 512, edgeTop: 1536, edgeH: 42 };

export function denomLabel(d: number): string {
  if (d >= 1000) return d % 1000 === 0 ? `${d / 1000}K` : `${(d / 1000).toFixed(1)}K`;
  return String(d);
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function drawChipCap(ctx: Ctx, x: number, y: number, size: number, denom: number, st: ChipStyle, wear: number, seed: number) {
  const cx = x + size / 2,
    cy = y + size / 2,
    R = size / 2;
  ctx.save();
  // base
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = st.base;
  ctx.fill();
  // edge spots on the face (6 spots like inserts), each with stripes
  const spots = 6;
  for (let i = 0; i < spots; i++) {
    const a = (i / spots) * Math.PI * 2 + Math.PI / spots;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(R * 0.74, -R * 0.13);
    ctx.lineTo(R, -R * 0.17);
    ctx.lineTo(R, R * 0.17);
    ctx.lineTo(R * 0.74, R * 0.13);
    ctx.closePath();
    ctx.fillStyle = st.spot;
    ctx.fill();
    ctx.strokeStyle = shade(st.base, -0.2);
    ctx.lineWidth = size * 0.006;
    for (const k of [-0.06, 0.06]) {
      ctx.beginPath();
      ctx.moveTo(R * 0.76, R * k);
      ctx.lineTo(R * 0.99, R * k * 1.3);
      ctx.stroke();
    }
    ctx.restore();
  }
  // raised outer ring (embossed)
  ctx.lineWidth = size * 0.012;
  ctx.strokeStyle = shade(st.base, 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  // small dashes ring
  ctx.strokeStyle = shade(st.base, -0.25);
  ctx.lineWidth = size * 0.008;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.64, cy + Math.sin(a) * R * 0.64);
    ctx.lineTo(cx + Math.cos(a) * R * 0.69, cy + Math.sin(a) * R * 0.69);
    ctx.stroke();
  }
  // inlay
  const g = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.2, R * 0.05, cx, cy, R * 0.6);
  g.addColorStop(0, '#fffdf6');
  g.addColorStop(1, st.inlay);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = size * 0.01;
  ctx.strokeStyle = st.text;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.52, 0, Math.PI * 2);
  ctx.stroke();
  // denomination
  const label = denomLabel(denom);
  ctx.fillStyle = st.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = label.length <= 2 ? size * 0.34 : label.length === 3 ? size * 0.27 : size * 0.21;
  ctx.font = `700 ${fs}px ${SERIF}`;
  ctx.fillText(label, cx, cy + size * 0.01);
  ctx.font = `700 ${size * 0.055}px ${SERIF}`;
  ctx.fillText('FELT · OAK', cx, cy - R * 0.36);
  ctx.fillText('★', cx, cy + R * 0.38);
  // wear: scratches + grime
  const rnd = mulberry32(seed);
  ctx.globalAlpha = 0.12 * wear;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < wear * 12; i++) {
    const a = rnd() * Math.PI * 2,
      r = rnd() * R * 0.9;
    const px = cx + Math.cos(a) * r,
      py = cy + Math.sin(a) * r;
    const b = rnd() * Math.PI * 2,
      l = 6 + rnd() * 24;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(b) * l, py + Math.sin(b) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawChipEdge(ctx: Ctx, x: number, y: number, w: number, h: number, st: ChipStyle, wear: number) {
  ctx.fillStyle = st.base;
  ctx.fillRect(x, y, w, h);
  const spots = 6;
  const seg = w / spots;
  for (let i = 0; i < spots; i++) {
    const sx = x + i * seg + seg / 2 - seg * 0.17;
    ctx.fillStyle = st.spot;
    ctx.fillRect(sx, y, seg * 0.34, h);
    ctx.fillStyle = shade(st.base, -0.15);
    ctx.fillRect(sx + seg * 0.1, y, seg * 0.03, h);
    ctx.fillRect(sx + seg * 0.21, y, seg * 0.03, h);
  }
  // subtle top/bottom bevel darkening
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.2, 'rgba(0,0,0,0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (wear > 0) {
    ctx.globalAlpha = 0.08 * wear;
    ctx.fillStyle = '#000';
    for (let i = 0; i < 40 * wear; i++) ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 1);
    ctx.globalAlpha = 1;
  }
}

export function drawChipAtlas(ctx: Ctx, set: number, wear: number) {
  const styles = CHIP_SETS[set] ?? CHIP_SETS[0];
  const A = CHIP_ATLAS;
  ctx.clearRect(0, 0, A.size, A.size);
  DENOMS.forEach((d, i) => {
    const st = styles[d];
    const col = i % A.capCols,
      row = Math.floor(i / A.capCols);
    drawChipCap(ctx, col * A.cap, row * A.cap, A.cap, d, st, wear, 77 + i);
    drawChipEdge(ctx, 0, A.edgeTop + i * A.edgeH, A.size, A.edgeH, st, wear);
  });
}
