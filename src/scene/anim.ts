// Animation runtime: time-scaled tasks driven by the TableScene ticker, plus physically based motion helpers.
import * as THREE from 'three';
import type { TableScene } from './TableScene';

export const G = 9.81;

export interface Motion {
  /** advance by dt (already scaled). Return true when finished. */
  step(dt: number): boolean;
  /** jump to final state */
  finish(): void;
}

export class Animator {
  speed = 1; // 0 = off (instant), >0 time multiplier
  private motions = new Set<{ m: Motion; resolve: () => void }>();
  private timers = new Set<{ t: number; resolve: () => void }>();
  private skipping = false;
  constructor(private scene: TableScene) {}

  get instant() {
    return this.speed <= 0 || this.skipping;
  }

  /** Run a motion; resolves when done. */
  run(m: Motion): Promise<void> {
    if (this.instant) {
      m.finish();
      this.scene.cards.dirty = true;
      this.scene.chips.dirty = true;
      this.scene.requestRender();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.motions.add({ m, resolve });
      this.ensureTicker();
    });
  }

  /** Scaled sleep. */
  wait(seconds: number): Promise<void> {
    if (this.instant || seconds <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.timers.add({ t: seconds, resolve });
      this.ensureTicker();
    });
  }

  /** Finish everything currently running immediately (tap-to-skip). */
  skipAll() {
    for (const x of [...this.motions]) {
      x.m.finish();
      x.resolve();
    }
    this.motions.clear();
    for (const t of [...this.timers]) t.resolve();
    this.timers.clear();
    this.scene.cards.dirty = true;
    this.scene.chips.dirty = true;
    this.scene.requestRender();
  }

  /** While skipping, every new motion completes instantly. */
  async skipping_(fn: () => Promise<void>) {
    this.skipping = true;
    this.skipAll();
    try {
      await fn();
    } finally {
      this.skipping = false;
    }
  }

  get busy() {
    return this.motions.size > 0 || this.timers.size > 0;
  }

  private ticking = false;
  private ensureTicker() {
    if (this.ticking) return;
    this.ticking = true;
    this.scene.addTicker((dt) => {
      const sdt = dt * this.speed;
      for (const x of [...this.motions]) {
        if (x.m.step(sdt)) {
          this.motions.delete(x);
          x.resolve();
        }
      }
      for (const t of [...this.timers]) {
        t.t -= sdt;
        if (t.t <= 0) {
          this.timers.delete(t);
          t.resolve();
        }
      }
      this.scene.cards.dirty = true;
      this.scene.chips.dirty = true;
      const alive = this.motions.size > 0 || this.timers.size > 0;
      if (!alive) this.ticking = false;
      return alive;
    });
  }
}

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.4,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/** Generic duration-based motion. */
export class Tween implements Motion {
  private t = 0;
  constructor(
    private duration: number,
    private fn: (k: number, dt: number) => void,
    private delay = 0,
  ) {}
  step(dt: number) {
    this.t += dt;
    const k = Math.min(1, Math.max(0, (this.t - this.delay) / this.duration));
    if (this.t >= this.delay) this.fn(k, dt);
    return k >= 1;
  }
  finish() {
    this.fn(1, 0);
  }
}

/** Run several motions in parallel as one. */
export class Parallel implements Motion {
  constructor(private ms: Motion[]) {}
  step(dt: number) {
    let done = true;
    for (const m of this.ms) if (!m.step(dt)) done = false;
    return done;
  }
  finish() {
    this.ms.forEach((m) => m.finish());
  }
}

export interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const tmpQ = new THREE.Quaternion();

/**
 * Card flick: ballistic flight with spin, landing short of the target, then a friction slide to rest.
 * Air phase and slide are solved analytically so the card stops exactly on target.
 */
export class FlickMotion implements Motion {
  private t = 0;
  private T: number; // air time
  private ts: number; // slide time
  private vh: THREE.Vector3; // horizontal launch velocity
  private vy: number;
  private p0: THREE.Vector3;
  private dir: THREE.Vector3;
  private slideDist: number;
  private decel: number;
  private q0: THREE.Quaternion;
  private q1: THREE.Quaternion;
  private spin: number;
  private landed = false;
  constructor(
    private obj: Pose,
    to: THREE.Vector3,
    toQuat: THREE.Quaternion,
    opts: { speed?: number; slideFrac?: number; spin?: number; lift?: number; onLand?: () => void; delay?: number } = {},
  ) {
    this.delayLeft = opts.delay ?? 0;
    this.p0 = obj.pos.clone();
    this.q0 = obj.quat.clone();
    this.q1 = toQuat.clone();
    const d = new THREE.Vector3(to.x - this.p0.x, 0, to.z - this.p0.z);
    const D = d.length();
    this.dir = D > 1e-6 ? d.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const mu = 0.35; // card on felt
    this.decel = mu * G;
    this.slideDist = D * (opts.slideFrac ?? 0.22);
    const v0 = Math.sqrt(2 * this.decel * this.slideDist); // speed when touching down
    const speed = Math.max(v0, opts.speed ?? 2.2);
    // horizontal speed during flight (air drag negligible); air distance covered at `speed` decaying to v0
    const airDist = D - this.slideDist;
    const vAvg = (speed + v0) / 2;
    this.T = Math.max(0.12, airDist / vAvg);
    this.ts = v0 / this.decel;
    this.vh = this.dir.clone().multiplyScalar(speed);
    // vertical: start at y0, land at to.y; include apex lift
    const y0 = this.p0.y;
    const lift = opts.lift ?? 0.03;
    this.vy = (to.y - y0 + 0.5 * G * this.T * this.T) / this.T + lift * 0.0;
    this.spin = opts.spin ?? 0;
    this.onLand = opts.onLand;
    this.to = to.clone();
    this.speed0 = speed;
    this.v0 = v0;
  }
  private onLand?: () => void;
  private delayLeft: number;
  private to: THREE.Vector3;
  private speed0: number;
  private v0: number;
  step(dt: number) {
    this.t += dt;
    if (this.delayLeft > 0) {
      this.delayLeft -= dt;
      this.t = 0;
      return false;
    }
    const total = this.T + this.ts;
    const t = Math.min(this.t, total);
    const D = this.to.clone().setY(0).sub(this.p0.clone().setY(0)).length();
    let s: number; // distance traveled along dir
    let y: number;
    if (t <= this.T) {
      // horizontal speed decays linearly from speed0 to v0 (air drag)
      const a = (this.speed0 - this.v0) / this.T;
      s = this.speed0 * t - 0.5 * a * t * t;
      y = this.p0.y + this.vy * t - 0.5 * G * t * t;
    } else {
      if (!this.landed) {
        this.landed = true;
        this.onLand?.();
      }
      const u = t - this.T;
      s = D - this.slideDist + (this.v0 * u - 0.5 * this.decel * u * u);
      // tiny bounce right after touchdown
      const b = Math.max(0, 1 - u / 0.08);
      y = this.to.y + Math.abs(Math.sin(u * 60)) * 0.002 * b;
    }
    const k = total > 0 ? t / total : 1;
    this.obj.pos.set(this.p0.x + this.dir.x * s, Math.max(this.to.y, y), this.p0.z + this.dir.z * s);
    // rotation: ease to target, with extra spin that decays
    const e = 1 - Math.pow(1 - k, 2.2);
    tmpQ.copy(this.q0).slerp(this.q1, e);
    if (this.spin) {
      const extra = this.spin * (1 - e) * (1 - e);
      tmpQ.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), extra));
    }
    this.obj.quat.copy(tmpQ);
    if (this.t >= total) {
      this.finish();
      return true;
    }
    return false;
  }
  finish() {
    if (!this.landed) {
      this.landed = true;
      this.onLand?.();
    }
    this.obj.pos.copy(this.to);
    this.obj.quat.copy(this.q1);
  }
}

/** Lift-carry-drop arc (used for chips being picked up and placed, and card flips). */
export class ArcMotion implements Motion {
  private t = 0;
  private p0: THREE.Vector3;
  private q0: THREE.Quaternion;
  private bounced = false;
  constructor(
    private obj: Pose,
    private to: THREE.Vector3,
    private toQuat: THREE.Quaternion | null,
    private duration: number,
    private height: number,
    private delay = 0,
    private onLand?: () => void,
    private easing: (t: number) => number = ease.inOut,
  ) {
    this.p0 = obj.pos.clone();
    this.q0 = obj.quat.clone();
  }
  private started = false;
  step(dt: number) {
    this.t += dt;
    if (this.t < this.delay) return false;
    if (!this.started) {
      this.started = true;
      this.p0.copy(this.obj.pos);
      this.q0.copy(this.obj.quat);
    }
    const k = Math.min(1, (this.t - this.delay) / this.duration);
    const e = this.easing(k);
    this.obj.pos.lerpVectors(this.p0, this.to, e);
    this.obj.pos.y += Math.sin(Math.PI * Math.min(1, k * 1.02)) * this.height;
    if (this.toQuat) this.obj.quat.copy(this.q0).slerp(this.toQuat, ease.inOut(k));
    if (k >= 1) {
      this.finish();
      return true;
    }
    return false;
  }
  finish() {
    this.obj.pos.copy(this.to);
    if (this.toQuat) this.obj.quat.copy(this.toQuat);
    if (!this.bounced) {
      this.bounced = true;
      this.onLand?.();
    }
  }
}

/** Friction slide along the felt: decelerates uniformly to stop exactly at the target. */
export class SlideMotion implements Motion {
  private t = 0;
  private p0: THREE.Vector3;
  private q0: THREE.Quaternion;
  constructor(
    private obj: Pose,
    private to: THREE.Vector3,
    private duration: number,
    private delay = 0,
    private toQuat: THREE.Quaternion | null = null,
    private onEnd?: () => void,
    private lag = 0, // lag factor for stack sway (0 bottom chip, 1 top)
  ) {
    this.p0 = obj.pos.clone();
    this.q0 = obj.quat.clone();
  }
  private started = false;
  step(dt: number) {
    this.t += dt;
    if (this.t < this.delay) return false;
    if (!this.started) {
      this.started = true;
      this.p0.copy(this.obj.pos);
      this.q0.copy(this.obj.quat);
    }
    const k = Math.min(1, (this.t - this.delay) / this.duration);
    // uniform deceleration: s = 2k - k²
    const e = 2 * k - k * k;
    this.obj.pos.lerpVectors(this.p0, this.to, e);
    if (this.toQuat) this.obj.quat.copy(this.q0).slerp(this.toQuat, e);
    if (this.lag > 0 && k < 1) {
      // top chips lag behind at start, overshoot slightly at stop (stack sway)
      const sway = Math.sin(k * Math.PI * 2) * (1 - k) * this.lag * 0.0015;
      const d = new THREE.Vector3().subVectors(this.to, this.p0).setY(0);
      if (d.lengthSq() > 1e-8) d.normalize();
      this.obj.pos.addScaledVector(d, -sway);
    }
    if (k >= 1) {
      this.finish();
      return true;
    }
    return false;
  }
  finish() {
    this.obj.pos.copy(this.to);
    if (this.toQuat) this.obj.quat.copy(this.toQuat);
    const cb = this.onEnd;
    this.onEnd = undefined;
    cb?.();
  }
}

/** Drop with gravity, bounce (restitution) and a damped wobble settle. */
export class DropMotion implements Motion {
  private t = 0;
  private y: number;
  private vy = 0;
  private bounces = 0;
  private settle = 0;
  private baseQ: THREE.Quaternion;
  private axis: THREE.Vector3;
  private done = false;
  constructor(
    private obj: Pose,
    private restY: number,
    private delay = 0,
    private onImpact?: (first: boolean) => void,
  ) {
    this.y = obj.pos.y;
    this.baseQ = obj.quat.clone();
    const a = Math.random() * Math.PI * 2;
    this.axis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  }
  private started = false;
  step(dt: number) {
    this.t += dt;
    if (this.t < this.delay) return false;
    if (!this.started) {
      this.started = true;
      this.y = this.obj.pos.y;
      this.baseQ.copy(this.obj.quat);
    }
    if (this.bounces < 3) {
      this.vy -= G * dt;
      this.y += this.vy * dt;
      if (this.y <= this.restY) {
        this.y = this.restY;
        this.vy = -this.vy * 0.28;
        this.onImpact?.(this.bounces === 0);
        this.bounces++;
        if (Math.abs(this.vy) < 0.05) this.bounces = 3;
      }
      this.obj.pos.y = this.y;
      return false;
    }
    // wobble settle (damped oscillation of tilt)
    this.settle += dt;
    const amp = 0.05 * Math.exp(-this.settle * 9) * Math.cos(this.settle * 45);
    this.obj.quat.copy(this.baseQ).multiply(tmpQ.setFromAxisAngle(this.axis, amp));
    this.obj.pos.y = this.restY;
    if (this.settle > 0.35) {
      this.finish();
      return true;
    }
    return false;
  }
  finish() {
    if (this.done) return;
    this.done = true;
    if (!this.started) this.baseQ.copy(this.obj.quat);
    this.obj.pos.y = this.restY;
    this.obj.quat.copy(this.baseQ);
  }
}

/** Sequence of motions executed one after another. */
export class Sequence implements Motion {
  private i = 0;
  constructor(private ms: Motion[]) {}
  step(dt: number) {
    while (this.i < this.ms.length) {
      if (!this.ms[this.i].step(dt)) return false;
      this.i++;
      dt = 0;
    }
    return true;
  }
  finish() {
    for (; this.i < this.ms.length; this.i++) this.ms[this.i].finish();
  }
}
