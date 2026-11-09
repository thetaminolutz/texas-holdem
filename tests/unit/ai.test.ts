import { describe, it, expect } from 'vitest';
import { createHand, applyAction, getLegal, normalizeAction, type HandInit } from '../../src/engine/game';
import { fullDeck } from '../../src/engine/cards';
import { SeededRng, shuffle } from '../../src/engine/rng';
import { decide, DIFF } from '../../src/ai/brain';
import { buildView } from '../../src/ai/view';
import { ARCHETYPES } from '../../src/ai/characters';
import { equityVsRanges, fullRange, handPercentile, countOuts, percentileBand } from '../../src/ai/range';
import { parseCards, parseCard } from '../../src/engine/cards';
import type { Archetype, BotContext } from '../../src/ai/types';
import type { Difficulty } from '../../src/ai/difficulty';
import { breakdown } from '../../src/scene/catalog';
import { analyzeHand } from '../../src/ai/opponentModel';

const ctx = (a: Archetype, d: Difficulty): BotContext => ({ archetype: a, difficulty: d, personality: ARCHETYPES[a].p, tilt: 0, confidence: 0, opponents: {}, seed: 1 });

describe('bot view (no cheating)', () => {
  it('contains only the bot’s own hole cards', () => {
    const init: HandInit = { handId: 'v', handNo: 1, config: { sb: 5, bb: 10, ante: 0, structure: 'NL', straddle: false, runItTwice: false }, players: [0, 1, 2, 3].map((i) => ({ id: 'p' + i, name: 'P' + i, stack: 1000, seat: i })), button: 0, deck: shuffle(fullDeck(), new SeededRng(3)) };
    const s = createHand(init);
    const me = s.toAct!;
    const v = buildView(s, me);
    const json = JSON.stringify(v);
    expect(v.hole).toEqual(s.players[me].hole);
    for (let i = 0; i < s.players.length; i++) {
      if (i === me) continue;
      for (const c of s.players[i].hole) expect(v.hole.includes(c)).toBe(false);
    }
    expect(json.includes('"hole":[' + s.players[me].hole.join(','))).toBe(true);
    // no other player's hole array anywhere in the view
    expect((json.match(/"hole"/g) ?? []).length).toBe(1);
  });
});

describe('bot decisions', () => {
  it('always produce legal actions across archetypes, difficulties and random situations', () => {
    const rng = new SeededRng(77);
    const archs = Object.keys(ARCHETYPES) as Archetype[];
    const diffs = Object.keys(DIFF) as Difficulty[];
    for (let h = 0; h < 300; h++) {
      const n = 2 + rng.int(8);
      const init: HandInit = { handId: 'b' + h, handNo: h, config: { sb: 10, bb: 20, ante: rng.int(2) ? 0 : 2, structure: (['NL', 'NL', 'PL', 'FL'] as const)[rng.int(4)], straddle: false, runItTwice: false }, players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, stack: 100 + rng.int(4000), seat: i })), button: rng.int(n), deck: shuffle(fullDeck(), rng) };
      const s = createHand(init);
      let guard = 0;
      while (s.street !== 'complete' && guard++ < 200) {
        if (s.pendingRuns) { applyAction(s, { type: 'runs', amount: 1 }); continue; }
        const i = s.toAct!;
        const d = decide(buildView(s, i), ctx(archs[(i + h) % archs.length], diffs[(i + h) % diffs.length]), rng);
        const L = getLegal(s)!;
        const norm = normalizeAction(s, d.action as any);
        if (norm.type === 'fold') expect(L.canFold || L.canCheck).toBe(true);
        if (norm.type === 'bet' || norm.type === 'raise') {
          expect(norm.amount!).toBeGreaterThanOrEqual(L.minTo);
          expect(norm.amount!).toBeLessThanOrEqual(L.maxTo);
        }
        expect(d.thinkMs).toBeGreaterThan(0);
        applyAction(s, d.action as any);
      }
      expect(s.street).toBe('complete');
    }
  });
  it('folds trash and raises aces preflop', () => {
    const mk = (hole: string) => {
      const deck = fullDeck();
      const hc = parseCards(hole);
      const rest = deck.filter((c) => !hc.includes(c));
      // player 0 is the button in 6-handed: deal order starts at seat 1, so seat 0 gets cards 5 and 11
      const order: number[] = [];
      let k = 0;
      for (let r = 0; r < 2; r++) for (let p = 1; p <= 6; p++) order.push((p % 6) === 0 ? hc[r] : rest[k++]);
      return [...order, ...rest.slice(k)];
    };
    const run = (hole: string) => {
      const init: HandInit = { handId: 'x', handNo: 1, config: { sb: 10, bb: 20, ante: 0, structure: 'NL', straddle: false, runItTwice: false }, players: Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, stack: 2000, seat: i })), button: 0, deck: mk(hole) };
      const s = createHand(init);
      // everyone folds to the button
      while (s.toAct !== 0) applyAction(s, { type: 'fold' });
      expect(s.players[0].hole).toEqual(parseCards(hole));
      return decide(buildView(s, 0), ctx('Pro', 'expert'), new SeededRng(1)).action.type;
    };
    expect(run('As Ah')).toBe('raise');
    expect(run('7c 2d')).toBe('fold');
  });
});

describe('equity & ranges', () => {
  it('AA vs random is ~85%', () => {
    const e = equityVsRanges(parseCards('As Ah'), [], [fullRange()], 6000, new SeededRng(5));
    expect(e).toBeGreaterThan(0.82);
    expect(e).toBeLessThan(0.88);
  });
  it('AA vs a tight range is lower than vs random', () => {
    const rng = new SeededRng(6);
    const vsTight = equityVsRanges(parseCards('Ks Kh'), [], [percentileBand(0, 0.03)], 4000, rng);
    const vsAny = equityVsRanges(parseCards('Ks Kh'), [], [fullRange()], 4000, rng);
    expect(vsTight).toBeLessThan(vsAny - 0.1);
  });
  it('percentile ranks premium hands first', () => {
    expect(handPercentile(parseCard('As'), parseCard('Ad'))).toBeLessThan(0.01);
    expect(handPercentile(parseCard('7c'), parseCard('2d'))).toBeGreaterThan(0.9);
  });
  it('counts a flush draw as 9 outs', () => {
    const o = countOuts(parseCards('Ah 5h'), parseCards('Kh 9h 2c'));
    expect(o.outs).toBeGreaterThanOrEqual(9);
  });
});

describe('chips', () => {
  it('breakdown sums exactly and looks natural', () => {
    for (const amt of [1, 7, 25, 99, 150, 1234, 2000, 9999, 123456]) {
      const b = breakdown(amt);
      expect(b.reduce((a, x) => a + x.denom * x.count, 0)).toBe(amt);
      expect(b.reduce((a, x) => a + x.count, 0)).toBeLessThanOrEqual(80);
    }
  });
});

describe('opponent model', () => {
  it('flags VPIP/PFR for raisers', () => {
    const init: HandInit = { handId: 'o', handNo: 1, config: { sb: 5, bb: 10, ante: 0, structure: 'NL', straddle: false, runItTwice: false }, players: [0, 1, 2].map((i) => ({ id: 'p' + i, name: 'P' + i, stack: 1000, seat: i })), button: 0, deck: fullDeck() };
    const s = createHand(init);
    applyAction(s, { type: 'raise', amount: 30 });
    applyAction(s, { type: 'fold' });
    applyAction(s, { type: 'fold' });
    const f = analyzeHand(s);
    expect(f[0].vpip && f[0].pfr).toBe(true);
    expect(f[1].vpip).toBe(false);
  });
});
