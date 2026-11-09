// Generates all app icons procedurally (no external files): a clay poker chip with a spade on dark felt
// framed by walnut wood. Writes PNGs into public/icons/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.ts';
import { Noise2D, clamp, smoothstep, lerp } from '../src/util/noise.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const noise = new Noise2D(7);

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Spade SDF-ish inside test in unit coords (centered at 0, size ~1)
function insideSpade(x: number, y: number): number {
  // y down. Body: inverted heart = two circles + triangle pointing up.
  const yy = -y; // y up
  const c1 = Math.hypot(x + 0.24, yy + 0.06) - 0.26;
  const c2 = Math.hypot(x - 0.24, yy + 0.06) - 0.26;
  // triangle top
  const tri = Math.max(Math.abs(x) * 0.8 + (yy - 0.5) * 0.6, -(yy + 0.05));
  const smin = (a: number, b: number, k: number) => {
    const h = clamp(0.5 + (0.5 * (b - a)) / k);
    return lerp(b, a, h) - k * h * (1 - h);
  };
  const body = smin(Math.min(c1, c2), tri, 0.12);
  // stem
  const stem = Math.max(Math.abs(x) - (0.04 + (-0.2 - yy) * 0.5), yy + 0.12, -(yy + 0.55));
  return Math.min(body, Math.max(stem, -1));
}

function iconPixel(u: number, v: number, maskable: boolean): RGB {
  // u,v in [0,1]
  const x = u - 0.5;
  const y = v - 0.5;
  // Background: walnut wood frame + felt center
  const frame = maskable ? 0 : 0.06;
  const wn = noise.fbm(u * 3, v * 40, 4);
  const ring = Math.sin((u * 18 + wn * 6) * Math.PI) * 0.5 + 0.5;
  const wood: RGB = mix([62, 36, 20], [104, 64, 36], ring * 0.6 + wn * 0.3 + 0.2);
  const fn = noise.fbm(u * 60, v * 60, 3) * 0.5 + 0.5;
  const vign = 1 - Math.hypot(x, y) * 0.9;
  const felt: RGB = mix([10, 58, 34], [22, 96, 56], fn * 0.4 + vign * 0.6);
  const inFelt = Math.max(Math.abs(x), Math.abs(y)) < 0.5 - frame;
  let col: RGB = inFelt ? felt : wood;
  if (!maskable && Math.abs(Math.max(Math.abs(x), Math.abs(y)) - (0.5 - frame)) < 0.006) col = [200, 160, 80];

  // Chip
  const R = maskable ? 0.3 : 0.36;
  const r = Math.hypot(x, y);
  // contact shadow
  const sh = smoothstep(R + 0.06, R - 0.02, Math.hypot(x - 0.012, y - 0.02));
  col = mix(col, [0, 0, 0], sh * 0.55);
  if (r < R) {
    const ang = Math.atan2(y, x);
    const t = r / R;
    // base red clay
    let c: RGB = [168, 22, 30];
    // edge spots (6 white rectangles at rim)
    const seg = (((ang / (Math.PI * 2)) * 8) % 1 + 1) % 1;
    if (t > 0.78 && seg > 0.35 && seg < 0.65) c = [238, 232, 220];
    // inner ring
    if (t > 0.6 && t < 0.64) c = [240, 220, 170];
    if (t < 0.6) c = [236, 228, 210];
    // spade
    const s = insideSpade(x / (R * 1.0), y / (R * 1.0) - 0.02);
    if (s < 0) c = [24, 20, 22];
    // grain and lighting (dome)
    const n = noise.fbm(u * 80, v * 80, 3) * 0.06;
    const light = 0.85 + 0.25 * (1 - t) - 0.15 * (x + y) / R + n;
    const rim = smoothstep(0.9, 1.0, t);
    c = [c[0] * light, c[1] * light, c[2] * light];
    c = mix(c, [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6], rim);
    // specular highlight
    const spec = Math.exp(-Math.pow(Math.hypot(x + R * 0.35, y + R * 0.4) / (R * 0.35), 2)) * 0.35;
    c = mix(c, [255, 250, 240], spec);
    const aa = smoothstep(R, R - 0.004, r);
    col = mix(col, c, aa);
  }
  return [clamp(col[0], 0, 255), clamp(col[1], 0, 255), clamp(col[2], 0, 255)];
}

function render(size: number, maskable: boolean): Buffer {
  const ss = 2;
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = iconPixel((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, maskable);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const i = (py * size + px) * 4;
      data[i] = r / (ss * ss);
      data[i + 1] = g / (ss * ss);
      data[i + 2] = b / (ss * ss);
      data[i + 3] = 255;
    }
  }
  return encodePNG(size, size, data);
}

const targets: [string, number, boolean][] = [
  ['icon-180.png', 180, false],
  ['apple-touch-icon.png', 180, false],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['favicon-32.png', 32, false],
];
for (const [name, size, mask] of targets) {
  const file = resolve(outDir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size, mask));
}
console.log(`Generated ${targets.length} icons in public/icons`);
