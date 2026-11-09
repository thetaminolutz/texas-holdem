// Clay chips: one InstancedMesh, per-instance denomination picks cap/edge art from a 2048² atlas.
import * as THREE from 'three';
import { DENOMS } from './catalog';
import { CHIP_ATLAS } from './textures/chipArt';

export const CHIP = { r: 0.0195, h: 0.0033, bevel: 0.0005 };
export const MAX_CHIPS = 900;

export interface ChipObj {
  id: number;
  denom: number; // value
  pos: THREE.Vector3; // bottom center
  quat: THREE.Quaternion;
  visible: boolean;
}

function chipGeometry(seg = 40): THREE.BufferGeometry {
  const { r, h, bevel: b } = CHIP;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  // profile rings: [radius, y, normalR, normalY, side, v]
  const rings: [number, number, number, number, number, number][] = [
    [r - b, h, 0.5, 0.86, 0, 0],
    [r, h - b, 1, 0.15, 0, 0.12],
    [r, b, 1, -0.15, 0, 0.88],
    [r - b, 0, 0.5, -0.86, 0, 1],
  ];
  // side band
  const ringStart: number[] = [];
  for (const [rr, y, nr, ny, sd, v] of rings) {
    ringStart.push(pos.length / 3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a),
        s = Math.sin(a);
      pos.push(c * rr, y, s * rr);
      const l = Math.hypot(nr, ny);
      nor.push((c * nr) / l, ny / l, (s * nr) / l);
      uv.push(i / seg, v);
      side.push(sd);
    }
  }
  // Use edge texture on band between ring1 and ring2; bevels between ring0-1 and ring2-3 with cap-ish shading
  const strip = (r0: number, r1: number, flip: boolean) => {
    for (let i = 0; i < seg; i++) {
      const a = ringStart[r0] + i,
        bb = ringStart[r1] + i;
      if (!flip) idx.push(a, a + 1, bb, a + 1, bb + 1, bb);
      else idx.push(a, bb, a + 1, a + 1, bb, bb + 1);
    }
  };
  strip(0, 1, false);
  strip(1, 2, false);
  strip(2, 3, false);
  // caps
  const cap = (y: number, ny: number, sd: number) => {
    const center = pos.length / 3;
    pos.push(0, y, 0);
    nor.push(0, ny, 0);
    uv.push(0.5, 0.5);
    side.push(sd);
    const start = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a),
        s = Math.sin(a);
      pos.push(c * (r - b), y, s * (r - b));
      nor.push(0, ny, 0);
      uv.push(0.5 + (c * (r - b)) / (2 * r), 0.5 - ((s * (r - b)) / (2 * r)) * sd);
      side.push(sd);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) idx.push(center, start + i + 1, start + i);
      else idx.push(center, start + i, start + i + 1);
    }
  };
  cap(h, 1, 1);
  cap(0, -1, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

export class ChipSystem {
  mesh: THREE.InstancedMesh;
  chips: ChipObj[] = [];
  private free: number[] = [];
  private aDenom: THREE.InstancedBufferAttribute;
  private m4 = new THREE.Matrix4();
  private one = new THREE.Vector3(1, 1, 1);
  material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  dirty = true;

  constructor(atlas: THREE.Texture, normal: THREE.Texture | null, physical: boolean) {
    const geo = chipGeometry();
    this.aDenom = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHIPS), 1);
    this.aDenom.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDenom', this.aDenom);
    const params = { map: atlas, roughness: 0.42, metalness: 0, normalMap: normal ?? undefined, normalScale: new THREE.Vector2(0.4, 0.4) };
    this.material = physical ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 0.3, clearcoatRoughness: 0.35 }) : new THREE.MeshStandardMaterial(params);
    const A = CHIP_ATLAS;
    this.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDenom; attribute float aSide;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          {
            float col = mod(aDenom, ${A.capCols}.0);
            float row = floor(aDenom / ${A.capCols}.0 + 0.001);
            vec2 a;
            if (abs(aSide) > 0.25) {
              a = vec2((col + uv.x) * ${A.cap / A.size}, (row + (1.0 - uv.y)) * ${A.cap / A.size});
            } else {
              a = vec2(uv.x, (${A.edgeTop}.0 + (aDenom + 0.1 + uv.y * 0.8) * ${A.edgeH}.0) / ${A.size}.0);
            }
            vMapUv = vec2(a.x, 1.0 - a.y);
            #ifdef USE_NORMALMAP
            vNormalMapUv = uv * vec2(3.0, 1.0);
            #endif
          }`,
        );
    };
    this.material.customProgramCacheKey = () => 'chip-v2';
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX_CHIPS);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_CHIPS; i++) {
      this.chips.push({ id: i, denom: 1, pos: new THREE.Vector3(0, -50, 0), quat: new THREE.Quaternion(), visible: false });
      this.free.push(MAX_CHIPS - 1 - i);
    }
    this.update(true);
  }

  alloc(denom: number): ChipObj | null {
    const id = this.free.pop();
    if (id === undefined) return null;
    const c = this.chips[id];
    c.denom = denom;
    c.visible = true;
    this.dirty = true;
    return c;
  }
  release(c: ChipObj) {
    if (!c.visible) return;
    c.visible = false;
    this.free.push(c.id);
    this.dirty = true;
  }
  releaseAll() {
    for (const c of this.chips) if (c.visible) this.release(c);
  }
  get used() {
    return MAX_CHIPS - this.free.length;
  }

  setAtlas(t: THREE.Texture) {
    this.material.map = t;
    this.material.needsUpdate = true;
  }

  update(force = false) {
    if (!this.dirty && !force) return false;
    for (const c of this.chips) {
      if (!c.visible) {
        this.m4.makeScale(0, 0, 0);
        this.m4.setPosition(0, -50, 0);
      } else this.m4.compose(c.pos, c.quat, this.one);
      this.mesh.setMatrixAt(c.id, this.m4);
      this.aDenom.setX(c.id, Math.max(0, DENOMS.indexOf(c.denom as any)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aDenom.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
