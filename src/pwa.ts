import { Store } from './state/store';

export interface PwaState {
  supported: boolean;
  registered: boolean;
  offlineReady: boolean;
  needRefresh: boolean;
  error?: string;
  controller: boolean;
}

export const pwaStore = new Store<PwaState>({
  supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  registered: false,
  offlineReady: false,
  needRefresh: false,
  controller: typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller,
});

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export async function initPwa() {
  if (!pwaStore.get().supported) return;
  if (import.meta.env.DEV) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    updateSW = registerSW({
      immediate: true,
      onOfflineReady() {
        pwaStore.update((s) => ({ ...s, offlineReady: true }));
      },
      onNeedRefresh() {
        pwaStore.update((s) => ({ ...s, needRefresh: true }));
      },
      onRegisteredSW(_url: string, reg: ServiceWorkerRegistration | undefined) {
        pwaStore.update((s) => ({ ...s, registered: !!reg }));
        // Check for updates when the app comes back to the foreground (only meaningful when online).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) reg?.update().catch(() => {});
        });
      },
      onRegisterError(e: unknown) {
        pwaStore.update((s) => ({ ...s, error: String(e) }));
      },
    });
    // If a SW already controls this page and its precache is complete, we're offline ready.
    const ready = await navigator.serviceWorker.ready;
    if (ready.active) {
      const stats = await cacheStatus();
      if (stats.files > 0) pwaStore.update((s) => ({ ...s, offlineReady: true, controller: true }));
    }
    navigator.serviceWorker.addEventListener('controllerchange', () =>
      pwaStore.update((s) => ({ ...s, controller: true })),
    );
  } catch (e) {
    pwaStore.update((s) => ({ ...s, error: String(e) }));
  }
}

export function applyUpdate() {
  void updateSW?.(true);
}

export interface CacheStats {
  caches: string[];
  files: number;
  bytes: number;
  list: { url: string; size: number }[];
}

export async function cacheStatus(): Promise<CacheStats> {
  const out: CacheStats = { caches: [], files: 0, bytes: 0, list: [] };
  if (typeof caches === 'undefined') return out;
  const names = await caches.keys();
  out.caches = names;
  for (const n of names) {
    const c = await caches.open(n);
    const reqs = await c.keys();
    for (const r of reqs) {
      out.files++;
      let size = 0;
      try {
        const resp = await c.match(r);
        if (resp) size = (await resp.clone().arrayBuffer()).byteLength;
      } catch {
        /* ignore */
      }
      out.bytes += size;
      out.list.push({ url: r.url.replace(location.origin, ''), size });
    }
  }
  out.list.sort((a, b) => a.url.localeCompare(b.url));
  return out;
}
