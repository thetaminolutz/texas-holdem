import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Panel, Row, Seg, Slider, Switch, Tabs, confirmDialog, toast, showDialog } from '../kit';
import { back, home } from '../router';
import { useStore } from '../../state/store';
import { settingsStore, patchSettings, defaultSettings, SOUND_KEYS, type Settings } from '../../state/settings';
import { AboutContent, OfflineStatus } from './About';
import { exportBackup, importBackup, resetEverything } from '../../storage/backup';
import { db } from '../../storage/db';
import { CARD_BACK_NAMES, CHIP_SET_NAMES } from '../../scene/catalog';
import { DIFFICULTY_OPTIONS } from '../../ai/difficulty';

type TabId = 'gameplay' | 'look' | 'anim' | 'audio' | 'access' | 'coach' | 'data' | 'presets' | 'about';
const TABS: { id: TabId; label: string }[] = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'look', label: 'Look' },
  { id: 'anim', label: 'Animations' },
  { id: 'audio', label: 'Audio' },
  { id: 'access', label: 'Accessibility' },
  { id: 'coach', label: 'Coach' },
  { id: 'data', label: 'Data' },
  { id: 'presets', label: 'Presets' },
  { id: 'about', label: 'About' },
];

export const FELT_COLORS: { name: string; hex: string }[] = [
  { name: 'Classic Green', hex: '#1f6b3f' },
  { name: 'Emerald', hex: '#0f5a4a' },
  { name: 'Burgundy', hex: '#6b1a24' },
  { name: 'Royal Blue', hex: '#1c3f7a' },
  { name: 'Midnight', hex: '#1c2433' },
  { name: 'Charcoal', hex: '#3a3d40' },
  { name: 'Black', hex: '#161616' },
  { name: 'Purple', hex: '#43265e' },
  { name: 'Tan', hex: '#8a6a3f' },
];
export const LEATHER_COLORS: { name: string; hex: string }[] = [
  { name: 'Espresso', hex: '#3a1f14' },
  { name: 'Black', hex: '#1b1715' },
  { name: 'Oxblood', hex: '#4e1414' },
  { name: 'Cognac', hex: '#7a4420' },
  { name: 'Navy', hex: '#1b2438' },
  { name: 'Forest', hex: '#1f3324' },
];

function useSettings() {
  return useStore(settingsStore);
}

function GameplayTab({ s }: { s: Settings }) {
  const g = s.gameplay;
  const p = (patch: Partial<Settings['gameplay']>) => patchSettings('gameplay', patch);
  return (
    <div class="grid2">
      <Panel kind="leather">
        <h3 class="embossed">Table</h3>
        <Row label="Number of players" hint="Including you (2–9)">
          <Seg label="Players" value={g.players} onChange={(v) => p({ players: v })} options={[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: n, label: String(n) }))} testid="set-players" />
        </Row>
        <Row label="Starting stack">
          <Seg label="Starting stack" value={g.startingStack} onChange={(v) => p({ startingStack: v })} options={[500, 1000, 2000, 5000, 10000].map((n) => ({ value: n, label: n.toLocaleString() }))} />
        </Row>
        <Row label="Blinds">
          <Seg
            label="Blinds"
            value={`${g.smallBlind}/${g.bigBlind}`}
            onChange={(v) => {
              const [sb, bb] = v.split('/').map(Number);
              p({ smallBlind: sb, bigBlind: bb });
            }}
            options={['5/10', '10/20', '25/50', '50/100', '100/200'].map((x) => ({ value: x, label: x }))}
          />
        </Row>
        <Row label="Ante">
          <Seg label="Ante" value={g.ante} onChange={(v) => p({ ante: v })} options={[0, 1, 2, 5, 10, 25].map((n) => ({ value: n, label: n ? String(n) : 'None' }))} />
        </Row>
        <Row label="Betting structure">
          <Seg label="Structure" value={g.structure} onChange={(v) => p({ structure: v })} options={[{ value: 'NL', label: 'No-Limit' }, { value: 'PL', label: 'Pot-Limit' }, { value: 'FL', label: 'Fixed-Limit' }]} />
        </Row>
        <Row label="Default bot difficulty">
          <Seg label="Difficulty" value={g.defaultDifficulty} onChange={(v) => p({ defaultDifficulty: v })} options={DIFFICULTY_OPTIONS} />
        </Row>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Blind levels (tournaments)</h3>
        <Row label="Level by">
          <Seg label="Level by" value={g.levelBy} onChange={(v) => p({ levelBy: v })} options={[{ value: 'hands', label: 'Hands' }, { value: 'minutes', label: 'Minutes' }]} />
        </Row>
        <Row label={`Level length: ${g.levelLength} ${g.levelBy}`}>
          <div style={{ width: '200px' }}>
            <Slider label="Level length" min={3} max={30} value={g.levelLength} onChange={(v) => p({ levelLength: v })} />
          </div>
        </Row>
        <h3 class="embossed" style={{ marginTop: '10px' }}>Rules</h3>
        <Row label="Rebuys / top-up (cash)"><Switch label="Rebuys" checked={g.rebuys} onChange={(v) => p({ rebuys: v })} /></Row>
        <Row label="Straddle" hint="UTG may post 2× BB"><Switch label="Straddle" checked={g.straddle} onChange={(v) => p({ straddle: v })} /></Row>
        <Row label="Run it twice" hint="When all-in before the river">
          <Seg label="Run it twice" value={g.runItTwice} onChange={(v) => p({ runItTwice: v })} options={[{ value: 'off', label: 'Off' }, { value: 'ask', label: 'Ask' }, { value: 'always', label: 'Always' }]} />
        </Row>
        <Row label="Auto-muck losing hands"><Switch label="Auto-muck" checked={g.autoMuck} onChange={(v) => p({ autoMuck: v })} /></Row>
        <Row label="Auto-post blinds"><Switch label="Auto-post blinds" checked={g.autoPostBlinds} onChange={(v) => p({ autoPostBlinds: v })} /></Row>
        <Row label="Show bot cards at showdown"><Switch label="Show bot cards" checked={g.showBotCards} onChange={(v) => p({ showBotCards: v })} /></Row>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Pace</h3>
        <Row label={`Bot speed: ${g.gameSpeed.toFixed(2)}×`} hint="Think-time multiplier">
          <div style={{ width: '200px' }}>
            <Slider label="Game speed" min={0.25} max={2} step={0.25} value={g.gameSpeed} onChange={(v) => p({ gameSpeed: v })} detents={[{ value: 1, label: '1×' }]} />
          </div>
        </Row>
        <Row label="Turn timer">
          <Seg label="Turn timer" value={g.turnTimer} onChange={(v) => p({ turnTimer: v })} options={[0, 15, 30, 60].map((n) => ({ value: n, label: n ? `${n}s` : 'Off' }))} />
        </Row>
        <Row label="On timeout">
          <Seg label="Timeout" value={g.timeoutAction} onChange={(v) => p({ timeoutAction: v })} options={[{ value: 'checkfold', label: 'Check/Fold' }, { value: 'fold', label: 'Fold' }]} />
        </Row>
        <h3 class="embossed" style={{ marginTop: '10px' }}>Bet controls</h3>
        <Row label="+/− step">
          <Seg label="Step" value={g.stepSize} onChange={(v) => p({ stepSize: v })} options={[{ value: 'bb', label: 'BB' }, { value: 'halfbb', label: '½ BB' }, { value: 'one', label: '1' }, { value: 'custom', label: 'Custom' }]} />
        </Row>
        {g.stepSize === 'custom' && (
          <Row label={`Custom step: ${g.customStep}`}>
            <div style={{ width: '200px' }}>
              <Slider label="Custom step" min={5} max={500} step={5} value={g.customStep} onChange={(v) => p({ customStep: v })} />
            </div>
          </Row>
        )}
        <Row label="Quick-bet buttons" hint="Fractions of the pot">
          <Seg
            label="Quick bets"
            value={g.quickBets.join(',')}
            onChange={(v) => p({ quickBets: v.split(',').map(Number) })}
            options={[
              { value: '0.33,0.5,0.75,1', label: '⅓ ½ ¾ Pot' },
              { value: '0.5,0.66,1,2', label: '½ ⅔ Pot 2×' },
              { value: '0.25,0.5,1,1.5', label: '¼ ½ Pot 1.5×' },
            ]}
          />
        </Row>
      </Panel>
    </div>
  );
}

function LookTab({ s }: { s: Settings }) {
  const l = s.look;
  const p = (patch: Partial<Settings['look']>) => patchSettings('look', patch);
  return (
    <div class="grid2">
      <Panel kind="leather">
        <h3 class="embossed">Table</h3>
        <Row label="Shape">
          <Seg label="Table shape" value={l.tableShape} onChange={(v) => p({ tableShape: v })} options={[{ value: 'oval', label: 'Oval' }, { value: 'round', label: 'Round' }, { value: 'rect', label: 'Home table' }]} testid="set-shape" />
        </Row>
        <Row label="Wood">
          <Seg label="Wood" value={l.wood} onChange={(v) => p({ wood: v })} options={[{ value: 'oak', label: 'Oak' }, { value: 'walnut', label: 'Walnut' }, { value: 'mahogany', label: 'Mahogany' }, { value: 'ebony', label: 'Ebony' }]} testid="set-wood" />
        </Row>
        <div class="row" style={{ flexWrap: 'wrap' }}>
          <span class="label" style={{ flexBasis: '100%' }}>Felt color</span>
          {FELT_COLORS.map((c) => (
            <button key={c.hex} class="swatch" aria-label={c.name} title={c.name} aria-pressed={l.felt === c.hex} style={{ background: c.hex }} onClick={() => p({ felt: c.hex })} />
          ))}
          <input type="color" aria-label="Custom felt color" value={l.felt} onInput={(e) => p({ felt: (e.target as HTMLInputElement).value })} style={{ width: '44px', height: '44px', border: 'none', background: 'none' }} />
        </div>
        <div class="row" style={{ flexWrap: 'wrap' }}>
          <span class="label" style={{ flexBasis: '100%' }}>Rail leather</span>
          {LEATHER_COLORS.map((c) => (
            <button key={c.hex} class="swatch" aria-label={c.name} title={c.name} aria-pressed={l.leather === c.hex} style={{ background: c.hex }} onClick={() => p({ leather: c.hex })} />
          ))}
        </div>
        <Row label="Trim">
          <Seg label="Trim" value={l.trim} onChange={(v) => p({ trim: v })} options={[{ value: 'brass', label: 'Brass' }, { value: 'chrome', label: 'Chrome' }]} />
        </Row>
        <Row label="Lighting mood">
          <Seg label="Lighting" value={l.lighting} onChange={(v) => p({ lighting: v })} options={[{ value: 'warm', label: 'Warm lamp' }, { value: 'smoky', label: 'Smoky' }, { value: 'cool', label: 'Cool' }, { value: 'noir', label: 'Noir' }]} />
        </Row>
        <Row label="Wear level">
          <Seg label="Wear" value={l.wear} onChange={(v) => p({ wear: v })} options={[{ value: 'new', label: 'New' }, { value: 'light', label: 'Lightly used' }, { value: 'worn', label: 'Well-worn' }, { value: 'vintage', label: 'Vintage' }]} testid="set-wear" />
        </Row>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Cards &amp; chips</h3>
        <Row label="Deck style">
          <Seg label="Deck style" value={l.deckStyle} onChange={(v) => p({ deckStyle: v })} options={[{ value: 'classic', label: 'Classic' }, { value: 'large', label: 'Large index' }, { value: 'four', label: '4-color' }]} />
        </Row>
        <Row label="Card back">
          <select class="text" style={{ maxWidth: '220px' }} value={l.cardBack} onChange={(e) => p({ cardBack: Number((e.target as HTMLSelectElement).value) })} aria-label="Card back">
            {CARD_BACK_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </Row>
        <Row label="Chip set">
          <select class="text" style={{ maxWidth: '220px' }} value={l.chipSet} onChange={(e) => p({ chipSet: Number((e.target as HTMLSelectElement).value) })} aria-label="Chip set">
            {CHIP_SET_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </Row>
        <Row label="Avatars">
          <Seg label="Avatar style" value={l.avatarStyle} onChange={(v) => p({ avatarStyle: v })} options={[{ value: 'portrait', label: 'Portraits' }, { value: 'monogram', label: 'Monograms' }]} />
        </Row>
        <h3 class="embossed" style={{ marginTop: '10px' }}>Interface</h3>
        <Row label="UI material">
          <Seg label="UI theme" value={l.uiTheme} onChange={(v) => p({ uiTheme: v })} options={[{ value: 'wood', label: 'Wood' }, { value: 'leather', label: 'Leather' }, { value: 'metal', label: 'Metal' }]} />
        </Row>
        <Row label="Appearance">
          <Seg label="Color scheme" value={l.colorScheme} onChange={(v) => p({ colorScheme: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Row>
        <Row label={`Font size: ${Math.round(l.fontScale * 100)}%`}>
          <div style={{ width: '200px' }}>
            <Slider label="Font size" min={0.85} max={1.4} step={0.05} value={l.fontScale} onChange={(v) => p({ fontScale: Math.round(v * 100) / 100 })} detents={[{ value: 1, label: '100%' }]} />
          </div>
        </Row>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Camera &amp; graphics</h3>
        <Row label="Camera">
          <Seg label="Camera preset" value={l.camera} onChange={(v) => p({ camera: v })} options={[{ value: 'player', label: 'Player view' }, { value: 'top', label: 'Top-down' }, { value: 'cinematic', label: 'Cinematic' }]} />
        </Row>
        <Row label="Graphics quality" hint="Auto adapts to frame time">
          <Seg label="Quality" value={l.quality} onChange={(v) => p({ quality: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }]} testid="set-quality" />
        </Row>
      </Panel>
    </div>
  );
}

function AnimTab({ s }: { s: Settings }) {
  const a = s.anim;
  const p = (patch: Partial<Settings['anim']>) => patchSettings('anim', patch);
  return (
    <div class="grid2">
      <Panel kind="leather">
        <h3 class="embossed">Motion</h3>
        <Row label="Animation speed">
          <Seg label="Animation speed" value={a.speed} onChange={(v) => p({ speed: v })} options={[{ value: 'off', label: 'Off' }, { value: '0.5', label: '0.5×' }, { value: '1', label: '1×' }, { value: '1.5', label: '1.5×' }, { value: '2', label: '2×' }, { value: 'instant', label: 'Instant' }]} testid="set-animspeed" />
        </Row>
        <Row label="Reduce motion" hint="Shorter, calmer animations, no camera moves"><Switch label="Reduce motion" checked={a.reduceMotion} onChange={(v) => p({ reduceMotion: v })} /></Row>
        <Row label="Cinematic camera" hint="Zoom on big pots and all-ins"><Switch label="Cinematic" checked={a.cinematic} onChange={(v) => p({ cinematic: v })} /></Row>
        <Row label="Idle camera sway"><Switch label="Camera sway" checked={a.cameraSway} onChange={(v) => p({ cameraSway: v })} /></Row>
        <Row label="Idle chip fidgeting"><Switch label="Idle fidget" checked={a.idleFidget} onChange={(v) => p({ idleFidget: v })} /></Row>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Dealer</h3>
        <Row label="Shuffle style">
          <Seg label="Shuffle" value={a.shuffleStyle} onChange={(v) => p({ shuffleStyle: v })} options={[{ value: 'riffle', label: 'Riffle' }, { value: 'bridge', label: 'Bridge' }, { value: 'overhand', label: 'Overhand' }, { value: 'wash', label: 'Wash' }, { value: 'cut', label: 'Cut' }, { value: 'random', label: 'Mix' }]} />
        </Row>
        <Row label="Quick shuffle"><Switch label="Quick shuffle" checked={a.quickShuffle} onChange={(v) => p({ quickShuffle: v })} /></Row>
        <Row label="Deal style">
          <Seg label="Deal style" value={a.dealStyle} onChange={(v) => p({ dealStyle: v })} options={[{ value: 'flick', label: 'Flick (pitch)' }, { value: 'slide', label: 'Slide' }]} />
        </Row>
        <Row label="Slow-roll the river"><Switch label="Slow roll river" checked={a.slowRollRiver} onChange={(v) => p({ slowRollRiver: v })} /></Row>
        <Row label="Chip animations">
          <Seg label="Chip intensity" value={a.chipIntensity} onChange={(v) => p({ chipIntensity: v })} options={[{ value: 'subtle', label: 'Subtle' }, { value: 'normal', label: 'Normal' }, { value: 'dramatic', label: 'Dramatic' }]} />
        </Row>
      </Panel>
    </div>
  );
}

const SOUND_LABELS: Record<string, string> = {
  cards: 'Card flicks, slides & flips',
  shuffle: 'Shuffling',
  chips: 'Chips',
  knock: 'Check knock',
  fold: 'Fold thud',
  bell: 'Blind level bell',
  timer: 'Turn timer warning',
  win: 'Win fanfare',
  ui: 'Button & switch clicks',
};

function AudioTab({ s }: { s: Settings }) {
  const a = s.audio;
  const p = (patch: Partial<Settings['audio']>) => patchSettings('audio', patch);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div class="grid2">
      <Panel kind="leather">
        <h3 class="embossed">Volume</h3>
        {(['master', 'effects', 'music'] as const).map((k) => (
          <Row key={k} label={`${k[0].toUpperCase() + k.slice(1)}: ${pct(a[k])}`}>
            <div style={{ width: '220px' }}>
              <Slider label={`${k} volume`} min={0} max={1} step={0.05} value={a[k]} onChange={(v) => p({ [k]: v } as any)} format={pct} />
            </div>
          </Row>
        ))}
        <Row label="Ambient lounge music" hint="Generative, synthesized live"><Switch label="Music" checked={a.musicOn} onChange={(v) => p({ musicOn: v })} /></Row>
        <Row label="Stereo panning by seat"><Switch label="Spatial audio" checked={a.spatial} onChange={(v) => p({ spatial: v })} /></Row>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Sounds</h3>
        {SOUND_KEYS.map((k) => (
          <Row key={k} label={SOUND_LABELS[k]}>
            <Switch label={SOUND_LABELS[k]} checked={a.sounds[k] !== false} onChange={(v) => p({ sounds: { ...a.sounds, [k]: v } })} />
          </Row>
        ))}
      </Panel>
    </div>
  );
}

function AccessTab({ s }: { s: Settings }) {
  const a = s.access;
  const p = (patch: Partial<Settings['access']>) => patchSettings('access', patch);
  return (
    <Panel kind="leather">
      <Row label="Colorblind-friendly suits" hint="Four-color deck with shapes emphasized"><Switch label="Colorblind" checked={a.colorblind} onChange={(v) => { p({ colorblind: v }); if (v) patchSettings('look', { deckStyle: 'four' }); }} /></Row>
      <Row label="High contrast text"><Switch label="High contrast" checked={a.highContrast} onChange={(v) => p({ highContrast: v })} /></Row>
      <Row label="Larger tap targets"><Switch label="Large targets" checked={a.largeTargets} onChange={(v) => p({ largeTargets: v })} /></Row>
      <Row label="Left-handed layout" hint="Action buttons on the left"><Switch label="Left-handed" checked={a.leftHanded} onChange={(v) => p({ leftHanded: v })} /></Row>
      <Row label="Reduce motion"><Switch label="Reduce motion" checked={s.anim.reduceMotion} onChange={(v) => patchSettings('anim', { reduceMotion: v })} /></Row>
      <p class="muted">All controls carry VoiceOver labels. Game events are announced through a live region.</p>
    </Panel>
  );
}

function CoachTab({ s }: { s: Settings }) {
  const c = s.coach;
  const p = (patch: Partial<Settings['coach']>) => patchSettings('coach', patch);
  return (
    <Panel kind="leather">
      <Row label="Pot-odds helper" hint="Shows the price you are getting"><Switch label="Pot odds" checked={c.potOdds} onChange={(v) => p({ potOdds: v })} /></Row>
      <Row label="Equity meter" hint="Your chance to win vs. likely ranges"><Switch label="Equity" checked={c.equity} onChange={(v) => p({ equity: v })} /></Row>
      <Row label="Coach suggestions" hint="Suggested action with explanation"><Switch label="Coach" checked={c.coach} onChange={(v) => p({ coach: v })} /></Row>
      <Row label="Mistake review after hands"><Switch label="Mistake review" checked={c.mistakeReview} onChange={(v) => p({ mistakeReview: v })} /></Row>
      <Row label="HUD stats on opponents" hint="VPIP / PFR / AF"><Switch label="HUD" checked={c.hud} onChange={(v) => p({ hud: v })} /></Row>
      <Row label="Bot table talk"><Switch label="Table talk" checked={c.tableTalk} onChange={(v) => p({ tableTalk: v })} /></Row>
    </Panel>
  );
}

function DataTab({ s }: { s: Settings }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const days = s.meta.lastBackup ? Math.floor((Date.now() - s.meta.lastBackup) / 86400000) : null;
  return (
    <div class="grid2">
      <Panel kind="leather">
        <h3 class="embossed">Backup</h3>
        <p class="muted">iPadOS can delete website data for apps that are not opened for a long time. Export a backup file now and then (save it to Files or iCloud Drive).</p>
        <div class="row">
          <span class="label">Last backup</span>
          <span class={`badge ${days === null || days > 14 ? 'warn' : 'ok'}`} data-testid="last-backup">{days === null ? 'Never' : days === 0 ? 'Today' : `${days} days ago`}</span>
        </div>
        <div class="row" style={{ flexWrap: 'wrap' }}>
          <Button
            variant="green"
            testid="export-data"
            onClick={async () => {
              try {
                const r = await exportBackup();
                toast(r === 'shared' ? 'Backup shared ✔' : 'Backup downloaded ✔');
              } catch {
                toast('Backup cancelled');
              }
            }}
          >
            Export backup
          </Button>
          <Button onClick={() => fileRef.current?.click()} testid="import-data">Import backup</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            data-testid="import-file"
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              const text = await f.text();
              (e.target as HTMLInputElement).value = '';
              if (!(await confirmDialog('Import backup?', 'This replaces all current settings, statistics, saved game and hand history.', 'Import', true))) return;
              try {
                const r = await importBackup(text);
                toast(`Imported ${r.hands} hands ✔`);
              } catch (err) {
                await showDialog('Import failed', String((err as Error).message), [{ label: 'OK', value: 'ok' }]);
              }
            }}
          />
        </div>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Storage &amp; offline</h3>
        <OfflineStatus />
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed">Reset</h3>
        <div class="row">
          <span class="label">Reset statistics<span class="hint">Keeps settings and hand history</span></span>
          <Button
            variant="red"
            size="small"
            testid="reset-stats"
            onClick={async () => {
              if (!(await confirmDialog('Reset statistics?', 'Lifetime statistics, bankroll chart and opponent records will be cleared.', 'Reset', true))) return;
              await db.del('kv', 'profile');
              toast('Statistics reset');
            }}
          >
            Reset stats
          </Button>
        </div>
        <div class="row">
          <span class="label">Reset everything<span class="hint">Settings, stats, history, saved game, textures</span></span>
          <Button
            variant="red"
            size="small"
            testid="reset-all"
            onClick={async () => {
              if (!(await confirmDialog('Reset everything?', 'All data on this device will be deleted. This cannot be undone.', 'Continue', true))) return;
              if (!(await confirmDialog('Are you absolutely sure?', 'Last chance — export a backup first if you want to keep anything.', 'Delete everything', true))) return;
              await resetEverything();
              settingsStore.set(defaultSettings());
              toast('Everything reset');
              home();
            }}
          >
            Reset all
          </Button>
        </div>
      </Panel>
    </div>
  );
}

interface Preset {
  name: string;
  gameplay: Settings['gameplay'];
}
function PresetsTab({ s }: { s: Settings }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState('');
  useEffect(() => {
    void db.get<Preset[]>('kv', 'presets').then((p) => setPresets(p ?? []));
  }, []);
  const save = (list: Preset[]) => {
    setPresets(list);
    void db.set('kv', 'presets', list);
  };
  return (
    <Panel kind="leather">
      <h3 class="embossed">Game-setting presets</h3>
      <div class="row">
        <input class="text" placeholder="Preset name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Preset name" />
        <Button
          variant="green"
          disabled={!name.trim()}
          onClick={() => {
            save([...presets.filter((p) => p.name !== name.trim()), { name: name.trim(), gameplay: s.gameplay }]);
            setName('');
            toast('Preset saved');
          }}
        >
          Save current
        </Button>
      </div>
      {presets.length === 0 && <p class="muted">No presets yet. Configure the Gameplay tab and save it here.</p>}
      {presets.map((p) => (
        <div class="row" key={p.name}>
          <span class="label">
            {p.name}
            <span class="hint">
              {p.gameplay.players} players · {p.gameplay.smallBlind}/{p.gameplay.bigBlind} · {p.gameplay.structure} · stack {p.gameplay.startingStack}
            </span>
          </span>
          <Button size="small" onClick={() => { patchSettings('gameplay', p.gameplay); toast(`Loaded "${p.name}"`); }}>Load</Button>
          <Button size="small" variant="red" onClick={() => save(presets.filter((x) => x !== p))}>Delete</Button>
        </div>
      ))}
    </Panel>
  );
}

export function SettingsScreen(props: { initialTab?: TabId }) {
  const s = useSettings();
  const [tab, setTab] = useState<TabId>(props.initialTab ?? 'gameplay');
  return (
    <div class="screen wood-dark" data-testid="settings-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back" testid="back">‹ Back</Button>
        <h1 class="embossed">Settings</h1>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div class="screen-body panel wood" style={{ borderRadius: '12px', padding: '16px' }}>
        {tab === 'gameplay' && <GameplayTab s={s} />}
        {tab === 'look' && <LookTab s={s} />}
        {tab === 'anim' && <AnimTab s={s} />}
        {tab === 'audio' && <AudioTab s={s} />}
        {tab === 'access' && <AccessTab s={s} />}
        {tab === 'coach' && <CoachTab s={s} />}
        {tab === 'data' && <DataTab s={s} />}
        {tab === 'presets' && <PresetsTab s={s} />}
        {tab === 'about' && <AboutContent />}
      </div>
    </div>
  );
}
