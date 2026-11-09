// PBR materials built from procedural textures, plus the printed felt overlay and the procedural environment map.
import * as THREE from 'three';
import { generateTexture, toBitmap, type GenResult } from './textures/textureClient';
import type { Settings } from '../state/settings';
import type { Layout } from './layout';
import type { TableMaterials } from './tableBuilder';
import { hexToRgb, mulberry32 } from '../util/noise';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export const WEAR_LEVEL = { new: 0, light: 1, worn: 2, vintage: 3 } as const;

export interface QualityProfile {
  dpr: number;
  shadowMap: number;
  tex: number;
  physical: boolean;
  segments: number;
  anisotropy: number;
  post: boolean;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { dpr: 1, shadowMap: 512, tex: 512, physical: false, segments: 128, anisotropy: 1, post: false },
  medium: { dpr: 1.5, shadowMap: 1024, tex: 1024, physical: false, segments: 192, anisotropy: 4, post: false },
  high: { dpr: 2, shadowMap: 2048, tex: 1024, physical: true, segments: 256, anisotropy: 8, post: false },
  ultra: { dpr: 2, shadowMap: 2048, tex: 2048, physical: true, segments: 320, anisotropy: 16, post: true },
};

async function makeTex(src: Blob | ImageData | null | undefined, srgb: boolean, repeat = true, aniso = 4): Promise<THREE.Texture | null> {
  if (!src) return null;
  const img = await toBitmap(src);
  const t = img instanceof ImageData ? new THREE.DataTexture(img.data, img.width, img.height) : new THREE.Texture(img as any);
  if (img instanceof ImageData) t.flipY = true;
  else t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

async function texSet(r: GenResult, aniso: number) {
  const [map, normal, rough] = await Promise.all([makeTex(r.color, true, true, aniso), makeTex(r.normal, false, true, aniso), makeTex(r.rough, false, true, aniso)]);
  return { map: map!, normal, rough };
}

/** Large non-tiled felt surface: fibers + printed betting line + logo + wear patches + chalk + card slide marks. */
export async function drawFeltOverlay(
  feltColor: string,
  wear: number,
  layout: Layout,
  bounds: { minX: number; minZ: number; W: number; D: number },
  size: number,
  fiberTile: Blob | ImageData,
): Promise<HTMLCanvasElement> {
  const aspect = bounds.W / bounds.D;
  const w = size;
  const h = Math.round(size / Math.max(1, aspect));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const toPx = (x: number, z: number) => [((x - bounds.minX) / bounds.W) * w, ((z - bounds.minZ) / bounds.D) * h] as const;
  const pxPerM = w / bounds.W;
  // fiber base (tiled)
  const tile = await toBitmap(fiberTile);
  let tileCanvas: CanvasImageSource;
  if (tile instanceof ImageData) {
    const tc = document.createElement('canvas');
    tc.width = tile.width;
    tc.height = tile.height;
    tc.getContext('2d')!.putImageData(tile, 0, 0);
    tileCanvas = tc;
  } else tileCanvas = tile;
  const pat = ctx.createPattern(tileCanvas, 'repeat')!;
  const scale = (0.22 * pxPerM) / (tile as any).width; // tile covers 22 cm
  pat.setTransform(new DOMMatrix().scale(scale, scale));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  const [fr, fg, fb] = hexToRgb(feltColor);
  const lum = (0.3 * fr + 0.59 * fg + 0.11 * fb) / 255;
  // large-scale lighting irregularity (cloth stretched over padding)
  const rnd = mulberry32(17);
  for (let i = 0; i < 12; i++) {
    const x = rnd() * w,
      y = rnd() * h,
      r = (0.2 + rnd() * 0.4) * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rnd() * 0.04;
    g.addColorStop(0, rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // wear patches in front of each seat and the dealer (lighter, desaturated, matted nap)
  const wearA = [0, 0.05, 0.1, 0.16][wear];
  if (wearA > 0) {
    const spots = [...layout.seats.map((s) => s.cards), layout.dealer.deck, layout.dealer.shuffle];
    for (const sp of spots) {
      const [x, y] = toPx(sp.x, sp.z);
      const r = 0.14 * pxPerM;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${Math.min(255, fr + 70)},${Math.min(255, fg + 70)},${Math.min(255, fb + 60)},${wearA})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // card slide marks: faint streaks from dealer to seats
    ctx.lineCap = 'round';
    for (const s of layout.seats) {
      const [x0, y0] = toPx(layout.dealer.deck.x, layout.dealer.deck.z);
      const [x1, y1] = toPx(s.cards.x, s.cards.z);
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(255,255,255,${wearA * 0.045})`;
        ctx.lineWidth = (0.05 + rnd() * 0.03) * pxPerM;
        ctx.filter = 'blur(6px)';
        ctx.beginPath();
        ctx.moveTo(x0 + (rnd() - 0.5) * 20, y0 + (rnd() - 0.5) * 20);
        ctx.lineTo(x1 + (rnd() - 0.5) * 30, y1 + (rnd() - 0.5) * 30);
        ctx.stroke();
        ctx.filter = 'none';
      }
    }
    // chalk/dust specks
    for (let i = 0; i < 400 * wear; i++) {
      ctx.fillStyle = `rgba(240,235,220,${0.05 + rnd() * 0.12})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // a faint stain or two on vintage
    if (wear >= 3) {
      for (let i = 0; i < 2; i++) {
        const x = w * (0.25 + rnd() * 0.5),
          y = h * (0.3 + rnd() * 0.4),
          r = (0.04 + rnd() * 0.04) * pxPerM;
        const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
        g.addColorStop(0, 'rgba(40,25,10,0.03)');
        g.addColorStop(0.9, 'rgba(40,25,10,0.07)');
        g.addColorStop(1, 'rgba(40,25,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // ambient occlusion where the cloth meets the raised racetrack and rail
  {
    const path0 = layout.dims.path;
    for (let k = 0; k < 10; k++) {
      const off = -k * 0.006;
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const { p, n } = path0.at(i / 200, 0);
        const [x, y] = toPx(p.x + n.x * off, p.z + n.z * off);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(0,0,0,${0.09 * (1 - k / 10)})`;
      ctx.lineWidth = 0.008 * pxPerM;
      ctx.stroke();
    }
  }
  // printed betting line (thin double line following the outline)
  const ink = lum > 0.45 ? 'rgba(40,30,20,0.55)' : 'rgba(232,206,140,0.55)';
  const path = layout.dims.path;
  // betting line: the outline scaled inward (scaling keeps rounded corners smooth on every table shape)
  const halfX = path.hx + path.r,
    halfZ = path.hz + path.r;
  const line = (off: number, width: number) => {
    const sx = 1 + off / halfX,
      sz = 1 + off / halfZ;
    ctx.beginPath();
    for (let i = 0; i <= 256; i++) {
      const { p } = path.at(i / 256, 0);
      const [x, y] = toPx(p.x * sx, p.z * sz);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = ink;
    ctx.lineWidth = width * pxPerM;
    ctx.stroke();
  };
  line(-0.3, 0.004);
  line(-0.307, 0.0015);
  // logo: printed text in the center toward the dealer
  const bc = layout.board[2];
  const [lx, ly] = toPx(bc.x, bc.z + 0.17);
  ctx.save();
  ctx.translate(lx, ly);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${0.05 * pxPerM}px "Playfair Display", Georgia, serif`;
  ctx.globalAlpha = 0.85;
  ctx.fillText('FELT  &  OAK', 0, 0);
  ctx.font = `400 ${0.018 * pxPerM}px "Playfair Display", Georgia, serif`;
  ctx.fillText('— TEXAS HOLD’EM · EST. MMXXVI —', 0, 0.045 * pxPerM);
  ctx.restore();
  // dealer chip-tray outline + box positions printed
  for (const b of layout.board) {
    const [x, y] = toPx(b.x, b.z);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 0.0015 * pxPerM;
    const cw = 0.066 * pxPerM,
      ch = 0.092 * pxPerM;
    ctx.beginPath();
    ctx.roundRect(x - cw / 2, y - ch / 2, cw, ch, 0.005 * pxPerM);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  return c;
}

/** Procedural environment: dark room, warm lamp, a few soft light panels → PMREM. */
export function buildEnvironment(renderer: THREE.WebGLRenderer, mood: string): THREE.Texture {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicMaterial({ color: mood === 'noir' ? 0x050505 : 0x1a120c, side: THREE.BackSide }));
  room.position.y = 2;
  env.add(room);
  const warm = mood === 'cool' ? 0xdfe8ff : mood === 'noir' ? 0xffffff : 0xffd9a0;
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({ color: warm }));
  lamp.position.set(0, 2.2, 0);
  lamp.rotation.x = Math.PI / 2;
  lamp.scale.setScalar(1);
  (lamp.material as THREE.MeshBasicMaterial).color.multiplyScalar(6);
  env.add(lamp);
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(mood === 'cool' ? 0x405070 : 0x6a4020).multiplyScalar(1.4) });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), panelMat);
    const a = (i / 4) * Math.PI * 2 + 0.5;
    p.position.set(Math.cos(a) * 5.8, 1.6, Math.sin(a) * 5.8);
    p.lookAt(0, 1.6, 0);
    env.add(p);
  }
  // bar shelf glow
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb060).multiplyScalar(2) }));
  bar.position.set(0, 1.2, -5.9);
  env.add(bar);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material)?.dispose?.();
  });
  return rt.texture;
}

export interface BuiltMaterials extends TableMaterials {
  textures: THREE.Texture[];
  dispose(): void;
}

export async function buildMaterials(
  s: Settings,
  q: QualityProfile,
  layout: Layout,
  feltBounds: { minX: number; minZ: number; W: number; D: number },
  progress?: (p: number, label: string) => void,
): Promise<BuiltMaterials> {
  const wear = WEAR_LEVEL[s.look.wear];
  const T = q.tex;
  const textures: THREE.Texture[] = [];
  progress?.(0.05, 'Planing the wood…');
  const jobs = await Promise.all([
    generateTexture('wood', T, T / 2, { type: s.look.wood, wear, seed: 11 }),
    generateTexture('felt', Math.min(512, T / 2), Math.min(512, T / 2), { color: s.look.felt, wear, seed: 21 }),
    generateTexture('leather', T / 2, T / 4, { color: s.look.leather, wear, seed: 31, stitches: [0.08, 0.92], stitchColor: '#d8c29a' }),
    generateTexture('metal', 256, 256, { tint: s.look.trim, wear, seed: 41 }),
    generateTexture('wood', T / 2, T / 4, { type: s.look.wood === 'oak' ? 'walnut' : 'ebony', wear, seed: 13, rings: false }),
    generateTexture('felt', 256, 256, { color: '#2a1810', wear: 0, seed: 71 }),
  ]);
  progress?.(0.55, 'Stretching the felt…');
  const [woodR, feltR, leatherR, metalR, darkR, floorR] = jobs;
  const wood = await texSet(woodR, q.anisotropy);
  const leather = await texSet(leatherR, q.anisotropy);
  const metal = await texSet(metalR, q.anisotropy);
  const dark = await texSet(darkR, q.anisotropy);
  const floorT = await texSet(floorR, 1);
  const feltNormal = await makeTex(feltR.normal, false, true, q.anisotropy);
  const overlayCanvas = await drawFeltOverlay(s.look.felt, wear, layout, feltBounds, Math.min(2048, T * 2), feltR.color);
  const overlay = new THREE.CanvasTexture(overlayCanvas);
  overlay.colorSpace = THREE.SRGBColorSpace;
  overlay.anisotropy = q.anisotropy;
  progress?.(0.8, 'Polishing the rail…');
  textures.push(wood.map, leather.map, metal.map, dark.map, floorT.map, overlay);
  for (const t of [wood.normal, wood.rough, leather.normal, leather.rough, metal.normal, metal.rough, dark.normal, dark.rough, feltNormal, floorT.normal]) if (t) textures.push(t);

  if (feltNormal) {
    feltNormal.channel = 1;
    feltNormal.repeat.set(1, 1);
  }
  const fc = new THREE.Color(s.look.felt);
  const feltParams = {
    map: overlay,
    normalMap: feltNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.92,
    metalness: 0,
  };
  const felt = q.physical
    ? new THREE.MeshPhysicalMaterial({ ...feltParams, sheen: 0.8, sheenRoughness: 0.55, sheenColor: fc.clone().lerp(new THREE.Color(1, 1, 1), 0.35) })
    : new THREE.MeshStandardMaterial(feltParams);
  const varnish = Math.max(0.1, 0.65 - wear * 0.12);
  const woodParams = { map: wood.map, normalMap: wood.normal, roughnessMap: wood.rough, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.5, 0.5) };
  const woodM = q.physical
    ? new THREE.MeshPhysicalMaterial({ ...woodParams, clearcoat: varnish, clearcoatRoughness: 0.12 + wear * 0.08 })
    : new THREE.MeshStandardMaterial({ ...woodParams, roughness: 0.8 });
  const darkParams = { map: dark.map, normalMap: dark.normal, roughnessMap: dark.rough, roughness: 1, metalness: 0 };
  const darkWood = q.physical ? new THREE.MeshPhysicalMaterial({ ...darkParams, clearcoat: varnish * 0.8, clearcoatRoughness: 0.2 }) : new THREE.MeshStandardMaterial(darkParams);
  const leatherM = new THREE.MeshStandardMaterial({
    map: leather.map,
    normalMap: leather.normal,
    roughnessMap: leather.rough,
    roughness: 0.75,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  if (q.physical) {
    (leatherM as any).envMapIntensity = 0.8;
  }
  const metalM = new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normal, roughnessMap: metal.rough, metalness: 1, roughness: 1, envMapIntensity: 1.4 });
  const cupInner = new THREE.MeshStandardMaterial({ color: 0x0a0807, roughness: 0.6, metalness: 0.2 });
  floorT.map.repeat.set(10, 10);
  if (floorT.normal) floorT.normal.repeat.set(10, 10);
  const floor = new THREE.MeshStandardMaterial({ map: floorT.map, normalMap: floorT.normal, roughness: 1, color: 0x9a8070 });
  progress?.(1, 'Ready');
  const mats = [felt, woodM, darkWood, leatherM, metalM, cupInner, floor];
  return {
    felt,
    wood: woodM,
    darkWood,
    leather: leatherM,
    metal: metalM,
    cupInner,
    floor,
    textures,
    dispose() {
      textures.forEach((t) => t.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
