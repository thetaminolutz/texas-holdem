// Pure pixel-level procedural texture generators. They run in a Web Worker (or Node) and return raw RGBA buffers.
// All generators are tileable horizontally and vertically unless noted, seeded and deterministic.
import { Noise2D, clamp, lerp, mulberry32, smoothstep, hexToRgb } from '../../util/noise';

export type WearLevel = 0 | 1 | 2 | 3; // new, light, worn, vintage

export interface TexOut {
  width: number;
  height: number;
  color: Uint8ClampedArray; // RGBA
  normal?: Uint8ClampedArray; // RGBA tangent-space normal map
  rough?: Uint8ClampedArray; // RGBA, roughness in G (three.js convention: G=roughness, B=metalness)
}

type RGB = [number, number, number];

export const WOOD_PALETTES: Record<string, { light: RGB; dark: RGB; ringFreq: number; contrast: number }> = {
  oak: { light: [196, 150, 98], dark: [128, 86, 48], ringFreq: 9, contrast: 0.75 },
  walnut: { light: [112, 72, 44], dark: [52, 31, 19], ringFreq: 7, contrast: 0.8 },
  mahogany: { light: [140, 58, 34], dark: [78, 27, 17], ringFreq: 11, contrast: 0.6 },
  ebony: { light: [52, 42, 36], dark: [16, 12, 11], ringFreq: 14, contrast: 0.55 },
};

/** Height buffer -> tangent space normal map (wrapping). */
export function heightToNormal(h: Float32Array, w: number, hh: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * hh * 4);
  for (let y = 0; y < hh; y++) {
    const ym = ((y - 1 + hh) % hh) * w;
    const yp = ((y + 1) % hh) * w;
    const y0 = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (h[y0 + xp] - h[y0 + xm]) * strength;
      const dy = (h[yp + x] - h[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y0 + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * inv * 0.5 + 0.5) * 255; // OpenGL convention (+Y up)
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function scratchLayer(w: number, h: number, count: number, seed: number, lenMax: number): Float32Array {
  // Thin random line scratches (wrap-around), value 0..1
  const m = new Float32Array(w * h);
  const rnd = mulberry32(seed);
  for (let s = 0; s < count; s++) {
    let x = rnd() * w;
    let y = rnd() * h;
    const ang = rnd() * Math.PI * 2;
    let dx = Math.cos(ang);
    let dy = Math.sin(ang);
    const len = (0.2 + rnd() * 0.8) * lenMax;
    const intensity = 0.3 + rnd() * 0.7;
    const curve = (rnd() - 0.5) * 0.02;
    for (let t = 0; t < len; t++) {
      const ix = ((Math.floor(x) % w) + w) % w;
      const iy = ((Math.floor(y) % h) + h) % h;
      const fade = Math.sin((t / len) * Math.PI);
      const k = iy * w + ix;
      m[k] = Math.max(m[k], intensity * fade);
      const c = Math.cos(curve);
      const sn = Math.sin(curve);
      const ndx = dx * c - dy * sn;
      dy = dx * sn + dy * c;
      dx = ndx;
      x += dx;
      y += dy;
    }
  }
  return m;
}

export interface WoodOpts {
  type: string;
  wear: WearLevel;
  seed?: number;
  /** cups/glass ring marks */
  rings?: boolean;
}

export function genWood(w: number, h: number, o: WoodOpts): TexOut {
  const pal = WOOD_PALETTES[o.type] ?? WOOD_PALETTES.walnut;
  const seed = o.seed ?? 11;
  const n = new Noise2D(seed);
  const n2 = new Noise2D(seed + 1);
  const rnd = mulberry32(seed + 2);
  const color = new Uint8ClampedArray(w * h * 4);
  const rough = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  // knots
  const knots: { x: number; y: number; r: number }[] = [];
  const kc = o.type === 'oak' || o.type === 'walnut' ? 1 + Math.floor(rnd() * 2) : 0;
  for (let i = 0; i < kc; i++) knots.push({ x: rnd(), y: rnd(), r: 0.02 + rnd() * 0.02 });
  const scratches = o.wear > 0 ? scratchLayer(w, h, [0, 25, 70, 150][o.wear], seed + 3, w * 0.18) : null;
  const ringMarks: { x: number; y: number; r: number; a: number }[] = [];
  if (o.rings !== false && o.wear >= 2) {
    const rc = o.wear === 3 ? 4 : 2;
    for (let i = 0; i < rc; i++) ringMarks.push({ x: rnd(), y: rnd(), r: 0.035 + rnd() * 0.02, a: 0.3 + rnd() * 0.4 });
  }
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // Grain runs along u. Large-scale ring bending (cathedral figure) + medium waviness.
      const warp = n.fbm(u * 2, v * 2, 3, 2, 0.5, 2, 2);
      let rv = v * pal.ringFreq * 2 + warp * 2.2 + n2.noise(u * 6, v * 4, 6, 4) * 0.25 + n.noise(u * 1, v * 5, 1, 5) * 1.6;
      let knotDark = 0;
      for (const k of knots) {
        let dx = u - k.x;
        let dy = v - k.y;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const d = Math.sqrt(dx * dx * 0.12 + dy * dy);
        const infl = Math.exp(-d / (k.r * 1.6));
        rv += infl * 1.4;
        knotDark = Math.max(knotDark, smoothstep(k.r * 0.45, k.r * 0.12, d));
      }
      const ring = rv - Math.floor(rv);
      // early wood soft and light, late wood a sharp darker band
      const ringIdx = Math.floor(rv);
      const ringVar = 0.35 + 0.65 * (((Math.sin(ringIdx * 12.9898) * 43758.5453) % 1) + 1) % 1;
      const late = smoothstep(0.55, 0.92, ring) * (1 - smoothstep(0.92, 1, ring)) * ringVar;
      const fibers = n2.noise(u * 8, v * 260, 8, 260) * 0.5 + 0.5; // long thin streaks
      const fibers2 = n.noise(u * 3, v * 90, 3, 90) * 0.5 + 0.5;
      const pores = Math.pow(n.noise(u * 64, v * 420, 64, 420) * 0.5 + 0.5, 7);
      const rays = o.type === 'oak' ? Math.pow(Math.max(0, n2.noise(u * 48, v * 6, 48, 6)), 6) * 0.9 : 0;
      let t = clamp(late * pal.contrast * 0.75 + (fibers - 0.5) * 0.2 + (fibers2 - 0.5) * 0.3 + warp * 0.15 + 0.2);
      t = clamp(t + knotDark * 0.6 - rays * 0.35);
      let r = lerp(pal.light[0], pal.dark[0], t);
      let g = lerp(pal.light[1], pal.dark[1], t);
      let b = lerp(pal.light[2], pal.dark[2], t);
      const pd = 1 - pores * 0.35;
      r *= pd;
      g *= pd;
      b *= pd;
      // large color variation (board to board)
      const cv = n.fbm(u * 1.5, v * 1.5, 2, 2, 0.5, 1.5, 1.5) * 0.12;
      r *= 1 + cv;
      g *= 1 + cv;
      b *= 1 + cv;
      let ro = 0.32 + late * 0.06 + pores * 0.2;
      let hgt = -late * 0.4 - pores * 0.6 + fibers * 0.1;
      if (scratches) {
        const s = scratches[y * w + x];
        if (s > 0) {
          // scratches in varnish are lighter and rougher
          r = lerp(r, r * 1.2 + 12, s * 0.3);
          g = lerp(g, g * 1.18 + 9, s * 0.3);
          b = lerp(b, b * 1.15 + 6, s * 0.3);
          ro = lerp(ro, 0.75, s);
          hgt -= s * 0.8;
        }
      }
      for (const m of ringMarks) {
        let dx = u - m.x;
        let dy = v - m.y;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        const ringv = Math.exp(-Math.pow((d - m.r) / 0.0025, 2)) * m.a * (0.6 + 0.4 * n.noise(u * 80, v * 80));
        r = lerp(r, r * 0.7 + 25, ringv);
        g = lerp(g, g * 0.7 + 22, ringv);
        b = lerp(b, b * 0.7 + 18, ringv);
        ro = lerp(ro, 0.6, ringv);
      }
      const i = (y * w + x) * 4;
      color[i] = r;
      color[i + 1] = g;
      color[i + 2] = b;
      color[i + 3] = 255;
      rough[i] = 255;
      rough[i + 1] = clamp(ro) * 255;
      rough[i + 2] = 0;
      rough[i + 3] = 255;
      height[y * w + x] = hgt;
    }
  }
  return { width: w, height: h, color, rough, normal: heightToNormal(height, w, h, 1.2) };
}

export interface FeltOpts {
  color: string;
  wear: WearLevel;
  seed?: number;
}

/** Tileable felt/speed-cloth fibers. Color texture + normal map (fine fibers, directional nap). */
export function genFelt(w: number, h: number, o: FeltOpts): TexOut {
  const base = hexToRgb(o.color);
  const n = new Noise2D(o.seed ?? 21);
  const n2 = new Noise2D((o.seed ?? 21) + 5);
  const rnd = mulberry32((o.seed ?? 21) + 9);
  const color = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const P = 8;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // microscopic fibers: high frequency noise stretched along nap direction (u)
      const f1 = n.noise(u * 32 * P, v * 96 * P, 32 * P, 96 * P);
      const f2 = n2.noise(u * 64 * P, v * 20 * P, 64 * P, 20 * P);
      const cloud = n.fbm(u * P, v * P, 4, 2, 0.5, P, P);
      const speck = rnd() < 0.002 ? 1 : 0;
      const t = f1 * 0.06 + f2 * 0.05 + cloud * 0.07 + (rnd() - 0.5) * 0.06;
      const k = 1 + t + speck * 0.25;
      const i = (y * w + x) * 4;
      color[i] = base[0] * k;
      color[i + 1] = base[1] * k;
      color[i + 2] = base[2] * k;
      color[i + 3] = 255;
      height[y * w + x] = f1 * 0.5 + f2 * 0.4 + (rnd() - 0.5) * 0.5;
    }
  }
  return { width: w, height: h, color, normal: heightToNormal(height, w, h, 1.6) };
}

export interface LeatherOpts {
  color: string;
  wear: WearLevel;
  seed?: number;
  /** draw stitch lines at these v positions (0..1) */
  stitches?: number[];
  stitchColor?: string;
}

/** Pebbled leather via cellular noise + creases + wear. */
export function genLeather(w: number, h: number, o: LeatherOpts): TexOut {
  const base = hexToRgb(o.color);
  const seed = o.seed ?? 31;
  const n = new Noise2D(seed);
  const rnd = mulberry32(seed + 1);
  // Cell points on a jittered grid (tileable)
  const G = 128;
  const pts = new Float32Array(G * G * 2);
  for (let i = 0; i < G * G; i++) {
    pts[i * 2] = rnd();
    pts[i * 2 + 1] = rnd();
  }
  const color = new Uint8ClampedArray(w * h * 4);
  const rough = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const sc = o.stitchColor ? hexToRgb(o.stitchColor) : ([220, 200, 160] as RGB);
  const P = 4;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const gx = u * G;
      const gy = v * G * (h / w);
      const Gy = Math.round(G * (h / w)) || 1;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      let d1 = 9,
        d2 = 9;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const X = (((cx + ox) % G) + G) % G;
          const Y = (((cy + oy) % Gy) + Gy) % Gy;
          const pi = ((Y % G) * G + X) * 2;
          const px = cx + ox + pts[pi];
          const py = cy + oy + pts[pi + 1];
          const d = (px - gx) * (px - gx) + (py - gy) * (py - gy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // 0 at cell borders
      const pebble = smoothstep(0, 0.35, edge);
      const crease = Math.pow(1 - Math.abs(n.noise(u * 3 * P, v * 3 * P, 3 * P, 3 * P)), 18);
      const mottled = n.fbm(u * P, v * P, 4, 2, 0.5, P, P);
      const wearM = o.wear > 0 ? smoothstep(0.1, 0.6, n.fbm(u * 2 * P, v * 2 * P, 3, 2, 0.5, 2 * P, 2 * P) + o.wear * 0.12 - 0.2) : 0;
      let k = 0.8 + pebble * 0.22 + mottled * 0.12 - crease * 0.08;
      k += wearM * 0.22;
      let r = base[0] * k;
      let g = base[1] * k;
      let b = base[2] * k;
      let ro = 0.55 - pebble * 0.12 + wearM * 0.15;
      let hg = pebble * 0.8 - crease * 0.3;
      if (o.stitches) {
        for (const sv of o.stitches) {
          const dv = Math.abs(v - sv) * h; // px
          if (dv < 5) {
            // channel groove
            hg -= (1 - dv / 5) * 0.6;
          }
          const stitchLen = 18;
          const ph = (x % stitchLen) / stitchLen;
          if (dv < 2.2 && ph > 0.15 && ph < 0.8) {
            const s = 1 - dv / 2.2;
            r = lerp(r, sc[0] * (0.8 + 0.2 * Math.sin(ph * Math.PI)), s);
            g = lerp(g, sc[1] * (0.8 + 0.2 * Math.sin(ph * Math.PI)), s);
            b = lerp(b, sc[2] * (0.8 + 0.2 * Math.sin(ph * Math.PI)), s);
            hg += s * 1.2;
            ro = 0.7;
          }
        }
      }
      const i = (y * w + x) * 4;
      color[i] = r;
      color[i + 1] = g;
      color[i + 2] = b;
      color[i + 3] = 255;
      rough[i] = 255;
      rough[i + 1] = clamp(ro) * 255;
      rough[i + 2] = 0;
      rough[i + 3] = 255;
      height[y * w + x] = hg;
    }
  }
  return { width: w, height: h, color, rough, normal: heightToNormal(height, w, h, 2.0) };
}

export interface MetalOpts {
  tint: 'brass' | 'chrome' | 'gold' | 'steel';
  wear: WearLevel;
  seed?: number;
}

export function genBrushedMetal(w: number, h: number, o: MetalOpts): TexOut {
  const tints: Record<string, RGB> = {
    brass: [196, 156, 84],
    gold: [214, 176, 96],
    chrome: [200, 202, 208],
    steel: [150, 152, 158],
  };
  const base = tints[o.tint];
  const n = new Noise2D(o.seed ?? 41);
  const rnd = mulberry32((o.seed ?? 41) + 3);
  const color = new Uint8ClampedArray(w * h * 4);
  const rough = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const scr = o.wear > 0 ? scratchLayer(w, h, [0, 40, 100, 200][o.wear], (o.seed ?? 41) + 7, w * 0.15) : null;
  // per-row brushing streaks
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++) rows[y] = rnd();
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const streak = n.noise(u * 4, v * 400, 4, 400) * 0.5 + (rows[y] - 0.5) * 0.4;
      const cloud = n.fbm(u * 3, v * 3, 3, 2, 0.5, 3, 3);
      const tarnish = o.tint === 'brass' ? smoothstep(0.1, 0.6, cloud + o.wear * 0.1) * 0.25 : 0;
      let k = 0.9 + streak * 0.1 + cloud * 0.05 - tarnish;
      let ro = 0.3 + streak * 0.05 + tarnish * 0.6;
      if (scr) {
        const s = scr[y * w + x];
        k += s * 0.12;
        ro += s * 0.2;
      }
      const i = (y * w + x) * 4;
      color[i] = base[0] * k;
      color[i + 1] = base[1] * k * (1 - tarnish * 0.15);
      color[i + 2] = base[2] * k * (1 - tarnish * 0.35);
      color[i + 3] = 255;
      rough[i] = 255;
      rough[i + 1] = clamp(ro) * 255;
      rough[i + 2] = 255;
      rough[i + 3] = 255;
      height[y * w + x] = streak * 0.3 - (scr ? scr[y * w + x] : 0);
    }
  }
  return { width: w, height: h, color, rough, normal: heightToNormal(height, w, h, 0.8) };
}

export function genPaper(w: number, h: number, o: { tint?: string; wear: WearLevel; seed?: number }): TexOut {
  const base = hexToRgb(o.tint ?? '#efe6d2');
  const n = new Noise2D(o.seed ?? 51);
  const rnd = mulberry32((o.seed ?? 51) + 1);
  const color = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const P = 6;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const fib = n.noise(u * 40 * P, v * 40 * P, 40 * P, 40 * P);
      const cloud = n.fbm(u * P, v * P, 4, 2, 0.5, P, P);
      const stain = o.wear >= 2 ? smoothstep(0.25, 0.55, n.fbm(u * 2, v * 2, 3, 2, 0.5, 2, 2)) * 0.08 * o.wear : 0;
      const k = 0.97 + fib * 0.025 + cloud * 0.04 + (rnd() - 0.5) * 0.03;
      const i = (y * w + x) * 4;
      color[i] = base[0] * k * (1 - stain * 0.5);
      color[i + 1] = base[1] * k * (1 - stain * 0.8);
      color[i + 2] = base[2] * k * (1 - stain * 1.4);
      color[i + 3] = 255;
      height[y * w + x] = fib * 0.4 + cloud * 0.2;
    }
  }
  return { width: w, height: h, color, normal: heightToNormal(height, w, h, 0.6) };
}

/** Clay chip edge/top micro texture (grayscale-ish, multiplied with chip color). */
export function genClay(w: number, h: number, seed = 61, wear: WearLevel = 1): TexOut {
  const n = new Noise2D(seed);
  const color = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const scr = wear > 0 ? scratchLayer(w, h, [0, 30, 80, 160][wear], seed + 1, w * 0.1) : null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w,
        v = y / h;
      const g = n.fbm(u * 24, v * 24, 4, 2, 0.5, 24, 24);
      const s = scr ? scr[y * w + x] : 0;
      const k = 235 + g * 18 - s * 30;
      const i = (y * w + x) * 4;
      color[i] = color[i + 1] = color[i + 2] = k;
      color[i + 3] = 255;
      height[y * w + x] = g * 0.5 - s;
    }
  return { width: w, height: h, color, normal: heightToNormal(height, w, h, 1.0) };
}
