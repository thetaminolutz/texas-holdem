// What a bot is allowed to know: only public information + its own hole cards. Bots never see other hole cards.
import type { Card } from '../engine/cards';
import type { Legal, Street, Structure, ActionType } from '../engine/game';
import type { Difficulty } from './difficulty';

export interface PublicPlayer {
  id: string;
  name: string;
  stack: number;
  committed: number;
  total: number;
  folded: boolean;
  allIn: boolean;
  startStack: number;
}

export interface PublicAction {
  p: number;
  street: Street;
  type: ActionType;
  to: number; // committed after the action on that street
  amount: number; // chips added
}

export interface BotView {
  me: number; // index in players
  handNo: number;
  street: Street;
  hole: Card[];
  board: Card[];
  players: PublicPlayer[];
  button: number;
  sbIdx: number;
  bbIdx: number;
  pot: number; // total incl. current bets
  currentBet: number;
  legal: Legal;
  sb: number;
  bb: number;
  structure: Structure;
  actions: PublicAction[];
  tournament: { payouts: number[]; playersLeft: number; avgStack: number; bubble: boolean } | null;
}

export type Archetype = 'TAG' | 'LAG' | 'Rock' | 'Station' | 'Maniac' | 'Nit' | 'Pro' | 'Tourist' | 'Trickster';

export interface Personality {
  /** preflop looseness: fraction of hands played from late position (0..1) */
  vpip: number;
  /** aggression preference: raise vs call (0..1) */
  aggr: number;
  /** base bluff frequency multiplier */
  bluff: number;
  /** tendency to call down light (0..1) */
  sticky: number;
  /** tendency to slow-play/trap monsters */
  trap: number;
  /** sizing preference multiplier (1 = standard) */
  sizing: number;
  /** tilt susceptibility */
  tiltProne: number;
  /** talkativeness */
  chatty: number;
}

export interface OpponentStats {
  hands: number;
  vpip: number; // counts
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  foldTo3Opp: number;
  foldTo3: number;
  cbetOpp: number;
  cbet: number;
  foldToCbetOpp: number;
  foldToCbet: number;
  bets: number; // postflop bets+raises
  calls: number; // postflop calls
  wtsdOpp: number; // saw flop
  wtsd: number;
  wsd: number; // won at showdown
  xrOpp: number;
  xr: number;
}

export interface BotContext {
  archetype: Archetype;
  difficulty: Difficulty;
  personality: Personality;
  tilt: number; // 0..1 current tilt
  confidence: number; // -1..1
  /** smoothed stats of opponents by id (only what this bot could observe) */
  opponents: Record<string, OpponentStats>;
  seed: number;
}

export interface Decision {
  action: { type: ActionType; amount?: number };
  thinkMs: number;
  /** optional table talk */
  talk?: string;
  /** debugging / coach explanation */
  reason?: string;
  equity?: number;
}
