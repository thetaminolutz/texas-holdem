// Tracks observable statistics per player (VPIP, PFR, 3-bet, c-bet, fold-to-c-bet, AF, WTSD, W$SD, check-raise).
// Fed only with public information from completed hands (shown cards are not needed).
import type { HandState } from '../engine/game';
import type { OpponentStats } from './types';

export function emptyStats(): OpponentStats {
  return { hands: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0, foldTo3Opp: 0, foldTo3: 0, cbetOpp: 0, cbet: 0, foldToCbetOpp: 0, foldToCbet: 0, bets: 0, calls: 0, wtsdOpp: 0, wtsd: 0, wsd: 0, xrOpp: 0, xr: 0 };
}

/** Per-hand observable flags for every player (used both for bot models and the human's lifetime stats). */
export interface HandFlags {
  vpip: boolean;
  pfr: boolean;
  threeBetOpp: boolean;
  threeBet: boolean;
  foldTo3Opp: boolean;
  foldTo3: boolean;
  cbetOpp: boolean;
  cbet: boolean;
  foldToCbetOpp: boolean;
  foldToCbet: boolean;
  bets: number;
  calls: number;
  sawFlop: boolean;
  wtsd: boolean;
  wonSd: boolean;
  xrOpp: boolean;
  xr: boolean;
  won: boolean;
}

export function analyzeHand(h: HandState): HandFlags[] {
  const n = h.players.length;
  const f: HandFlags[] = h.players.map(() => ({ vpip: false, pfr: false, threeBetOpp: false, threeBet: false, foldTo3Opp: false, foldTo3: false, cbetOpp: false, cbet: false, foldToCbetOpp: false, foldToCbet: false, bets: 0, calls: 0, sawFlop: false, wtsd: false, wonSd: false, xrOpp: false, xr: false, won: false }));
  // preflop
  let raises = 0;
  let pfa: number | null = null;
  let level = h.config.bb;
  const pre = h.actions.filter((a) => a.street === 'preflop' && a.p >= 0);
  // replay commitments to know "to" amounts: use events instead
  const acts = h.events.filter((e) => e.t === 'act') as Extract<HandState['events'][number], { t: 'act' }>[];
  let ai = 0;
  const streetOf: string[] = [];
  {
    // map events to streets by walking events
    let st = 'preflop';
    for (const e of h.events) {
      if (e.t === 'board' && e.run !== 2) st = e.street;
      if (e.t === 'act') streetOf.push(st);
    }
  }
  const raisersPre: number[] = [];
  for (let k = 0; k < acts.length; k++) {
    const e = acts[k];
    if (streetOf[k] !== 'preflop') continue;
    const isRaise = e.to > level && e.action !== 'call';
    if (raises === 1 && !raisersPre.includes(e.p)) f[e.p].threeBetOpp = true;
    if (raises === 2 && raisersPre[0] === e.p) {
      f[e.p].foldTo3Opp = true;
      if (e.action === 'fold') f[e.p].foldTo3 = true;
    }
    if (e.action === 'call' || isRaise) f[e.p].vpip = true;
    if (isRaise) {
      f[e.p].pfr = true;
      if (raises === 1) f[e.p].threeBet = true;
      raises++;
      raisersPre.push(e.p);
      pfa = e.p;
      level = e.to;
    }
  }
  void pre;
  void ai;
  // postflop
  const sawFlop = h.board.length >= 3;
  if (sawFlop) {
    // players not folded preflop
    const foldedPre = new Set<number>();
    acts.forEach((e, k) => streetOf[k] === 'preflop' && e.action === 'fold' && foldedPre.add(e.p));
    for (let i = 0; i < n; i++) if (!foldedPre.has(i)) f[i].sawFlop = true;
    let flopBet: number | null = null;
    const checkedFirst = new Set<number>();
    for (let k = 0; k < acts.length; k++) {
      const e = acts[k];
      const st = streetOf[k];
      if (st === 'preflop') continue;
      if (e.action === 'bet' || e.action === 'raise' || (e.action === 'allin' && e.amount > 0)) f[e.p].bets++;
      if (e.action === 'call') f[e.p].calls++;
      if (st === 'flop') {
        if (pfa !== null && e.p === pfa && flopBet === null) {
          f[e.p].cbetOpp = true;
          if (e.action === 'bet' || e.action === 'allin') {
            f[e.p].cbet = true;
            flopBet = e.p;
          }
        } else if (flopBet !== null && flopBet === pfa && e.p !== pfa) {
          f[e.p].foldToCbetOpp = true;
          if (e.action === 'fold') f[e.p].foldToCbet = true;
        }
        if (e.action === 'check') checkedFirst.add(e.p);
        if (checkedFirst.has(e.p) && (e.action === 'raise' || e.action === 'allin')) f[e.p].xr = true;
        if (checkedFirst.has(e.p) && flopBet !== null && e.p !== flopBet) f[e.p].xrOpp = true;
        if (flopBet === null && (e.action === 'bet' || e.action === 'allin')) flopBet = e.p;
      }
    }
  }
  const showdown = h.events.some((e) => e.t === 'show');
  h.players.forEach((p, i) => {
    f[i].won = h.winners.includes(i);
    if (showdown && !p.folded && f[i].sawFlop) {
      f[i].wtsd = true;
      if (f[i].won) f[i].wonSd = true;
    }
  });
  return f;
}

export function accumulate(st: OpponentStats, fl: HandFlags): OpponentStats {
  st.hands++;
  if (fl.vpip) st.vpip++;
  if (fl.pfr) st.pfr++;
  if (fl.threeBetOpp) st.threeBetOpp++;
  if (fl.threeBet) st.threeBet++;
  if (fl.foldTo3Opp) st.foldTo3Opp++;
  if (fl.foldTo3) st.foldTo3++;
  if (fl.cbetOpp) st.cbetOpp++;
  if (fl.cbet) st.cbet++;
  if (fl.foldToCbetOpp) st.foldToCbetOpp++;
  if (fl.foldToCbet) st.foldToCbet++;
  st.bets += fl.bets;
  st.calls += fl.calls;
  if (fl.sawFlop) st.wtsdOpp++;
  if (fl.wtsd) st.wtsd++;
  if (fl.wonSd) st.wsd++;
  if (fl.xrOpp) st.xrOpp++;
  if (fl.xr) st.xr++;
  return st;
}
