// Table / session management: seats, button movement, blind levels, bust-outs and tournament places.
import { fullDeck } from './cards';
import { type Rng, shuffle, cryptoRng } from './rng';
import type { HandConfig, HandInit, HandState, Structure } from './game';

export type GameMode = 'quick' | 'cash' | 'sng' | 'headsup' | 'custom';

export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
}

export interface TableSeat {
  seat: number;
  id: string;
  name: string;
  stack: number;
  isHuman: boolean;
  bot?: BotSeatConfig;
  busted: boolean;
  sittingOut: boolean;
  buyIns: number;
  place?: number;
}

export interface BotSeatConfig {
  archetype: string;
  difficulty: string;
  avatarSeed: number;
}

export interface TableConfig {
  mode: GameMode;
  seats: number; // 2..9 physical seats
  structure: Structure;
  startingStack: number;
  levels: BlindLevel[];
  levelBy: 'hands' | 'minutes' | 'none';
  levelLength: number;
  rebuys: boolean;
  straddle: boolean;
  runItTwice: boolean;
  payouts: number[]; // fractions for 1st, 2nd... (tournaments)
  tournament: boolean;
}

export interface TableState {
  config: TableConfig;
  seats: (TableSeat | null)[];
  buttonSeat: number;
  handNo: number;
  level: number;
  levelStartHand: number;
  playMs: number; // accumulated playing time (for minute-based levels)
  levelStartMs: number;
  finished: boolean;
  places: { id: string; name: string; place: number; prize: number }[];
  bustOrder: string[];
}

export function standardLevels(sb: number, bb: number, ante: number, tournament: boolean): BlindLevel[] {
  if (!tournament) return [{ sb, bb, ante }];
  const mult = [1, 1.5, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000];
  const round = (v: number) => {
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const nice = n < 1.5 ? 1 : n < 2.25 ? 2 : n < 2.75 ? 2.5 : n < 4 ? 3 : n < 5.5 ? 5 : n < 7 ? 6 : 8;
    return Math.max(1, Math.round(nice * mag));
  };
  return mult.map((m, i) => {
    const nbb = round(bb * m);
    const nsb = Math.max(1, round(nbb / 2) === nbb ? Math.floor(nbb / 2) : round(nbb / 2));
    return { sb: Math.min(nsb, nbb), bb: nbb, ante: i >= 3 ? Math.max(ante, round(nbb / 10)) : ante };
  });
}

export function defaultPayouts(players: number): number[] {
  if (players <= 3) return [1];
  if (players <= 6) return [0.65, 0.35];
  return [0.5, 0.3, 0.2];
}

export function createTable(config: TableConfig, seats: (TableSeat | null)[], rng: Rng = cryptoRng): TableState {
  const occupied = seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const button = occupied[rng.int(occupied.length)];
  return {
    config,
    seats,
    buttonSeat: button,
    handNo: 0,
    level: 0,
    levelStartHand: 0,
    playMs: 0,
    levelStartMs: 0,
    finished: false,
    places: [],
    bustOrder: [],
  };
}

export function activeSeats(t: TableState): TableSeat[] {
  return t.seats.filter((s): s is TableSeat => !!s && !s.busted && !s.sittingOut && s.stack > 0);
}

export function currentLevel(t: TableState): BlindLevel {
  return t.config.levels[Math.min(t.level, t.config.levels.length - 1)];
}

/** Advance blind level if due. Returns true if the level changed. */
export function checkLevelUp(t: TableState): boolean {
  if (t.config.levelBy === 'none' || t.config.levels.length <= 1) return false;
  if (t.level >= t.config.levels.length - 1) return false;
  let due = false;
  if (t.config.levelBy === 'hands') due = t.handNo - t.levelStartHand >= t.config.levelLength;
  else due = t.playMs - t.levelStartMs >= t.config.levelLength * 60_000;
  if (due) {
    t.level++;
    t.levelStartHand = t.handNo;
    t.levelStartMs = t.playMs;
  }
  return due;
}

function nextOccupied(t: TableState, from: number): number {
  const n = t.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const s = t.seats[i];
    if (s && !s.busted && !s.sittingOut && s.stack > 0) return i;
  }
  return from;
}

let handCounter = 0;
export function newHandId(): string {
  handCounter++;
  return `${Date.now().toString(36)}-${handCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Prepare the next hand: move the button and build the HandInit. */
export function nextHandInit(t: TableState, rng: Rng = cryptoRng, deck?: number[]): HandInit {
  const act = activeSeats(t);
  if (act.length < 2) throw new Error('not enough players');
  if (t.handNo > 0) t.buttonSeat = nextOccupied(t, t.buttonSeat);
  else if (!t.seats[t.buttonSeat] || t.seats[t.buttonSeat]!.busted) t.buttonSeat = nextOccupied(t, t.buttonSeat);
  t.handNo++;
  const lvl = currentLevel(t);
  const players = act.map((s) => ({ id: s.id, name: s.name, stack: s.stack, seat: s.seat }));
  const button = players.findIndex((p) => p.seat === t.buttonSeat);
  const config: HandConfig = {
    sb: lvl.sb,
    bb: lvl.bb,
    ante: lvl.ante,
    structure: t.config.structure,
    straddle: t.config.straddle,
    runItTwice: t.config.runItTwice,
  };
  const n = players.length;
  const bbIdx = n === 2 ? (button + 1) % n : (button + 2) % n;
  return {
    handId: newHandId(),
    handNo: t.handNo,
    config,
    players,
    button: button < 0 ? 0 : button,
    deck: deck ?? shuffle(fullDeck(), rng),
    straddler: t.config.straddle && n > 2 ? (bbIdx + 1) % n : null,
  };
}

/** Apply the finished hand to the table: stacks, bust-outs, places. Returns ids of busted players. */
export function applyHandResult(t: TableState, h: HandState): string[] {
  const busted: string[] = [];
  const bustThisHand: TableSeat[] = [];
  for (const p of h.players) {
    const seat = t.seats.find((s) => s && s.id === p.id);
    if (!seat) continue;
    seat.stack = p.stack;
    if (seat.stack <= 0 && !seat.busted) {
      seat.busted = true;
      bustThisHand.push(seat);
      busted.push(seat.id);
    }
  }
  if (t.config.tournament && bustThisHand.length) {
    // players busting in the same hand: the one who started with more chips finishes higher
    bustThisHand.sort((a, b) => (h.players.find((p) => p.id === a.id)!.startStack - h.players.find((p) => p.id === b.id)!.startStack));
    let remaining = t.seats.filter((s) => s && !s.busted).length;
    for (const s of bustThisHand) {
      remaining++;
      s.place = remaining;
    }
    // re-number so the highest starting stack gets the best place
    const places = bustThisHand.map((s) => s.place!).sort((a, b) => b - a);
    bustThisHand.forEach((s, k) => (s.place = places[k]));
    for (const s of bustThisHand) {
      t.bustOrder.push(s.id);
      t.places.push({ id: s.id, name: s.name, place: s.place!, prize: prizeFor(t, s.place!) });
    }
    const alive = t.seats.filter((s): s is TableSeat => !!s && !s.busted);
    if (alive.length === 1) {
      alive[0].place = 1;
      t.places.push({ id: alive[0].id, name: alive[0].name, place: 1, prize: prizeFor(t, 1) });
      t.finished = true;
    }
    t.places.sort((a, b) => a.place - b.place);
  }
  return busted;
}

export function prizePool(t: TableState): number {
  const entrants = t.seats.filter(Boolean).length;
  return entrants * t.config.startingStack;
}

export function prizeFor(t: TableState, place: number): number {
  const f = t.config.payouts[place - 1] ?? 0;
  return Math.round(prizePool(t) * f);
}

export function rebuy(t: TableState, id: string, amount?: number) {
  const s = t.seats.find((x) => x && x.id === id);
  if (!s) return;
  s.stack = amount ?? t.config.startingStack;
  s.busted = false;
  s.buyIns++;
}

export function topUp(t: TableState, id: string) {
  const s = t.seats.find((x) => x && x.id === id);
  if (!s) return 0;
  const add = Math.max(0, t.config.startingStack - s.stack);
  s.stack += add;
  if (add > 0) s.buyIns += add / t.config.startingStack;
  return add;
}

export function tableChips(t: TableState): number {
  return t.seats.reduce((a, s) => a + (s ? s.stack : 0), 0);
}
