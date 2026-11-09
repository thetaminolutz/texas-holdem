// Runs a table session: hands, bots, human input, animations, persistence (resume mid-hand), history and stats.
import { Store } from './store';
import { createHand, applyAction, replayHand, getLegal, computePots, totalPot, playerBestFive, handToText, type Action, type HandInit, type HandState, type Legal, type HandEvent } from '../engine/game';
import { createTable, nextHandInit, applyHandResult, checkLevelUp, currentLevel, rebuy, topUp, activeSeats, type TableState, type TableSeat } from '../engine/table';
import { cryptoRng } from '../engine/rng';
import { describe as describeScore, evaluate } from '../engine/evaluator';
import { cardToPretty } from '../engine/cards';
import { buildView } from '../ai/view';
import { botDecide, coach as coachAdvice } from '../ai/client';
import { ARCHETYPES, CHARACTERS, pickTalk } from '../ai/characters';
import { analyzeHand, accumulate, emptyStats } from '../ai/opponentModel';
import { opponentProfile } from '../ai/brain';
import type { BotContext, Decision, OpponentStats, Archetype } from '../ai/types';
import type { Difficulty } from '../ai/difficulty';
import type { Director } from '../scene/director';
import { settingsStore, animSpeedFactor, type Settings } from './settings';
import { db } from '../storage/db';
import { saveHand } from '../storage/history';
import { recordHand, recordTournament, ACHIEVEMENTS } from './profile';
import { buildTable as buildTableSpec, type GameSetupSpec } from './modes';
import { sfx } from '../audio/sfx';
import { countOuts } from '../ai/range';

export const SAVE_VERSION = 3;

export interface SeatView {
  seat: number;
  id: string;
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  isHuman: boolean;
  inHand: boolean;
  isTurn: boolean;
  isButton: boolean;
  lastAction: string | null;
  avatarSeed: number;
  archetype?: string;
  difficulty?: string;
  bio?: string;
  busted: boolean;
  talk?: string;
  shown?: number[];
  handName?: string;
  winner?: boolean;
  thinking: boolean;
  hud?: { vpip: number; pfr: number; af: number; hands: number };
}

export interface HumanTurn {
  legal: Legal;
  pot: number;
  toCall: number;
  stack: number;
  committed: number;
  bb: number;
}

export interface CoachInfo {
  potOdds: number | null;
  equity: number | null;
  outs: { outs: number; desc: string } | null;
  advice: Decision | null;
  handName: string | null;
}

export interface GameView {
  ready: boolean;
  mode: string;
  handNo: number;
  sb: number;
  bb: number;
  ante: number;
  level: number;
  nextLevel: { sb: number; bb: number; in: string } | null;
  street: string;
  board: number[];
  board2: number[] | null;
  pots: number[];
  potTotal: number;
  seats: (SeatView | null)[];
  human: HumanTurn | null;
  humanHole: number[];
  humanRevealed: boolean;
  coach: CoachInfo;
  log: { text: string; kind: string }[];
  message: string | null;
  askRuns: boolean;
  rebuyOffer: boolean;
  finished: { place: number; prize: number; places: { name: string; place: number; prize: number }[] } | null;
  timer: { endsAt: number; total: number } | null;
  lastHand: { text: string; mistakes: string[]; summary: string } | null;
  handsCompleted: number;
  paused: boolean;
}

interface BotMeta {
  archetype: Archetype;
  difficulty: Difficulty;
  adaptive: boolean;
  tilt: number;
  confidence: number;
  avatarSeed: number;
  bio: string;
}

interface SavedGame {
  version: number;
  spec: GameSetupSpec;
  table: TableState;
  hand: { init: HandInit; actions: Action[] } | null;
  bots: Record<string, BotMeta>;
  stats: Record<string, OpponentStats>;
  handsCompleted: number;
  savedAt: number;
}

const HUMAN = 'human';

function emptyView(): GameView {
  return {
    ready: false,
    mode: '',
    handNo: 0,
    sb: 0,
    bb: 0,
    ante: 0,
    level: 0,
    nextLevel: null,
    street: 'preflop',
    board: [],
    board2: null,
    pots: [],
    potTotal: 0,
    seats: [],
    human: null,
    humanHole: [],
    humanRevealed: false,
    coach: { potOdds: null, equity: null, outs: null, advice: null, handName: null },
    log: [],
    message: null,
    askRuns: false,
    rebuyOffer: false,
    finished: null,
    timer: null,
    lastHand: null,
    handsCompleted: 0,
    paused: false,
  };
}

export class GameController {
  view = new Store<GameView>(emptyView());
  table!: TableState;
  hand: HandState | null = null;
  actions: Action[] = [];
  bots: Record<string, BotMeta> = {};
  stats: Record<string, OpponentStats> = {};
  handsCompleted = 0;
  private running = false;
  private stopped = false;
  private humanResolve: ((a: Action) => void) | null = null;
  private runsResolve: ((n: number) => void) | null = null;
  private rebuyResolve: ((b: boolean) => void) | null = null;
  private pauseResolve: (() => void) | null = null;
  private paused = false;
  private talk: Record<string, { text: string; until: number }> = {};
  private thinking: string | null = null;
  private eventCursor = 0;
  private preAction: 'checkfold' | 'callany' | 'check' | null = null;
  private humanDecisions: { street: string; action: Action; advice: Decision | null; equity: number | null }[] = [];
  private lastAdvice: Decision | null = null;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private levelStartWall = Date.now();
  spec!: GameSetupSpec;

  constructor(public director: Director) {}

  get s(): Settings {
    return settingsStore.get();
  }

  /** Animation speed from settings (automated tests may override it). */
  animSpeed(): number {
    const o = (globalThis as any).__speedOverride;
    return typeof o === 'number' ? o : animSpeedFactor(this.s);
  }

  // ------------------------------------------------------------------ setup
  newGame(spec: GameSetupSpec) {
    this.spec = spec;
    const { config, seats } = buildTableSpec(spec);
    this.table = createTable(config, seats);
    this.bots = {};
    for (const s of seats) if (s.bot) this.bots[s.id] = this.makeBotMeta(s);
    this.stats = {};
    this.handsCompleted = 0;
  }

  private makeBotMeta(s: TableSeat): BotMeta {
    const ch = CHARACTERS.find((c) => c.avatarSeed === s.bot!.avatarSeed);
    const adaptive = this.spec?.difficulty === 'adaptive';
    return {
      archetype: s.bot!.archetype as Archetype,
      difficulty: (['beginner', 'easy', 'medium', 'hard', 'expert'].includes(s.bot!.difficulty) ? s.bot!.difficulty : 'medium') as Difficulty,
      adaptive,
      tilt: 0,
      confidence: 0,
      avatarSeed: s.bot!.avatarSeed,
      bio: ch?.bio ?? 'A regular at this table.',
    };
  }

  async loadSaved(saved: SavedGame) {
    if (!saved || saved.version !== SAVE_VERSION) throw new Error('Incompatible save');
    this.spec = saved.spec;
    this.table = saved.table;
    this.bots = saved.bots;
    this.stats = saved.stats ?? {};
    this.handsCompleted = saved.handsCompleted ?? 0;
    if (saved.hand) {
      this.hand = replayHand(saved.hand.init, saved.hand.actions);
      this.actions = [...saved.hand.actions];
      if (this.hand.street === 'complete') {
        // hand finished right before the save: apply result
        this.hand = null;
        this.actions = [];
      }
    }
  }

  static async readSave(): Promise<SavedGame | null> {
    const s = await db.get<SavedGame>('kv', 'savedGame');
    if (!s || s.version !== SAVE_VERSION || !s.table || !s.spec) return null;
    return s;
  }

  save() {
    if (!this.table) return Promise.resolve();
    const data: SavedGame = {
      version: SAVE_VERSION,
      spec: this.spec,
      table: this.table,
      hand: this.hand && this.hand.street !== 'complete' ? { init: this.hand.init, actions: this.actions } : null,
      bots: this.bots,
      stats: this.stats,
      handsCompleted: this.handsCompleted,
      savedAt: Date.now(),
    };
    if (this.table.finished) return db.del('kv', 'savedGame');
    return db.set('kv', 'savedGame', JSON.parse(JSON.stringify(data)));
  }

  // ------------------------------------------------------------------ view
  private humanIdx(h = this.hand): number {
    return h ? h.players.findIndex((p) => p.id === HUMAN) : -1;
  }

  private log(text: string, kind = 'info') {
    const v = this.view.get();
    const log = [...v.log, { text, kind }].slice(-120);
    this.view.set({ ...v, log });
  }

  refresh(extra: Partial<GameView> = {}) {
    const t = this.table;
    if (!t) return;
    const h = this.hand;
    const lvl = currentLevel(t);
    const hi = this.humanIdx();
    const seats: (SeatView | null)[] = t.seats.map((s) => {
      if (!s) return null;
      const pi = h ? h.players.findIndex((p) => p.id === s.id) : -1;
      const ps = pi >= 0 ? h!.players[pi] : null;
      const meta = this.bots[s.id];
      const talk = this.talk[s.id];
      const st = this.stats[s.id];
      const prof = st ? opponentProfile(st) : null;
      const shown = ps && h && h.events.some((e) => e.t === 'show' && e.p === pi) ? ps.hole : undefined;
      const winner = !!(h && h.street === 'complete' && pi >= 0 && h.winners.includes(pi));
      return {
        seat: s.seat,
        id: s.id,
        name: s.name,
        stack: ps ? ps.stack : s.stack,
        bet: ps ? ps.committed : 0,
        folded: ps ? ps.folded : false,
        allIn: ps ? ps.allIn : false,
        isHuman: s.isHuman,
        inHand: !!ps,
        isTurn: !!(h && h.toAct === pi && pi >= 0),
        isButton: !!(h && h.button === pi),
        lastAction: ps ? ps.lastAction : null,
        avatarSeed: meta?.avatarSeed ?? 0,
        archetype: meta ? ARCHETYPES[meta.archetype].label : undefined,
        difficulty: meta?.difficulty,
        bio: meta?.bio,
        busted: s.busted,
        talk: talk && talk.until > Date.now() ? talk.text : undefined,
        shown,
        handName: shown && h!.board.length >= 3 ? describeScore(evaluate([...shown, ...h!.board])) : undefined,
        winner,
        thinking: this.thinking === s.id,
        hud: prof ? { vpip: prof.vpip, pfr: prof.pfr, af: prof.af, hands: prof.hands } : undefined,
      };
    });
    let pots: number[] = [];
    if (h && h.street !== 'complete') pots = this.middlePots(h);
    let nextLevel: GameView['nextLevel'] = null;
    if (t.config.levelBy !== 'none' && t.level < t.config.levels.length - 1) {
      const n = t.config.levels[t.level + 1];
      const left = t.config.levelBy === 'hands' ? `${Math.max(0, t.config.levelLength - (t.handNo - t.levelStartHand))} hands` : `${Math.max(0, Math.ceil((t.config.levelLength * 60000 - (t.playMs - t.levelStartMs)) / 60000))} min`;
      nextLevel = { sb: n.sb, bb: n.bb, in: left };
    }
    const humanHole = hi >= 0 ? h!.players[hi].hole : [];
    this.view.set({
      ...this.view.get(),
      ready: true,
      mode: t.config.mode,
      handNo: t.handNo,
      sb: lvl.sb,
      bb: lvl.bb,
      ante: lvl.ante,
      level: t.level,
      nextLevel,
      street: h ? h.street : 'preflop',
      board: h ? [...h.board] : [],
      board2: h?.board2 ? [...h.board2] : null,
      pots,
      potTotal: h ? totalPot(h) : 0,
      seats,
      humanHole,
      handsCompleted: this.handsCompleted,
      ...extra,
    });
  }

  // ------------------------------------------------------------------ main loop
  async run() {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    const d = this.director;
    d.anim.speed = this.animSpeed();
    await this.syncTableInstant();
    this.refresh();
    try {
      while (!this.stopped) {
        await this.waitIfPaused();
        if (this.table.finished) {
          await this.finishTournament();
          break;
        }
        if (this.hand && this.hand.street !== 'complete') {
          await this.playHand(true);
          continue;
        }
        if (!(await this.beforeHand())) break;
        await this.startHand();
        await this.playHand(false);
      }
    } finally {
      this.running = false;
    }
  }

  stop() {
    this.stopped = true;
    this.humanResolve?.({ type: 'fold' });
    this.runsResolve?.(1);
    this.rebuyResolve?.(false);
    this.pauseResolve?.();
    if (this.timerHandle) clearTimeout(this.timerHandle);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) {
      this.pauseResolve?.();
      this.pauseResolve = null;
    }
    this.refresh({ paused: p });
  }

  private waitIfPaused() {
    if (!this.paused) return Promise.resolve();
    return new Promise<void>((r) => (this.pauseResolve = r));
  }

  /** Rebuild the 3D table to match the current state without animation (start / resume / settings change). */
  async syncTableInstant() {
    const d = this.director;
    d.resetSeats();
    d.clearAll();
    const h = this.hand;
    this.table.seats.forEach((s, i) => {
      if (!s) return;
      const ps = h?.players.find((p) => p.id === s.id);
      d.setStack(i, ps ? ps.stack : s.busted ? 0 : s.stack);
      d.setBet(i, ps ? ps.committed : 0);
    });
    if (h) {
      const hi = this.humanIdx();
      h.players.forEach((p, i) => {
        if (p.folded) return;
        const shown = h.events.some((e) => e.t === 'show' && e.p === i);
        d.placeHoleInstant(p.seat, i === hi || shown ? p.hole : [-1, -1], shown || (i === hi && h.actions.some((a) => a.p === hi)), i === hi);
      });
      d.placeBoardInstant(h.board, 0);
      if (h.board2) d.placeBoardInstant(h.board2.slice(h.board.length - (5 - h.board2.length)), 2);
      const burns = h.events.filter((e) => e.t === 'burn').length;
      const folds = h.players.filter((p) => p.folded).length * 2;
      d.placeMuckInstant(burns + folds);
      d.setPotsInstant(this.middlePots(h));
      const sbSeat = h.players[h.sbIdx]?.seat ?? null;
      const bbSeat = h.players[h.bbIdx]?.seat ?? null;
      await d.moveButtons(h.players[h.button].seat, sbSeat, bbSeat, true);
      this.eventCursor = h.events.length;
    } else {
      await d.moveButtons(this.table.buttonSeat, null, null, true);
    }
    d.scene.requestRender();
  }

  /** Chips gathered in the middle (main + side pots only when someone is all-in). */
  middlePots(h: HandState): number[] {
    if (!h.players.some((p) => p.allIn)) return h.potCollected > 0 ? [h.potCollected] : [];
    const pots = this.potsCollectedOnly(h);
    return pots.length ? pots : h.potCollected > 0 ? [h.potCollected] : [];
  }

  /** Pots excluding bets still in front of players. */
  private potsCollectedOnly(h: HandState): number[] {
    const pots = computePots(h).map((p) => p.amount);
    let bets = h.players.reduce((a, p) => a + p.committed, 0);
    for (let i = pots.length - 1; i >= 0 && bets > 0; i--) {
      const take = Math.min(pots[i], bets);
      pots[i] -= take;
      bets -= take;
    }
    return pots.filter((p) => p > 0);
  }

  private async beforeHand(): Promise<boolean> {
    const t = this.table;
    const human = t.seats.find((s) => s?.id === HUMAN)!;
    // Human busted
    if (human.busted || human.stack <= 0) {
      if (t.config.tournament) {
        if (!t.finished && activeSeats(t).length > 1) {
          // spectate: let bots finish quickly
          this.director.anim.speed = 8;
        }
      } else {
        this.refresh({ rebuyOffer: true });
        const yes = await new Promise<boolean>((r) => (this.rebuyResolve = r));
        this.rebuyResolve = null;
        this.refresh({ rebuyOffer: false });
        if (!yes) return false;
        rebuy(t, HUMAN);
        this.director.setStack(0, human.stack);
        this.log('You bought in again.', 'info');
      }
    }
    // Bots busted in cash games: rebuy or get replaced by a newcomer
    if (!t.config.tournament) {
      for (const s of t.seats) {
        if (!s || s.isHuman || !s.busted) continue;
        if (cryptoRng.next() < 0.6) {
          rebuy(t, s.id);
          this.log(`${s.name} rebuys.`, 'info');
        } else {
          const used = new Set(t.seats.filter(Boolean).map((x) => x!.name));
          const ch = CHARACTERS.filter((c) => !used.has(c.name))[Math.floor(cryptoRng.next() * 6)] ?? CHARACTERS[0];
          this.log(`${s.name} leaves the table. ${ch.name} sits down.`, 'info');
          s.name = ch.name;
          s.id = `bot-${s.seat}-${ch.avatarSeed}-${t.handNo}`;
          s.bot = { archetype: ch.archetype, difficulty: s.bot?.difficulty ?? 'medium', avatarSeed: ch.avatarSeed };
          s.stack = t.config.startingStack;
          s.busted = false;
          this.bots[s.id] = this.makeBotMeta(s);
        }
        this.director.setStack(s.seat, s.stack);
      }
    }
    if (activeSeats(t).length < 2) {
      t.finished = true;
      return true;
    }
    // blind level
    if (t.config.levelBy === 'minutes') {
      t.playMs += Date.now() - this.levelStartWall;
      this.levelStartWall = Date.now();
    }
    if (checkLevelUp(t)) {
      const l = currentLevel(t);
      sfx.bell();
      this.log(`Blinds up: ${l.sb}/${l.bb}${l.ante ? ` ante ${l.ante}` : ''}`, 'level');
      this.refresh({ message: `Blinds are now ${l.sb}/${l.bb}${l.ante ? ` · ante ${l.ante}` : ''}` });
    }
    return true;
  }

  private async startHand() {
    const t = this.table;
    const d = this.director;
    d.anim.speed = this.humanBustedTourney() ? 8 : this.animSpeed();
    d.opts = { chipIntensity: this.s.anim.chipIntensity, dealStyle: this.s.anim.dealStyle, slowRollRiver: this.s.anim.slowRollRiver };
    // gather previous hand's cards and shuffle
    d.clearHighlight();
    try {
      await d.gatherCards();
    } catch (e) {
      console.error('gather failed', e);
    }
    d.clearPots();
    if (d.deck.length < 52) d.resetDeckInstant();
    this.refresh({ message: null, lastHand: this.view.get().lastHand });
    const init = nextHandInit(t, cryptoRng);
    this.hand = createHand(init);
    this.actions = [];
    this.eventCursor = 0;
    this.humanDecisions = [];
    this.preAction = null;
    this.talk = {};
    this.refresh({ humanRevealed: false, human: null, coach: { potOdds: null, equity: null, outs: null, advice: null, handName: null } });
    void this.save();
    // shuffle (cosmetic) — tap to skip handled by UI calling skipAnimations()
    if (this.s.anim.speed !== 'off' && !this.humanBustedTourney() && !d.anim.instant) {
      try {
        await d.shuffle(this.s.anim.shuffleStyle, this.s.anim.quickShuffle || this.s.anim.reduceMotion);
      } catch (e) {
        console.error('shuffle failed', e);
        d.resetDeckInstant();
      }
    }
    const h = this.hand;
    await d.moveButtons(h.players[h.button].seat, h.players[h.sbIdx].seat, h.players[h.bbIdx].seat);
    this.log(`— Hand #${t.handNo} · blinds ${h.config.sb}/${h.config.bb}${h.config.ante ? ` · ante ${h.config.ante}` : ''} —`, 'hand');
    await this.animateNewEvents();
  }

  private humanBustedTourney() {
    const human = this.table.seats.find((s) => s?.id === HUMAN);
    return !!(this.table.config.tournament && human && human.busted);
  }

  private async playHand(resumed: boolean) {
    const h = this.hand!;
    if (resumed) this.refresh();
    while (h.street !== 'complete' && !this.stopped) {
      await this.waitIfPaused();
      if (h.pendingRuns) {
        const n = await this.decideRuns();
        this.actions.push({ type: 'runs', amount: n });
        applyAction(h, { type: 'runs', amount: n });
        if (n === 2) this.log('Running it twice.', 'info');
        await this.animateNewEvents();
        continue;
      }
      const idx = h.toAct!;
      const p = h.players[idx];
      let action: Action;
      if (p.id === HUMAN) action = await this.humanTurn();
      else action = await this.botTurn(idx);
      if (this.stopped) return;
      if (h.toAct !== idx) continue; // state changed (shouldn't happen)
      this.actions.push(action);
      applyAction(h, action);
      this.refresh({ human: null, timer: null });
      void this.save();
      await this.animateNewEvents();
    }
    if (this.stopped) return;
    await this.finishHand();
  }

  private async decideRuns(): Promise<number> {
    const h = this.hand!;
    const hi = this.humanIdx();
    const involved = h.players.filter((p) => !p.folded);
    const mode = this.spec.runItTwice;
    if (mode === 'always') return 2;
    let botsAgree = involved.filter((p) => p.id !== HUMAN).every(() => cryptoRng.next() < 0.6);
    if (hi >= 0 && !h.players[hi].folded) {
      this.refresh({ askRuns: true });
      const n = await new Promise<number>((r) => (this.runsResolve = r));
      this.runsResolve = null;
      this.refresh({ askRuns: false });
      if (n === 2 && !botsAgree) this.log('Opponent declines to run it twice.', 'info');
      return n === 2 && botsAgree ? 2 : 1;
    }
    return botsAgree ? 2 : 1;
  }

  chooseRuns(n: number) {
    this.runsResolve?.(n);
  }
  answerRebuy(yes: boolean) {
    this.rebuyResolve?.(yes);
  }

  // ------------------------------------------------------------------ bots
  private botContext(id: string): BotContext {
    const m = this.bots[id];
    const opps: Record<string, OpponentStats> = {};
    for (const [k, v] of Object.entries(this.stats)) if (k !== id) opps[k] = v;
    let difficulty = m.difficulty;
    if (m.adaptive) {
      // Adaptive: track the human's results; winning humans face stronger bots
      const human = this.table.seats.find((s) => s?.id === HUMAN)!;
      const ratio = human.stack / (this.table.config.startingStack * Math.max(1, human.buyIns));
      difficulty = ratio > 1.6 ? 'expert' : ratio > 1.2 ? 'hard' : ratio < 0.5 ? 'easy' : 'medium';
    }
    return { archetype: m.archetype, difficulty, personality: ARCHETYPES[m.archetype].p, tilt: this.s.coach.tableTalk || true ? m.tilt : 0, confidence: m.confidence, opponents: opps, seed: m.avatarSeed };
  }

  private tournamentInfo(): GameView['finished'] extends never ? never : import('../ai/types').BotView['tournament'] {
    const t = this.table;
    if (!t.config.tournament) return null;
    const alive = activeSeats(t);
    const avg = alive.reduce((a, s) => a + s.stack, 0) / Math.max(1, alive.length);
    return { payouts: t.config.payouts, playersLeft: alive.length, avgStack: avg, bubble: alive.length === t.config.payouts.length + 1 };
  }

  private async botTurn(idx: number): Promise<Action> {
    const h = this.hand!;
    const p = h.players[idx];
    const view = buildView(h, idx, this.tournamentInfo());
    this.thinking = p.id;
    this.refresh();
    const t0 = performance.now();
    let dec: Decision;
    try {
      dec = await botDecide(view, this.botContext(p.id));
    } catch {
      dec = { action: view.legal.canCheck ? { type: 'check' } : { type: 'fold' }, thinkMs: 500 };
    }
    // human-like think time (scaled by game speed and animation speed)
    const speed = this.s.gameplay.gameSpeed;
    const anim = this.director.anim.speed;
    const want = anim <= 0 || anim >= 8 ? 60 : (dec.thinkMs * speed) / Math.max(0.5, anim);
    const elapsed = performance.now() - t0;
    if (want > elapsed) {
      // fidget with chips while thinking
      if (this.s.anim.idleFidget && want - elapsed > 1600 && cryptoRng.next() < 0.35) void this.director.fidget(p.seat);
      await sleepWall(want - elapsed);
    }
    this.thinking = null;
    if (dec.talk && this.s.coach.tableTalk) {
      this.talk[p.id] = { text: dec.talk, until: Date.now() + 3200 };
      this.log(`${p.name}: “${dec.talk}”`, 'talk');
    }
    return dec.action as Action;
  }

  // ------------------------------------------------------------------ human
  private async humanTurn(): Promise<Action> {
    const h = this.hand!;
    const idx = h.toAct!;
    const legal = getLegal(h)!;
    const me = h.players[idx];
    // reveal cards automatically the first time the human must act
    if (!this.director.revealed) {
      await this.director.revealHuman();
      this.refresh({ humanRevealed: true });
    }
    // pre-actions
    if (this.preAction) {
      const pa = this.preAction;
      this.preAction = null;
      if (pa === 'checkfold') return legal.canCheck ? { type: 'check' } : { type: 'fold' };
      if (pa === 'check' && legal.canCheck) return { type: 'check' };
      if (pa === 'callany') return legal.canCheck ? { type: 'check' } : { type: 'call' };
    }
    const turn: HumanTurn = { legal, pot: legal.pot, toCall: legal.toCall, stack: me.stack, committed: me.committed, bb: h.config.bb };
    const timerSec = this.s.gameplay.turnTimer;
    const timer = timerSec > 0 ? { endsAt: Date.now() + timerSec * 1000, total: timerSec * 1000 } : null;
    this.refresh({ human: turn, timer });
    void this.updateCoach(idx);
    const action = await new Promise<Action>((resolve) => {
      this.humanResolve = resolve;
      if (timer) {
        const warn = setTimeout(() => sfx.timerTick(true), Math.max(0, timerSec * 1000 - 5000));
        this.timerHandle = setTimeout(() => {
          clearTimeout(warn);
          resolve(this.s.gameplay.timeoutAction === 'checkfold' && legal.canCheck ? { type: 'check' } : { type: 'fold' });
        }, timerSec * 1000);
        const prev = resolve;
        this.humanResolve = (a) => {
          clearTimeout(warn);
          prev(a);
        };
      }
    });
    if (this.timerHandle) clearTimeout(this.timerHandle);
    this.timerHandle = null;
    this.humanResolve = null;
    this.humanDecisions.push({ street: h.street, action, advice: this.lastAdvice, equity: this.view.get().coach.equity });
    return action;
  }

  /** UI entry point for the human's action. */
  act(a: Action) {
    this.humanResolve?.(a);
  }

  setPreAction(p: 'checkfold' | 'callany' | 'check' | null) {
    this.preAction = p;
  }

  private async updateCoach(idx: number) {
    const h = this.hand!;
    const c = this.s.coach;
    const legal = getLegal(h);
    if (!legal) return;
    const potOdds = legal.toCall > 0 ? legal.toCall / (legal.pot + legal.toCall) : null;
    const me = h.players[idx];
    const handName = h.board.length >= 3 ? describeScore(evaluate([...me.hole, ...h.board])) : null;
    const outs = h.board.length >= 3 && h.board.length < 5 ? countOuts(me.hole, h.board) : null;
    this.refresh({ coach: { potOdds, equity: null, outs, advice: null, handName } });
    this.lastAdvice = null;
    if (!(c.equity || c.coach || c.mistakeReview)) return;
    const view = buildView(h, idx, this.tournamentInfo());
    const opps: Record<string, OpponentStats> = {};
    for (const [k, v] of Object.entries(this.stats)) if (k !== HUMAN) opps[k] = v;
    try {
      const adv = await coachAdvice(view, opps);
      if (this.hand !== h || h.toAct !== idx) return;
      this.lastAdvice = adv;
      this.refresh({ coach: { potOdds, equity: adv.equity ?? null, outs, advice: c.coach ? adv : null, handName } });
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ animations
  private async animateNewEvents() {
    const h = this.hand!;
    const events = h.events.slice(this.eventCursor);
    this.eventCursor = h.events.length;
    const d = this.director;
    const hi = this.humanIdx();
    const seatOf = (p: number) => h.players[p].seat;
    let boardCount = 0;
    let board2Count = 0;
    for (const e of events) {
      if (this.stopped) return;
      try {
        await this.animateEvent(e, d, hi, seatOf, () => boardCount, (n) => (boardCount = n), () => board2Count, (n) => (board2Count = n));
      } catch (err) {
        // A visual glitch must never stop the game: resync the table from the engine state.
        console.error('animation failed', e.t, err);
        try {
          await this.syncTableInstant();
        } catch {
          /* ignore */
        }
      }
      this.refresh();
    }
  }

  private async animateEvent(e: HandEvent, d: Director, hi: number, seatOf: (p: number) => number, getB: () => number, setB: (n: number) => void, getB2: () => number, setB2: (n: number) => void) {
    const h = this.hand!;
    const name = (p: number) => (h.players[p].id === HUMAN ? 'You' : h.players[p].name);
    switch (e.t) {
      case 'post':
        if (e.kind === 'ante') {
          await d.bet(seatOf(e.p), e.amount, false);
        } else {
          await d.bet(seatOf(e.p), e.amount, false);
          this.log(`${name(e.p)} post${h.players[e.p].id === HUMAN ? '' : 's'} ${e.kind === 'sb' ? 'small blind' : e.kind === 'bb' ? 'big blind' : 'a straddle'} ${e.amount}`, 'post');
        }
        // antes go straight into the pot
        if (e.kind === 'ante' && h.events.indexOf(e) === h.events.filter((x) => x.t === 'post' && x.kind === 'ante').length - 1) {
          // collect antes only (bets from antes are tracked as committed? antes are dead money: sweep them)
          const antesTotal = h.events.filter((x) => x.t === 'post' && x.kind === 'ante').reduce((a, x) => a + (x as any).amount, 0);
          await this.collectAntes(antesTotal);
        }
        break;
      case 'deal': {
        const order = e.order.map(seatOf);
        await d.dealHole(order, e.rounds, hi >= 0 ? seatOf(hi) : -1, hi >= 0 ? h.players[hi].hole : []);
        break;
      }
      case 'act': {
        const seat = seatOf(e.p);
        const pan = d.L.seats[seat] ? d.L.seats[seat].edge.x : 0;
        const n = name(e.p);
        const you = h.players[e.p].id === HUMAN;
        switch (e.action) {
          case 'fold':
            this.log(`${n} fold${you ? '' : 's'}`, 'fold');
            await d.fold(seat);
            break;
          case 'check':
            this.log(`${n} check${you ? '' : 's'}`, 'check');
            sfx.knock(pan);
            await d.anim.wait(0.25);
            break;
          case 'call':
            this.log(`${n} call${you ? '' : 's'} ${e.amount}${e.allIn ? ' (all-in)' : ''}`, 'call');
            await d.bet(seat, e.amount, e.allIn);
            break;
          case 'bet':
            this.log(`${n} bet${you ? '' : 's'} ${e.amount}`, 'bet');
            await d.bet(seat, e.amount, false);
            break;
          case 'raise':
            this.log(`${n} raise${you ? '' : 's'} to ${e.to}`, 'raise');
            await d.bet(seat, e.amount, false);
            break;
          case 'allin':
            this.log(`${n} ${you ? 'go' : 'goes'} all-in (${e.to})`, 'allin');
            await d.bet(seat, e.amount, true);
            if (this.s.anim.cinematic && e.to >= 20 * h.config.bb) {
              const st = d.L.seats[seat];
              d.scene.rig.focusOn(st.bet.x * 0.6, st.bet.z * 0.6, 0.85, 2);
            }
            break;
        }
        break;
      }
      case 'return':
        this.log(`Uncalled ${e.amount} returned to ${name(e.p)}`, 'info');
        await d.returnBet(seatOf(e.p), e.amount);
        break;
      case 'collect': {
        const pots = this.middlePots(h);
        const anyBets = d.seats.some((s) => s.bet.chips.length > 0);
        if (anyBets) await d.collectBets(pots.length ? pots : [h.potCollected]);
        break;
      }
      case 'burn':
        await d.burn();
        break;
      case 'board': {
        if (e.run === 2) {
          const start = getB2() === 0 ? 5 - (h.board2!.length - (h.board2!.length - e.cards.length)) : 0;
          void start;
          const base = h.board2!.length - countRun2Remaining(h, e);
          await d.dealBoard(e.cards, base, 2, e.street as any);
          setB2(getB2() + e.cards.length);
        } else {
          const start = getB();
          await d.dealBoard(e.cards, start === 0 ? boardStartIndex(e.street) : start, 1, e.street as any);
          setB(boardStartIndex(e.street) + e.cards.length);
        }
        this.log(`${e.run === 2 ? 'Second board' : e.street[0].toUpperCase() + e.street.slice(1)}: ${e.cards.map(cardToPretty).join(' ')}`, 'board');
        break;
      }
      case 'show': {
        const seat = seatOf(e.p);
        if (e.p !== hi || !d.revealed) await d.show(seat, e.cards);
        this.log(`${name(e.p)} show${h.players[e.p].id === HUMAN ? '' : 's'} ${e.cards.map(cardToPretty).join(' ')} — ${e.name}`, 'show');
        if (this.s.anim.cinematic && totalPotNow(h) >= 40 * h.config.bb && h.players.filter((p) => p.allIn).length > 0) d.scene.rig.focusOn(0, 0, 0.8, 2.5);
        break;
      }
      case 'muck': {
        const seat = seatOf(e.p);
        const p = h.players[e.p];
        if (e.p === hi && !this.s.gameplay.autoMuck) {
          await d.show(seat, p.hole);
          this.log(`You show ${p.hole.map(cardToPretty).join(' ')}`, 'show');
        } else if (e.p !== hi && this.s.gameplay.showBotCards) {
          await d.show(seat, p.hole);
          this.log(`${p.name} mucks (${p.hole.map(cardToPretty).join(' ')})`, 'muck');
        } else {
          this.log(`${name(e.p)} muck${e.p === hi ? '' : 's'}`, 'muck');
          await d.fold(seat);
        }
        break;
      }
      case 'award': {
        const winners = e.winners.map((w, k) => ({ seat: seatOf(w), amount: e.amounts[k] }));
        if (e.name && h.board.length >= 3) {
          const w0 = e.winners[0];
          const board = e.run === 2 ? h.board2! : h.board;
          const best = playerBestFive(h, w0, board);
          await d.highlight(best, e.winners.map(seatOf));
        }
        const names = e.winners.map(name).join(' & ');
        this.log(`${names} win${e.winners.length === 1 && h.players[e.winners[0]].id !== HUMAN ? 's' : ''} ${e.amount}${e.pot > 0 ? ` (side pot ${e.pot})` : ''}${e.run ? ` (run ${e.run})` : ''}${e.name ? ` with ${e.name}` : ''}`, 'win');
        if (e.winners.some((w) => h.players[w].id === HUMAN)) sfx.win(e.amount >= 30 * h.config.bb);
        await d.payout(e.pot, winners);
        break;
      }
      case 'end':
        break;
    }
  }

  private async collectAntes(total: number) {
    if (total <= 0) return;
    await this.director.collectBets([total]);
  }

  // ------------------------------------------------------------------ end of hand
  private async finishHand() {
    const h = this.hand!;
    const t = this.table;
    const hi = this.humanIdx();
    // opponent modelling (public info only)
    const flags = analyzeHand(h);
    h.players.forEach((p, i) => (this.stats[p.id] = accumulate(this.stats[p.id] ?? emptyStats(), flags[i])));
    // tilt / confidence
    h.players.forEach((p) => {
      const m = this.bots[p.id];
      if (!m) return;
      const net = (p.stack - p.startStack) / h.config.bb;
      const prone = ARCHETYPES[m.archetype].p.tiltProne;
      m.tilt = Math.max(0, Math.min(1, m.tilt * 0.88 + (net < -25 ? prone * 0.35 : 0) + (net < -60 ? prone * 0.3 : 0)));
      m.confidence = Math.max(-1, Math.min(1, m.confidence * 0.9 + Math.sign(net) * 0.1));
      if (this.s.coach.tableTalk && net > 30 && cryptoRng.next() < ARCHETYPES[m.archetype].p.chatty * 0.5) {
        this.talk[p.id] = { text: pickTalk('win', cryptoRng.next()), until: Date.now() + 3000 };
      } else if (this.s.coach.tableTalk && net < -40 && cryptoRng.next() < ARCHETYPES[m.archetype].p.chatty * 0.4) {
        this.talk[p.id] = { text: pickTalk('lose', cryptoRng.next()), until: Date.now() + 3000 };
      }
    });
    const busted = applyHandResult(t, h);
    for (const id of busted) {
      const s = t.seats.find((x) => x?.id === id)!;
      this.log(id === HUMAN ? (t.config.tournament ? `You are out in ${s.place ?? '?'}th place.` : 'You are out of chips.') : `${s.name} is out of chips${s.place ? ` (${ordinal(s.place)})` : ''}.`, 'bust');
    }
    this.handsCompleted++;
    // human stats, history, mistakes
    let mistakes: string[] = [];
    if (hi >= 0) {
      const meta: Record<string, { archetype?: string }> = {};
      for (const [id, m] of Object.entries(this.bots)) meta[id] = { archetype: m.archetype };
      const unlocked = recordHand(h, hi, meta);
      const names = unlocked.map((u) => ACHIEVEMENTS.find((a) => a.id === u)?.name ?? u);
      for (const n of names) this.log(`🏆 Achievement unlocked: ${n}`, 'achievement');
      if (names.length) this.refresh({ message: `🏆 Achievement unlocked: ${names.join(', ')}` });
      const me = h.players[hi];
      mistakes = this.reviewMistakes();
      const result = me.stack > me.startStack ? `Won ${me.stack - me.startStack}` : me.stack < me.startStack ? `Lost ${me.startStack - me.stack}` : 'Even';
      void saveHand({
        date: Date.now(),
        mode: t.config.mode,
        humanId: HUMAN,
        init: h.init,
        actions: [...this.actions],
        summary: { net: me.stack - me.startStack, pot: h.players.reduce((a, p) => a + p.total, 0), bb: h.config.bb, winners: h.winners.map((w) => h.players[w].name), hole: me.hole, board: h.board, result, mistakes },
      });
      const summary = `${result}${h.winners.length ? ` · winner: ${h.winners.map((w) => h.players[w].name).join(', ')}` : ''}`;
      this.refresh({ lastHand: { text: handToText(h), mistakes, summary } });
    }
    this.refresh({ human: null, timer: null });
    await this.save();
    // pause between hands so players can see the result
    const speed = this.director.anim.speed;
    await sleepWall(speed <= 0 ? 400 : speed >= 8 ? 150 : 1600 / Math.max(0.5, speed));
  }

  private reviewMistakes(): string[] {
    if (!this.s.coach.mistakeReview) return [];
    const out: string[] = [];
    for (const d of this.humanDecisions) {
      const adv = d.advice;
      if (!adv) continue;
      const a = d.action.type;
      const b = adv.action.type;
      const eq = adv.equity;
      if (a === 'fold' && (b === 'call' || b === 'raise' || b === 'bet') && eq !== undefined && eq > 0.4)
        out.push(`${cap(d.street)}: you folded with about ${(eq * 100).toFixed(0)}% equity — the coach would ${b}.`);
      else if ((a === 'call' || a === 'allin') && b === 'fold' && eq !== undefined && eq < 0.25)
        out.push(`${cap(d.street)}: calling with only ~${(eq * 100).toFixed(0)}% equity was expensive — folding was better.`);
      else if (a === 'check' && (b === 'bet' || b === 'raise') && eq !== undefined && eq > 0.75)
        out.push(`${cap(d.street)}: you checked a strong hand (~${(eq * 100).toFixed(0)}%) — betting for value earns more.`);
    }
    return out.slice(0, 4);
  }

  private async finishTournament() {
    const t = this.table;
    const human = t.seats.find((s) => s?.id === HUMAN)!;
    const place = human.place ?? 1;
    const prize = t.places.find((p) => p.id === HUMAN)?.prize ?? 0;
    const un = recordTournament(place, t.seats.filter(Boolean).length, t.config.payouts.length);
    if (place === 1) sfx.win(true);
    this.refresh({ finished: { place, prize, places: t.places.map((p) => ({ name: p.name, place: p.place, prize: p.prize })) } });
    if (un.length) this.log('🏆 Achievement unlocked!', 'achievement');
    await db.del('kv', 'savedGame');
  }

  // ------------------------------------------------------------------ cash game table management
  canChangeSeats() {
    return !this.table.config.tournament;
  }

  /** Between hands: add or remove a bot seat (cash games). */
  async changeSeatCount(n: number): Promise<boolean> {
    const t = this.table;
    if (t.config.tournament || n < 2 || n > 9) return false;
    if (this.hand && this.hand.street !== 'complete') return false;
    const cur = t.seats.length;
    if (n === cur) return true;
    if (n > cur) {
      const used = new Set(t.seats.filter(Boolean).map((s) => s!.name));
      for (let i = cur; i < n; i++) {
        const ch = CHARACTERS.find((c) => !used.has(c.name)) ?? CHARACTERS[i];
        used.add(ch.name);
        const seat: TableSeat = { seat: i, id: `bot-${i}-${ch.avatarSeed}-${t.handNo}`, name: ch.name, stack: t.config.startingStack, isHuman: false, bot: { archetype: ch.archetype, difficulty: this.spec.difficulty === 'mixed' ? 'medium' : this.spec.difficulty, avatarSeed: ch.avatarSeed }, busted: false, sittingOut: false, buyIns: 1 };
        t.seats.push(seat);
        this.bots[seat.id] = this.makeBotMeta(seat);
        this.log(`${ch.name} joins the table.`, 'info');
      }
    } else {
      const removed = t.seats.splice(n);
      removed.forEach((s) => s && this.log(`${s.name} leaves the table.`, 'info'));
      if (t.buttonSeat >= n) t.buttonSeat = 0;
    }
    t.config.seats = n;
    this.spec.players = n;
    await this.director.scene.setSeatCount(n);
    await this.syncTableInstant();
    this.refresh();
    void this.save();
    return true;
  }

  humanTopUp() {
    if (this.table.config.tournament || (this.hand && this.hand.street !== 'complete')) return 0;
    const add = topUp(this.table, HUMAN);
    this.director.setStack(0, this.table.seats[0]!.stack);
    this.refresh();
    return add;
  }

  skipAnimations() {
    this.director.anim.skipAll();
  }
}

function boardStartIndex(street: string) {
  return street === 'flop' ? 0 : street === 'turn' ? 3 : 4;
}
function countRun2Remaining(h: HandState, e: Extract<HandEvent, { t: 'board' }>) {
  // index of this event's cards within board2
  const idx = h.board2!.findIndex((c) => c === e.cards[0]);
  return h.board2!.length - idx;
}
function totalPotNow(h: HandState) {
  return h.players.reduce((a, p) => a + p.total, 0);
}
function sleepWall(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
