import { useEffect } from 'preact/hooks';
import { Button, Panel } from '../kit';
import { back } from '../router';
import { useStore } from '../../state/store';
import { profileStore, loadProfile, ACHIEVEMENTS } from '../../state/profile';

export function AchievementsScreen() {
  const p = useStore(profileStore);
  useEffect(() => {
    void loadProfile();
  }, []);
  const done = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
  return (
    <div class="screen wood-dark" data-testid="achievements-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Achievements</h1>
        <span class="badge ok">{done} / {ACHIEVEMENTS.length}</span>
      </div>
      <div class="screen-body">
        <div class="grid2">
          {ACHIEVEMENTS.map((a) => {
            const [v, max] = a.progress(p);
            const unlocked = p.achievements[a.id];
            return (
              <Panel kind={unlocked ? 'felt' : 'leather'} key={a.id} class="stitched">
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div class={`medal ${unlocked ? 'on' : ''}`} aria-hidden="true">{unlocked ? '★' : '☆'}</div>
                  <div style={{ flex: 1 }}>
                    <h3 class="embossed">{a.name}</h3>
                    <div class="muted" style={{ fontSize: '0.9em' }}>{a.desc}</div>
                    <div class="progress inset" aria-label={`${v} of ${max}`}><div class="fill" style={{ width: `${(Math.min(v, max) / max) * 100}%` }} /></div>
                    <div class="muted num" style={{ fontSize: '0.8em' }}>{unlocked ? `Unlocked ${new Date(unlocked).toLocaleDateString('en-US')}` : `${v} / ${max}`}</div>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>
    </div>
  );
}
