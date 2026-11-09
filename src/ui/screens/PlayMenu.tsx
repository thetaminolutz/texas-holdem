import { Button, Panel } from '../kit';
import { back, go } from '../router';
import { MODE_INFO } from '../../state/modes';
import type { GameMode } from '../../engine/table';

const ORDER: GameMode[] = ['quick', 'cash', 'sng', 'headsup', 'custom'];
const ICON: Record<GameMode, string> = { quick: '⚡', cash: '💵', sng: '🏆', headsup: '⚔', custom: '⚙' };

export function PlayMenu() {
  return (
    <div class="screen wood-dark" data-testid="play-menu">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Choose a game</h1>
      </div>
      <div class="screen-body">
        <div class="grid2" style={{ maxWidth: '980px', margin: '0 auto' }}>
          {ORDER.map((m) => (
            <Panel kind="felt" class="stitched" key={m}>
              <h2 class="embossed" style={{ fontSize: '1.4em' }}>{ICON[m]} {MODE_INFO[m].title}</h2>
              <p style={{ minHeight: '2.6em', lineHeight: 1.4 }}>{MODE_INFO[m].desc}</p>
              <Button variant="brass" block onClick={() => go('setup', { mode: m })} testid={`mode-${m}`}>
                {m === 'quick' ? 'Play now' : 'Set up'}
              </Button>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}
