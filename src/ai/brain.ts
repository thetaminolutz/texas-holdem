// Layered poker decision system: math layer (ranges, Monte Carlo equity, pot odds, texture), strategy layer
// (mixed strategies, value/bluff balance, exploitation) and personality layer (archetypes, tilt, mistakes, timing).
// Uses ONLY information in BotView (public info + own hole cards).
import type { BotContext, BotView, Decision, OpponentStats, PublicAction } from './types';
import type { Rng } from '../engine/rng';
import { evaluate, category, Cat } from '../engine/evaluator';
import { rankOf, suitOf } from '../engine/cards';
import { handPercentile, percentileBand, fullRange, updatePostflop, equityVsRanges, drawStrength, boardTexture, comboStrengths, comboIndex, removeDead, type Range } from './range';
import { pickTalk } from './characters';
import type { Difficulty } from './difficulty';

interface DiffParams {
  iters: number;
  noise: number; // equity estimation noise (sd)
  mistake: number; // probability of a random (sub-optimal) deviation
  rangeRead: number; // 0 = assumes random hands, 1 = full range reading
  exploit: number; // use of opponent statistics
  potOdds: number; // how much pot odds are respected (0..1)
  bluffSkill: number; // quality of bluff selection
  tells: boolean; // weak players leak sizing/timing tells
  think: [number, number]; // ms range
}

export const DIFF: Record<Difficulty, DiffParams> = {
  beginner: { iters: 0, noise: 0.16, mistake: 0.22, rangeRead: 0, exploit: 0, potOdds: 0.25, bluffSkill: 0.1, tells: true, think: [500, 1800] },
  easy: { iters: 120, noise: 0.1, mistake: 0.12, rangeRead: 0.3, exploit: 0, potOdds: 0.55, bluffSkill: 0.3, tells: true, think: [700, 2200] },
  medium: { iters: 300, noise: 0.05, mistake: 0.05, rangeRead: 0.7, exploit: 0.3, potOdds: 0.85, bluffSkill: 0.6, tells: false, think: [800, 2800] },
  hard: { iters: 600, noise: 0.025, mistake: 0.02, rangeRead: 0.9, exploit: 0.7, potOdds: 1, bluffSkill: 0.85, tells: false, think: [900, 3200] },
  expert: { iters: 1000, noise: 0.012, mistake: 0.006, rangeRead: 1, exploit: 1, potOdds: 1, bluffSkill: 1, tells: false, think: [900, 3600] },
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Bayesian-smoothed frequency. */
export function smooth(count: number, opp: number, prior: number, weight = 8) {
  return (count + prior * weight) / (opp + weight);
}

export function opponentProfile(st: OpponentStats | undefined) {
  if (!st) return { vpip: 0.3, pfr: 0.18, af: 1.8, foldToCbet: 0.45, foldTo3: 0.55, wtsd: 0.3, threeBet: 0.07, hands: 0 };
  return {
    vpip: smooth(st.vpip, st.hands, 0.3),
    pfr: smooth(st.pfr, st.hands, 0.18),
    af: (st.bets + 1.8 * 4) / (st.calls + 4),
    foldToCbet: smooth(st.foldToCbet, st.foldToCbetOpp, 0.45),
    foldTo3: smooth(st.foldTo3, st.foldTo3Opp, 0.55),
    wtsd: smooth(st.wtsd, st.wtsdOpp, 0.3),
    threeBet: smooth(st.threeBet, st.threeBetOpp, 0.07),
    hands: st.hands,
  };
}

function gauss(rng: Rng) {
  return Math.sqrt(-2 * Math.log(rng.next() + 1e-9)) * Math.cos(2 * Math.PI * rng.next());
}

/** Number of players yet to act after `me` preflop in an unopened pot (incl. blinds). */
function playersBehindPreflop(v: BotView): number {
  const n = v.players.length;
  let k = 0;
  for (let i = 1; i < n; i++) {
    const idx = (v.me + i) % n;
    if (v.players[idx].folded) continue;
    // stop when we wrap to the first preflop actor (left of BB)
    if (idx === (v.bbIdx + 1) % n) break;
    k++;
  }
  return k;
}

export const OPEN_BY_BEHIND = [1, 0.62, 0.46, 0.31, 0.25, 0.2, 0.17, 0.15, 0.13, 0.12];

interface PreflopSummary {
  raises: number;
  callers: number;
  limpers: number;
  lastRaiser: number | null;
  lastRaiseTo: number;
  myActions: number;
  raiserBehind: number;
}

function summarizePreflop(v: BotView): PreflopSummary {
  let raises = 0,
    callers = 0,
    limpers = 0,
    lastRaiser: number | null = null,
    lastRaiseTo = v.bb,
    myActions = 0;
  for (const a of v.actions) {
    if (a.street !== 'preflop') continue;
    if (a.p === v.me) myActions++;
    if (a.type === 'raise' || a.type === 'bet' || (a.type === 'allin' && a.to > lastRaiseTo)) {
      raises++;
      callers = 0;
      lastRaiser = a.p;
      lastRaiseTo = a.to;
    } else if (a.type === 'call' || (a.type === 'allin' && a.to <= lastRaiseTo)) {
      if (raises === 0) limpers++;
      else callers++;
    }
  }
  return { raises, callers, limpers, lastRaiser, lastRaiseTo, myActions, raiserBehind: 0 };
}

/** Estimate a player's range from their observed actions this hand (public information only). */
function estimateRange(v: BotView, p: number, readSkill: number, opp: ReturnType<typeof opponentProfile>): Range {
  if (readSkill <= 0) return fullRange();
  const loose = clamp(opp.vpip / 0.3, 0.5, 2.2);
  let r = fullRange();
  // preflop
  const pre = v.actions.filter((a) => a.street === 'preflop');
  let raisesBefore = 0;
  let lastTo = v.bb;
  let band: [number, number] | null = null;
  for (const a of pre) {
    const isRaise = a.to > lastTo && (a.type === 'raise' || a.type === 'bet' || a.type === 'allin');
    if (a.p === p) {
      if (isRaise) band = raisesBefore === 0 ? [0, clamp(0.22 * loose, 0.06, 0.6)] : raisesBefore === 1 ? [0, clamp(0.07 * loose, 0.025, 0.25)] : [0, 0.035];
      else if (a.type === 'call' || a.type === 'allin') band = raisesBefore === 0 ? [0.06, clamp(0.55 * loose, 0.3, 1)] : raisesBefore === 1 ? [0.02, clamp(0.3 * loose, 0.12, 0.6)] : [0.01, 0.1];
      else if (a.type === 'check') band = [0.08, 1];
    }
    if (isRaise) {
      raisesBefore++;
      lastTo = a.to;
    }
  }
  if (band) r = percentileBand(band[0], band[1], 0.06);
  // postflop actions re-weight by board strength at that time
  const streets: ('flop' | 'turn' | 'river')[] = ['flop', 'turn', 'river'];
  const boardAt = { flop: v.board.slice(0, 3), turn: v.board.slice(0, 4), river: v.board.slice(0, 5) };
  for (const st of streets) {
    const b = boardAt[st];
    if (b.length < (st === 'flop' ? 3 : st === 'turn' ? 4 : 5) || v.board.length < b.length) continue;
    for (const a of v.actions.filter((x) => x.street === st && x.p === p)) {
      const bluffy = clamp((opp.af - 1) * 0.08 + 0.1, 0.05, 0.4);
      if (a.type === 'bet') updatePostflop(r, b, 'bet', bluffy);
      else if (a.type === 'raise' || a.type === 'allin') updatePostflop(r, b, 'raise', bluffy);
      else if (a.type === 'call') updatePostflop(r, b, 'call', bluffy);
      else if (a.type === 'check') updatePostflop(r, b, 'check', bluffy);
    }
  }
  if (readSkill < 1) {
    for (let i = 0; i < 1326; i++) r[i] = r[i] * readSkill + (1 - readSkill) * 0.5;
  }
  return r;
}

function lastAggressorPreflop(v: BotView): number | null {
  let last: number | null = null;
  let to = v.bb;
  for (const a of v.actions) if (a.street === 'preflop' && a.to > to && a.type !== 'call') {
    last = a.p;
    to = a.to;
  }
  return last;
}

function roundBet(x: number, v: BotView) {
  const unit = v.bb >= 100 ? v.bb / 4 : v.bb >= 20 ? 5 : 1;
  return Math.round(x / unit) * unit;
}

/** Turn a desired "raise to" amount into a legal action. */
function betTo(v: BotView, to: number): Decision['action'] {
  const L = v.legal;
  if (!L.canRaise) return L.canCall ? { type: 'call' } : { type: 'check' };
  let amt = roundBet(to, v);
  amt = clamp(amt, L.minTo, L.maxTo);
  // if almost all-in, just go all-in
  const me = v.players[v.me];
  if (amt >= (me.committed + me.stack) * 0.85) amt = me.committed + me.stack;
  amt = Math.min(amt, L.maxTo);
  return { type: L.isBet ? 'bet' : 'raise', amount: amt };
}

function passive(v: BotView): Decision['action'] {
  return v.legal.canCheck ? { type: 'check' } : { type: 'fold' };
}

export function decide(v: BotView, ctx: BotContext, rng: Rng): Decision {
  const D = DIFF[ctx.difficulty];
  const tilt = ctx.tilt;
  const P = {
    ...ctx.personality,
    vpip: clamp(ctx.personality.vpip * (1 + tilt * 0.6), 0.05, 0.9),
    aggr: clamp(ctx.personality.aggr + tilt * 0.2, 0, 1),
    bluff: ctx.personality.bluff * (1 + tilt * 0.8),
    sticky: clamp(ctx.personality.sticky + tilt * 0.25, 0, 1),
  };
  const res = v.street === 'preflop' ? preflop(v, ctx, D, P, rng) : postflop(v, ctx, D, P, rng);
  // controlled human-like mistakes
  if (rng.next() < D.mistake) {
    const L = v.legal;
    const r = rng.next();
    if (res.action.type === 'fold' && L.canCall && r < 0.6) res.action = { type: 'call' };
    else if ((res.action.type === 'call' || res.action.type === 'check') && L.canRaise && r < 0.25) res.action = betTo(v, L.minTo + (L.pot * 0.5));
    else if (res.action.type === 'raise' && L.canCall && r < 0.5) res.action = { type: 'call' };
    res.reason = (res.reason ?? '') + ' (mistake)';
  }
  // timing (with tells for weak bots)
  const [lo, hi] = D.think;
  let t = lo + rng.next() * (hi - lo);
  const close = res.closeness ?? 0.5;
  t *= 0.6 + close * 0.9;
  if (v.legal.canCheck && res.action.type === 'check') t *= 0.6;
  if (D.tells) {
    if ((res.equity ?? 0) > 0.8 && res.action.type !== 'check') t *= 1.6; // "Hollywooding" strong hands
    if (res.action.type === 'call' && (res.draw ?? 0) > 0.4) t *= 0.5; // quick calls with draws
  }
  if (v.street === 'preflop' && res.action.type === 'fold') t *= 0.5;
  t *= 0.85 + gauss(rng) * 0.12;
  // table talk
  let talk: string | undefined;
  if (rng.next() < P.chatty * 0.12) {
    const a = res.action;
    const me = v.players[v.me];
    if (a.type === 'raise' || a.type === 'bet') talk = (a.amount ?? 0) >= me.committed + me.stack ? pickTalk('allin', rng.next()) : (a.amount ?? 0) > v.pot ? pickTalk('bigbet', rng.next()) : undefined;
    else if (a.type === 'fold' && rng.next() < 0.4) talk = pickTalk('fold', rng.next());
    else if (a.type === 'call' && rng.next() < 0.3) talk = pickTalk('call', rng.next());
    if (tilt > 0.5 && rng.next() < 0.5) talk = pickTalk('tilt', rng.next());
  }
  return { action: res.action, thinkMs: Math.round(clamp(t, 250, 9000)), talk, reason: res.reason, equity: res.equity };
}

interface Partial {
  action: Decision['action'];
  reason?: string;
  equity?: number;
  closeness?: number;
  draw?: number;
}

function effStackBB(v: BotView): number {
  const me = v.players[v.me];
  let maxOther = 0;
  v.players.forEach((p, i) => {
    if (i !== v.me && !p.folded) maxOther = Math.max(maxOther, p.stack + p.committed);
  });
  return Math.min(me.stack + me.committed, maxOther) / v.bb;
}

function preflop(v: BotView, ctx: BotContext, D: DiffParams, P: BotContext['personality'], rng: Rng): Partial {
  const [a, b] = v.hole;
  const pct = clamp(handPercentile(a, b) + gauss(rng) * D.noise * 0.25, 0, 1);
  const L = v.legal;
  const me = v.players[v.me];
  const s = summarizePreflop(v);
  const behind = playersBehindPreflop(v);
  const eff = effStackBB(v);
  const looseK = clamp(P.vpip / 0.25, 0.4, 2.6);
  const suited = suitOf(a) === suitOf(b);
  const pair = rankOf(a) === rankOf(b);
  const connected = Math.abs(rankOf(a) - rankOf(b)) <= 2;
  const speculative = pair || (suited && connected) || (suited && Math.max(rankOf(a), rankOf(b)) === 12);
  const isBB = v.me === v.bbIdx;
  const isSB = v.me === v.sbIdx;
  const tourney = v.tournament;
  let bubbleTight = 1;
  if (tourney?.bubble && me.stack < tourney.avgStack * 1.5 && me.stack > tourney.avgStack * 0.4) bubbleTight = 0.7;
  const openPct = clamp(OPEN_BY_BEHIND[Math.min(behind, 9)] * looseK, 0.05, 0.95);
  const raiseSize = (base: number) => base * v.bb * P.sizing * (1 + 0.1 * gauss(rng));

  // ---------- short-stack push/fold (tournaments and short cash stacks) ----------
  if (eff <= 13 && D.rangeRead > 0) {
    if (s.raises === 0) {
      const pushPct = clamp(openPct * (1.1 + (13 - eff) * 0.06), 0.06, 0.85) * (looseK > 1.3 ? 1.15 : 1);
      if (pct <= pushPct) return { action: betTo(v, me.committed + me.stack), reason: `push/fold: shove ${Math.round(eff)}bb`, equity: 1 - pct, closeness: 0.3 };
      return { action: passive(v), reason: 'push/fold: fold', closeness: 0.2 };
    }
    const toCall = L.toCall;
    const odds = toCall / (L.pot + toCall);
    const callPct = clamp((0.08 + odds * 0.35) * looseK * bubbleTight * (s.raises > 1 ? 0.6 : 1), 0.03, 0.5);
    if (pct <= callPct * 0.5 && L.canRaise) return { action: betTo(v, me.committed + me.stack), reason: 'push over', closeness: 0.3 };
    if (pct <= callPct) return { action: { type: 'call' }, reason: 'call shove range', closeness: 0.5 };
    return { action: passive(v), reason: 'fold vs shove', closeness: 0.4 };
  }

  // ---------- unopened or limped ----------
  if (s.raises === 0) {
    if (isBB && L.canCheck) {
      if (pct < 0.1 * looseK && rng.next() < 0.7 * P.aggr + 0.2) return { action: betTo(v, raiseSize(3) + s.limpers * v.bb), reason: 'raise limpers from BB', closeness: 0.4 };
      return { action: { type: 'check' }, reason: 'check option', closeness: 0.1 };
    }
    if (s.limpers === 0) {
      if (pct <= openPct) {
        // passive archetypes sometimes limp
        if (P.aggr < 0.35 && rng.next() < 0.6 - P.aggr) return { action: L.canCall ? { type: 'call' } : { type: 'check' }, reason: 'limp (passive style)', closeness: 0.3 };
        const size = isSB ? raiseSize(3) : behind >= 5 ? raiseSize(2.5) : raiseSize(2.3);
        return { action: betTo(v, size), reason: `open raise (top ${Math.round(openPct * 100)}%)`, equity: 1 - pct, closeness: Math.abs(pct - openPct) < 0.05 ? 0.8 : 0.3 };
      }
      if (isSB && pct < 0.7 * looseK && P.aggr < 0.5) return { action: { type: 'call' }, reason: 'SB complete', closeness: 0.4 };
      return { action: passive(v), reason: 'fold (outside opening range)', closeness: 0.1 };
    }
    // limpers in front: iso-raise or over-limp
    if (pct <= openPct * 0.65) return { action: betTo(v, raiseSize(3.5) + s.limpers * v.bb), reason: 'isolation raise', closeness: 0.4 };
    if (pct <= openPct * 1.3 && (speculative || looseK > 1.2)) return { action: L.canCall ? { type: 'call' } : { type: 'check' }, reason: 'over-limp with implied odds', closeness: 0.4 };
    if (isSB && pct < 0.6) return { action: { type: 'call' }, reason: 'complete SB', closeness: 0.3 };
    return { action: passive(v), reason: 'fold to limpers', closeness: 0.2 };
  }

  // ---------- facing raise(s) ----------
  const raiser = s.lastRaiser ?? 0;
  const opp = D.exploit > 0 ? opponentProfile(ctx.opponents[v.players[raiser].id]) : opponentProfile(undefined);
  const raiserLoose = clamp(opp.pfr / 0.18, 0.5, 2.5) * (D.exploit > 0 ? 1 : 1);
  const toCall = L.toCall;
  const priceBB = toCall / v.bb;
  const odds = toCall / (L.pot + toCall);
  const inPosition = !isBB && !isSB;
  if (s.raises === 1) {
    const valuePct = clamp(0.035 * Math.sqrt(raiserLoose) * (s.callers > 0 ? 0.9 : 1) * (0.8 + P.aggr * 0.4), 0.02, 0.09);
    const bluff3 = D.bluffSkill * P.bluff * 0.06 * (inPosition ? 1.2 : 0.8) * (D.exploit > 0 && opp.foldTo3 > 0.6 ? 1.6 : 1);
    const blocker = (rankOf(a) === 12 || rankOf(b) === 12) && suited;
    if (pct <= valuePct) {
      const size = inPosition ? s.lastRaiseTo * 3 : s.lastRaiseTo * 3.6;
      return { action: betTo(v, size + s.callers * s.lastRaiseTo), reason: s.callers ? 'squeeze for value' : '3-bet for value', equity: 1 - pct, closeness: 0.3 };
    }
    if ((blocker || (suited && connected)) && pct < 0.45 && rng.next() < bluff3) {
      return { action: betTo(v, s.lastRaiseTo * (inPosition ? 3 : 3.6) + s.callers * s.lastRaiseTo), reason: '3-bet bluff with blockers', closeness: 0.6 };
    }
    let callPct = clamp((0.09 + odds * 0.25) * Math.sqrt(raiserLoose) * looseK * bubbleTight, 0.03, 0.6);
    if (isBB) callPct *= 1.6; // already invested, great price
    if (inPosition) callPct *= 1.15;
    if (speculative && eff > 40 && priceBB < eff * 0.08) callPct *= 1.3; // implied odds
    if (priceBB > eff * 0.3) callPct *= 0.6;
    callPct *= 0.75 + P.sticky * 0.5;
    if (pct <= callPct) return { action: { type: 'call' }, reason: 'call open (in range)', equity: 1 - pct, closeness: Math.abs(pct - callPct) < 0.05 ? 0.9 : 0.4 };
    return { action: { type: 'fold' }, reason: 'fold to raise', closeness: Math.abs(pct - callPct) < 0.04 ? 0.8 : 0.15 };
  }
  // facing 3-bet or more
  const fourPct = s.raises === 2 ? 0.025 * clamp(raiserLoose, 0.7, 1.8) : 0.012;
  if (pct <= fourPct) {
    const size = eff < 60 ? me.committed + me.stack : s.lastRaiseTo * 2.3;
    return { action: betTo(v, size), reason: s.raises === 2 ? '4-bet for value' : '5-bet jam', equity: 1 - pct, closeness: 0.4 };
  }
  let callPct = clamp((0.035 + odds * 0.12) * looseK * (0.7 + P.sticky * 0.6) * bubbleTight, 0.015, 0.2);
  if (s.myActions > 0) callPct *= 1.4; // already invested
  if (pct <= callPct) return { action: { type: 'call' }, reason: 'call 3-bet', closeness: 0.7 };
  if (s.raises === 2 && D.bluffSkill > 0.7 && rng.next() < 0.03 * P.bluff && (rankOf(a) === 12 || rankOf(b) === 12) && eff > 60) {
    return { action: betTo(v, s.lastRaiseTo * 2.3), reason: '4-bet bluff (ace blocker)', closeness: 0.9 };
  }
  return { action: { type: 'fold' }, reason: 'fold to 3-bet', closeness: 0.3 };
}

function postflop(v: BotView, ctx: BotContext, D: DiffParams, P: BotContext['personality'], rng: Rng): Partial {
  const L = v.legal;
  const me = v.players[v.me];
  const board = v.board;
  const hole = v.hole;
  const opps = v.players.map((p, i) => ({ p, i })).filter((x) => x.i !== v.me && !x.p.folded);
  const nOpp = opps.length;
  const texture = boardTexture(board);
  const draw = drawStrength(hole, board);
  const myScore = evaluate([...hole, ...board]);
  const cat = category(myScore);
  const boardScore = board.length >= 5 ? evaluate(board) : -1;
  const strength = comboStrengths(board)[comboIndex(hole[0], hole[1])];
  // ----- equity vs estimated ranges -----
  let equity: number;
  if (D.iters === 0) {
    // beginner: rough heuristic from own hand only
    equity = clamp(Math.pow(strength, 1 + nOpp * 0.35) + draw * 0.25, 0, 1);
  } else {
    const ranges = opps.map((o) => {
      const prof = opponentProfile(ctx.opponents[o.p.id]);
      const r = estimateRange(v, o.i, D.rangeRead, prof);
      removeDead(r, [...hole, ...board]);
      return r;
    });
    const iters = Math.round(D.iters / Math.max(1, Math.sqrt(nOpp) * 0.8));
    equity = equityVsRanges(hole, board, ranges, iters, rng);
  }
  equity = clamp(equity + gauss(rng) * D.noise, 0, 1);
  const pot = L.pot;
  const toCall = L.toCall;
  const streetIdx = board.length === 3 ? 0 : board.length === 4 ? 1 : 2;
  const river = streetIdx === 2;
  const spr = me.stack / Math.max(1, pot);
  const aggressorPre = lastAggressorPreflop(v);
  const iAmPfa = aggressorPre === v.me;
  const myStreetActions = v.actions.filter((a) => a.street === v.street && a.p === v.me);
  const checkedThisStreet = myStreetActions.some((a) => a.type === 'check');
  // aggregate opponent tendencies (only for exploiting difficulties)
  const profs = opps.map((o) => opponentProfile(ctx.opponents[o.p.id]));
  const avgFoldCbet = profs.reduce((x, p) => x + p.foldToCbet, 0) / Math.max(1, profs.length);
  const avgAf = profs.reduce((x, p) => x + p.af, 0) / Math.max(1, profs.length);
  const avgWtsd = profs.reduce((x, p) => x + p.wtsd, 0) / Math.max(1, profs.length);
  const nutted = cat >= Cat.Straight && myScore > boardScore;
  const sizeFor = (kind: 'value' | 'bluff' | 'protect' | 'cbet' | 'thin') => {
    let f = 0.5;
    if (kind === 'cbet') f = texture.wet > 0.45 ? 0.6 : 0.33;
    else if (kind === 'protect') f = 0.7;
    else if (kind === 'thin') f = 0.4;
    else if (kind === 'value') f = texture.wet > 0.5 ? 0.75 : 0.6;
    else if (kind === 'bluff') f = river ? 0.7 : 0.55;
    if (river && (kind === 'value' || kind === 'bluff') && D.bluffSkill > 0.7 && rng.next() < 0.18) f = 1.25; // polar overbet
    f *= P.sizing;
    if (D.tells) f *= kind === 'value' ? 1.3 : kind === 'bluff' ? 0.6 : 1; // sizing tells
    f *= 1 + gauss(rng) * 0.08;
    return clamp(f, 0.25, 1.6);
  };

  // ---------- no bet to us ----------
  if (L.canCheck) {
    const valueTh = (river ? 0.6 : 0.64) + (nOpp - 1) * 0.04 - P.aggr * 0.05;
    if (equity > valueTh) {
      if (equity > 0.85 && !river && rng.next() < P.trap * 0.55 && texture.wet < 0.5) return { action: { type: 'check' }, reason: 'slow-play / trap', equity, closeness: 0.4 };
      const kind = equity > 0.8 ? 'value' : texture.wet > 0.5 ? 'protect' : 'thin';
      return { action: betTo(v, pot * sizeFor(kind)), reason: `${kind} bet (equity ${(equity * 100).toFixed(0)}%)`, equity, closeness: 0.3, draw };
    }
    // semi-bluff with draws
    if (draw >= 0.4 && !river && rng.next() < (0.35 + P.aggr * 0.4) * Math.min(1.5, P.bluff)) {
      return { action: betTo(v, pot * sizeFor('bluff')), reason: 'semi-bluff with a draw', equity, closeness: 0.5, draw };
    }
    // continuation bet as preflop aggressor
    if (iAmPfa && streetIdx === 0 && !checkedThisStreet && nOpp <= 2) {
      let freq = 0.45 + P.aggr * 0.3 - texture.wet * 0.25 - (nOpp - 1) * 0.2;
      if (D.exploit > 0) freq += (avgFoldCbet - 0.45) * D.exploit * 0.8;
      if (rng.next() < clamp(freq, 0.1, 0.9)) return { action: betTo(v, pot * sizeFor('cbet')), reason: 'continuation bet', equity, closeness: 0.4, draw };
    }
    // barrel / probe / pure bluff: balanced against value range, using fold equity
    const foldEq = D.exploit > 0 ? clamp(avgFoldCbet * (1 - avgWtsd * 0.6), 0.1, 0.85) : 0.4;
    const bluffFreq = clamp(P.bluff * D.bluffSkill * 0.22 * foldEq * (nOpp === 1 ? 1.4 : 0.4) * (texture.paired ? 1.2 : 1), 0, 0.45);
    const blockerish = hole.some((c) => rankOf(c) >= 11) || (texture.monotone && hole.some((c) => board.filter((x) => suitOf(x) === suitOf(c)).length >= 3 && rankOf(c) >= 10));
    if (equity < 0.35 && rng.next() < bluffFreq * (blockerish ? 1.4 : 0.8) && (river || streetIdx === 1 || iAmPfa)) {
      return { action: betTo(v, pot * sizeFor('bluff')), reason: river ? 'river bluff (blockers, fold equity)' : 'barrel bluff', equity, closeness: 0.7 };
    }
    // weak players stab more randomly
    if (D.tells && rng.next() < 0.08 * P.aggr) return { action: betTo(v, pot * 0.4), reason: 'random stab', equity, closeness: 0.5 };
    return { action: { type: 'check' }, reason: 'check', equity, closeness: Math.abs(equity - valueTh) < 0.06 ? 0.6 : 0.2 };
  }

  // ---------- facing a bet ----------
  const required = toCall / (pot + toCall);
  const allInCall = toCall >= me.stack;
  // implied odds for draws (not on the river, deep stacks)
  const implied = !river && !allInCall && draw > 0.3 ? clamp(spr * 0.04, 0, 0.12) * D.potOdds : 0;
  // reverse implied odds for weak made hands on wet boards
  const reverse = cat <= Cat.Pair && texture.wet > 0.5 ? 0.04 : 0;
  // exploitative bluff-catching: aggressive opponents bluff more
  const bettor = [...v.actions].reverse().find((a: PublicAction) => a.street === v.street && (a.type === 'bet' || a.type === 'raise' || a.type === 'allin'));
  const bp = bettor ? opponentProfile(ctx.opponents[v.players[bettor.p].id]) : opponentProfile(undefined);
  let bluffAdj = 0;
  if (D.exploit > 0) bluffAdj = clamp((bp.af - 1.8) * 0.03, -0.06, 0.08) * D.exploit;
  const stickyAdj = (P.sticky - 0.4) * 0.12;
  // weak players don't respect pot odds properly
  const req = required * D.potOdds + (1 - D.potOdds) * 0.33;
  const callScore = equity + implied - reverse + bluffAdj + stickyAdj;
  const raiseTh = (river ? 0.82 : 0.74) + (nOpp - 1) * 0.05 - P.aggr * 0.06;
  // value raise
  if (equity > raiseTh && L.canRaise) {
    if (!river && nutted && rng.next() < P.trap * 0.4) return { action: { type: 'call' }, reason: 'flat with a monster (trap)', equity, closeness: 0.5 };
    const to = v.currentBet * 2.6 + (pot - v.currentBet) * 0.4 * P.sizing;
    return { action: betTo(v, to), reason: `raise for value (equity ${(equity * 100).toFixed(0)}%)`, equity, closeness: 0.3, draw };
  }
  // semi-bluff raise with strong draws (check-raise if we checked)
  if (!river && draw >= 0.55 && L.canRaise && !allInCall && rng.next() < (0.18 + P.aggr * 0.3) * P.bluff * D.bluffSkill) {
    return { action: betTo(v, v.currentBet * 2.8), reason: checkedThisStreet ? 'check-raise semi-bluff' : 'raise semi-bluff', equity, closeness: 0.7, draw };
  }
  // occasional river bluff-raise by tricky players
  if (river && equity < 0.2 && L.canRaise && nOpp === 1 && rng.next() < 0.03 * P.bluff * D.bluffSkill) {
    return { action: betTo(v, v.currentBet * 3), reason: 'river bluff-raise', equity, closeness: 0.9 };
  }
  // MDF on the river: defend enough of our range vs. small bets
  const mdf = pot / (pot + toCall);
  if (river && D.exploit > 0.5 && callScore < req && callScore > req - 0.08 && strength > 1 - mdf * 0.85 && rng.next() < 0.5) {
    return { action: { type: 'call' }, reason: 'bluff-catch (MDF)', equity, closeness: 0.9 };
  }
  // hero fold vs tight opponents' big river bets
  if (river && D.exploit > 0.6 && bp.af < 1.2 && toCall > pot * 0.6 && callScore < req + 0.08 && callScore > req && rng.next() < 0.6) {
    return { action: { type: 'fold' }, reason: 'hero fold vs a tight player', equity, closeness: 0.95 };
  }
  if (callScore >= req) return { action: { type: 'call' }, reason: `call (equity ${(equity * 100).toFixed(0)}% vs price ${(required * 100).toFixed(0)}%)`, equity, closeness: Math.abs(callScore - req) < 0.05 ? 0.9 : 0.4, draw };
  // stations call anyway sometimes
  if (rng.next() < P.sticky * 0.25 * (1 - required)) return { action: { type: 'call' }, reason: 'sticky call', equity, closeness: 0.6 };
  return { action: { type: 'fold' }, reason: `fold (equity ${(equity * 100).toFixed(0)}% < ${(required * 100).toFixed(0)}%)`, equity, closeness: Math.abs(callScore - req) < 0.05 ? 0.85 : 0.2 };
}

/** Coach helper: recommended action for the human with an explanation (uses the expert brain, Pro style). */
export function coachAdvice(v: BotView, opponents: BotContext['opponents'], rng: Rng): Decision {
  const ctx: BotContext = {
    archetype: 'Pro',
    difficulty: 'expert',
    personality: { vpip: 0.25, aggr: 0.65, bluff: 0.8, sticky: 0.4, trap: 0.15, sizing: 1, tiltProne: 0, chatty: 0 },
    tilt: 0,
    confidence: 0,
    opponents,
    seed: 1,
  };
  return decide(v, ctx, rng);
}
