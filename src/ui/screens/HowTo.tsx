import { Button, Panel } from '../kit';
import { back } from '../router';
import { HandRankings } from '../cardsUi';

export function HowToScreen() {
  return (
    <div class="screen wood-dark" data-testid="howto-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">How to Play</h1>
      </div>
      <div class="screen-body">
        <div class="grid2">
          <Panel kind="paper">
            <h2>Texas Hold'em in one minute</h2>
            <ol class="rules">
              <li><b>Blinds.</b> The two players left of the dealer button post the small and big blind. The button moves one seat clockwise every hand.</li>
              <li><b>Hole cards.</b> Everyone gets two private cards, dealt one at a time starting left of the button.</li>
              <li><b>Pre-flop betting.</b> Starting left of the big blind, each player folds, calls or raises.</li>
              <li><b>The flop</b> — three shared cards — then a betting round starting left of the button.</li>
              <li><b>The turn</b> (4th card) and <b>the river</b> (5th card), each followed by betting.</li>
              <li><b>Showdown.</b> The best five-card hand made from your two cards and the five on the board wins the pot. Ties split the pot.</li>
            </ol>
            <h3>Betting terms</h3>
            <ul class="rules">
              <li><b>Check</b>: pass without betting (only when nobody has bet).</li>
              <li><b>Bet / Raise</b>: put chips in; others must call, raise or fold. A raise must be at least the size of the previous bet or raise (No-Limit).</li>
              <li><b>All-in</b>: bet all your chips. You can only win as much from each opponent as you put in — extra chips form a <i>side pot</i>.</li>
              <li><b>Pot-Limit</b>: the largest raise is the size of the pot. <b>Fixed-Limit</b>: bets come in fixed sizes, max four bets per round.</li>
            </ul>
          </Panel>
          <Panel kind="paper">
            <h2>Hand rankings</h2>
            <HandRankings />
          </Panel>
          <Panel kind="paper">
            <h2>Using this table</h2>
            <ul class="rules">
              <li><b>Peek</b>: touch and hold your two cards — the corners lift so you can look. <b>Tap</b> them to turn them face up.</li>
              <li><b>Raise</b>: drag the brass slider (it clicks into Min, ⅓, ½, ⅔, ¾, Pot, 2× and All-in), tap chips to add them, use ± or type an exact amount on the keypad.</li>
              <li><b>Camera</b>: drag to look around, pinch to zoom, double-tap to reset. Tap the felt to fast-forward an animation.</li>
              <li><b>Pre-actions</b>: tick <i>Check/Fold</i> or <i>Call any</i> while others think.</li>
              <li>Keyboard: <b>F</b> fold, <b>C</b> check/call, <b>R</b> raise, <b>A</b> all-in, <b>Esc</b> menu.</li>
              <li>The game saves after every action. If iPadOS closes the app, choose <b>Continue Game</b> to resume exactly where you were.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
