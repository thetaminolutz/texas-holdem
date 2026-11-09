// Pure, UI-independent Texas Hold'em hand engine (event-sourced).
// A hand is fully determined by its HandInit (players, stacks, button, config, deck order) plus the list of actions.
import { type Card, cardToString } from './cards';
import { evaluate, describe as describeScore, bestFive } from './evaluator';

export type Structure = 'NL' | 'PL' | 'FL';
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'runs';

export interface HandConfig {
  sb: number;
  bb: number;
  ante: number;
  structure: Structure;
  straddle: boolean;
  /** if true and all players are all-in before the river, the remaining board is dealt twice */
  runItTwice: boolean;
}

export interface SeatInit {
  id: string;
  name: string;
  stack: number;
  seat: number; // physical seat index at the table
}

export interface HandInit {
  handId: string;
  handNo: number;
  config: HandConfig;
  players: SeatInit[]; // in clockwise seat order, only players dealt in
  button: number; // index into players
  deck: Card[]; // full 52-card order used for this hand
  /** player indexes allowed to straddle (decided before the hand), usually UTG */
  straddler?: number | null;
}

export interface Action {
  type: ActionType;
  /** for bet/raise: total amount committed on this street after the action ("raise to") */
  amount?: number;
}

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  stack: number;
  startStack: number;
  committed: number; // chips in front this street
  total: number; // total committed this hand (incl. antes)
  folded: boolean;
  allIn: boolean;
  hole: Card[];
  actedAt: number | null; // currentBet level when the player last acted voluntarily this street
  lastAction: string | null;
  shown: boolean;
  mucked: boolean;
}

export type HandEvent =
  | { t: 'post'; p: number; amount: number; kind: 'sb' | 'bb' | 'ante' | 'straddle'; allIn: boolean }
  | { t: 'deal'; order: number[]; rounds: number } // hole cards dealt one at a time starting left of button
  | { t: 'act'; p: number; action: ActionType; amount: number; to: number; allIn: boolean }
  | { t: 'return'; p: number; amount: number }
  | { t: 'collect'; street: Street; pot: number }
  | { t: 'burn'; card: Card }
  | { t: 'board'; street: Street; cards: Card[]; run: number }
  | { t: 'show'; p: number; cards: Card[]; score: number; name: string }
  | { t: 'muck'; p: number }
  | { t: 'award'; pot: number; run: number; winners: number[]; amounts: number[]; amount: number; name: string; eligible: number[] }
  | { t: 'end' };

export interface Pot {
  amount: number;
  eligible: number[];
}

export interface Award {
  pot: number;
  run: number;
  winners: number[];
  amounts: number[];
}

export interface HandState {
  init: HandInit;
  config: HandConfig;
  players: PlayerState[];
  button: number;
  sbIdx: number;
  bbIdx: number;
  deckPos: number;
  board: Card[];
  board2: Card[] | null; // second run when running it twice
  street: Street;
  toAct: number | null;
  currentBet: number;
  minRaise: number; // size of the last full raise (or bb)
  betsThisStreet: number; // number of bets/raises (for fixed limit cap)
  lastAggressor: number | null;
  riverAggressor: number | null;
  potCollected: number; // chips already gathered into the middle (previous streets + antes)
  events: HandEvent[];
  actions: { p: number; street: Street; action: Action }[];
  awards: Award[];
  winners: number[];
  ranOutTwice: boolean;
  /** true while waiting for players to agree whether to run it twice */
  pendingRuns: boolean;
}

export interface Legal {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number; // additional chips needed to call (capped by stack)
  canRaise: boolean; // bet or raise
  isBet: boolean; // no current bet -> "bet" rather than "raise"
  minTo: number; // minimum total "to" amount for a bet/raise
  maxTo: number; // maximum total "to" amount (all-in or pot limit)
  toCall: number; // full amount to match (may exceed stack)
  pot: number; // pot including all bets on table
}

const next = (s: HandState, i: number) => (i + 1) % s.players.length;

export function totalPot(s: HandState): number {
  let p = s.potCollected;
  for (const pl of s.players) p += pl.committed;
  return p;
}

export function chipsInPlay(s: HandState): number {
  return s.players.reduce((a, p) => a + p.stack, 0) + totalPot(s);
}

function canAct(p: PlayerState) {
  return !p.folded && !p.allIn;
}

function activeCount(s: HandState) {
  return s.players.filter((p) => !p.folded).length;
}

function post(s: HandState, i: number, amount: number, kind: 'sb' | 'bb' | 'ante' | 'straddle') {
  const p = s.players[i];
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  if (kind === 'ante') {
    p.total += a;
    s.potCollected += a;
  } else {
    p.committed += a;
    p.total += a;
  }
  if (p.stack === 0) p.allIn = true;
  s.events.push({ t: 'post', p: i, amount: a, kind, allIn: p.allIn });
  return a;
}

export function createHand(init: HandInit): HandState {
  const n = init.players.length;
  if (n < 2) throw new Error('need at least 2 players');
  const players: PlayerState[] = init.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    stack: p.stack,
    startStack: p.stack,
    committed: 0,
    total: 0,
    folded: false,
    allIn: false,
    hole: [],
    actedAt: null,
    lastAction: null,
    shown: false,
    mucked: false,
  }));
  const headsUp = n === 2;
  const button = init.button % n;
  const sbIdx = headsUp ? button : (button + 1) % n;
  const bbIdx = (sbIdx + 1) % n;
  const s: HandState = {
    init,
    config: init.config,
    players,
    button,
    sbIdx,
    bbIdx,
    deckPos: 0,
    board: [],
    board2: null,
    street: 'preflop',
    toAct: null,
    currentBet: 0,
    minRaise: init.config.bb,
    betsThisStreet: 1,
    lastAggressor: null,
    riverAggressor: null,
    potCollected: 0,
    events: [],
    actions: [],
    awards: [],
    winners: [],
    ranOutTwice: false,
    pendingRuns: false,
  };
  const c = init.config;
  if (c.ante > 0) for (let i = 0; i < n; i++) post(s, (button + 1 + i) % n, c.ante, 'ante');
  post(s, sbIdx, c.sb, 'sb');
  post(s, bbIdx, c.bb, 'bb');
  s.currentBet = Math.max(c.bb, players[sbIdx].committed, players[bbIdx].committed);
  let firstToAct = next(s, bbIdx);
  let lastBlind = bbIdx;
  if (c.straddle && init.straddler != null && n > 2 && init.straddler === next(s, bbIdx)) {
    const st = init.straddler;
    if (players[st].stack > c.bb * 2) {
      post(s, st, c.bb * 2, 'straddle');
      s.currentBet = c.bb * 2;
      s.minRaise = c.bb * 2;
      firstToAct = next(s, st);
      lastBlind = st;
    }
  }
  void lastBlind;
  // Deal hole cards: one at a time, starting left of the button (SB in heads-up gets the 2nd card first? Real rule:
  // dealing starts left of the button; heads-up, the non-button (BB) receives the first card).
  const order: number[] = [];
  for (let i = 1; i <= n; i++) order.push((button + i) % n);
  for (let r = 0; r < 2; r++) for (const i of order) players[i].hole.push(init.deck[s.deckPos++]);
  s.events.push({ t: 'deal', order, rounds: 2 });
  s.toAct = findNextToAct(s, firstToAct - 1 < 0 ? n - 1 : firstToAct - 1);
  if (s.toAct === null) advanceStreet(s);
  return s;
}

/** Find the next player (starting after `from`) who still needs to act this street, or null if the round is closed. */
function findNextToAct(s: HandState, from: number): number | null {
  const n = s.players.length;
  const live = s.players.filter((p) => !p.folded);
  if (live.length <= 1) return null;
  const actors = s.players.filter(canAct);
  // If only one player can act and they've already matched the bet, no action.
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = s.players[i];
    if (!canAct(p)) continue;
    if (p.actedAt === null || p.committed < s.currentBet) {
      // A lone player who isn't facing a bet and everyone else is all-in has nothing to decide.
      if (actors.length === 1 && p.committed >= s.currentBet) return null;
      return i;
    }
  }
  return null;
}

export function getLegal(s: HandState): Legal | null {
  if (s.toAct === null) return null;
  const p = s.players[s.toAct];
  const c = s.config;
  const toCall = Math.max(0, s.currentBet - p.committed);
  const callAmount = Math.min(toCall, p.stack);
  const pot = totalPot(s);
  const allInTo = p.committed + p.stack;
  const reopened = p.actedAt === null || s.currentBet - p.actedAt >= s.minRaise;
  // anyone else left who could respond to a raise?
  const othersCanAct = s.players.some((q, i) => i !== s.toAct && canAct(q));
  // If no one else can act (all others all-in or folded), raising is pointless: only call/fold.
  let canRaise = reopened && p.stack > toCall && othersCanAct;
  let minTo = s.currentBet + s.minRaise;
  let maxTo = allInTo;
  if (c.structure === 'PL') {
    const potAfterCall = pot + toCall;
    maxTo = Math.min(allInTo, s.currentBet + potAfterCall);
  } else if (c.structure === 'FL') {
    const size = s.street === 'turn' || s.street === 'river' ? c.bb * 2 : c.bb;
    minTo = s.currentBet + size;
    maxTo = Math.min(allInTo, minTo);
    if (s.betsThisStreet >= 4) canRaise = false;
  }
  if (s.currentBet === 0 && c.structure !== 'FL') minTo = Math.max(c.bb, 1);
  if (minTo > allInTo) minTo = allInTo; // all-in for less than a full raise
  if (maxTo < minTo) maxTo = minTo;
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    canRaise,
    isBet: s.currentBet === 0,
    minTo,
    maxTo,
    toCall,
    pot,
  };
}

/** Normalize a (possibly sloppy) action into a legal one. Returns null if impossible. */
export function normalizeAction(s: HandState, a: Action): Action {
  const L = getLegal(s);
  if (!L) throw new Error('no action expected');
  const p = s.players[s.toAct!];
  switch (a.type) {
    case 'runs':
      return a;
    case 'fold':
      return L.canFold ? a : { type: 'check' };
    case 'check':
      return L.canCheck ? a : { type: 'fold' };
    case 'call':
      return L.canCall ? a : { type: 'check' };
    case 'allin': {
      const to = p.committed + p.stack;
      if (to <= s.currentBet || !L.canRaise) return L.canCall ? { type: 'call' } : { type: 'check' };
      if (s.config.structure !== 'NL') return { type: s.currentBet === 0 ? 'bet' : 'raise', amount: L.maxTo };
      return { type: s.currentBet === 0 ? 'bet' : 'raise', amount: to };
    }
    case 'bet':
    case 'raise': {
      if (!L.canRaise) return L.canCall ? { type: 'call' } : { type: 'check' };
      let to = Math.round(a.amount ?? L.minTo);
      to = Math.max(L.minTo, Math.min(L.maxTo, to));
      if (to <= s.currentBet) return L.canCall ? { type: 'call' } : { type: 'check' };
      return { type: s.currentBet === 0 ? 'bet' : 'raise', amount: to };
    }
  }
}

export function applyAction(s: HandState, raw: Action): HandState {
  if (raw.type === 'runs') {
    if (!s.pendingRuns) throw new Error('no run-it-twice decision pending');
    s.pendingRuns = false;
    s.actions.push({ p: -1, street: s.street, action: { type: 'runs', amount: raw.amount === 2 ? 2 : 1 } });
    runOut(s, raw.amount === 2);
    return s;
  }
  if (s.toAct === null) throw new Error('no player to act');
  const i = s.toAct;
  const p = s.players[i];
  const a = normalizeAction(s, raw);
  s.actions.push({ p: i, street: s.street, action: a });
  const before = s.currentBet;
  switch (a.type) {
    case 'fold':
      p.folded = true;
      p.lastAction = 'Fold';
      s.events.push({ t: 'act', p: i, action: 'fold', amount: 0, to: p.committed, allIn: false });
      break;
    case 'check':
      p.lastAction = 'Check';
      s.events.push({ t: 'act', p: i, action: 'check', amount: 0, to: p.committed, allIn: false });
      break;
    case 'call': {
      const amt = Math.min(s.currentBet - p.committed, p.stack);
      p.stack -= amt;
      p.committed += amt;
      p.total += amt;
      if (p.stack === 0) p.allIn = true;
      p.lastAction = p.allIn ? 'All-in' : 'Call';
      s.events.push({ t: 'act', p: i, action: 'call', amount: amt, to: p.committed, allIn: p.allIn });
      break;
    }
    case 'bet':
    case 'raise': {
      const to = a.amount!;
      const amt = to - p.committed;
      p.stack -= amt;
      p.committed = to;
      p.total += amt;
      if (p.stack === 0) p.allIn = true;
      const raiseSize = to - before;
      if (raiseSize >= s.minRaise) {
        s.minRaise = raiseSize; // full raise: reopens action
      }
      s.currentBet = to;
      s.betsThisStreet++;
      s.lastAggressor = i;
      if (s.street === 'river') s.riverAggressor = i;
      p.lastAction = p.allIn ? 'All-in' : a.type === 'bet' ? 'Bet' : 'Raise';
      s.events.push({ t: 'act', p: i, action: p.allIn ? 'allin' : a.type, amount: amt, to, allIn: p.allIn });
      break;
    }
  }
  if (a.type !== 'fold') p.actedAt = s.currentBet;
  // Anyone who previously acted keeps their actedAt; they'll need to act again if committed < currentBet.
  if (activeCount(s) === 1) {
    endRound(s);
    finishHand(s);
    return s;
  }
  s.toAct = findNextToAct(s, i);
  if (s.toAct === null) advanceStreet(s);
  return s;
}

/** Return uncalled chips and gather bets into the pot. */
function endRound(s: HandState) {
  // uncalled bet: top committed exceeds second highest committed
  let top = -1,
    topAmt = -1,
    second = 0;
  s.players.forEach((p, i) => {
    if (p.committed > topAmt) {
      second = Math.max(second, topAmt);
      topAmt = p.committed;
      top = i;
    } else second = Math.max(second, p.committed);
  });
  if (top >= 0 && topAmt > second) {
    const p = s.players[top];
    const ret = topAmt - second;
    p.committed -= ret;
    p.total -= ret;
    p.stack += ret;
    if (p.stack > 0) p.allIn = false;
    s.events.push({ t: 'return', p: top, amount: ret });
  }
  let gathered = 0;
  for (const p of s.players) {
    gathered += p.committed;
    p.committed = 0;
    p.actedAt = null;
  }
  s.potCollected += gathered;
  s.events.push({ t: 'collect', street: s.street, pot: s.potCollected });
  s.currentBet = 0;
  s.minRaise = s.config.bb;
  s.betsThisStreet = 0;
}

function dealBoard(s: HandState, count: number, street: Street, target: Card[], run: number) {
  const burn = s.init.deck[s.deckPos++];
  s.events.push({ t: 'burn', card: burn });
  const cards = s.init.deck.slice(s.deckPos, s.deckPos + count);
  s.deckPos += count;
  target.push(...cards);
  s.events.push({ t: 'board', street, cards, run });
}

function advanceStreet(s: HandState) {
  endRound(s);
  const live = s.players.filter((p) => !p.folded);
  if (live.length <= 1) return finishHand(s);
  const canBet = live.filter((p) => !p.allIn).length;
  const order: Street[] = ['preflop', 'flop', 'turn', 'river'];
  // Betting is over before the river with 2+ players all-in: optionally offer to run it twice.
  if (canBet <= 1 && s.street !== 'river' && s.config.runItTwice && !s.ranOutTwice) {
    s.pendingRuns = true;
    s.toAct = null;
    return;
  }
  if (s.street === 'river') return showdown(s);
  const nextStreet = order[order.indexOf(s.street) + 1];
  s.street = nextStreet;
  dealBoard(s, nextStreet === 'flop' ? 3 : 1, nextStreet, s.board, 0);
  s.betsThisStreet = 0;
  // first to act: first active player left of the button
  s.toAct = findNextToAct(s, s.button);
  if (s.toAct === null) advanceStreet(s);
}

function runOut(s: HandState, twice: boolean) {
  const order: Street[] = ['preflop', 'flop', 'turn', 'river'];
  s.ranOutTwice = true; // decision made, don't ask again
  if (!twice) {
    while (s.board.length < 5) {
      const street = order[order.indexOf(s.street) + 1];
      s.street = street;
      dealBoard(s, street === 'flop' ? 3 : 1, street, s.board, 0);
      endRound(s);
    }
    return showdown(s);
  }
  const base = [...s.board];
  const st = order.indexOf(s.street);
  for (const run of [1, 2]) {
    const extra: Card[] = [];
    let idx = st;
    while (base.length + extra.length < 5) {
      idx++;
      const street = order[idx];
      dealBoard(s, street === 'flop' ? 3 : 1, street, extra, run);
    }
    if (run === 1) s.board = [...base, ...extra];
    else s.board2 = [...base, ...extra];
  }
  s.street = 'river';
  showdown(s);
}

/** Compute main and side pots from total contributions. */
export function computePots(s: HandState): Pot[] {
  const contrib = s.players.map((p) => p.total);
  const levels = [...new Set(s.players.filter((p) => !p.folded).map((p) => p.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const c of contrib) amount += Math.max(0, Math.min(c, lvl) - prev);
    const eligible = s.players.map((p, i) => (!p.folded && p.total >= lvl ? i : -1)).filter((i) => i >= 0);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((e, k) => e === eligible[k])) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = lvl;
  }
  // dead money above the highest live contribution (folded players who put in more) goes to the last pot
  let dead = 0;
  for (const c of contrib) dead += Math.max(0, c - prev);
  if (dead > 0 && pots.length) pots[pots.length - 1].amount += dead;
  return pots;
}

function showdownOrder(s: HandState): number[] {
  const n = s.players.length;
  const live: number[] = [];
  const start = s.riverAggressor !== null && !s.players[s.riverAggressor].folded ? s.riverAggressor : (s.button + 1) % n;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!s.players[i].folded) live.push(i);
  }
  return live;
}

function showdown(s: HandState) {
  s.street = 'showdown';
  s.toAct = null;
  const order = showdownOrder(s);
  const pots = computePots(s);
  const boards = s.board2 ? [s.board, s.board2] : [s.board];
  const scores = boards.map((b) => s.players.map((p) => (p.folded ? -1 : evaluate([...p.hole, ...b]))));
  // Showing: a player shows if they could win any pot so far (best shown score for that pot), otherwise mucks.
  const bestShown = pots.map(() => boards.map(() => -1));
  for (const i of order) {
    let mustShow = false;
    pots.forEach((pot, pi) => {
      if (!pot.eligible.includes(i)) return;
      boards.forEach((_, bi) => {
        if (scores[bi][i] >= bestShown[pi][bi]) mustShow = true;
      });
    });
    // all-in players always table their cards
    const allInShowdown = s.players.filter((p) => !p.folded && !p.allIn).length <= 1;
    if (mustShow || allInShowdown) {
      s.players[i].shown = true;
      pots.forEach((pot, pi) => {
        if (pot.eligible.includes(i)) boards.forEach((_, bi) => (bestShown[pi][bi] = Math.max(bestShown[pi][bi], scores[bi][i])));
      });
      const sc = scores[0][i];
      s.events.push({ t: 'show', p: i, cards: [...s.players[i].hole], score: sc, name: describeScore(sc) });
    } else {
      s.players[i].mucked = true;
      s.events.push({ t: 'muck', p: i });
    }
  }
  const n = s.players.length;
  pots.forEach((pot, pi) => {
    const runs = boards.length;
    const shares = runs === 2 ? [Math.ceil(pot.amount / 2), Math.floor(pot.amount / 2)] : [pot.amount];
    shares.forEach((share, bi) => {
      let best = -1;
      for (const i of pot.eligible) best = Math.max(best, scores[bi][i]);
      const winners = pot.eligible.filter((i) => scores[bi][i] === best);
      // odd chips go to the first winner(s) clockwise from the button
      winners.sort((a, b) => ((a - s.button - 1 + n) % n) - ((b - s.button - 1 + n) % n));
      const base = Math.floor(share / winners.length);
      let odd = share - base * winners.length;
      const amounts = winners.map(() => base + (odd-- > 0 ? 1 : 0));
      winners.forEach((w, k) => (s.players[w].stack += amounts[k]));
      s.awards.push({ pot: pi, run: runs === 2 ? bi + 1 : 0, winners, amounts });
      s.events.push({
        t: 'award',
        pot: pi,
        run: runs === 2 ? bi + 1 : 0,
        winners,
        amounts,
        amount: share,
        name: describeScore(best),
        eligible: pot.eligible,
      });
    });
  });
  s.potCollected = 0;
  s.winners = [...new Set(s.awards.flatMap((a) => a.winners))];
  s.street = 'complete';
  s.events.push({ t: 'end' });
}

function finishHand(s: HandState) {
  // Everyone but one folded.
  const winner = s.players.findIndex((p) => !p.folded);
  const amount = s.potCollected;
  s.players[winner].stack += amount;
  s.awards.push({ pot: 0, run: 0, winners: [winner], amounts: [amount] });
  s.events.push({ t: 'award', pot: 0, run: 0, winners: [winner], amounts: [amount], amount, name: '', eligible: [winner] });
  s.potCollected = 0;
  s.winners = [winner];
  s.toAct = null;
  s.street = 'complete';
  s.events.push({ t: 'end' });
}

/** Rebuild a hand from init + actions (event sourcing / replays / resume). */
export function replayHand(init: HandInit, actions: Action[]): HandState {
  const s = createHand(init);
  for (const a of actions) {
    if (s.toAct === null && !s.pendingRuns) break;
    applyAction(s, a);
  }
  return s;
}

export function isComplete(s: HandState) {
  return s.street === 'complete';
}

/** Best five cards for a player (for showdown highlighting). */
export function playerBestFive(s: HandState, i: number, board = s.board): Card[] {
  const p = s.players[i];
  if (board.length < 3) return [];
  return bestFive([...p.hole, ...board]);
}

export function handScore(s: HandState, i: number, board = s.board) {
  return evaluate([...s.players[i].hole, ...board]);
}

/** Readable text hand history. */
export function handToText(s: HandState): string {
  const L: string[] = [];
  const c = s.config;
  const nm = (i: number) => s.players[i].name;
  L.push(`Hand #${s.init.handNo} (${s.init.handId}) — Hold'em ${c.structure === 'NL' ? 'No-Limit' : c.structure === 'PL' ? 'Pot-Limit' : 'Fixed-Limit'} (${c.sb}/${c.bb}${c.ante ? ` ante ${c.ante}` : ''})`);
  s.players.forEach((p, i) => L.push(`Seat ${p.seat + 1}: ${p.name} (${p.startStack} in chips)${i === s.button ? ' [button]' : ''}`));
  let street: Street = 'preflop';
  L.push('*** HOLE CARDS ***');
  for (const e of s.events) {
    switch (e.t) {
      case 'post':
        L.push(`${nm(e.p)}: posts ${e.kind === 'sb' ? 'small blind' : e.kind === 'bb' ? 'big blind' : e.kind} ${e.amount}${e.allIn ? ' and is all-in' : ''}`);
        break;
      case 'deal':
        s.players.forEach((p) => L.push(`Dealt to ${p.name} [${p.hole.map(cardToString).join(' ')}]`));
        break;
      case 'act': {
        const verb = e.action === 'fold' ? 'folds' : e.action === 'check' ? 'checks' : e.action === 'call' ? `calls ${e.amount}` : e.action === 'bet' ? `bets ${e.amount}` : `raises to ${e.to}`;
        L.push(`${nm(e.p)}: ${e.action === 'allin' ? (s.actions.length ? `goes all-in (${e.to})` : 'all-in') : verb}${e.allIn && e.action !== 'allin' ? ' and is all-in' : ''}`);
        break;
      }
      case 'return':
        L.push(`Uncalled bet (${e.amount}) returned to ${nm(e.p)}`);
        break;
      case 'board':
        if (e.street !== street || e.run) {
          street = e.street;
          L.push(`*** ${e.street.toUpperCase()}${e.run ? ` (run ${e.run})` : ''} *** [${e.cards.map(cardToString).join(' ')}]`);
        }
        break;
      case 'show':
        L.push(`${nm(e.p)}: shows [${e.cards.map(cardToString).join(' ')}] (${e.name})`);
        break;
      case 'muck':
        L.push(`${nm(e.p)}: mucks hand`);
        break;
      case 'award':
        e.winners.forEach((w, k) => L.push(`${nm(w)} collected ${e.amounts[k]} from ${e.pot === 0 ? 'main pot' : `side pot ${e.pot}`}${e.run ? ` (run ${e.run})` : ''}${e.name ? ` with ${e.name}` : ''}`));
        break;
    }
  }
  L.push(`*** SUMMARY *** Board [${s.board.map(cardToString).join(' ')}]${s.board2 ? ` / [${s.board2.map(cardToString).join(' ')}]` : ''}`);
  return L.join('\n');
}
