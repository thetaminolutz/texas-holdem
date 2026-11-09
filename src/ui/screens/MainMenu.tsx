import { useEffect, useState } from 'preact/hooks';
import { Button, Plaque } from '../kit';
import { go } from '../router';
import { db } from '../../storage/db';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { pwaStore } from '../../pwa';

export function MainMenu() {
  const [hasSave, setHasSave] = useState(false);
  const s = useStore(settingsStore);
  const pwa = useStore(pwaStore);
  useEffect(() => {
    void db.get('kv', 'savedGame').then((g) => setHasSave(!!g));
  }, []);
  const days = s.meta.lastBackup ? Math.floor((Date.now() - s.meta.lastBackup) / 86400000) : null;
  const backupDue = days === null ? Date.now() - s.meta.firstRun > 7 * 86400000 : days > 14;
  return (
    <div class="screen wood-dark" data-testid="main-menu" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px', width: 'min(720px, 100%)', maxHeight: '100%' }}>
        <Plaque screws class="title-plaque">
          <div style={{ fontSize: 'clamp(26px, 5vw, 44px)', padding: '6px 18px', letterSpacing: '0.06em' }}>Felt &amp; Oak</div>
          <div style={{ fontSize: 'clamp(13px, 2vw, 17px)', letterSpacing: '0.4em', textAlign: 'center', marginTop: '-4px' }}>TEXAS HOLD'EM</div>
        </Plaque>
        <div class="panel felt stitched scroll" style={{ width: '100%', padding: '26px', borderRadius: '22px', maxHeight: '70vh' }}>
          <div class="menu-btn-list">
            {hasSave && (
              <Button variant="green" size="big" block onClick={() => go('game', { resume: true })} testid="menu-continue" sub="Resume exactly where you left off">
                Continue Game
              </Button>
            )}
            <Button variant="brass" size="big" block onClick={() => go('play')} testid="menu-play" sub="Quick Play · Cash · Sit & Go · Heads-Up · Custom">
              Play
            </Button>
            <div class="grid2" style={{ gap: '12px' }}>
              <Button block onClick={() => go('stats')} testid="menu-stats">Profile &amp; Statistics</Button>
              <Button block onClick={() => go('history')} testid="menu-history">Hand History</Button>
              <Button block onClick={() => go('training')} testid="menu-training">Training</Button>
              <Button block onClick={() => go('settings', { tab: 'look' })} testid="menu-custom">Customization</Button>
              <Button block onClick={() => go('achievements')} testid="menu-achievements">Achievements</Button>
              <Button block onClick={() => go('settings')} testid="menu-settings">Settings</Button>
              <Button block onClick={() => go('howto')} testid="menu-howto">How to Play</Button>
              <Button block onClick={() => go('about')} testid="menu-about">About</Button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {pwa.offlineReady ? <span class="badge ok" data-testid="offline-badge-menu">Offline ready ✔</span> : <span class="badge warn">Preparing offline mode…</span>}
          {backupDue && (
            <button class="badge warn" style={{ border: 'none', cursor: 'pointer' }} onClick={() => go('settings', { tab: 'data' })}>
              {days === null ? 'No backup yet' : `Last backup ${days} days ago`} · Back up now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
