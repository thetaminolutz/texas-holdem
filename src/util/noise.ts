// Seeded procedural noise utilities shared by the browser texture worker and Node build scripts.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  private perm: Uint8Array;
  private grad: Float32Array;
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const a = rnd() * Math.PI * 2;
      this.grad[i * 2] = Math.cos(a);
      this.grad[i * 2 + 1] = Math.sin(a);
    }
  }
  /** Gradient noise in roughly [-1,1], periodic with period `px`,`py` if given (for tileable textures). */
  noise(x: number, y: number, px = 0, py = 0): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const X0 = px ? ((xi % px) + px) % px : xi;
    const Y0 = py ? ((yi % py) + py) % py : yi;
    const X1 = px ? (X0 + 1) % px : xi + 1;
    const Y1 = py ? (Y0 + 1) % py : yi + 1;
    const g = (X: number, Y: number, dx: number, dy: number) => {
      const h = this.perm[(this.perm[X & 255] + Y) & 511] * 2;
      return this.grad[h] * dx + this.grad[h + 1] * dy;
    };
    const n00 = g(X0, Y0, xf, yf);
    const n10 = g(X1, Y0, xf - 1, yf);
    const n01 = g(X0, Y1, xf, yf - 1);
    const n11 = g(X1, Y1, xf - 1, yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5, px = 0, py = 0): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq, px ? px * freq : 0, py ? py * freq : 0);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  ridged(x: number, y: number, octaves = 4, px = 0, py = 0): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq, px ? px * freq : 0, py ? py * freq : 0));
      sum += n * n * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  }
}

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
