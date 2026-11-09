// Hand ranges as weights over all 1326 two-card combos, plus Monte Carlo equity against weighted ranges.
import { type Card, handClass, rankOf, suitOf } from '../engine/cards';
import { evaluate, category, Cat } from '../engine/evaluator';
import type { Rng } from '../engine/rng';
import TABLE from './preflopTable.json';

export const PREFLOP = TABLE as Record<string, { e1: number; e2: number; e5: number; rank: number; pct: number }>;

export const COMBOS: [Card, Card][] = [];
const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);
export const COMBO_PCT = new Float32Array(1326);
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++) {
    COMBO_INDEX[a * 52 + b] = COMBO_INDEX[b * 52 + a] = COMBOS.length;
    COMBOS.push([a, b]);
  }
COMBOS.forEach(([a, b], i) => (COMBO_PCT[i] = PREFLOP[handClass(a, b)].pct));

export function comboIndex(a: Card, b: Card) {
  return COMBO_INDEX[a * 52 + b];
}

/** Percentile of a starting hand (0 = best, 1 = worst). */
export function handPercentile(a: Card, b: Card): number {
  return PREFLOP[handClass(a, b)].pct;
}

export type Range = Float32Array;

export function fullRange(): Range {
  return new Float32Array(1326).fill(1);
}

/** Keep hands within [lo, hi] percentile with soft edges. */
export function percentileBand(lo: number, hi: number, soft = 0.04): Range {
  const r = new Float32Array(1326);
  for (let i = 0; i < 1326; i++) {
    const p = COMBO_PCT[i];
    let w = 1;
    if (p < lo) w = Math.max(0, 1 - (lo - p) / soft);
    if (p > hi) w = Math.max(0, 1 - (p - hi) / soft);
    r[i] = w;
  }
  return r;
}

export function multiply(r: Range, f: Range, floor = 0.02) {
  for (let i = 0; i < 1326; i++) r[i] *= Math.max(floor, f[i]);
}

export function removeDead(r: Range, dead: Card[]) {
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    if (dead.includes(a) || dead.includes(b)) r[i] = 0;
  }
}

/**
 * Re-weight a range after a postflop action using each combo's strength on the board.
 * aggressive: bet/raise (polarized toward strong hands + some draws/bluffs), passive call (medium/draws), check (capped).
 */
export function updatePostflop(r: Range, board: Card[], action: 'bet' | 'raise' | 'call' | 'check', bluffiness = 0.15) {
  const strength = comboStrengths(board);
  for (let i = 0; i < 1326; i++) {
    if (r[i] <= 0) continue;
    const s = strength[i]; // 0..1 (made hand), negative = blocked
    if (s < 0) {
      r[i] = 0;
      continue;
    }
    const draw = drawStrength(COMBOS[i], board);
    let w = 1;
    switch (action) {
      case 'raise':
        w = s > 0.8 ? 1 : s > 0.6 ? 0.45 : draw > 0.5 ? 0.45 : bluffiness * 0.6;
        break;
      case 'bet':
        w = s > 0.7 ? 1 : s > 0.45 ? 0.6 : draw > 0.4 ? 0.65 : bluffiness;
        break;
      case 'call':
        w = s > 0.85 ? 0.45 : s > 0.35 ? 1 : draw > 0.3 ? 0.9 : 0.12 + bluffiness * 0.3;
        break;
      case 'check':
        w = s > 0.9 ? 0.35 : s > 0.6 ? 0.75 : 1;
        break;
    }
    r[i] *= w;
  }
}

const strengthCache = new Map<string, Float32Array>();
/** Relative strength (percentile among all live combos) of every combo on the given board. */
export function comboStrengths(board: Card[]): Float32Array {
  const key = board.join(',');
  const hit = strengthCache.get(key);
  if (hit) return hit;
  const scores = new Float64Array(1326);
  const seven: Card[] = [0, 0, ...board];
  const live: number[] = [];
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    if (board.includes(a) || board.includes(b)) {
      scores[i] = -1;
      continue;
    }
    seven[0] = a;
    seven[1] = b;
    scores[i] = evaluate(seven, 2 + board.length);
    live.push(i);
  }
  live.sort((x, y) => scores[x] - scores[y]);
  const out = new Float32Array(1326).fill(-1);
  live.forEach((idx, k) => (out[idx] = k / Math.max(1, live.length - 1)));
  if (strengthCache.size > 64) strengthCache.clear();
  strengthCache.set(key, out);
  return out;
}

/** Draw potential 0..1 (flush draws, open-enders, gutshots) for a combo on a flop/turn. */
export function drawStrength(hole: [Card, Card] | Card[], board: Card[]): number {
  if (board.length >= 5 || board.length < 3) return 0;
  const cards = [...hole, ...board];
  const suits = [0, 0, 0, 0];
  for (const c of cards) suits[suitOf(c)]++;
  let score = 0;
  const flushDraw = suits.some((n, s) => n === 4 && hole.some((h) => suitOf(h) === s));
  if (flushDraw) score += 0.6;
  let mask = 0;
  for (const c of cards) mask |= 1 << rankOf(c);
  let oesd = false,
    gut = false;
  for (let lo = -1; lo <= 8; lo++) {
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const r = lo + k;
      const bit = r === -1 ? 12 : r;
      if (mask & (1 << bit)) n++;
    }
    if (n === 4) {
      // open-ended if the missing card is at an end
      const first = lo === -1 ? 12 : lo;
      const last = lo + 4;
      const hasFirst = !!(mask & (1 << first));
      const hasLast = !!(mask & (1 << last));
      if (!hasFirst || !hasLast) oesd = true;
      else gut = true;
    }
  }
  if (oesd) score += 0.45;
  else if (gut) score += 0.22;
  // overcards
  const top = Math.max(...board.map(rankOf));
  const overs = hole.filter((h) => rankOf(h) > top).length;
  score += overs * 0.08;
  return Math.min(1, score);
}

/** Count clean outs to improve to at least `targetCat` (approximate, for the coach and bots). */
export function countOuts(hole: Card[], board: Card[]): { outs: number; desc: string } {
  if (board.length >= 5 || board.length < 3) return { outs: 0, desc: '' };
  const cur = evaluate([...hole, ...board]);
  const curCat = category(cur);
  const used = new Set([...hole, ...board]);
  let outs = 0;
  const kinds = new Set<string>();
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const nb = [...board, c];
    const s = evaluate([...hole, ...nb]);
    const boardOnly = nb.length >= 5 ? evaluate(nb) : -1;
    const cat = category(s);
    if (cat > curCat && cat >= Cat.Pair && s > boardOnly) {
      // ignore outs that only pair the board for everyone
      if (cat === Cat.Pair || (cat === Cat.TwoPair && curCat === Cat.Pair)) {
        if (!hole.some((h) => rankOf(h) === rankOf(c))) continue;
      }
      outs++;
      kinds.add(['', 'pair', 'two pair', 'trips', 'straight', 'flush', 'full house', 'quads', 'straight flush'][cat]);
    }
  }
  return { outs, desc: [...kinds].slice(0, 3).join(', ') };
}

export interface BoardTexture {
  wet: number; // 0..1
  paired: boolean;
  monotone: boolean;
  twoTone: boolean;
  connected: number; // 0..1
  highCard: number; // rank
}

export function boardTexture(board: Card[]): BoardTexture {
  if (board.length < 3) return { wet: 0, paired: false, monotone: false, twoTone: false, connected: 0, highCard: 0 };
  const suits = [0, 0, 0, 0];
  board.forEach((c) => suits[suitOf(c)]++);
  const maxSuit = Math.max(...suits);
  const ranks = [...new Set(board.map(rankOf))].sort((a, b) => a - b);
  const paired = ranks.length < board.length;
  let conn = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2) conn++;
  const connected = Math.min(1, conn / Math.max(1, ranks.length - 1));
  const monotone = maxSuit >= 3;
  const twoTone = maxSuit === 2;
  const wet = Math.min(1, connected * 0.55 + (monotone ? 0.5 : twoTone ? 0.25 : 0) - (paired ? 0.15 : 0));
  return { wet: Math.max(0, wet), paired, monotone, twoTone, connected, highCard: ranks[ranks.length - 1] };
}

/** Sample a combo from a weighted range avoiding dead cards (rejection sampling with fallback). */
function sampleCombo(r: Range, cum: Float32Array, total: number, dead: Uint8Array, rng: Rng): number {
  for (let tries = 0; tries < 30; tries++) {
    const x = rng.next() * total;
    // binary search
    let lo = 0,
      hi = 1325;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    const [a, b] = COMBOS[lo];
    if (!dead[a] && !dead[b]) return lo;
  }
  // fallback: uniform random live combo
  for (let tries = 0; tries < 200; tries++) {
    const i = rng.int(1326);
    const [a, b] = COMBOS[i];
    if (!dead[a] && !dead[b] && r[i] > 0) return i;
  }
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    if (!dead[a] && !dead[b]) return i;
  }
  return 0;
}

/** Monte Carlo equity of `hole` vs opponents' weighted ranges. */
export function equityVsRanges(hole: Card[], board: Card[], ranges: Range[], iters: number, rng: Rng): number {
  if (ranges.length === 0) return 1;
  const cums: Float32Array[] = [];
  const totals: number[] = [];
  for (const r of ranges) {
    const cum = new Float32Array(1326);
    let t = 0;
    for (let i = 0; i < 1326; i++) {
      const [a, b] = COMBOS[i];
      const w = hole.includes(a) || hole.includes(b) || board.includes(a) || board.includes(b) ? 0 : r[i];
      t += w;
      cum[i] = t;
    }
    if (t <= 0) {
      for (let i = 0; i < 1326; i++) cum[i] = i + 1;
      t = 1326;
    }
    cums.push(cum);
    totals.push(t);
  }
  const dead = new Uint8Array(52);
  const deck: Card[] = [];
  const seven: Card[] = new Array(7);
  let won = 0;
  for (let it = 0; it < iters; it++) {
    dead.fill(0);
    for (const c of hole) dead[c] = 1;
    for (const c of board) dead[c] = 1;
    const opp: number[] = [];
    for (let k = 0; k < ranges.length; k++) {
      const ci = sampleCombo(ranges[k], cums[k], totals[k], dead, rng);
      const [a, b] = COMBOS[ci];
      dead[a] = dead[b] = 1;
      opp.push(a, b);
    }
    deck.length = 0;
    for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
    const need = 5 - board.length;
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(deck.length - i);
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    for (let i = 0; i < board.length; i++) seven[2 + i] = board[i];
    for (let i = 0; i < need; i++) seven[2 + board.length + i] = deck[i];
    seven[0] = hole[0];
    seven[1] = hole[1];
    const me = evaluate(seven, 7);
    let ties = 0,
      lost = false;
    for (let k = 0; k < ranges.length; k++) {
      seven[0] = opp[k * 2];
      seven[1] = opp[k * 2 + 1];
      const s = evaluate(seven, 7);
      if (s > me) {
        lost = true;
        break;
      }
      if (s === me) ties++;
    }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / iters;
}
