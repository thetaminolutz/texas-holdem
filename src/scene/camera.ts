// Camera rig: presets, aspect-aware framing, touch orbit / pinch / pan with inertia, idle sway, cinematic focus.
import * as THREE from 'three';
import type { CameraPreset } from '../state/settings';

interface Pose {
  tx: number;
  ty: number;
  tz: number;
  radius: number;
  polar: number; // from vertical
  azimuth: number;
}

const PRESETS: Record<CameraPreset, { polar: number; azimuth: number; radiusK: number; tz: number }> = {
  player: { polar: 0.78, azimuth: 0, radiusK: 1, tz: 0.03 },
  top: { polar: 0.05, azimuth: 0, radiusK: 1.06, tz: 0 },
  cinematic: { polar: 1.02, azimuth: 0.3, radiusK: 0.9, tz: 0.02 },
};

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private cur: Pose = { tx: 0, ty: 0, tz: 0, radius: 2.5, polar: 0.8, azimuth: 0 };
  private base: Pose = { ...this.cur };
  private user = { dAz: 0, dPolar: 0, zoom: 1, panX: 0, panZ: 0 };
  private vel = { az: 0, polar: 0 };
  private focus: { x: number; z: number; k: number; until: number } | null = null;
  private time = 0;
  private lastInteract = 0;
  preset: CameraPreset = 'player';
  sway = true;
  reduceMotion = false;
  private tableHalf = { x: 1.2, z: 0.75 };
  private outline: THREE.Vector3[] = [];
  /** screen-space margins in NDC: [left/right, top, bottom] */
  margins = { x: 0.97, top: 0.86, bottom: -0.74 };
  private moving = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.05, 30);
  }

  setTableExtent(halfX: number, halfZ: number, outline?: THREE.Vector3[]) {
    this.tableHalf = { x: halfX, z: halfZ };
    if (outline) this.outline = outline;
    this.recompute();
  }

  private verticalExtent(polar: number, azimuth: number, tz: number, r: number) {
    const cam = this.camera.clone();
    const sp = Math.sin(polar);
    cam.position.set(r * sp * Math.sin(azimuth), r * Math.cos(polar), tz + r * sp * Math.cos(azimuth));
    cam.lookAt(0, 0, tz);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    let min = 9,
      max = -9;
    const v = new THREE.Vector3();
    for (const p of this.outline) {
      v.copy(p).project(cam);
      min = Math.min(min, v.y);
      max = Math.max(max, v.y);
    }
    return { min, max };
  }

  /** Binary-search the radius so every outline point projects inside the margins. */
  private fitRadius(polar: number, azimuth: number, tz: number, startR: number): number {
    if (!this.outline.length) return startR;
    const cam = this.camera.clone();
    const v = new THREE.Vector3();
    const fits = (r: number) => {
      const sp = Math.sin(polar);
      cam.position.set(r * sp * Math.sin(azimuth), r * Math.cos(polar), tz + r * sp * Math.cos(azimuth));
      cam.lookAt(0, 0, tz);
      cam.updateMatrixWorld();
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      for (const p of this.outline) {
        v.copy(p).project(cam);
        if (Math.abs(v.x) > this.margins.x || v.y > this.margins.top || v.y < this.margins.bottom) return false;
      }
      return true;
    };
    let lo = 0.5,
      hi = Math.max(startR * 2, 6);
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  setPreset(p: CameraPreset) {
    this.preset = p;
    this.user = { dAz: 0, dPolar: 0, zoom: 1, panX: 0, panZ: 0 };
    this.recompute();
  }

  resetUser() {
    this.user = { dAz: 0, dPolar: 0, zoom: 1, panX: 0, panZ: 0 };
    this.vel = { az: 0, polar: 0 };
    this.moving = true;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.recompute();
  }

  /** Choose the radius so the whole table (incl. rail and name plates) fits the viewport. */
  private recompute() {
    const base = PRESETS[this.preset];
    // In portrait the table is framed from higher up so it fills the taller screen.
    const portrait = this.camera.aspect < 0.95;
    const pr = portrait && this.preset !== 'top' ? { ...base, polar: base.polar * 0.62, tz: base.tz } : base;
    const cam = this.camera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const hx = this.tableHalf.x + 0.12;
    const hz = this.tableHalf.z + 0.18;
    // fit width
    const rW = hx / Math.tan(hfov / 2);
    // fit depth (projected): the table depth seen at polar angle shrinks by cos(polar)-ish
    const depthSeen = hz * Math.cos(pr.polar) + 0.12 * Math.sin(pr.polar);
    const rD = depthSeen / Math.tan(vfov / 2) + hz * Math.sin(pr.polar) * 0.6;
    const r0 = Math.max(rW, rD);
    // Fit radius, then shift the look-at point so the table is vertically centered between the margins; iterate.
    let tz = pr.tz;
    let fitted = this.fitRadius(pr.polar, pr.azimuth, tz, r0);
    for (let it = 0; it < 4 && this.outline.length && pr.polar > 0.2; it++) {
      const ext = this.verticalExtent(pr.polar, pr.azimuth, tz, fitted);
      const mid = (ext.min + ext.max) / 2;
      const want = (this.margins.top + this.margins.bottom) / 2;
      tz = THREE.MathUtils.clamp(tz - (mid - want) * fitted * 0.35, -0.6, 0.6);
      fitted = this.fitRadius(pr.polar, pr.azimuth, tz, fitted);
    }
    this.base = { tx: 0, ty: 0, tz, radius: fitted * pr.radiusK, polar: pr.polar, azimuth: pr.azimuth };
    this.moving = true;
  }

  interact() {
    this.lastInteract = this.time;
    this.moving = true;
  }

  orbit(dx: number, dy: number) {
    this.interact();
    this.vel.az = -dx * 0.004;
    this.vel.polar = -dy * 0.003;
    this.user.dAz += this.vel.az;
    this.user.dPolar += this.vel.polar;
    this.clampUser();
  }
  release() {
    // inertia continues using last velocity
  }
  pinch(scale: number) {
    this.interact();
    this.user.zoom = THREE.MathUtils.clamp(this.user.zoom / scale, 0.55, 1.5);
  }
  pan(dx: number, dy: number) {
    this.interact();
    const k = this.cur.radius * 0.0012;
    const c = Math.cos(this.cur.azimuth),
      s = Math.sin(this.cur.azimuth);
    this.user.panX = THREE.MathUtils.clamp(this.user.panX - (dx * c + dy * s) * k, -0.6, 0.6);
    this.user.panZ = THREE.MathUtils.clamp(this.user.panZ - (dy * c - dx * s) * k, -0.4, 0.4);
  }
  private clampUser() {
    this.user.dAz = THREE.MathUtils.clamp(this.user.dAz, -0.9, 0.9);
    this.user.dPolar = THREE.MathUtils.clamp(this.user.dPolar, -0.7, 0.45);
  }

  /** Temporarily zoom towards a point (big pots, all-in showdowns). */
  focusOn(x: number, z: number, k = 0.75, seconds = 3) {
    if (this.reduceMotion) return;
    this.focus = { x, z, k, until: this.time + seconds };
    this.moving = true;
  }

  /** Returns true while the camera is still moving (needs rendering). */
  update(dt: number): boolean {
    this.time += dt;
    // inertia
    if (this.time - this.lastInteract > 0.05) {
      this.vel.az *= Math.pow(0.04, dt);
      this.vel.polar *= Math.pow(0.04, dt);
      if (Math.abs(this.vel.az) > 1e-5 || Math.abs(this.vel.polar) > 1e-5) {
        this.user.dAz += this.vel.az * dt * 30;
        this.user.dPolar += this.vel.polar * dt * 30;
        this.clampUser();
      }
    }
    const tgt: Pose = {
      tx: this.base.tx + this.user.panX,
      ty: 0,
      tz: this.base.tz + this.user.panZ,
      radius: this.base.radius * this.user.zoom,
      polar: Math.max(0.03, this.base.polar + this.user.dPolar),
      azimuth: this.base.azimuth + this.user.dAz,
    };
    if (this.preset === 'cinematic' && !this.reduceMotion) tgt.azimuth += Math.sin(this.time * 0.08) * 0.3;
    if (this.focus) {
      if (this.time > this.focus.until) this.focus = null;
      else {
        tgt.tx = THREE.MathUtils.lerp(tgt.tx, this.focus.x, 0.6);
        tgt.tz = THREE.MathUtils.lerp(tgt.tz, this.focus.z, 0.6);
        tgt.radius *= this.focus.k;
        tgt.polar = Math.min(1.1, tgt.polar + 0.12);
      }
    }
    const idle = this.time - this.lastInteract > 4;
    let swaying = false;
    if (this.sway && idle && !this.reduceMotion && this.preset !== 'top') {
      tgt.azimuth += Math.sin(this.time * 0.21) * 0.012;
      tgt.polar += Math.sin(this.time * 0.17 + 1) * 0.008;
      tgt.radius *= 1 + Math.sin(this.time * 0.13) * 0.006;
      swaying = true;
    }
    const k = 1 - Math.exp(-dt * (this.reduceMotion ? 12 : 4.5));
    let delta = 0;
    for (const key of Object.keys(tgt) as (keyof Pose)[]) {
      const d = tgt[key] - this.cur[key];
      this.cur[key] += d * k;
      delta += Math.abs(d);
    }
    this.apply();
    const moving = delta > 1e-4 || swaying || !!this.focus || Math.abs(this.vel.az) > 1e-5;
    const was = this.moving;
    this.moving = moving;
    return moving || was;
  }

  private apply() {
    const { tx, ty, tz, radius, polar, azimuth } = this.cur;
    const sp = Math.sin(polar);
    this.camera.position.set(tx + radius * sp * Math.sin(azimuth), ty + radius * Math.cos(polar), tz + radius * sp * Math.cos(azimuth));
    this.camera.lookAt(tx, ty, tz);
  }

  snap() {
    this.update(10);
  }
}
