// Procedurally generated textures for the skeuomorphic DOM UI (wood panels, leather, brushed metal, paper, felt).
// Generated in a worker on first launch, cached in IndexedDB as PNG blobs, exposed as CSS custom properties.
import { generateTexture, toObjectURL } from '../scene/textures/textureClient';
import type { Settings } from '../state/settings';

const WEAR = { new: 0, light: 1, worn: 2, vintage: 3 } as const;
const urls: string[] = [];
let lastKey = '';

export async function applyUiTextures(s: Settings) {
  const wear = WEAR[s.look.wear];
  const key = JSON.stringify([s.look.wood, wear, s.look.felt, s.look.leather]);
  if (key === lastKey) return;
  lastKey = key;
  const jobs: [string, Promise<string>][] = [
    ['--tex-wood', gen('wood', 512, 256, { type: s.look.wood === 'ebony' ? 'walnut' : s.look.wood, wear, seed: 5, rings: false })],
    ['--tex-wood-dark', gen('wood', 512, 256, { type: 'walnut', wear, seed: 9, rings: false })],
    ['--tex-leather', gen('leather', 256, 256, { color: s.look.leather, wear, seed: 3 })],
    ['--tex-leather-red', gen('leather', 256, 256, { color: '#5a1a16', wear, seed: 4 })],
    ['--tex-metal', gen('metal', 256, 256, { tint: 'steel', wear, seed: 2 })],
    ['--tex-brass', gen('metal', 256, 256, { tint: 'brass', wear, seed: 6 })],
    ['--tex-paper', gen('paper', 256, 256, { wear, seed: 7 })],
    ['--tex-felt', gen('felt', 256, 256, { color: s.look.felt, wear, seed: 8 })],
  ];
  const root = document.documentElement;
  for (const [name, p] of jobs) {
    try {
      const url = await p;
      urls.push(url);
      root.style.setProperty(name, `url("${url}")`);
    } catch (e) {
      console.warn('ui texture failed', name, e);
    }
  }
  // revoke old urls after swap
  while (urls.length > jobs.length * 2) URL.revokeObjectURL(urls.shift()!);
}

async function gen(kind: any, w: number, h: number, opts: object) {
  const r = await generateTexture(kind, w, h, opts);
  return toObjectURL(r.color);
}
