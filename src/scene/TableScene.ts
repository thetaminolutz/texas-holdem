// The 3D poker table: renderer, lights, procedural materials, cards, chips, buttons and the render loop.
import * as THREE from 'three';
import type { Settings, Quality } from '../state/settings';
import { computeLayout, type Layout } from './layout';
import { buildTable, buildLamp, type TableMeshes } from './tableBuilder';
import { buildMaterials, buildEnvironment, QUALITY, WEAR_LEVEL, type BuiltMaterials, type QualityLevel } from './materials';
import { CameraRig } from './camera';
import { CardSystem, BlobShadows, CARD_SIZE } from './cards';
import { ChipSystem, CHIP } from './chips';
import { drawCardAtlas, ATLAS } from './textures/cardArt';
import { drawChipAtlas } from './textures/chipArt';
import { generateTexture, toBitmap } from './textures/textureClient';

export type Ticker = (dt: number) => boolean; // return true while still animating

const LIGHT_MOODS: Record<string, { color: number; intensity: number; hemi: number; exposure: number; penumbra: number; angle: number; fog: number }> = {
  warm: { color: 0xffd3a0, intensity: 40, hemi: 0.08, exposure: 0.92, penumbra: 1.0, angle: 0.52, fog: 0 },
  smoky: { color: 0xffc78a, intensity: 28, hemi: 0.12, exposure: 0.95, penumbra: 1.0, angle: 0.64, fog: 0.18 },
  cool: { color: 0xe6eeff, intensity: 28, hemi: 0.16, exposure: 0.88, penumbra: 0.9, angle: 0.68, fog: 0 },
  noir: { color: 0xfff4e4, intensity: 36, hemi: 0.04, exposure: 0.9, penumbra: 0.7, angle: 0.55, fog: 0.06 },
};

export class TableScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig: CameraRig;
  layout: Layout;
  cards!: CardSystem;
  chips!: ChipSystem;
  cardShadows!: BlobShadows;
  chipShadows!: BlobShadows;
  buttons = { dealer: new THREE.Group(), sb: new THREE.Group(), bb: new THREE.Group() };
  private spot!: THREE.SpotLight;
  private hemi!: THREE.HemisphereLight;
  private lamp!: THREE.Group;
  private table: TableMeshes | null = null;
  private mats: BuiltMaterials | null = null;
  private env: THREE.Texture | null = null;
  private tickers = new Set<Ticker>();
  private dirty = true;
  private raf = 0;
  private last = 0;
  private running = false;
  private lost = false;
  quality: QualityLevel = 'high';
  private autoQuality = false;
  private frameTimes: number[] = [];
  private settings: Settings;
  private cardAtlasTex: THREE.CanvasTexture | null = null;
  private chipAtlasTex: THREE.CanvasTexture | null = null;
  private nSeats: number;
  onFrame: (() => void) | null = null;
  onQualityChange: ((q: QualityLevel) => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  fps = 60;

  constructor(
    public canvas: HTMLCanvasElement,
    settings: Settings,
    nSeats: number,
  ) {
    this.settings = settings;
    this.nSeats = nSeats;
    this.quality = resolveQuality(settings.look.quality);
    this.autoQuality = settings.look.quality === 'auto';
    const q = QUALITY[this.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x0d0907);
    this.rig = new CameraRig(1);
    this.layout = computeLayout(settings.look.tableShape, nSeats);
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.raf);
  };
  private onRestored = () => {
    this.lost = false;
    this.dirty = true;
    if (this.cardAtlasTex) this.cardAtlasTex.needsUpdate = true;
    if (this.chipAtlasTex) this.chipAtlasTex.needsUpdate = true;
    this.mats?.textures.forEach((t) => (t.needsUpdate = true));
    this.loop();
  };

  async init(progress?: (p: number, label: string) => void) {
    const s = this.settings;
    // Lights
    this.hemi = new THREE.HemisphereLight(0x8a7560, 0x1a120c, 0.3);
    this.scene.add(this.hemi);
    this.spot = new THREE.SpotLight(0xffd6a0, 38, 6, 0.95, 0.75, 2);
    this.spot.position.set(0, 2.05, 0.15);
    this.spot.target.position.set(0, 0, 0);
    this.spot.castShadow = true;
    this.spot.shadow.bias = -0.00008;
    this.spot.shadow.normalBias = 0.0015;
    this.spot.shadow.camera.near = 0.8;
    this.spot.shadow.camera.far = 3.2;
    this.spot.shadow.radius = this.quality === 'low' ? 1 : 3;
    (this.spot.shadow as any).blurSamples = 12;
    this.scene.add(this.spot, this.spot.target);
    this.lamp = buildLamp();
    this.lamp.position.set(0, 2.15, 0.15);
    this.scene.add(this.lamp);
    // Fill light from the camera side so faces of cards read well
    const fill = new THREE.DirectionalLight(0xffe8cc, 0.12);
    fill.position.set(0, 1.5, 2.5);
    this.scene.add(fill);

    await document.fonts?.load?.('700 40px "Playfair Display"').catch(() => {});
    progress?.(0.1, 'Printing the cards…');
    this.buildAtlases();
    const q = QUALITY[this.quality];
    const clay = await generateTexture('clay', 256, 64, { seed: 61, wear: WEAR_LEVEL[s.look.wear] });
    const clayN = clay.normal ? await toBitmap(clay.normal) : null;
    let clayTex: THREE.Texture | null = null;
    if (clayN) {
      clayTex = clayN instanceof ImageData ? new THREE.DataTexture(clayN.data, clayN.width, clayN.height) : new THREE.Texture(clayN as any);
      clayTex.wrapS = clayTex.wrapT = THREE.RepeatWrapping;
      clayTex.needsUpdate = true;
    }
    this.cards = new CardSystem(this.cardAtlasTex!, q.physical);
    this.chips = new ChipSystem(this.chipAtlasTex!, clayTex, q.physical);
    this.cardShadows = new BlobShadows('rect', 64);
    this.chipShadows = new BlobShadows('round', 160);
    this.scene.add(this.cards.mesh, this.chips.mesh, this.cardShadows.mesh, this.chipShadows.mesh);
    this.buildButtons();
    progress?.(0.2, 'Building the table…');
    await this.rebuildTable((p, l) => progress?.(0.2 + p * 0.75, l));
    this.applyLook(s, true);
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.canvas.parentElement ?? this.canvas);
    window.addEventListener('orientationchange', this.onOrient);
    progress?.(1, 'Ready');
    this.running = true;
    this.last = performance.now();
    this.loop();
  }

  private onOrient = () => setTimeout(() => this.resize(), 250);

  private buildAtlases() {
    const s = this.settings;
    const wear = WEAR_LEVEL[s.look.wear];
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS.size;
    drawCardAtlas(c.getContext('2d')!, { style: s.access.colorblind ? 'four' : s.look.deckStyle, wear, back: s.look.cardBack, seed: 3 });
    if (!this.cardAtlasTex) this.cardAtlasTex = new THREE.CanvasTexture(c);
    else {
      this.cardAtlasTex.image = c;
      this.cardAtlasTex.needsUpdate = true;
    }
    this.cardAtlasTex.colorSpace = THREE.SRGBColorSpace;
    this.cardAtlasTex.anisotropy = QUALITY[this.quality].anisotropy;
    this.cardAtlasTex.generateMipmaps = true;
    const cc = document.createElement('canvas');
    cc.width = cc.height = 2048;
    drawChipAtlas(cc.getContext('2d')!, s.look.chipSet, wear);
    if (!this.chipAtlasTex) this.chipAtlasTex = new THREE.CanvasTexture(cc);
    else {
      this.chipAtlasTex.image = cc;
      this.chipAtlasTex.needsUpdate = true;
    }
    this.chipAtlasTex.colorSpace = THREE.SRGBColorSpace;
    this.chipAtlasTex.anisotropy = QUALITY[this.quality].anisotropy;
  }

  private buildButtons() {
    const mk = (label: string, bg: string, fg: string, r: number, h: number, group: THREE.Group) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d')!;
      const g = x.createRadialGradient(110, 100, 10, 128, 128, 128);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, bg);
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 256);
      x.strokeStyle = fg;
      x.lineWidth = 6;
      x.beginPath();
      x.arc(128, 128, 110, 0, Math.PI * 2);
      x.stroke();
      x.fillStyle = fg;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = `700 ${label.length > 2 ? 54 : 96}px "Playfair Display", Georgia, serif`;
      x.fillText(label, 128, 132);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const top = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
      const sideM = new THREE.MeshPhysicalMaterial({ color: bg, roughness: 0.25, clearcoat: 0.8 });
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r - 0.002, 0), new THREE.Vector2(r, 0.002), new THREE.Vector2(r, h - 0.002), new THREE.Vector2(r - 0.002, h)];
      const lathe = new THREE.LatheGeometry(pts, 40);
      const body = new THREE.Mesh(lathe, sideM);
      const capG = new THREE.CircleGeometry(r - 0.002, 40);
      capG.rotateX(-Math.PI / 2);
      const cap = new THREE.Mesh(capG, top);
      cap.position.y = h + 0.00005;
      body.castShadow = cap.castShadow = true;
      body.receiveShadow = true;
      group.add(body, cap);
      group.visible = false;
      this.scene.add(group);
    };
    mk('DEALER', '#e8e2d2', '#1b1b1b', 0.026, 0.009, this.buttons.dealer);
    mk('SB', '#2b5fae', '#ffffff', 0.016, 0.006, this.buttons.sb);
    mk('BB', '#e0b52c', '#1b1b1b', 0.016, 0.006, this.buttons.bb);
  }

  async rebuildTable(progress?: (p: number, label: string) => void) {
    this.layout = computeLayout(this.settings.look.tableShape, this.nSeats);
    const q = QUALITY[this.quality];
    // build geometry first (with temporary materials) to know felt bounds
    const placeholder = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const tmp = buildTable(this.layout, { felt: placeholder, wood: placeholder, leather: placeholder, metal: placeholder, darkWood: placeholder, cupInner: placeholder, floor: placeholder }, q.segments);
    const mats = await buildMaterials(this.settings, q, this.layout, tmp.feltBounds, progress);
    tmp.dispose();
    placeholder.dispose();
    const table = buildTable(this.layout, mats, q.segments);
    if (this.table) {
      this.scene.remove(this.table.group);
      this.table.dispose();
    }
    this.mats?.dispose();
    this.table = table;
    this.mats = mats;
    this.scene.add(table.group);
    const { path, racetrack, rail } = this.layout.dims;
    const outline = path.sample(48, racetrack + rail).map((q) => new THREE.Vector3(q.p.x, 0.06, q.p.z));
    // keep the human's cards/stack area fully visible
    outline.push(new THREE.Vector3(0, 0, path.hz + path.r + racetrack + rail + 0.04));
    this.rig.setTableExtent(path.hx + path.r + racetrack + rail, path.hz + path.r + racetrack + rail, outline);
    this.requestRender();
  }

  /** Apply look settings. Heavy changes (textures/shape) rebuild asynchronously. */
  async applyLook(s: Settings, initial = false) {
    const prev = this.settings;
    this.settings = s;
    const mood = LIGHT_MOODS[s.look.lighting] ?? LIGHT_MOODS.warm;
    this.spot.color.setHex(mood.color);
    this.spot.intensity = mood.intensity;
    this.spot.penumbra = mood.penumbra;
    this.spot.angle = mood.angle;
    this.hemi.intensity = mood.hemi;
    this.renderer.toneMappingExposure = mood.exposure;
    this.scene.fog = mood.fog > 0 ? new THREE.FogExp2(0x1a120c, mood.fog) : null;
    if (initial || prev.look.lighting !== s.look.lighting) {
      this.env?.dispose();
      this.env = buildEnvironment(this.renderer, s.look.lighting);
      this.scene.environment = this.env;
      this.scene.environmentIntensity = 0.32;
    }
    this.rig.sway = s.anim.cameraSway;
    this.rig.reduceMotion = s.anim.reduceMotion;
    if (initial || prev.look.camera !== s.look.camera) this.rig.setPreset(s.look.camera);
    const q = resolveQuality(s.look.quality);
    this.autoQuality = s.look.quality === 'auto';
    if (!initial && !this.autoQuality && q !== this.quality) this.setQuality(q);
    if (!initial) {
      const atlasChanged = prev.look.deckStyle !== s.look.deckStyle || prev.look.cardBack !== s.look.cardBack || prev.look.wear !== s.look.wear || prev.look.chipSet !== s.look.chipSet || prev.access.colorblind !== s.access.colorblind;
      if (atlasChanged) this.buildAtlases();
      const tableChanged = ['tableShape', 'wood', 'felt', 'leather', 'trim', 'wear'].some((k) => (prev.look as any)[k] !== (s.look as any)[k]);
      if (tableChanged) await this.rebuildTable();
    }
    this.requestRender();
  }

  setQuality(q: QualityLevel) {
    if (q === this.quality) return;
    this.quality = q;
    const p = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.dpr));
    this.spot.shadow.mapSize.set(p.shadowMap, p.shadowMap);
    this.spot.shadow.map?.dispose();
    (this.spot.shadow as any).map = null;
    this.spot.shadow.radius = q === 'low' ? 1 : 3;
    this.resize();
    this.onQualityChange?.(q);
    void this.rebuildTable();
  }

  async setSeatCount(n: number) {
    if (n === this.nSeats) return;
    this.nSeats = n;
    await this.rebuildTable();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.rig.setAspect(w / h);
    this.spot.shadow.mapSize.setScalar(QUALITY[this.quality].shadowMap);
    this.requestRender();
  }

  addTicker(t: Ticker) {
    this.tickers.add(t);
    this.requestRender();
    return () => this.tickers.delete(t);
  }

  requestRender() {
    this.dirty = true;
    if (this.running && !this.raf && !this.lost) this.raf = requestAnimationFrame(this.frame);
  }

  private loop() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.running || this.lost) return;
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    let active = false;
    for (const t of [...this.tickers]) {
      try {
        if (t(dt)) active = true;
        else this.tickers.delete(t);
      } catch (e) {
        console.error('ticker failed', e);
        this.tickers.delete(t);
      }
    }
    const camMoving = this.rig.update(dt);
    // the hanging lamp is only drawn when the camera is below it (seen from above it would hide the table)
    if (this.lamp) this.lamp.visible = this.rig.camera.position.y < this.lamp.position.y - 0.25;
    const changed = this.cards.update() || false;
    const chipChanged = this.chips.update() || false;
    if (changed || chipChanged || active || this.dirty) this.updateShadows();
    if (active || camMoving || this.dirty || changed || chipChanged) {
      const t0 = performance.now();
      this.renderer.render(this.scene, this.rig.camera);
      this.trackPerf(performance.now() - t0, dt);
      this.onFrame?.();
      this.dirty = false;
    }
    if (active || camMoving || this.tickers.size > 0) this.raf = requestAnimationFrame(this.frame);
    else this.last = performance.now();
  };

  /** Soft contact shadows under cards and chip stacks; they grow and fade with height. */
  private updateShadows() {
    this.cardShadows.begin();
    for (const c of this.cards.cards) {
      if (!c.visible) continue;
      const hgt = Math.max(0, c.pos.y - 0.001);
      const k = 1 + hgt * 6;
      const op = Math.max(0, 0.42 - hgt * 2.2);
      if (op <= 0.01) continue;
      const e = new THREE.Euler().setFromQuaternion(c.quat, 'YXZ');
      this.cardShadows.add(c.pos.x, c.pos.z + hgt * 0.15, CARD_SIZE.w * 1.25 * k, CARD_SIZE.h * 1.18 * k, e.y, op, 0.00012);
    }
    this.cardShadows.end();
    // chip stacks: one blob per column (merge chips with the same x/z)
    this.chipShadows.begin();
    const seen = new Map<string, number>();
    for (const c of this.chips.chips) {
      if (!c.visible) continue;
      const key = `${Math.round(c.pos.x * 200)}:${Math.round(c.pos.z * 200)}`;
      const h = Math.max(0, c.pos.y);
      if (h > 0.004 && seen.has(key)) continue;
      seen.set(key, 1);
      const k = 1 + h * 5;
      const op = Math.max(0, 0.55 - h * 2.5);
      if (op > 0.02) this.chipShadows.add(c.pos.x + 0.002, c.pos.z + 0.003, CHIP.r * 3.0 * k, CHIP.r * 3.0 * k, 0, op, 0.00015);
    }
    this.chipShadows.end();
  }

  private trackPerf(_renderMs: number, dt: number) {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length >= 90) {
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.fps = 1000 / median;
      this.frameTimes = [];
      if (this.autoQuality && median > 24) {
        const order: QualityLevel[] = ['ultra', 'high', 'medium', 'low'];
        const i = order.indexOf(this.quality);
        if (i < order.length - 1) this.setQuality(order[i + 1]);
      }
    }
  }

  /** World → CSS pixel coordinates relative to the canvas. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.rig.camera);
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 };
  }

  /** Screen → table plane (y = height). */
  unproject(px: number, py: number, height = 0): THREE.Vector3 | null {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const ndc = new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.rig.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out);
  }

  pause(p: boolean) {
    if (p) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.running = true;
      this.last = performance.now();
      this.requestRender();
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    window.removeEventListener('orientationchange', this.onOrient);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.table?.dispose();
    this.mats?.dispose();
    this.cards?.dispose();
    this.chips?.dispose();
    this.cardShadows?.dispose();
    this.chipShadows?.dispose();
    this.cardAtlasTex?.dispose();
    this.chipAtlasTex?.dispose();
    this.env?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mm = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mm) ? mm : [mm]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export function resolveQuality(q: Quality): QualityLevel {
  if (q !== 'auto') return q;
  // Heuristic start: iPad / desktop with decent GPU -> high; small or low-memory devices -> medium
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem <= 2) return 'medium';
  return 'high';
}
