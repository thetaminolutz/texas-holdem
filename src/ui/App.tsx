import { Component, type ComponentChildren } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useStore } from '../state/store';
import { routeStore, home } from './router';
import { DialogHost, ToastHost, Button } from './kit';
import { MainMenu } from './screens/MainMenu';
import { SettingsScreen } from './screens/Settings';
import { AboutScreen } from './screens/About';
import { pwaStore, applyUpdate } from '../pwa';

const PlayMenu = lazy(() => import('./screens/PlayMenu').then((m) => ({ default: m.PlayMenu })));
const GameSetup = lazy(() => import('./screens/GameSetup').then((m) => ({ default: m.GameSetup })));
const GameScreen = lazy(() => import('./screens/GameScreen').then((m) => ({ default: m.GameScreen })));
const StatsScreen = lazy(() => import('./screens/Stats').then((m) => ({ default: m.StatsScreen })));
const HistoryScreen = lazy(() => import('./screens/History').then((m) => ({ default: m.HistoryScreen })));
const ReplayScreen = lazy(() => import('./screens/Replay').then((m) => ({ default: m.ReplayScreen })));
const TrainingScreen = lazy(() => import('./screens/Training').then((m) => ({ default: m.TrainingScreen })));
const AchievementsScreen = lazy(() => import('./screens/Achievements').then((m) => ({ default: m.AchievementsScreen })));
const HowToScreen = lazy(() => import('./screens/HowTo').then((m) => ({ default: m.HowToScreen })));
const MaterialLab = lazy(() => import('./screens/MaterialLab').then((m) => ({ default: m.MaterialLab })));

class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };
  componentDidCatch(error: Error) {
    console.error(error);
    this.setState({ error });
  }
  render() {
    if (this.state.error)
      return (
        <div class="screen wood-dark" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div class="dialog paper" style={{ animation: 'none' }}>
            <h2>Something went wrong</h2>
            <p>The table got bumped. Your data is safe.</p>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '30vh', overflow: 'auto' }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
            <div class="actions">
              <Button onClick={() => location.reload()}>Reload</Button>
              <Button
                variant="green"
                onClick={() => {
                  this.setState({ error: null });
                  home();
                }}
              >
                Main Menu
              </Button>
            </div>
          </div>
        </div>
      );
    return this.props.children;
  }
}

function Loading() {
  return (
    <div class="screen wood-dark" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div class="embossed" style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3em' }}>
        Shuffling up…
      </div>
    </div>
  );
}

function UpdateBanner() {
  const p = useStore(pwaStore);
  if (!p.needRefresh) return null;
  return (
    <div style={{ position: 'fixed', bottom: 'calc(16px + var(--safe-b))', left: '50%', transform: 'translateX(-50%)', zIndex: 90 }}>
      <div class="plaque brass engraved" style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
        <span>New version available</span>
        <Button size="small" variant="green" onClick={applyUpdate} testid="update-reload">
          Reload
        </Button>
      </div>
    </div>
  );
}

export function App() {
  const route = useStore(routeStore);
  let screen: ComponentChildren;
  switch (route.name) {
    case 'menu':
      screen = <MainMenu />;
      break;
    case 'play':
      screen = <PlayMenu />;
      break;
    case 'setup':
      screen = <GameSetup mode={route.params?.mode ?? 'custom'} />;
      break;
    case 'game':
      screen = <GameScreen resume={!!route.params?.resume} />;
      break;
    case 'settings':
      screen = <SettingsScreen initialTab={route.params?.tab} />;
      break;
    case 'about':
      screen = <AboutScreen />;
      break;
    case 'stats':
      screen = <StatsScreen />;
      break;
    case 'history':
      screen = <HistoryScreen />;
      break;
    case 'replay':
      screen = <ReplayScreen handId={route.params?.id} />;
      break;
    case 'training':
      screen = <TrainingScreen />;
      break;
    case 'achievements':
      screen = <AchievementsScreen />;
      break;
    case 'howto':
      screen = <HowToScreen />;
      break;
    case 'lab':
      screen = <MaterialLab />;
      break;
  }
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>{screen}</Suspense>
      <DialogHost />
      <ToastHost />
      <UpdateBanner />
    </ErrorBoundary>
  );
}
