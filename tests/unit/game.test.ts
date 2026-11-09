import { describe, it, expect } from 'vitest';
import { createHand, applyAction, getLegal, computePots, replayHand, chipsInPlay, totalPot, handToText, type HandInit, type HandConfig, type Action, type HandState } from '../../src/engine/game';
import { parseCards, fullDeck, type Card } from '../../src/engine/cards';
import { SeededRng, shuffle } from '../../src/engine/rng';
import { createTable, nextHandInit, applyHandResult, activeSeats, standardLevels, checkLevelUp, tableChips, type TableSeat } from '../../src/engine/table';

const cfg = (o: Partial<HandConfig> = {}): HandConfig => ({ sb: 5, bb: 10, ante: 0, structure: 'NL', straddle: false, runItTwice: false, ...o });

/** Build a deck where the given hole cards and board come out in dealing order. */
function riggedDeck(holes: string[], board: string, nPlayers: number, button: number): Card[] {
  const used = new Set<Card>();
  const hc = holes.map((h) => parseCards(h));
  const b = parseCards(board);
  hc.flat().concat(b).forEach((c) => used.add(c));
  const rest = fullDeck().filter((c) => !used.has(c));
  const deck: Card[] = [];
  const order: number[] = [];
  for (let i = 1; i <= nPlayers; i++) order.push((button + i) % nPlayers);
  for (let r = 0; r < 2; r++) for (const p of order) deck.push(hc[p][r]);
  const burn = () => deck.push(rest.pop()!);
  burn();
  deck.push(b[0], b[1], b[2]);
  burn();
  deck.push(b[3]);
  burn();
  deck.push(b[4]);
  while (rest.length) deck.push(rest.pop()!);
  return deck;
}

function mk(stacks: number[], o: Partial<HandConfig> = {}, button = 0, deck?: Card[]): HandState {
  const init: HandInit = {
    handId: 't',
    handNo: 1,
    config: cfg(o),
    players: stacks.map((s, i) => ({ id: 'p' + i, name: 'P' + i, stack: s, seat: i })),
    button,
    deck: deck ?? shuffle(fullDeck(), new SeededRng(42)),
  };
  return createHand(init);
}

describe('blinds and order', () => {
  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    const s = mk([1000, 1000], {}, 0);
    expect(s.sbIdx).toBe(0);
    expect(s.bbIdx).toBe(1);
    expect(s.toAct).toBe(0);
    applyAction(s, { type: 'call' });
    expect(s.toAct).toBe(1); // BB option
    applyAction(s, { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1); // BB first postflop
  });
  it('3-handed: UTG (button) acts first preflop; SB first postflop', () => {
    const s = mk([1000, 1000, 1000], {}, 0);
    expect(s.sbIdx).toBe(1);
    expect(s.bbIdx).toBe(2);
    expect(s.toAct).toBe(0);
    applyAction(s, { type: 'call' });
    applyAction(s, { type: 'call' });
    expect(s.toAct).toBe(2);
    applyAction(s, { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
  });
  it('antes are dead money', () => {
    const s = mk([1000, 1000, 1000], { ante: 2 });
    expect(totalPot(s)).toBe(6 + 15);
    expect(s.currentBet).toBe(10);
  });
  it('straddle makes UTG post 2BB and act last preflop', () => {
    const init: HandInit = { handId: 'x', handNo: 1, config: cfg({ straddle: true }), players: [0, 1, 2, 3].map((i) => ({ id: 'p' + i, name: 'P' + i, stack: 1000, seat: i })), button: 0, deck: fullDeck(), straddler: 3 };
    const s = createHand(init);
    expect(s.currentBet).toBe(20);
    expect(s.toAct).toBe(0);
    applyAction(s, { type: 'call' });
    applyAction(s, { type: 'call' });
    applyAction(s, { type: 'call' });
    expect(s.toAct).toBe(3); // straddler option
  });
});

describe('raising rules', () => {
  it('min-raise is the size of the last full raise', () => {
    const s = mk([1000, 1000, 1000], {}, 0);
    const L = getLegal(s)!;
    expect(L.minTo).toBe(20);
    applyAction(s, { type: 'raise', amount: 35 }); // raise by 25
    expect(getLegal(s)!.minTo).toBe(60);
    applyAction(s, { type: 'raise', amount: 10 }); // too small: normalized to minimum
    expect(s.currentBet).toBe(60);
  });
  it('incomplete all-in raise does not reopen the betting for players who already acted', () => {
    // P0 (button) 1000, P1 (SB) 1000, P2 (BB) 130
    const s = mk([1000, 1000, 130], {}, 0);
    applyAction(s, { type: 'raise', amount: 100 }); // P0 raises to 100 (raise of 90)
    applyAction(s, { type: 'call' }); // P1 calls 100
    applyAction(s, { type: 'allin' }); // P2 all-in to 130: raise of 30 < 90 -> incomplete
    expect(s.toAct).toBe(0);
    const L = getLegal(s)!;
    expect(L.canRaise).toBe(false);
    expect(L.callAmount).toBe(30);
    applyAction(s, { type: 'call' });
    expect(getLegal(s)!.canRaise).toBe(false);
  });
  it('a full raise reopens the betting', () => {
    const s = mk([1000, 1000, 1000], {}, 0);
    applyAction(s, { type: 'raise', amount: 30 });
    applyAction(s, { type: 'raise', amount: 80 });
    expect(getLegal(s)!.canRaise).toBe(true);
  });
  it('pot-limit caps the raise at the pot', () => {
    const s = mk([1000, 1000, 1000], { structure: 'PL' }, 0);
    // pot 15, call 10 -> max raise to 10 + (15+10) = 35
    expect(getLegal(s)!.maxTo).toBe(35);
  });
  it('fixed-limit uses fixed sizes and caps at 4 bets', () => {
    const s = mk([1000, 1000, 1000], { structure: 'FL' }, 0);
    expect(getLegal(s)!.minTo).toBe(20);
    expect(getLegal(s)!.maxTo).toBe(20);
    applyAction(s, { type: 'raise', amount: 999 });
    expect(s.currentBet).toBe(20);
    applyAction(s, { type: 'raise' });
    applyAction(s, { type: 'raise' });
    expect(s.currentBet).toBe(40);
    expect(getLegal(s)!.canRaise).toBe(false); // capped
  });
  it('uncalled bet is returned', () => {
    const s = mk([1000, 1000], {}, 0);
    applyAction(s, { type: 'raise', amount: 500 });
    applyAction(s, { type: 'fold' });
    expect(s.street).toBe('complete');
    expect(s.players[0].stack).toBe(1010);
    expect(s.players[1].stack).toBe(990);
    expect(s.events.some((e) => e.t === 'return' && e.amount === 490)).toBe(true);
  });
});

describe('side pots and showdown', () => {
  it('three all-ins with different stacks create correct side pots', () => {
    // button 0. Holes: P0 best, P1 second, P2 third, P3 worst
    const deck = riggedDeck(['As Ad', 'Ks Kd', 'Qs Qd', 'Js Jd'], '2c 7h 9d 3s 4h', 4, 0);
    const s = mk([100, 300, 600, 1000], {}, 0, deck);
    // P3 UTG acts first
    applyAction(s, { type: 'allin' }); // P3 1000
    applyAction(s, { type: 'allin' }); // P0 100
    applyAction(s, { type: 'allin' }); // P1 SB 300
    applyAction(s, { type: 'allin' }); // P2 BB 600
    expect(s.street).toBe('complete');
    const stacks = s.players.map((p) => p.stack);
    expect(stacks).toEqual([400, 600, 600, 400]);
    expect(stacks.reduce((a, b) => a + b)).toBe(2000);
  });
  it('computePots with folded dead money', () => {
    const s = mk([1000, 1000, 50], {}, 0);
    applyAction(s, { type: 'raise', amount: 200 }); // P0
    applyAction(s, { type: 'call' }); // P1 calls 200
    applyAction(s, { type: 'allin' }); // P2 all-in 50
    const pots = computePots(s);
    expect(pots[0]).toEqual({ amount: 150, eligible: [0, 1, 2] });
    expect(pots[1]).toEqual({ amount: 300, eligible: [0, 1] });
  });
  it('split pot gives the odd chip to the first player left of the button', () => {
    const deck = riggedDeck(['2c 3d', 'Ah 4c', 'Ad 4d'], 'Ks Qs Js Th 5c', 3, 0);
    const s = mk([1000, 1000, 1000], { sb: 5, bb: 10 }, 0, deck);
    applyAction(s, { type: 'fold' }); // P0 folds -> pot: sb 5 + bb 10 = 15
    applyAction(s, { type: 'call' }); // P1 SB completes to 10
    applyAction(s, { type: 'raise', amount: 15 }); // BB raises to 20 total? normalized to min 20
    applyAction(s, { type: 'call' });
    for (let i = 0; i < 6 && s.toAct !== null; i++) applyAction(s, { type: 'check' });
    expect(s.street).toBe('complete');
    // pot 40 split: 20/20 (no odd chip here) -> both broadway straights
    expect(s.players[1].stack).toBe(1000);
    expect(s.players[2].stack).toBe(1000);
  });
  it('odd chip with ante', () => {
    const deck = riggedDeck(['2c 3d', 'Ah 4c', 'Ad 4d'], 'Ks Qs Js Th 5c', 3, 0);
    const s = mk([1000, 1000, 1000], { sb: 5, bb: 10, ante: 1 }, 0, deck);
    applyAction(s, { type: 'fold' });
    applyAction(s, { type: 'call' });
    applyAction(s, { type: 'check' });
    for (let i = 0; i < 6 && s.toAct !== null; i++) applyAction(s, { type: 'check' });
    // pot = 3 antes + 20 = 23; P1 (left of button) gets 12, P2 gets 11
    expect(s.players[1].stack).toBe(1000 - 11 + 12);
    expect(s.players[2].stack).toBe(1000 - 11 + 11);
  });
  it('run it twice splits each pot between two boards', () => {
    const s = mk([1000, 1000], { runItTwice: true }, 0);
    applyAction(s, { type: 'allin' });
    applyAction(s, { type: 'call' });
    expect(s.pendingRuns).toBe(true);
    applyAction(s, { type: 'runs', amount: 2 });
    expect(s.board.length).toBe(5);
    expect(s.board2!.length).toBe(5);
    expect(s.street).toBe('complete');
    expect(s.awards.length).toBe(2);
    expect(s.players[0].stack + s.players[1].stack).toBe(2000);
  });
  it('showdown: last river aggressor shows first, losers may muck', () => {
    const deck = riggedDeck(['As Ad', 'Ks Kd'], '2c 7h 9d 3s 4h', 2, 0);
    const s = mk([1000, 1000], {}, 0, deck);
    applyAction(s, { type: 'call' });
    applyAction(s, { type: 'check' });
    for (let k = 0; k < 4; k++) applyAction(s, { type: 'check' });
    applyAction(s, { type: 'check' }); // river: BB checks
    applyAction(s, { type: 'bet', amount: 50 }); // button bets
    applyAction(s, { type: 'call' });
    const shows = s.events.filter((e) => e.t === 'show' || e.t === 'muck');
    expect(shows[0]).toMatchObject({ t: 'show', p: 0 });
    expect(shows[1]).toMatchObject({ t: 'muck', p: 1 });
  });
});

function randomAction(s: HandState, rng: SeededRng): Action {
  const L = getLegal(s)!;
  const r = rng.next();
  if (L.canRaise && r < 0.25) {
    const to = L.minTo + Math.floor(rng.next() * (L.maxTo - L.minTo + 1));
    return { type: L.isBet ? 'bet' : 'raise', amount: to };
  }
  if (r < 0.3) return { type: 'allin' };
  if (L.canFold && r < 0.45) return { type: 'fold' };
  if (L.canCheck) return { type: 'check' };
  return { type: 'call' };
}

describe('random simulation', () => {
  it('thousands of random hands: chips conserved, no negative stacks, no deadlocks, replays match', () => {
    const rng = new SeededRng(2024);
    for (let h = 0; h < 6000; h++) {
      const n = 2 + rng.int(8);
      const stacks = Array.from({ length: n }, () => 1 + rng.int(3000));
      const structure = (['NL', 'NL', 'PL', 'FL'] as const)[rng.int(4)];
      const init: HandInit = {
        handId: 'r' + h,
        handNo: h,
        config: cfg({ structure, ante: rng.int(3) === 0 ? 2 : 0, straddle: rng.int(4) === 0, runItTwice: rng.int(3) === 0 }),
        players: stacks.map((s, i) => ({ id: 'p' + i, name: 'P' + i, stack: s, seat: i })),
        button: rng.int(n),
        deck: shuffle(fullDeck(), rng),
        straddler: rng.int(2) ? (rng.int(n)) : null,
      };
      const total = stacks.reduce((a, b) => a + b, 0);
      const s = createHand(init);
      const actions: Action[] = [];
      let guard = 0;
      while (s.street !== 'complete') {
        if (++guard > 500) throw new Error('deadlock');
        expect(chipsInPlay(s)).toBe(total);
        let a: Action;
        if (s.pendingRuns) a = { type: 'runs', amount: rng.int(2) ? 2 : 1 };
        else {
          expect(s.toAct).not.toBeNull();
          a = randomAction(s, rng);
        }
        actions.push(a);
        applyAction(s, a);
        for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0);
      }
      const sum = s.players.reduce((a, p) => a + p.stack, 0);
      expect(sum).toBe(total);
      if (h % 50 === 0) {
        const r = replayHand(init, actions);
        expect(r.players.map((p) => p.stack)).toEqual(s.players.map((p) => p.stack));
        expect(handToText(r).length).toBeGreaterThan(50);
      }
    }
  });
});

describe('table', () => {
  const seats = (n: number, stack = 1000): TableSeat[] => Array.from({ length: n }, (_, i) => ({ seat: i, id: 'p' + i, name: 'P' + i, stack, isHuman: i === 0, busted: false, sittingOut: false, buyIns: 1 }));
  it('button moves clockwise to the next active seat and tournaments finish with correct places', () => {
    const rng = new SeededRng(7);
    const t = createTable(
      { mode: 'sng', seats: 6, structure: 'NL', startingStack: 1000, levels: standardLevels(10, 20, 0, true), levelBy: 'hands', levelLength: 5, rebuys: false, straddle: false, runItTwice: false, payouts: [0.65, 0.35], tournament: true },
      seats(6),
      rng,
    );
    let prevButton = -1;
    let hands = 0;
    while (!t.finished && hands < 5000) {
      checkLevelUp(t);
      const init = nextHandInit(t, rng);
      if (prevButton >= 0 && activeSeats(t).length > 1) expect(t.buttonSeat).not.toBe(prevButton);
      prevButton = t.buttonSeat;
      const s = createHand(init);
      while (s.street !== 'complete') applyAction(s, s.pendingRuns ? { type: 'runs', amount: 1 } : randomAction(s, rng));
      applyHandResult(t, s);
      expect(tableChips(t)).toBe(6000);
      hands++;
    }
    expect(t.finished).toBe(true);
    expect(t.places.map((p) => p.place).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.places.find((p) => p.place === 1)!.prize).toBe(3900);
    expect(t.level).toBe(Math.min(Math.floor((hands - 1) / 5), t.config.levels.length - 1));
  });
});
