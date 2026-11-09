// Builds the physical poker table meshes from a RoundedPath outline by sweeping cross-section profiles.
import * as THREE from 'three';
import { RoundedPath, type Layout } from './layout';

export interface ProfilePt {
  o: number; // outward offset from felt edge (m)
  y: number; // height (m)
}

/** Sweep a 2D profile (offset, height) around the closed path. UV u = distance along path / uScale, v = profile length / vScale. */
export function sweep(path: RoundedPath, profile: ProfilePt[], segments: number, uScale: number, vScale: number): THREE.BufferGeometry {
  const P = profile.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // profile normals (2D: outward offset, up) via tangent rotation
  const pn: { o: number; y: number }[] = [];
  const pv: number[] = [0];
  for (let i = 0; i < P; i++) {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(P - 1, i + 1)];
    const to = b.o - a.o,
      ty = b.y - a.y;
    const l = Math.hypot(to, ty) || 1;
    // rotate tangent (to,ty) by -90°: normal = (ty, -to)... choose the one pointing "up/outward"
    let no = ty / l,
      ny = -to / l;
    if (ny < 0 || (Math.abs(ny) < 1e-6 && no < 0)) {
      no = -no;
      ny = -ny;
    }
    pn.push({ o: no, y: ny });
    if (i > 0) pv.push(pv[i - 1] + Math.hypot(profile[i].o - profile[i - 1].o, profile[i].y - profile[i - 1].y));
  }
  const perim = path.perimeter(0);
  const reps = Math.max(1, Math.round(perim / uScale));
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const { p, n } = path.at(t % 1, 0);
    for (let i = 0; i < P; i++) {
      const pr = profile[i];
      pos.push(p.x + n.x * pr.o, pr.y, p.z + n.z * pr.o);
      nor.push(n.x * pn[i].o, pn[i].y, n.z * pn[i].o);
      uv.push(t * reps, pv[i] / vScale);
    }
  }
  for (let s = 0; s < segments; s++)
    for (let i = 0; i < P - 1; i++) {
      const a = s * P + i,
        b = (s + 1) * P + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Fix orientation: ensure triangles face outward/up (compare with normals)
  return g;
}

export function feltGeometry(path: RoundedPath, segments: number, detailScale: number) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const { p } = path.at(i / segments, 0.004);
    pts.push(new THREE.Vector2(p.x, -p.z));
  }
  const shape = new THREE.Shape(pts);
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.getAttribute('position');
  const uv0: number[] = [];
  const uv1: number[] = [];
  const W = bb.max.x - bb.min.x,
    D = bb.max.z - bb.min.z;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i);
    uv0.push((x - bb.min.x) / W, 1 - (z - bb.min.z) / D);
    uv1.push(x / detailScale, z / detailScale);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv0, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return { geometry: g, bounds: { minX: bb.min.x, minZ: bb.min.z, W, D } };
}

export interface TableMaterials {
  felt: THREE.Material;
  wood: THREE.Material;
  leather: THREE.Material;
  metal: THREE.Material;
  darkWood: THREE.Material;
  cupInner: THREE.Material;
  floor: THREE.Material;
}

export interface TableMeshes {
  group: THREE.Group;
  feltBounds: { minX: number; minZ: number; W: number; D: number };
  dispose(): void;
}

export function buildTable(layout: Layout, mats: TableMaterials, segments: number): TableMeshes {
  const { path, racetrack: rt, rail, railHeight: rh } = layout.dims;
  const group = new THREE.Group();
  group.name = 'table';
  const geoms: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = false, receive = true) => {
    geoms.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };
  const felt = feltGeometry(path, segments, 0.22);
  add(felt.geometry, mats.felt).name = 'felt';

  // Felt tuck: the cloth curves up slightly into the racetrack
  add(
    sweep(path, [
      { o: -0.006, y: 0 },
      { o: 0.0, y: 0.0015 },
      { o: 0.004, y: 0.005 },
      { o: 0.006, y: 0.0085 },
    ], segments, 0.3, 0.01),
    mats.felt,
  );
  // Wooden racetrack with rounded inner edge and slight crown
  const raceProfile: ProfilePt[] = [
    { o: 0.006, y: 0.0085 },
    { o: 0.008, y: 0.011 },
    { o: 0.012, y: 0.0125 },
    { o: rt * 0.5, y: 0.0135 },
    { o: rt - 0.006, y: 0.013 },
    { o: rt, y: 0.012 },
  ];
  add(sweep(path, raceProfile, segments, 0.9, 0.3), mats.wood).name = 'racetrack';
  // brass/chrome trim strip
  add(
    sweep(path, [
      { o: rt - 0.0005, y: 0.012 },
      { o: rt + 0.001, y: 0.0175 },
      { o: rt + 0.0045, y: 0.019 },
      { o: rt + 0.0075, y: 0.017 },
    ], segments, 0.2, 0.01),
    mats.metal,
  ).name = 'trim';
  // Padded leather rail: superellipse bulge
  const railProfile: ProfilePt[] = [];
  const r0 = rt + 0.007,
    r1 = rt + rail;
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * (1 - i / steps); // from inner (pi) to outer (0)
    const c = Math.cos(a),
      s = Math.sin(a);
    const ex = 0.6; // squareness
    const sx = Math.sign(c) * Math.pow(Math.abs(c), ex);
    const sy = Math.pow(Math.abs(s), ex);
    railProfile.push({ o: (r0 + r1) / 2 + sx * (r1 - r0) / 2, y: 0.017 + sy * (rh - 0.017) });
  }
  // tuck under on the outside
  railProfile.push({ o: r1 + 0.002, y: 0.01 });
  railProfile.push({ o: r1 - 0.004, y: -0.004 });
  const railMesh = add(sweep(path, railProfile, segments, 0.5, 0.25), mats.leather, true, true);
  railMesh.name = 'rail';
  // Apron (wood skirt)
  add(
    sweep(path, [
      { o: r1 - 0.012, y: -0.004 },
      { o: r1 - 0.004, y: -0.006 },
      { o: r1 - 0.002, y: -0.02 },
      { o: r1 - 0.002, y: -0.1 },
      { o: r1 - 0.01, y: -0.115 },
      { o: r1 - 0.06, y: -0.12 },
    ], segments, 0.9, 0.3),
    mats.darkWood,
  ).name = 'apron';
  // Cup holders in the racetrack, to the right of each seat
  const cupG = new THREE.TorusGeometry(0.036, 0.0035, 10, 40);
  cupG.rotateX(Math.PI / 2);
  const innerG = new THREE.CylinderGeometry(0.034, 0.03, 0.03, 32, 1, true);
  const bottomG = new THREE.CircleGeometry(0.0345, 32);
  bottomG.rotateX(-Math.PI / 2);
  geoms.push(cupG, innerG, bottomG);
  if (rt >= 0.08) {
    for (const seat of layout.seats) {
      const t = (seat.t + 0.045) % 1;
      const { p, n } = path.at(t, 0);
      const c = { x: p.x + n.x * rt * 0.52, z: p.z + n.z * rt * 0.52 };
      const ring = new THREE.Mesh(cupG, mats.metal);
      ring.position.set(c.x, 0.0135, c.z);
      ring.castShadow = false;
      ring.receiveShadow = true;
      const inner = new THREE.Mesh(innerG, mats.cupInner);
      inner.position.set(c.x, 0.0135 - 0.015, c.z);
      const bottom = new THREE.Mesh(bottomG, mats.cupInner);
      bottom.position.set(c.x, 0.0139, c.z); // dark recess drawn flush with the racetrack surface
      group.add(ring, inner, bottom);
    }
  }
  // Floor far below
  const floorG = new THREE.PlaneGeometry(14, 14);
  floorG.rotateX(-Math.PI / 2);
  const floor = add(floorG, mats.floor, false, false);
  floor.position.y = -0.75;
  // soft shadow of the table on the floor
  const fsC = document.createElement('canvas');
  fsC.width = fsC.height = 128;
  const fx = fsC.getContext('2d')!;
  const fg = fx.createRadialGradient(64, 64, 20, 64, 64, 64);
  fg.addColorStop(0, 'rgba(0,0,0,0.85)');
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  fx.fillStyle = fg;
  fx.fillRect(0, 0, 128, 128);
  const fsTex = new THREE.CanvasTexture(fsC);
  const fsG = new THREE.PlaneGeometry(1, 1);
  fsG.rotateX(-Math.PI / 2);
  geoms.push(fsG);
  const fsM = new THREE.MeshBasicMaterial({ map: fsTex, transparent: true, depthWrite: false, color: 0x000000 });
  const fs = new THREE.Mesh(fsG, fsM);
  const ext = path.hx + path.r + rt + rail;
  const extZ = path.hz + path.r + rt + rail;
  fs.scale.set(ext * 2.6, 1, extZ * 2.6);
  fs.position.y = -0.749;
  group.add(fs);
  floor.name = 'floor';
  // Pedestal / table base in shadow
  const baseG = new THREE.CylinderGeometry(0.25, 0.35, 0.62, 24);
  const base = add(baseG, mats.darkWood);
  base.position.y = -0.12 - 0.31;
  return {
    group,
    feltBounds: felt.bounds,
    dispose() {
      geoms.forEach((g) => g.dispose());
    },
  };
}

/** Hanging lamp above the table (visible from low camera angles). */
export function buildLamp(): THREE.Group {
  const g = new THREE.Group();
  const shadeG = new THREE.CylinderGeometry(0.12, 0.42, 0.22, 48, 1, true);
  const shadeM = new THREE.MeshStandardMaterial({ color: 0x1d3a26, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(shadeG, shadeM);
  const innerM = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe0a8, emissiveIntensity: 0.6, side: THREE.BackSide });
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.415, 0.215, 48, 1, true), innerM);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff4dc }));
  bulb.position.y = -0.05;
  const rodG = new THREE.CylinderGeometry(0.006, 0.006, 1.2, 8);
  const rod = new THREE.Mesh(rodG, new THREE.MeshStandardMaterial({ color: 0x8a6a30, metalness: 1, roughness: 0.3 }));
  rod.position.y = 0.7;
  const rimG = new THREE.TorusGeometry(0.42, 0.006, 8, 64);
  rimG.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimG, new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.25 }));
  rim.position.y = -0.11;
  g.add(shade, inner, bulb, rod, rim);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = false));
  return g;
}
