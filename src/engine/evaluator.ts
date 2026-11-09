// Fast 5–7 card poker hand evaluator using rank counts and per-suit bitmasks with lookup tables.
// Score: category * 2^20 + up to five 4-bit kicker ranks (higher score = better hand).
import { type Card, rankOf, suitOf, RANK_NAMES, RANK_PLURALS } from './cards';

export const enum Cat {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}
export const CATEGORY_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

const STRAIGHT_HIGH = new Int8Array(8192); // highest rank of best straight in mask, or -1
const TOP5 = new Int32Array(8192); // packed top-5 ranks (nibbles) of mask
const POPCOUNT = new Uint8Array(8192);
(() => {
  for (let m = 0; m < 8192; m++) {
    let hi = -1;
    for (let top = 12; top >= 4; top--) {
      const need = 0b11111 << (top - 4);
      if ((m & need) === need) {
        hi = top;
        break;
      }
    }
    if (hi < 0 && (m & 0b1000000001111) === 0b1000000001111) hi = 3; // wheel A-5
    STRAIGHT_HIGH[m] = hi;
    let packed = 0;
    let n = 0;
    for (let r = 12; r >= 0 && n < 5; r--)
      if (m & (1 << r)) {
        packed = (packed << 4) | r;
        n++;
      }
    while (n < 5) {
      packed <<= 4;
      n++;
    }
    TOP5[m] = packed;
    let c = 0;
    for (let r = 0; r < 13; r++) if (m & (1 << r)) c++;
    POPCOUNT[m] = c;
  }
})();

const SHIFT = 1 << 20;
const counts = new Uint8Array(13);
const suitMask = new Int32Array(4);
const suitCount = new Uint8Array(4);

/** Evaluate 5..7 cards. Allocation-free hot path. */
export function evaluate(cards: ArrayLike<Card>, n = cards.length): number {
  counts.fill(0);
  suitMask[0] = suitMask[1] = suitMask[2] = suitMask[3] = 0;
  suitCount[0] = suitCount[1] = suitCount[2] = suitCount[3] = 0;
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    counts[r]++;
    suitMask[s] |= 1 << r;
    suitCount[s]++;
    rankMask |= 1 << r;
  }
  // Flush / straight flush
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      const sf = STRAIGHT_HIGH[suitMask[s]];
      if (sf >= 0) return Cat.StraightFlush * SHIFT + (sf << 16);
      // Flush beats everything below; but quads/full house possible with 7 cards? Not simultaneously with a flush
      // when only 7 cards... Actually quads + flush impossible (needs 4+5 > 7 distinct), full house + flush possible.
      const flushScore = Cat.Flush * SHIFT + TOP5[suitMask[s]];
      // check full house / quads first
      const fh = pairedScore(rankMask);
      return fh > flushScore ? fh : flushScore;
    }
  }
  const st = STRAIGHT_HIGH[rankMask];
  const paired = pairedScore(rankMask);
  if (st >= 0) {
    const ss = Cat.Straight * SHIFT + (st << 16);
    return paired > ss ? paired : ss;
  }
  return paired;
}

/** Score from rank multiplicities (quads, full house, trips, two pair, pair, high card). */
function pairedScore(rankMask: number): number {
  let quad = -1,
    trip1 = -1,
    trip2 = -1,
    pair1 = -1,
    pair2 = -1,
    pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = counts[r];
    if (c === 4) quad = r;
    else if (c === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (c === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
      else if (pair3 < 0) pair3 = r;
    }
  }
  if (quad >= 0) {
    const kick = TOP5[rankMask & ~(1 << quad)] >> 16;
    return Cat.Quads * SHIFT + (quad << 16) + (kick << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const p = trip2 > pair1 ? trip2 : pair1;
    return Cat.FullHouse * SHIFT + (trip1 << 16) + (p << 12);
  }
  if (trip1 >= 0) {
    const k = TOP5[rankMask & ~(1 << trip1)];
    return Cat.Trips * SHIFT + (trip1 << 16) + ((k >> 16) << 12) + (((k >> 12) & 15) << 8);
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const k = TOP5[rankMask & ~(1 << pair1) & ~(1 << pair2)] >> 16;
    return Cat.TwoPair * SHIFT + (pair1 << 16) + (pair2 << 12) + (k << 8);
  }
  if (pair1 >= 0) {
    const k = TOP5[rankMask & ~(1 << pair1)];
    return Cat.Pair * SHIFT + (pair1 << 16) + kick3(k);
  }
  return Cat.HighCard * SHIFT + TOP5[rankMask];
}
// pair kickers: three highest remaining ranks placed in nibbles 3,2,1
function kick3(k: number): number {
  return (((k >> 16) & 15) << 12) | (((k >> 12) & 15) << 8) | (((k >> 8) & 15) << 4);
}

export function category(score: number): Cat {
  return Math.floor(score / SHIFT) as Cat;
}

/** Human readable name, e.g. "Full House, Kings over Tens". */
export function describe(score: number): string {
  const cat = category(score);
  const r1 = (score >> 16) & 15;
  const r2 = (score >> 12) & 15;
  switch (cat) {
    case Cat.StraightFlush:
      return r1 === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[r1]} high`;
    case Cat.Quads:
      return `Four of a Kind, ${RANK_PLURALS[r1]}`;
    case Cat.FullHouse:
      return `Full House, ${RANK_PLURALS[r1]} over ${RANK_PLURALS[r2]}`;
    case Cat.Flush:
      return `Flush, ${RANK_NAMES[r1]} high`;
    case Cat.Straight:
      return `Straight, ${RANK_NAMES[r1]} high`;
    case Cat.Trips:
      return `Three of a Kind, ${RANK_PLURALS[r1]}`;
    case Cat.TwoPair:
      return `Two Pair, ${RANK_PLURALS[r1]} and ${RANK_PLURALS[r2]}`;
    case Cat.Pair:
      return `Pair of ${RANK_PLURALS[r1]}`;
    default:
      return `High Card, ${RANK_NAMES[r1]}`;
  }
}

/** Short name of category for UI chips. */
export function categoryName(score: number): string {
  const s = describe(score);
  return s === 'Royal Flush' ? s : CATEGORY_NAMES[category(score)];
}

/** Best five cards (for highlighting) out of 5..7. */
export function bestFive(cards: Card[]): Card[] {
  const target = evaluate(cards);
  if (cards.length === 5) return [...cards];
  const n = cards.length;
  const five = new Array<Card>(5);
  let best: Card[] = cards.slice(0, 5);
  const rec = (start: number, k: number): boolean => {
    if (k === 5) {
      if (evaluate(five, 5) === target) {
        best = [...five];
        return true;
      }
      return false;
    }
    for (let i = start; i <= n - (5 - k); i++) {
      five[k] = cards[i];
      if (rec(i + 1, k + 1)) return true;
    }
    return false;
  };
  rec(0, 0);
  // order: by rank desc for display
  return best.sort((a, b) => rankOf(b) - rankOf(a) || suitOf(b) - suitOf(a));
}

// ---------------- Brute-force reference (for property tests) ----------------
/** Straightforward 5-card evaluator, returns comparable tuple encoded as number. */
export function referenceEval5(c: Card[]): number {
  const ranks = c.map(rankOf).sort((a, b) => b - a);
  const suits = c.map(suitOf);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3) straightHigh = 3;
  }
  const groups = new Map<number, number>();
  for (const r of ranks) groups.set(r, (groups.get(r) ?? 0) + 1);
  const g = [...groups.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pack = (cat: number, rs: number[]) => {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 16 + (rs[i] ?? 0);
    return v;
  };
  if (straightHigh >= 0 && flush) return pack(8, [straightHigh]);
  if (g[0][1] === 4) return pack(7, [g[0][0], g[1][0]]);
  if (g[0][1] === 3 && g[1][1] === 2) return pack(6, [g[0][0], g[1][0]]);
  if (flush) return pack(5, ranks);
  if (straightHigh >= 0) return pack(4, [straightHigh]);
  if (g[0][1] === 3) return pack(3, [g[0][0], g[1][0], g[2][0]]);
  if (g[0][1] === 2 && g[1][1] === 2) return pack(2, [g[0][0], g[1][0], g[2][0]]);
  if (g[0][1] === 2) return pack(1, [g[0][0], g[1][0], g[2][0], g[3][0]]);
  return pack(0, ranks);
}

export function referenceEval7(cards: Card[]): number {
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = referenceEval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (v > best) best = v;
          }
  return best;
}
