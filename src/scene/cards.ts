// All cards are one InstancedMesh (single draw call). A custom shader picks the face from a 2048² atlas,
// bends the card for corner peeks and applies glow/dim for showdown highlighting.
import * as THREE from 'three';
import { ATLAS, BACK_SLOT, CARD_W, CARD_H } from './textures/cardArt';

export const CARD_SIZE = { w: 0.063, h: 0.088, t: 0.00035 };
export const MAX_CARDS = 64;

export interface CardObj {
  id: number;
  face: number; // 0..51, -1 = unknown (back on both sides)
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  bend: number;
  bendSign: number;
  glow: number;
  dim: number;
  visible: boolean;
  scale: number;
}

function cardGeometry(): THREE.BufferGeometry {
  const { w, h, t } = CARD_SIZE;
  const sx = 4,
    sz = 6;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  const face = (y: number, ny: number, sd: number, flip: boolean) => {
    const base = pos.length / 3;
    for (let j = 0; j <= sz; j++)
      for (let i = 0; i <= sx; i++) {
        const u = i / sx,
          v = j / sz;
        pos.push(-w / 2 + u * w, y, -h / 2 + v * h);
        nor.push(0, ny, 0);
        uv.push(u, 1 - v);
        side.push(sd);
      }
    for (let j = 0; j < sz; j++)
      for (let i = 0; i < sx; i++) {
        const a = base + j * (sx + 1) + i;
        const b = a + 1,
          c = a + (sx + 1),
          d = c + 1;
        if (!flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
  };
  face(t / 2, 1, 1, false);
  face(-t / 2, -1, -1, true);
  // edges (thin strips), sampling the paper-edge swatch
  const edge = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const base = pos.length / 3;
    pos.push(x0, t / 2, z0, x1, t / 2, z1, x0, -t / 2, z0, x1, -t / 2, z1);
    for (let k = 0; k < 4; k++) {
      nor.push(nx, 0, nz);
      side.push(0);
    }
    uv.push(0.2, 0.2, 0.8, 0.2, 0.2, 0.8, 0.8, 0.8);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  const W = w / 2 - 0.0012,
    H = h / 2 - 0.0012; // inset so the square edge hides behind rounded corners
  edge(-W, H + 0.0012, W, H + 0.0012, 0, 1);
  edge(W, -H - 0.0012, -W, -H - 0.0012, 0, -1);
  edge(W + 0.0012, H, W + 0.0012, -H, 1, 0);
  edge(-W - 0.0012, -H, -W - 0.0012, H, -1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

export class CardSystem {
  mesh: THREE.InstancedMesh;
  cards: CardObj[] = [];
  private aCard: THREE.InstancedBufferAttribute;
  private aFx: THREE.InstancedBufferAttribute;
  private m4 = new THREE.Matrix4();
  private s3 = new THREE.Vector3();
  material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  dirty = true;

  constructor(atlas: THREE.Texture, physical: boolean) {
    const geo = cardGeometry();
    this.aCard = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS), 1);
    this.aFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 4), 4);
    geo.setAttribute('aCard', this.aCard);
    geo.setAttribute('aFx', this.aFx);
    const params = { map: atlas, roughness: 0.38, metalness: 0, alphaTest: 0.5 };
    this.material = physical
      ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 0.45, clearcoatRoughness: 0.28, specularIntensity: 0.6 })
      : new THREE.MeshStandardMaterial(params);
    const cell = new THREE.Vector4(ATLAS.cellW / ATLAS.size, ATLAS.cellH / ATLAS.size, CARD_W / ATLAS.size, CARD_H / ATLAS.size);
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uCell = { value: cell };
      sh.uniforms.uCols = { value: ATLAS.cols };
      sh.uniforms.uSize = { value: new THREE.Vector2(CARD_SIZE.w, CARD_SIZE.h) };
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aCard; attribute vec4 aFx; attribute float aSide;
          uniform vec4 uCell; uniform float uCols; uniform vec2 uSize;
          varying float vGlow; varying float vDim;
          vec2 cellOrigin(float slot){ float col = mod(slot, uCols); float row = floor(slot / uCols + 0.001); return vec2(col*uCell.x, row*uCell.y); }
          void bendCard(inout vec3 p, inout vec3 n){
            float b = aFx.x; if (b < 0.001) return;
            vec2 dir = normalize(vec2(uSize.x, uSize.y * 1.2));
            float corner = dot(uSize * 0.5, dir);
            float L = 0.03 + 0.035 * b;
            float d = dot(p.xz, dir) - (corner - L);
            if (d <= 0.0) return;
            float R = L / (b * 1.7);
            float phi = d / R;
            float s = aFx.y;
            float along = R * sin(phi);
            float up = R * (1.0 - cos(phi));
            p.xz += dir * (along - d);
            p.y += up * s;
            float nd = dot(n.xz, dir);
            float nd2 = nd * cos(phi) - n.y * sin(phi) * s;
            float ny2 = nd * sin(phi) * s + n.y * cos(phi);
            n.xz += dir * (nd2 - nd); n.y = ny2;
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3( normal );
          vec3 bentPos = position; bendCard(bentPos, objectNormal);
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = bentPos;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          {
            float slot = aSide > 0.5 ? (aCard < 0.0 ? ${BACK_SLOT}.0 : aCard) : (aSide < -0.5 ? ${BACK_SLOT}.0 : ${BACK_SLOT + 1}.0);
            float u = aSide < -0.5 ? 1.0 - uv.x : uv.x;
            vec2 a = cellOrigin(slot) + vec2(u * uCell.z, (1.0 - uv.y) * uCell.w);
            vMapUv = vec2(a.x, 1.0 - a.y);
            vGlow = aFx.z; vDim = aFx.w;
          }`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow; varying float vDim;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= (1.0 - vDim * 0.55);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.82, 0.45) * vGlow * 0.22;');
    };
    this.material.customProgramCacheKey = () => 'card-v2';
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX_CARDS);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.aFx.setUsage(THREE.DynamicDrawUsage);
    this.aCard.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_CARDS; i++) {
      this.cards.push({ id: i, face: -1, pos: new THREE.Vector3(0, -10, 0), quat: new THREE.Quaternion(), bend: 0, bendSign: 1, glow: 0, dim: 0, visible: false, scale: 1 });
    }
    this.mesh.count = MAX_CARDS;
    this.update(true);
  }

  setAtlas(t: THREE.Texture) {
    this.material.map = t;
    this.material.needsUpdate = true;
    this.dirty = true;
  }

  update(force = false) {
    if (!this.dirty && !force) return false;
    for (const c of this.cards) {
      if (!c.visible) {
        this.m4.makeScale(0, 0, 0);
        this.m4.setPosition(0, -50, 0);
      } else {
        this.s3.setScalar(c.scale);
        this.m4.compose(c.pos, c.quat, this.s3);
      }
      this.mesh.setMatrixAt(c.id, this.m4);
      this.aCard.setX(c.id, c.face);
      this.aFx.setXYZW(c.id, c.bend, c.bendSign, c.glow, c.dim);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aCard.needsUpdate = true;
    this.aFx.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Quaternion for a card lying flat, rotated by yaw around Y; faceDown flips around the long axis. */
export function cardQuat(yaw: number, faceDown: boolean, out = new THREE.Quaternion()): THREE.Quaternion {
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  if (!faceDown) return out.copy(qy);
  const qf = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  return out.copy(qy).multiply(qf);
}

// ---------------- Contact shadows (soft blobs under cards and chip stacks) ----------------
export class BlobShadows {
  mesh: THREE.InstancedMesh;
  private colors: THREE.InstancedBufferAttribute;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private used = 0;
  constructor(kind: 'rect' | 'round', max: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    if (kind === 'round') {
      const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    } else {
      ctx.filter = 'blur(10px)';
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(26, 22, 76, 84);
    }
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_INSTANCING_COLOR\n diffuseColor.a *= vColor.r; diffuseColor.rgb = vec3(0.0);\n#endif\n');
    };
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.colors = this.mesh.instanceColor;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }
  begin() {
    this.used = 0;
  }
  add(x: number, z: number, sx: number, sz: number, yaw: number, opacity: number, y = 0.0005) {
    if (this.used >= this.colors.count) return;
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.m4.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, 1, sz));
    this.mesh.setMatrixAt(this.used, this.m4);
    this.colors.setXYZ(this.used, opacity, opacity, opacity);
    this.used++;
  }
  end() {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
