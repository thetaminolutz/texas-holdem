// Build the bot-visible view of a hand (hides every other player's hole cards).
import { getLegal, totalPot, type HandState } from '../engine/game';
import type { BotView, PublicAction } from './types';

export function buildView(h: HandState, me: number, tournament: BotView['tournament'] = null): BotView {
  const legal = getLegal(h)!;
  const acts: PublicAction[] = [];
  let st: PublicAction['street'] = 'preflop';
  for (const e of h.events) {
    if (e.t === 'board' && e.run !== 2) st = e.street;
    if (e.t === 'act') acts.push({ p: e.p, street: st, type: e.action, to: e.to, amount: e.amount });
  }
  return {
    me,
    handNo: h.init.handNo,
    street: h.street,
    hole: [...h.players[me].hole],
    board: [...h.board],
    players: h.players.map((p) => ({ id: p.id, name: p.name, stack: p.stack, committed: p.committed, total: p.total, folded: p.folded, allIn: p.allIn, startStack: p.startStack })),
    button: h.button,
    sbIdx: h.sbIdx,
    bbIdx: h.bbIdx,
    pot: totalPot(h),
    currentBet: h.currentBet,
    legal,
    sb: h.config.sb,
    bb: h.config.bb,
    structure: h.config.structure,
    actions: acts,
    tournament,
  };
}
