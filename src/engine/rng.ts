// Random number sources. Production deals use crypto.getRandomValues; seeded mode for tests/replays.

export interface Rng {
  /** uniform float in [0,1) */
  next(): number;
  /** uniform integer in [0, n) without modulo bias */
  int(n: number): number;
}

/** Cryptographically secure RNG (Web Crypto, available in browsers, workers and Node 19+). */
export class CryptoRng implements Rng {
  private buf = new Uint32Array(256);
  private idx = 256;
  private u32(): number {
    if (this.idx >= this.buf.length) {
      globalThis.crypto.getRandomValues(this.buf);
      this.idx = 0;
    }
    return this.buf[this.idx++];
  }
  next(): number {
    return this.u32() / 4294967296;
  }
  int(n: number): number {
    if (n <= 0) return 0;
    // rejection sampling for an unbiased result
    const limit = Math.floor(4294967296 / n) * n;
    let x: number;
    do x = this.u32();
    while (x >= limit);
    return x % n;
  }
}

/** xoshiro128** — fast, high quality, seedable. */
export class SeededRng implements Rng {
  private s = new Uint32Array(4);
  constructor(seed: number | string) {
    let h = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    for (let i = 0; i < 4; i++) {
      // splitmix32
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
    if (!(this.s[0] | this.s[1] | this.s[2] | this.s[3])) this.s[0] = 1;
  }
  private u32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  next(): number {
    return this.u32() / 4294967296;
  }
  int(n: number): number {
    if (n <= 0) return 0;
    const limit = Math.floor(4294967296 / n) * n;
    let x: number;
    do x = this.u32();
    while (x >= limit);
    return x % n;
  }
}

function rotl(x: number, k: number) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export const cryptoRng = new CryptoRng();
