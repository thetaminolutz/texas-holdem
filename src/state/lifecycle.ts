// App lifecycle: save state whenever iPadOS may suspend or kill the app.
import { sfx } from '../audio/sfx';

type Saver = () => Promise<unknown> | unknown;
const savers = new Set<Saver>();
const pauseHandlers = new Set<(hidden: boolean) => void>();

export const lifecycle = {
  init(baseSaver: Saver) {
    savers.add(baseSaver);
    const saveAll = () => {
      for (const s of savers) {
        try {
          void s();
        } catch (e) {
          console.warn('save failed', e);
        }
      }
    };
    document.addEventListener('visibilitychange', () => {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) {
        saveAll();
        sfx.suspend();
      } else sfx.resume();
      pauseHandlers.forEach((h) => h(hidden));
    });
    window.addEventListener('pagehide', saveAll);
    window.addEventListener('beforeunload', saveAll);
    window.addEventListener('blur', saveAll);
  },
  addSaver(s: Saver) {
    savers.add(s);
    return () => savers.delete(s);
  },
  onVisibility(h: (hidden: boolean) => void) {
    pauseHandlers.add(h);
    return () => pauseHandlers.delete(h);
  },
};
