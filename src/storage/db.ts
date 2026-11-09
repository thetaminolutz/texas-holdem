// Persistent storage: IndexedDB with transparent localStorage (then in-memory) fallback.
// Stores: 'kv' (settings, profile, stats, saved game, presets...), 'hands' (hand histories), 'blobs' (texture cache).

const DB_NAME = 'felt-oak-holdem';
const DB_VERSION = 1;
const STORES = ['kv', 'hands', 'blobs'] as const;
export type StoreName = (typeof STORES)[number];

interface Backend {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  set(store: StoreName, key: string, value: unknown): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  keys(store: StoreName): Promise<string[]>;
  clear(store: StoreName): Promise<void>;
  kind: 'indexeddb' | 'localstorage' | 'memory';
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function openIDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    const timer = setTimeout(() => rej(new Error('indexedDB open timeout')), 4000);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onsuccess = () => {
      clearTimeout(timer);
      res(r.result);
    };
    r.onerror = () => {
      clearTimeout(timer);
      rej(r.error);
    };
    r.onblocked = () => {
      clearTimeout(timer);
      rej(new Error('blocked'));
    };
  });
}

class IDBBackend implements Backend {
  kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }
  private tx(store: StoreName, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  get<T>(store: StoreName, key: string) {
    return reqP(this.tx(store, 'readonly').get(key)) as Promise<T | undefined>;
  }
  async set(store: StoreName, key: string, value: unknown) {
    await reqP(this.tx(store, 'readwrite').put(value, key));
  }
  async del(store: StoreName, key: string) {
    await reqP(this.tx(store, 'readwrite').delete(key));
  }
  async keys(store: StoreName) {
    return (await reqP(this.tx(store, 'readonly').getAllKeys())).map(String);
  }
  async clear(store: StoreName) {
    await reqP(this.tx(store, 'readwrite').clear());
  }
}

class LSBackend implements Backend {
  kind = 'localstorage' as const;
  private p = (s: StoreName) => `fo:${s}:`;
  async get<T>(store: StoreName, key: string) {
    const v = localStorage.getItem(this.p(store) + key);
    return v == null ? undefined : (JSON.parse(v) as T);
  }
  async set(store: StoreName, key: string, value: unknown) {
    if (store === 'blobs') return; // never put big blobs in localStorage
    localStorage.setItem(this.p(store) + key, JSON.stringify(value));
  }
  async del(store: StoreName, key: string) {
    localStorage.removeItem(this.p(store) + key);
  }
  async keys(store: StoreName) {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(this.p(store))) out.push(k.slice(this.p(store).length));
    }
    return out;
  }
  async clear(store: StoreName) {
    for (const k of await this.keys(store)) await this.del(store, k);
  }
}

class MemBackend implements Backend {
  kind = 'memory' as const;
  private m = new Map<string, unknown>();
  async get<T>(s: StoreName, k: string) {
    return this.m.get(s + ':' + k) as T | undefined;
  }
  async set(s: StoreName, k: string, v: unknown) {
    this.m.set(s + ':' + k, v);
  }
  async del(s: StoreName, k: string) {
    this.m.delete(s + ':' + k);
  }
  async keys(s: StoreName) {
    return [...this.m.keys()].filter((k) => k.startsWith(s + ':')).map((k) => k.slice(s.length + 1));
  }
  async clear(s: StoreName) {
    for (const k of await this.keys(s)) this.m.delete(s + ':' + k);
  }
}

let backendP: Promise<Backend> | null = null;
function backend(): Promise<Backend> {
  if (!backendP) {
    backendP = (async () => {
      try {
        return new IDBBackend(await openIDB());
      } catch (e) {
        console.warn('IndexedDB unavailable, falling back', e);
        try {
          localStorage.setItem('fo:test', '1');
          localStorage.removeItem('fo:test');
          return new LSBackend();
        } catch {
          return new MemBackend();
        }
      }
    })();
  }
  return backendP;
}

export const db = {
  async kind() {
    return (await backend()).kind;
  },
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    try {
      return await (await backend()).get<T>(store, key);
    } catch (e) {
      console.warn('db.get failed', store, key, e);
      return undefined;
    }
  },
  async set(store: StoreName, key: string, value: unknown): Promise<void> {
    try {
      await (await backend()).set(store, key, value);
    } catch (e) {
      console.warn('db.set failed', store, key, e);
    }
  },
  async del(store: StoreName, key: string) {
    try {
      await (await backend()).del(store, key);
    } catch (e) {
      console.warn('db.del failed', e);
    }
  },
  async keys(store: StoreName) {
    try {
      return await (await backend()).keys(store);
    } catch {
      return [];
    }
  },
  async clear(store: StoreName) {
    try {
      await (await backend()).clear(store);
    } catch (e) {
      console.warn('db.clear failed', e);
    }
  },
};

export async function requestPersistence(): Promise<{ persisted: boolean; usage?: number; quota?: number }> {
  let persisted = false;
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    if (!persisted && navigator.storage?.persist) persisted = await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  const est = await storageEstimate();
  return { persisted, ...est };
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage, quota: e?.quota };
  } catch {
    return {};
  }
}
