import './ui/fonts.css';
import './ui/styles.css';
import { render } from 'preact';
import { App } from './ui/App';
import { loadSettings, settingsStore, flushSettings } from './state/settings';
import { initPwa } from './pwa';
import { requestPersistence } from './storage/db';
import { applyUiTextures } from './ui/uiTextures';
import { sfx } from './audio/sfx';
import { lifecycle } from './state/lifecycle';
import { go } from './ui/router';

async function boot() {
  // Prevent pinch-zoom / double-tap zoom / rubber band in standalone mode.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.scroll, .screen-body, .dialog, canvas')) e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: false, passive: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.classList.add('kbd-focus'); });

  await loadSettings();
  const applyRootClasses = () => {
    const s = settingsStore.get();
    const r = document.documentElement;
    r.style.setProperty('--fs', String(s.look.fontScale));
    r.classList.toggle('large-targets', s.access.largeTargets);
    r.classList.toggle('high-contrast', s.access.highContrast);
    r.classList.toggle('lefty', s.access.leftHanded);
    r.dataset.theme = s.look.uiTheme;
    const light = s.look.colorScheme === 'light' || (s.look.colorScheme === 'auto' && !!window.matchMedia?.("(prefers-color-scheme: light)").matches);
    r.classList.toggle('light', light);
    sfx.configure(s.audio);
    void applyUiTextures(s);
  };
  applyRootClasses();
  settingsStore.subscribe(applyRootClasses);

  (window as any).__nav = go; // used by automated screenshot tests
  render(<App />, document.getElementById('app')!);
  void initPwa();
  void requestPersistence();
  lifecycle.init(() => flushSettings());
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app')!.innerHTML = `<div style="padding:40px;font:16px Georgia;color:#f3e6c8">Failed to start: ${String(e)}</div>`;
});
