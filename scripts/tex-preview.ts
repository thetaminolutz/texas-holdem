// Renders procedural textures to PNG for quick visual iteration: tsx scripts/tex-preview.ts <outdir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { encodePNG } from './png.ts';
import { genWood, genFelt, genLeather, genBrushedMetal } from '../src/scene/textures/generators.ts';
const out = process.argv[2] ?? 'tex-preview';
mkdirSync(out, { recursive: true });
const save = (name: string, w: number, h: number, buf?: Uint8ClampedArray) => buf && writeFileSync(`${out}/${name}.png`, encodePNG(w, h, buf));
for (const type of ['oak', 'walnut', 'mahogany', 'ebony']) {
  const t = genWood(512, 256, { type, wear: 2, seed: 11 });
  save(`wood-${type}`, 512, 256, t.color);
}
const l = genLeather(512, 256, { color: '#3a1f14', wear: 1, seed: 31, stitches: [0.08, 0.92] });
save('leather', 512, 256, l.color);
save('leather-n', 512, 256, l.normal);
const f = genFelt(256, 256, { color: '#1f6b3f', wear: 1 });
save('felt', 256, 256, f.color);
const m = genBrushedMetal(256, 256, { tint: 'brass', wear: 1 });
save('brass', 256, 256, m.color);
