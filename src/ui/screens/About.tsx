import { useEffect, useState } from 'preact/hooks';
import { Button, Panel } from '../kit';
import { back, go } from '../router';
import { useStore } from '../../state/store';
import { pwaStore, cacheStatus, applyUpdate, type CacheStats } from '../../pwa';
import { requestPersistence, db } from '../../storage/db';

export function fmtBytes(n?: number) {
  if (n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function OfflineStatus(props: { detailed?: boolean }) {
  const pwa = useStore(pwaStore);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  const [backend, setBackend] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const refresh = () => {
    void cacheStatus().then(setCache);
    void requestPersistence().then(setStorage);
    void db.kind().then(setBackend);
  };
  useEffect(refresh, [pwa.offlineReady]);
  return (
    <div data-testid="offline-status">
      <div class="row">
        <span class="label">Offline mode</span>
        {pwa.offlineReady ? (
          <span class="badge ok" data-testid="offline-ready">Offline ready ✔</span>
        ) : !pwa.supported ? (
          <span class="badge bad">Not supported in this browser</span>
        ) : import.meta.env.DEV ? (
          <span class="badge warn">Disabled in dev mode</span>
        ) : (
          <span class="badge warn">Downloading…</span>
        )}
      </div>
      {pwa.error && <div class="row"><span class="badge bad">Service worker error: {pwa.error}</span></div>}
      {pwa.needRefresh && (
        <div class="row">
          <span class="label">New version available</span>
          <Button size="small" variant="green" onClick={applyUpdate}>Reload</Button>
        </div>
      )}
      <div class="row"><span class="label">Cached files</span><span class="num" data-testid="cache-count">{cache ? cache.files : '…'}</span></div>
      <div class="row"><span class="label">Cache size</span><span class="num">{fmtBytes(cache?.bytes)}</span></div>
      <div class="row"><span class="label">Persistent storage</span>{storage ? (storage.persisted ? <span class="badge ok">Granted</span> : <span class="badge warn">Not granted (best effort)</span>) : '…'}</div>
      <div class="row"><span class="label">Storage used / quota</span><span class="num">{fmtBytes(storage?.usage)} / {fmtBytes(storage?.quota)}</span></div>
      <div class="row"><span class="label">Database</span><span>{backend === 'indexeddb' ? 'IndexedDB' : backend === 'localstorage' ? 'localStorage (fallback)' : backend || '…'}</span></div>
      {props.detailed && (
        <>
          <div class="row">
            <Button size="small" onClick={refresh}>Refresh</Button>
            <Button size="small" onClick={() => setShowFiles(!showFiles)}>{showFiles ? 'Hide' : 'Show'} cached files</Button>
          </div>
          {showFiles && cache && (
            <div class="inset scroll" style={{ maxHeight: '240px', padding: '8px', fontSize: '12px', background: 'rgba(0,0,0,.25)' }}>
              {cache.caches.map((c) => <div key={c}><b>{c}</b></div>)}
              {cache.list.map((f) => (
                <div key={f.url} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.url}</span>
                  <span class="num">{fmtBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AboutContent() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Panel kind="leather">
        <h2 class="embossed" style={{ marginBottom: '8px' }}>Felt &amp; Oak Hold'em</h2>
        <div class="muted">Version {__APP_VERSION__} · built {__BUILD_TIME__.slice(0, 10)}</div>
        <p style={{ lineHeight: 1.5 }}>
          A fully offline Texas Hold'em table. Every texture, card face, chip, avatar and sound is generated on your device —
          nothing is downloaded after installation. The bots think locally and only ever see what a real player could see.
        </p>
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed" style={{ marginBottom: '6px' }}>Offline &amp; storage</h3>
        <OfflineStatus detailed />
      </Panel>
      <Panel kind="leather">
        <h3 class="embossed" style={{ marginBottom: '6px' }}>Tools</h3>
        <div class="row">
          <Button size="small" onClick={() => go('lab')} testid="open-lab">Material Lab</Button>
        </div>
        <p class="muted" style={{ fontSize: '0.85em' }}>
          Fonts: Playfair Display and Inter (SIL Open Font License), bundled locally. 3D: three.js (MIT). UI: Preact (MIT).
        </p>
      </Panel>
    </div>
  );
}

export function AboutScreen() {
  return (
    <div class="screen wood-dark" data-testid="about-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">About</h1>
      </div>
      <div class="screen-body">
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <AboutContent />
        </div>
      </div>
    </div>
  );
}
