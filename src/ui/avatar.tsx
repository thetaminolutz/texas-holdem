// Procedurally generated portrait avatars (SVG), seeded per character. Monogram style as an alternative.
import { mulberry32 } from '../util/noise';

const SKIN = ['#f6d7bd', '#eec4a0', '#d9a37c', '#c08560', '#9a6440', '#6e4428', '#4a2e1c'];
const HAIR = ['#1b1410', '#3a2516', '#6b4423', '#a0703a', '#d0a860', '#e6dccb', '#8a8a8a', '#7a2a1a'];
const BG = ['#5a2a24', '#24414f', '#2f4a2c', '#4a3a6a', '#6a4a24', '#2a2a36', '#4d5a2a', '#3a2a1a'];
const SHIRT = ['#7a1c1c', '#1c3a6a', '#2a5a3a', '#3a3a3a', '#6a5a2a', '#5a2a5a', '#c9b48a', '#1a1a1a'];

export function avatarSvg(seed: number, name: string): string {
  const r = mulberry32(seed * 9973 + 17);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const bg = pick(BG);
  const shirt = pick(SHIRT);
  const hairStyle = Math.floor(r() * 7);
  const faceW = 30 + r() * 6;
  const faceH = 36 + r() * 6;
  const glasses = r() < 0.3 ? Math.floor(r() * 2) : -1;
  const beard = r() < 0.3 ? Math.floor(r() * 3) : -1;
  const hat = r() < 0.22 ? Math.floor(r() * 3) : -1;
  const mouth = Math.floor(r() * 4);
  const brow = (r() - 0.5) * 4;
  const earring = r() < 0.2;
  const parts: string[] = [];
  parts.push(`<defs><radialGradient id="bg${seed}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${shade(bg, 0.25)}"/><stop offset="1" stop-color="${shade(bg, -0.35)}"/></radialGradient>
  <radialGradient id="sk${seed}" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="${shade(skin, 0.12)}"/><stop offset="1" stop-color="${shade(skin, -0.15)}"/></radialGradient></defs>`);
  parts.push(`<rect width="100" height="100" fill="url(#bg${seed})"/>`);
  // shoulders
  parts.push(`<path d="M10 100 Q14 74 50 70 Q86 74 90 100 Z" fill="${shirt}"/>`);
  parts.push(`<path d="M40 72 L50 84 L60 72" fill="none" stroke="${shade(shirt, -0.3)}" stroke-width="2"/>`);
  // neck
  parts.push(`<rect x="43" y="58" width="14" height="16" rx="5" fill="${shade(skin, -0.12)}"/>`);
  // back hair (long styles)
  if (hairStyle === 3 || hairStyle === 5) parts.push(`<path d="M${50 - faceW / 2 - 6} 44 Q${50 - faceW / 2 - 8} 78 ${50 - faceW / 2 + 4} 80 L${50 + faceW / 2 - 4} 80 Q${50 + faceW / 2 + 8} 78 ${50 + faceW / 2 + 6} 44 Z" fill="${shade(hair, -0.1)}"/>`);
  // ears
  parts.push(`<ellipse cx="${50 - faceW / 2}" cy="46" rx="4" ry="6" fill="${shade(skin, -0.1)}"/><ellipse cx="${50 + faceW / 2}" cy="46" rx="4" ry="6" fill="${shade(skin, -0.1)}"/>`);
  if (earring) parts.push(`<circle cx="${50 + faceW / 2}" cy="53" r="1.8" fill="#e8c35a"/>`);
  // face
  parts.push(`<ellipse cx="50" cy="44" rx="${faceW / 2}" ry="${faceH / 2}" fill="url(#sk${seed})"/>`);
  // hair front
  const hx = 50 - faceW / 2,
    hw = faceW;
  switch (hairStyle) {
    case 0:
      parts.push(`<path d="M${hx - 1} 40 Q${hx} 22 50 22 Q${hx + hw} 22 ${hx + hw + 1} 40 Q${50 + 6} 30 ${hx - 1} 40Z" fill="${hair}"/>`);
      break;
    case 1:
      parts.push(`<path d="M${hx - 2} 44 Q${hx - 2} 20 50 21 Q${hx + hw + 2} 20 ${hx + hw + 2} 44 L${hx + hw - 2} 34 Q50 28 ${hx + 2} 34Z" fill="${hair}"/>`);
      break;
    case 2:
      parts.push(`<path d="M${hx + 3} 32 Q50 18 ${hx + hw - 3} 32 Q50 27 ${hx + 3} 32Z" fill="${hair}" opacity="0.9"/>`);
      break;
    case 3:
      parts.push(`<path d="M${hx - 3} 50 Q${hx - 4} 20 50 20 Q${hx + hw + 4} 20 ${hx + hw + 3} 50 Q${hx + hw - 2} 32 50 30 Q${hx + 2} 32 ${hx - 3} 50Z" fill="${hair}"/>`);
      break;
    case 4:
      // curls
      for (let i = 0; i < 9; i++) parts.push(`<circle cx="${hx + 2 + (i * hw) / 8}" cy="${27 + Math.sin(i) * 2}" r="5.5" fill="${hair}"/>`);
      break;
    case 5:
      parts.push(`<path d="M${hx - 2} 40 Q${hx + 4} 18 ${50 + 4} 21 Q${hx + hw + 3} 24 ${hx + hw + 2} 42 Q${hx + hw - 6} 28 ${50 - 4} 30 Q${hx + 6} 30 ${hx - 2} 40Z" fill="${hair}"/>`);
      break;
    default:
      // bald with side hair
      parts.push(`<path d="M${hx - 1} 46 Q${hx} 36 ${hx + 4} 34 L${hx + 4} 44Z M${hx + hw + 1} 46 Q${hx + hw} 36 ${hx + hw - 4} 34 L${hx + hw - 4} 44Z" fill="${hair}"/>`);
  }
  // brows & eyes
  parts.push(`<path d="M${42 - 4} ${38 + brow} L${42 + 4} ${37 - brow}" stroke="${shade(hair, -0.2)}" stroke-width="2" stroke-linecap="round"/>`);
  parts.push(`<path d="M${58 - 4} ${37 - brow} L${58 + 4} ${38 + brow}" stroke="${shade(hair, -0.2)}" stroke-width="2" stroke-linecap="round"/>`);
  parts.push(`<ellipse cx="42" cy="43" rx="2.6" ry="2" fill="#fff"/><ellipse cx="58" cy="43" rx="2.6" ry="2" fill="#fff"/>`);
  parts.push(`<circle cx="42.3" cy="43.2" r="1.5" fill="#2a1c12"/><circle cx="58.3" cy="43.2" r="1.5" fill="#2a1c12"/>`);
  // nose
  parts.push(`<path d="M50 44 Q48 51 50 53 Q52 53 53 52" fill="none" stroke="${shade(skin, -0.3)}" stroke-width="1.3" stroke-linecap="round"/>`);
  // mouth
  const mouths = [
    `<path d="M44 57 Q50 61 56 57" fill="none" stroke="#7a3a2a" stroke-width="1.8" stroke-linecap="round"/>`,
    `<path d="M45 58 L55 58" stroke="#7a3a2a" stroke-width="1.8" stroke-linecap="round"/>`,
    `<path d="M44 58 Q51 60 56 56" fill="none" stroke="#7a3a2a" stroke-width="1.8" stroke-linecap="round"/>`,
    `<path d="M44 56 Q50 63 56 56 Z" fill="#7a2a22"/><path d="M45.5 57 L54.5 57" stroke="#fff" stroke-width="1.4"/>`,
  ];
  parts.push(mouths[mouth]);
  if (beard === 0) parts.push(`<path d="M${hx + 4} 50 Q${hx + 6} 66 50 67 Q${hx + hw - 6} 66 ${hx + hw - 4} 50 Q${hx + hw - 8} 60 50 61 Q${hx + 8} 60 ${hx + 4} 50Z" fill="${hair}" opacity="0.9"/>`);
  if (beard === 1) parts.push(`<path d="M43 54 Q50 51 57 54 Q50 56 43 54Z" fill="${hair}"/>`);
  if (beard === 2) parts.push(`<path d="M46 60 Q50 68 54 60 Q50 62 46 60Z" fill="${hair}"/>`);
  if (glasses === 0) parts.push(`<g fill="none" stroke="#1a1a1a" stroke-width="1.6"><circle cx="42" cy="43" r="5.2"/><circle cx="58" cy="43" r="5.2"/><path d="M47 43 L53 43"/></g>`);
  if (glasses === 1) parts.push(`<g fill="rgba(20,20,30,0.75)" stroke="#111" stroke-width="1.2"><rect x="35.5" y="39" width="12" height="8" rx="2"/><rect x="52.5" y="39" width="12" height="8" rx="2"/><path d="M47.5 42 L52.5 42" fill="none"/></g>`);
  if (hat === 0) parts.push(`<path d="M${hx - 10} 30 Q50 26 ${hx + hw + 10} 30 Q50 33 ${hx - 10} 30Z" fill="#2a2018"/><path d="M${hx + 2} 29 Q${hx + 3} 12 50 12 Q${hx + hw - 3} 12 ${hx + hw - 2} 29Z" fill="#3a2c20"/><rect x="${hx + 2}" y="24" width="${hw - 4}" height="4" fill="#7a1c1c"/>`);
  if (hat === 1) parts.push(`<path d="M${hx - 1} 33 Q${hx} 16 50 16 Q${hx + hw} 16 ${hx + hw + 1} 33Z" fill="#1c3a6a"/><path d="M${50} 31 Q${hx + hw + 14} 30 ${hx + hw + 16} 35 L${50} 35Z" fill="#14294a"/>`);
  if (hat === 2) parts.push(`<path d="M${hx - 2} 34 Q${hx - 1} 14 50 14 Q${hx + hw + 1} 14 ${hx + hw + 2} 34Z" fill="#6a2a2a"/><rect x="${hx - 3}" y="30" width="${hw + 6}" height="6" rx="3" fill="#4a1a1a"/>`);
  void name;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">${parts.join('')}</svg>`;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const cache = new Map<string, string>();
export function Avatar(props: { seed: number; name: string; size?: number; monogram?: boolean; human?: boolean }) {
  const size = props.size ?? 52;
  const initials = props.name
    .replace(/["“”].*?["“”]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (props.monogram || props.human) {
    return (
      <div class="avatar monogram" style={{ width: size, height: size }} aria-hidden="true">
        <span>{props.human ? '★' : initials}</span>
      </div>
    );
  }
  const key = `${props.seed}`;
  let url = cache.get(key);
  if (!url) {
    url = 'data:image/svg+xml;utf8,' + encodeURIComponent(avatarSvg(props.seed, props.name));
    cache.set(key, url);
  }
  return (
    <div class="avatar" style={{ width: size, height: size }} aria-hidden="true">
      <img src={url} width={size} height={size} alt="" draggable={false} />
    </div>
  );
}
