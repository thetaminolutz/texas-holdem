import { useMemo, useState } from 'preact/hooks';
import { Button, Panel, Row, Seg, Switch, Slider, formatChips, confirmDialog } from '../kit';
import { back, go } from '../router';
import { useStore } from '../../state/store';
import { settingsStore } from '../../state/settings';
import { setupForMode, pickBots, MODE_INFO, type GameSetupSpec } from '../../state/modes';
import { pendingSetup } from './GameScreen';
import { ARCHETYPES, CHARACTERS } from '../../ai/characters';
import { DIFFICULTY_OPTIONS } from '../../ai/difficulty';
import { defaultPayouts, type GameMode } from '../../engine/table';
import { Avatar } from '../avatar';
import { db } from '../../storage/db';
import type { Archetype } from '../../ai/types';

export function GameSetup(props: { mode: GameMode }) {
  const s = useStore(settingsStore);
  const [spec, setSpec] = useState<GameSetupSpec>(() => setupForMode(props.mode, s));
  const full = props.mode === 'custom';
  const upd = (p: Partial<GameSetupSpec>) => setSpec((x) => ({ ...x, ...p }));
  const setPlayers = (n: number) => {
    setSpec((x) => {
      const bots = [...x.bots];
      if (bots.length < n - 1) bots.push(...pickBots(n - 1 - bots.length, x.difficulty, x.startingStack).filter((b) => !bots.some((y) => y.name === b.name)));
      while (bots.length < n - 1) bots.push(...pickBots(1, x.difficulty, x.startingStack));
      return { ...x, players: n, bots: bots.slice(0, n - 1), payouts: x.tournament ? defaultPayouts(n) : x.payouts };
    });
  };
  const setDifficulty = (d: string) => setSpec((x) => ({ ...x, difficulty: d, bots: x.bots.map((b, i) => ({ ...b, difficulty: d === 'mixed' ? DIFFICULTY_OPTIONS[i % 5].value : d === 'adaptive' ? 'medium' : d })) }));
  const updBot = (i: number, p: Partial<GameSetupSpec['bots'][number]>) => setSpec((x) => ({ ...x, bots: x.bots.map((b, k) => (k === i ? { ...b, ...p } : b)) }));
  const prizePool = spec.players * spec.startingStack;
  const start = async () => {
    const saved = await db.get('kv', 'savedGame');
    if (saved && !(await confirmDialog('Start a new game?', 'Your saved game in progress will be replaced.', 'Start new game', true))) return;
    await db.del('kv', 'savedGame');
    pendingSetup.set({ ...spec, bots: spec.bots.map((b) => ({ ...b, stack: b.stack || spec.startingStack })) });
    go('game', { resume: false });
  };
  const fixedPlayers = props.mode === 'headsup';
  const blinds = useMemo(() => ['5/10', '10/20', '25/50', '50/100', '100/200', '250/500'], []);
  return (
    <div class="screen wood-dark" data-testid="setup-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">{MODE_INFO[props.mode].title}</h1>
        <Button variant="green" size="big" onClick={start} testid="start-game">Deal me in</Button>
      </div>
      <div class="screen-body">
        <div class="grid2">
          <Panel kind="leather">
            <h3 class="embossed">Table</h3>
            {!fixedPlayers && (
              <Row label="Players (incl. you)">
                <Seg label="Players" value={spec.players} onChange={setPlayers} options={[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: n, label: String(n) }))} testid="setup-players" />
              </Row>
            )}
            <Row label="Bot difficulty">
              <Seg label="Difficulty" value={spec.difficulty} onChange={setDifficulty} options={DIFFICULTY_OPTIONS} />
            </Row>
            <Row label="Starting stack">
              <Seg label="Starting stack" value={spec.startingStack} onChange={(v) => upd({ startingStack: v, bots: spec.bots.map((b) => ({ ...b, stack: v })) })} options={[500, 1000, 1500, 2000, 5000, 10000].map((n) => ({ value: n, label: formatChips(n) }))} />
            </Row>
            <Row label="Blinds">
              <Seg label="Blinds" value={`${spec.sb}/${spec.bb}`} onChange={(v) => { const [sb, bb] = v.split('/').map(Number); upd({ sb, bb }); }} options={blinds.map((b) => ({ value: b, label: b }))} />
            </Row>
            {(full || spec.tournament) && (
              <Row label="Ante">
                <Seg label="Ante" value={spec.ante} onChange={(v) => upd({ ante: v })} options={[0, 1, 2, 5, 10, 25].map((n) => ({ value: n, label: n ? String(n) : 'None' }))} />
              </Row>
            )}
            {full && (
              <Row label="Structure">
                <Seg label="Structure" value={spec.structure} onChange={(v) => upd({ structure: v })} options={[{ value: 'NL', label: 'No-Limit' }, { value: 'PL', label: 'Pot-Limit' }, { value: 'FL', label: 'Fixed-Limit' }]} />
              </Row>
            )}
            {full && (
              <Row label="Tournament (rising blinds)">
                <Switch label="Tournament" checked={spec.tournament} onChange={(v) => upd({ tournament: v, levelBy: v ? 'hands' : 'none', rebuys: !v, payouts: v ? defaultPayouts(spec.players) : [1] })} />
              </Row>
            )}
          </Panel>
          <Panel kind="leather">
            <h3 class="embossed">Rules</h3>
            {spec.tournament ? (
              <>
                <Row label="Blinds increase by">
                  <Seg label="Level by" value={spec.levelBy} onChange={(v) => upd({ levelBy: v })} options={[{ value: 'hands', label: 'Hands' }, { value: 'minutes', label: 'Minutes' }]} />
                </Row>
                <Row label={`Every ${spec.levelLength} ${spec.levelBy}`}>
                  <div style={{ width: '200px' }}>
                    <Slider label="Level length" min={3} max={30} value={spec.levelLength} onChange={(v) => upd({ levelLength: v })} />
                  </div>
                </Row>
                <Row label="Payouts" hint={`Prize pool ${formatChips(prizePool)}`}>
                  <Seg
                    label="Payouts"
                    value={spec.payouts.join(',')}
                    onChange={(v) => upd({ payouts: v.split(',').map(Number) })}
                    options={[
                      { value: '1', label: 'Winner takes all' },
                      { value: '0.65,0.35', label: '65/35' },
                      { value: '0.5,0.3,0.2', label: '50/30/20' },
                      { value: '0.4,0.3,0.2,0.1', label: '40/30/20/10' },
                    ]}
                  />
                </Row>
              </>
            ) : (
              <Row label="Rebuys & top-ups"><Switch label="Rebuys" checked={spec.rebuys} onChange={(v) => upd({ rebuys: v })} /></Row>
            )}
            <Row label="Straddle"><Switch label="Straddle" checked={spec.straddle} onChange={(v) => upd({ straddle: v })} /></Row>
            <Row label="Run it twice">
              <Seg label="Run it twice" value={spec.runItTwice} onChange={(v) => upd({ runItTwice: v })} options={[{ value: 'off', label: 'Off' }, { value: 'ask', label: 'Ask' }, { value: 'always', label: 'Always' }]} />
            </Row>
          </Panel>
        </div>
        <Panel kind="leather" style={{ marginTop: '14px' }}>
          <h3 class="embossed">Opponents</h3>
          <div class="bot-list">
            {spec.bots.map((b, i) => (
              <div class="bot-row" key={i} data-testid={`bot-row-${i}`}>
                <Avatar seed={b.avatarSeed} name={b.name} size={44} />
                <input class="text" value={b.name} aria-label={`Seat ${i + 2} name`} onInput={(e) => updBot(i, { name: (e.target as HTMLInputElement).value })} style={{ maxWidth: '200px' }} />
                <select class="text" value={b.archetype} aria-label={`Seat ${i + 2} style`} onChange={(e) => updBot(i, { archetype: (e.target as HTMLSelectElement).value as Archetype })} style={{ maxWidth: '190px' }}>
                  {Object.entries(ARCHETYPES).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
                </select>
                <select class="text" value={b.difficulty} aria-label={`Seat ${i + 2} difficulty`} onChange={(e) => updBot(i, { difficulty: (e.target as HTMLSelectElement).value })} style={{ maxWidth: '140px' }}>
                  {DIFFICULTY_OPTIONS.slice(0, 5).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                {full && (
                  <input class="text num" type="number" min={1} value={b.stack} aria-label={`Seat ${i + 2} starting stack`} onInput={(e) => updBot(i, { stack: Math.max(1, Number((e.target as HTMLInputElement).value) || spec.startingStack) })} style={{ maxWidth: '110px' }} />
                )}
                <Button
                  size="small"
                  label="Swap character"
                  onClick={() => {
                    const used = new Set(spec.bots.map((x) => x.name));
                    const c = CHARACTERS.filter((x) => !used.has(x.name))[Math.floor(Math.random() * 5)] ?? CHARACTERS[0];
                    updBot(i, { name: c.name, archetype: c.archetype, avatarSeed: c.avatarSeed, bio: c.bio });
                  }}
                >
                  ↻
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
