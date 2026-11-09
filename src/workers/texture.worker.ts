/// <reference lib="webworker" />
import { genWood, genFelt, genLeather, genBrushedMetal, genPaper, genClay, type TexOut } from '../scene/textures/generators';

export interface TexRequest {
  id: number;
  kind: 'wood' | 'felt' | 'leather' | 'metal' | 'paper' | 'clay';
  w: number;
  h: number;
  opts: any;
  /** encode outputs to PNG blobs (for CSS / caching) */
  encode?: boolean;
}

async function toBlob(buf: Uint8ClampedArray, w: number, h: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(buf as any, w, h), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e: MessageEvent<TexRequest>) => {
  const r = e.data;
  try {
    let out: TexOut;
    switch (r.kind) {
      case 'wood': out = genWood(r.w, r.h, r.opts); break;
      case 'felt': out = genFelt(r.w, r.h, r.opts); break;
      case 'leather': out = genLeather(r.w, r.h, r.opts); break;
      case 'metal': out = genBrushedMetal(r.w, r.h, r.opts); break;
      case 'paper': out = genPaper(r.w, r.h, r.opts); break;
      case 'clay': out = genClay(r.w, r.h, r.opts?.seed, r.opts?.wear); break;
      default: throw new Error('unknown kind');
    }
    if (r.encode) {
      const [color, normal, rough] = await Promise.all([
        toBlob(out.color, out.width, out.height),
        out.normal ? toBlob(out.normal, out.width, out.height) : null,
        out.rough ? toBlob(out.rough, out.width, out.height) : null,
      ]);
      if (color) {
        (self as any).postMessage({ id: r.id, width: out.width, height: out.height, blobs: { color, normal, rough } });
        return;
      }
    }
    const transfer = [out.color.buffer, out.normal?.buffer, out.rough?.buffer].filter(Boolean) as ArrayBuffer[];
    (self as any).postMessage({ id: r.id, out }, transfer);
  } catch (err) {
    (self as any).postMessage({ id: r.id, error: String(err) });
  }
};
