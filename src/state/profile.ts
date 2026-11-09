// Lifetime statistics, bankroll history, per-opponent records and achievements for the human player.
import { db } from '../storage/db';
import { Store } from './store';
import type { HandState } from '../engine/game';
import { handScore } from '../engine/game';
import { analyzeHand } from '../ai/opponentModel';
import { describe as describeScore, category, Cat } from '../engine/evaluator';

export const PROFILE_VERSION = 2;

export interface Profile {
  version: number;
  name: string;
  hands: number;
  handsWon: number;
  vpip: number;
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  sawFlop: number;
  wtsd: number;
  wsd: number;
  bets: number;
  calls: number;
  netChips: number;
  netBB: number;
  biggestPot: number;
  biggestPotBB: number;
  bestHand: { score: number; name: string } | null;
  streak: number;
  bestStreak: number;
  worstStreak: number;
  bankroll: number[]; // cumulative net in big blinds, one point per hand (downsampled)
  sngPlayed: number;
  sngWon: number;
  sngCashes: number;
  sessions: number;
  allInsWon: number;
  bluffsWon: number;
  showdownsWon: number;
  opponents: Record<string, { hands: number; net: number; archetype?: string }>;
  achievements: Record<string, number>; // id -> unlocked timestamp
  trainer: { preflop: [number, number]; potOdds: [number, number]; outs: [number, number] };
}

export function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    name: 'You',
    hands: 0,
    handsWon: 0,
    vpip: 0,
    pfr: 0,
    threeBetOpp: 0,
    threeBet: 0,
    sawFlop: 0,
    wtsd: 0,
    wsd: 0,
    bets: 0,
    calls: 0,
    netChips: 0,
    netBB: 0,
    biggestPot: 0,
    biggestPotBB: 0,
    bestHand: null,
    streak: 0,
    bestStreak: 0,
    worstStreak: 0,
    bankroll: [0],
    sngPlayed: 0,
    sngWon: 0,
    sngCashes: 0,
    sessions: 0,
    allInsWon: 0,
    bluffsWon: 0,
    showdownsWon: 0,
    opponents: {},
    achievements: {},
    trainer: { preflop: [0, 0], potOdds: [0, 0], outs: [0, 0] },
  };
}

export const profileStore = new Store<Profile>(defaultProfile());

export async function loadProfile() {
  const raw = await db.get<Partial<Profile>>('kv', 'profile');
  const p = { ...defaultProfile(), ...(raw && typeof raw === 'object' ? raw : {}) } as Profile;
  if (!Array.isArray(p.bankroll)) p.bankroll = [0];
  p.version = PROFILE_VERSION;
  profileStore.set(p);
  return p;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function saveProfile() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void db.set('kv', 'profile', profileStore.get()), 300);
}

// ---------------- Achievements ----------------
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  progress: (p: Profile) => [number, number];
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-hand', name: 'Take a Seat', desc: 'Play your first hand.', progress: (p) => [Math.min(1, p.hands), 1] },
  { id: 'first-win', name: 'First Blood', desc: 'Win your first pot.', progress: (p) => [Math.min(1, p.handsWon), 1] },
  { id: 'hands-100', name: 'Regular', desc: 'Play 100 hands.', progress: (p) => [Math.min(100, p.hands), 100] },
  { id: 'hands-1000', name: 'Grinder', desc: 'Play 1,000 hands.', progress: (p) => [Math.min(1000, p.hands), 1000] },
  { id: 'won-50', name: 'Pot Collector', desc: 'Win 50 pots.', progress: (p) => [Math.min(50, p.handsWon), 50] },
  { id: 'streak-5', name: 'Heater', desc: 'Win 5 hands in a row.', progress: (p) => [Math.min(5, p.bestStreak), 5] },
  { id: 'big-pot', name: 'Monster Pot', desc: 'Win a pot of 100 big blinds or more.', progress: (p) => [Math.min(100, Math.round(p.biggestPotBB)), 100] },
  { id: 'full-house', name: 'Full Boat', desc: 'Win a hand with a Full House or better.', progress: (p) => [p.bestHand && category(p.bestHand.score) >= Cat.FullHouse ? 1 : 0, 1] },
  { id: 'quads', name: 'Four of a Kind', desc: 'Win with Four of a Kind or better.', progress: (p) => [p.bestHand && category(p.bestHand.score) >= Cat.Quads ? 1 : 0, 1] },
  { id: 'straight-flush', name: 'Straight Flush', desc: 'Win with a Straight Flush.', progress: (p) => [p.bestHand && category(p.bestHand.score) >= Cat.StraightFlush ? 1 : 0, 1] },
  { id: 'all-in-win', name: 'All or Nothing', desc: 'Win 5 all-in showdowns.', progress: (p) => [Math.min(5, p.allInsWon), 5] },
  { id: 'bluff', name: 'Poker Face', desc: 'Win 10 pots without showdown after betting or raising on the river.', progress: (p) => [Math.min(10, p.bluffsWon), 10] },
  { id: 'sng-win', name: 'Champion', desc: 'Win a Sit & Go tournament.', progress: (p) => [Math.min(1, p.sngWon), 1] },
  { id: 'sng-5', name: 'Tournament Shark', desc: 'Win 5 Sit & Go tournaments.', progress: (p) => [Math.min(5, p.sngWon), 5] },
  { id: 'profit-100', name: 'In the Black', desc: 'Be up 100 big blinds lifetime.', progress: (p) => [Math.max(0, Math.min(100, Math.round(p.netBB))), 100] },
  { id: 'trainer', name: 'Student of the Game', desc: 'Answer 50 trainer questions correctly.', progress: (p) => [Math.min(50, p.trainer.preflop[0] + p.trainer.potOdds[0] + p.trainer.outs[0]), 50] },
];

/** Update the profile from a completed hand. Returns ids of newly unlocked achievements. */
export function recordHand(h: HandState, humanIdx: number, opponentsMeta: Record<string, { archetype?: string }>): string[] {
  const p = { ...profileStore.get() };
  const flags = analyzeHand(h)[humanIdx];
  const me = h.players[humanIdx];
  const net = me.stack - me.startStack;
  const bb = h.config.bb;
  p.hands++;
  if (flags.vpip) p.vpip++;
  if (flags.pfr) p.pfr++;
  if (flags.threeBetOpp) p.threeBetOpp++;
  if (flags.threeBet) p.threeBet++;
  if (flags.sawFlop) p.sawFlop++;
  if (flags.wtsd) p.wtsd++;
  if (flags.wonSd) p.wsd++;
  p.bets += flags.bets;
  p.calls += flags.calls;
  p.netChips += net;
  p.netBB += net / bb;
  const won = h.winners.includes(humanIdx);
  if (won && net > 0) {
    p.handsWon++;
    p.streak = p.streak >= 0 ? p.streak + 1 : 1;
    const pot = h.players.reduce((a, x) => a + x.total, 0);
    if (pot > p.biggestPot) p.biggestPot = pot;
    if (pot / bb > p.biggestPotBB) p.biggestPotBB = pot / bb;
    if (h.board.length >= 3 && h.events.some((e) => e.t === 'show' && e.p === humanIdx)) {
      const sc = handScore(h, humanIdx);
      if (!p.bestHand || sc > p.bestHand.score) p.bestHand = { score: sc, name: describeScore(sc) };
      p.showdownsWon++;
      if (me.allIn || h.players.some((x, i) => i !== humanIdx && x.allIn && !x.folded)) p.allInsWon++;
    }
    const showed = h.events.some((e) => e.t === 'show');
    const riverAggr = h.riverAggressor === humanIdx;
    if (!showed && riverAggr) p.bluffsWon++;
  } else if (net < 0) {
    p.streak = p.streak <= 0 ? p.streak - 1 : -1;
  }
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.worstStreak = Math.min(p.worstStreak, p.streak);
  const last = p.bankroll[p.bankroll.length - 1] ?? 0;
  p.bankroll = [...p.bankroll, Math.round((last + net / bb) * 10) / 10];
  if (p.bankroll.length > 3000) p.bankroll = p.bankroll.filter((_, i) => i % 2 === 0);
  p.opponents = { ...p.opponents };
  h.players.forEach((o, i) => {
    if (i === humanIdx) return;
    const rec = { ...(p.opponents[o.name] ?? { hands: 0, net: 0 }) };
    rec.hands++;
    // chips the human won from / lost to this opponent (approximation: share of the net)
    rec.net -= o.stack - o.startStack;
    rec.archetype = opponentsMeta[o.id]?.archetype ?? rec.archetype;
    p.opponents[o.name] = rec;
  });
  const unlocked = checkAchievements(p);
  profileStore.set(p);
  saveProfile();
  return unlocked;
}

export function checkAchievements(p: Profile): string[] {
  const out: string[] = [];
  p.achievements = { ...p.achievements };
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    const [v, max] = a.progress(p);
    if (v >= max) {
      p.achievements[a.id] = Date.now();
      out.push(a.id);
    }
  }
  return out;
}

export function recordTournament(place: number, entrants: number, paid: number) {
  const p = { ...profileStore.get() };
  p.sngPlayed++;
  if (place === 1) p.sngWon++;
  if (place <= paid) p.sngCashes++;
  const un = checkAchievements(p);
  profileStore.set(p);
  saveProfile();
  void entrants;
  return un;
}

export function recordTrainer(kind: 'preflop' | 'potOdds' | 'outs', correct: boolean) {
  const p = { ...profileStore.get() };
  p.trainer = { ...p.trainer, [kind]: [p.trainer[kind][0] + (correct ? 1 : 0), p.trainer[kind][1] + 1] };
  const un = checkAchievements(p);
  profileStore.set(p);
  saveProfile();
  return un;
}

export function pct(n: number, d: number) {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}
