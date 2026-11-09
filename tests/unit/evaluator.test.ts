import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { evaluate, describe as describeHand, referenceEval7, bestFive, category } from '../../src/engine/evaluator';
import { parseCards, fullDeck } from '../../src/engine/cards';
import { SeededRng, shuffle } from '../../src/engine/rng';

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('names hands', () => {
    expect(describeHand(ev('Kh Kd Ks Th Tc 2d 3c'))).toBe('Full House, Kings over Tens');
    expect(describeHand(ev('Ah Kh Qh Jh Th 2d 3c'))).toBe('Royal Flush');
    expect(describeHand(ev('9h 8h 7h 6h 5h 2d 3c'))).toBe('Straight Flush, Nine high');
    expect(describeHand(ev('Ah 2d 3c 4s 5h Kd Qc'))).toBe('Straight, Five high');
    expect(describeHand(ev('Ah Ad 8c 8s 5h Kd Qc'))).toBe('Two Pair, Aces and Eights');
    expect(describeHand(ev('Jh Jd 8c 7s 5h 2d 3c'))).toBe('Pair of Jacks');
    expect(describeHand(ev('Ah Jd 8c 7s 5h 2d 3c'))).toBe('High Card, Ace');
    expect(describeHand(ev('7h 7d 7c 7s 5h 2d 3c'))).toBe('Four of a Kind, Sevens');
    expect(describeHand(ev('Ah 9h 8h 2h 5h 2d 3c'))).toBe('Flush, Ace high');
    expect(describeHand(ev('7h 7d 7c Ks 5h 2d 3c'))).toBe('Three of a Kind, Sevens');
  });

  it('orders categories and kickers', () => {
    expect(ev('Ah Ad Kc Qs Jh 2d 3c')).toBeGreaterThan(ev('Ah Ad Kc Qs Th 2d 3c'));
    expect(ev('Ah Ad Kc Kd Qh 2d 3c')).toBeGreaterThan(ev('Ah Ad Kc Kd Jh 2d 3c'));
    expect(ev('6h 5d 4c 3s 2h 9d Tc')).toBeGreaterThan(ev('Ah 2d 3c 4s 5h 9d Jc'));
    // two pair with three pairs on board uses best two + best kicker
    expect(ev('Ah Ad Kc Kd Qh Qd 2c')).toBe(ev('Ah Ad Kc Kd Qh 3d 2c'));
    // full house with two trips
    expect(describeHand(ev('Ah Ad Ac Kd Kh Ks 2c'))).toBe('Full House, Aces over Kings');
    // ties
    expect(ev('Ah Kd 9c 8s 2h 3d 4c')).toBe(ev('As Kc 9d 8h 2c 3h 4d'));
  });

  it('matches brute-force reference ordering on random 7-card hands (property test)', () => {
    const rng = new SeededRng(1234);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (s1, s2) => {
        const d1 = shuffle(fullDeck(), new SeededRng(s1)).slice(0, 7);
        const d2 = shuffle(fullDeck(), new SeededRng(s2)).slice(0, 7);
        const a = evaluate(d1),
          b = evaluate(d2);
        const ra = referenceEval7(d1),
          rb = referenceEval7(d2);
        return Math.sign(a - b) === Math.sign(ra - rb);
      }),
      { numRuns: 4000 },
    );
    void rng;
  });

  it('agrees with reference on hands constructed to be tricky (pairs, straights, flushes)', () => {
    const rng = new SeededRng(99);
    const hands: number[][] = [];
    for (let i = 0; i < 3000; i++) {
      // bias toward few ranks / few suits
      const set = new Set<number>();
      const rs = 2 + rng.int(6);
      const ss = 1 + rng.int(2);
      const base = rng.int(13);
      while (set.size < 7) {
        const r = (base + rng.int(rs + 3)) % 13;
        const s = rng.int(4) < 3 ? rng.int(ss) : rng.int(4);
        set.add(r * 4 + s);
      }
      hands.push([...set]);
    }
    for (let i = 1; i < hands.length; i++) {
      const a = hands[i - 1],
        b = hands[i];
      expect(Math.sign(evaluate(a) - evaluate(b))).toBe(Math.sign(referenceEval7(a) - referenceEval7(b)));
    }
  });

  it('bestFive returns the five cards making the hand', () => {
    const cards = parseCards('Kh Kd Ks Th Tc 2d 3c');
    const b = bestFive(cards);
    expect(b.length).toBe(5);
    expect(evaluate(b)).toBe(evaluate(cards));
  });

  it('category distribution over all 7-card samples is plausible', () => {
    const rng = new SeededRng(5);
    const counts = new Array(9).fill(0);
    const N = 200000;
    const deck = fullDeck();
    for (let i = 0; i < N; i++) {
      shuffle(deck, rng);
      counts[category(evaluate(deck, 7))]++;
    }
    // known probabilities for 7-card hands
    const expected = [0.174, 0.438, 0.235, 0.0483, 0.0462, 0.0303, 0.026, 0.00168, 0.000311];
    for (let c = 0; c < 9; c++) expect(Math.abs(counts[c] / N - expected[c])).toBeLessThan(Math.max(0.004, expected[c] * 0.25));
  });

  it('is fast', () => {
    const rng = new SeededRng(7);
    const deck = fullDeck();
    const hands: number[][] = [];
    for (let i = 0; i < 1000; i++) hands.push(shuffle(deck, rng).slice(0, 7));
    const t = performance.now();
    let x = 0;
    for (let k = 0; k < 1000; k++) for (const h of hands) x += evaluate(h);
    const ms = performance.now() - t;
    expect(x).toBeGreaterThan(0);
    console.log(`evaluator: ${((1e6 / ms) * 1000 / 1e6).toFixed(2)}M evals/s`);
  });
});
