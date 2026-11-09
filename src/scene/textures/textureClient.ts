// Generates procedural textures in Web Workers and caches the encoded PNGs in IndexedDB.
import { db } from '../../storage/db';
import type { TexRequest } from '../../workers/texture.worker';

export interface GenResult {
  width: number;
  height: number;
  color: Blob | ImageData;
  normal?: Blob | ImageData | null;
  rough?: Blob | ImageData | null;
}

const CACHE_VERSION = 5;
const POOL_SIZE = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
let workers: Worker[] = [];
let rr = 0;
let nextId = 1;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();

function getWorker(): Worker {
  if (!workers.length) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL('../../workers/texture.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.rej(new Error(e.data.error));
        else p.res(e.data);
      };
      workers.push(w);
    }
  }
  return workers[rr++ % workers.length];
}

export function disposeTextureWorkers() {
  workers.forEach((w) => w.terminate());
  workers = [];
}

function toImageData(buf: Uint8ClampedArray | undefined, w: number, h: number) {
  return buf ? new ImageData(buf as any, w, h) : null;
}

export async function generateTexture(
  kind: TexRequest['kind'],
  w: number,
  h: number,
  opts: object,
  useCache = true,
): Promise<GenResult> {
  const key = `tex:v${CACHE_VERSION}:${kind}:${w}x${h}:${JSON.stringify(opts)}`;
  if (useCache) {
    const hit = await db.get<GenResult>('blobs', key);
    if (hit && hit.color) return hit;
  }
  const id = nextId++;
  const res: any = await new Promise((resolve, reject) => {
    pending.set(id, { res: resolve, rej: reject });
    getWorker().postMessage({ id, kind, w, h, opts, encode: true } satisfies TexRequest);
  });
  if (res.blobs) {
    const out: GenResult = { width: res.width, height: res.height, ...res.blobs };
    if (useCache) void db.set('blobs', key, out);
    return out;
  }
  const o = res.out;
  return {
    width: o.width,
    height: o.height,
    color: toImageData(o.color, o.width, o.height)!,
    normal: toImageData(o.normal, o.width, o.height),
    rough: toImageData(o.rough, o.width, o.height),
  };
}

export async function toBitmap(src: Blob | ImageData): Promise<ImageBitmap | ImageData> {
  if (src instanceof ImageData) return src;
  try {
    return await createImageBitmap(src);
  } catch {
    // Some WebKit versions fail on large blobs; decode via <img>
    const url = URL.createObjectURL(src);
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  }
}

export async function toObjectURL(src: Blob | ImageData): Promise<string> {
  if (src instanceof Blob) return URL.createObjectURL(src);
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.putImageData(src, 0, 0);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  return URL.createObjectURL(blob);
}
