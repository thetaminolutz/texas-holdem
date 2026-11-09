// Table outlines (stadium / circle / rounded rectangle), seat placement and spot positions (meters, table plane y=0).
import type { TableShape } from '../state/settings';

export interface V2 {
  x: number;
  z: number;
}

/** A rounded rectangle: straight half-lengths hx (along x), hz (along z) and corner radius r. Offsets grow r. */
export class RoundedPath {
  constructor(
    public hx: number,
    public hz: number,
    public r: number,
  ) {}
  perimeter(off = 0) {
    return 4 * this.hx + 4 * this.hz + 2 * Math.PI * (this.r + off);
  }
  /**
   * Point at parameter t in [0,1). t=0 is bottom center (+z, toward the human player) and t increases
   * clockwise when viewed from above with +z toward the viewer: bottom -> left (-x) -> top -> right.
   */
  at(t: number, off = 0): { p: V2; n: V2 } {
    const R = this.r + off;
    const { hx, hz } = this;
    const segs = [hx, (Math.PI / 2) * R, 2 * hz, (Math.PI / 2) * R, 2 * hx, (Math.PI / 2) * R, 2 * hz, (Math.PI / 2) * R, hx];
    const total = segs.reduce((a, b) => a + b, 0);
    let d = (((t % 1) + 1) % 1) * total;
    let k = 0;
    while (k < segs.length - 1 && d > segs[k]) {
      d -= segs[k];
      k++;
    }
    const arc = (cx: number, cz: number, a0: number) => {
      const a = a0 + (R > 0 ? d / R : 0);
      const n = { x: Math.cos(a), z: Math.sin(a) };
      return { p: { x: cx + n.x * R, z: cz + n.z * R }, n };
    };
    switch (k) {
      case 0:
        return { p: { x: -d, z: hz + R }, n: { x: 0, z: 1 } };
      case 1:
        return arc(-hx, hz, Math.PI / 2);
      case 2:
        return { p: { x: -hx - R, z: hz - d }, n: { x: -1, z: 0 } };
      case 3:
        return arc(-hx, -hz, Math.PI);
      case 4:
        return { p: { x: -hx + d, z: -hz - R }, n: { x: 0, z: -1 } };
      case 5:
        return arc(hx, -hz, (Math.PI * 3) / 2);
      case 6:
        return { p: { x: hx + R, z: -hz + d }, n: { x: 1, z: 0 } };
      case 7:
        return arc(hx, hz, 0);
      default:
        return { p: { x: hx - d, z: hz + R }, n: { x: 0, z: 1 } };
    }
  }
  /** Sample n points evenly by arc length. */
  sample(n: number, off = 0): { p: V2; n: V2 }[] {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.at(i / n, off));
    return out;
  }
}

export interface TableDims {
  path: RoundedPath; // felt edge
  racetrack: number; // width of wooden racetrack
  rail: number; // width of padded rail
  railHeight: number;
}

export function tableDims(shape: TableShape): TableDims {
  switch (shape) {
    case 'round':
      return { path: new RoundedPath(0, 0, 0.82), racetrack: 0.085, rail: 0.13, railHeight: 0.06 };
    case 'rect':
      return { path: new RoundedPath(0.62, 0.3, 0.2), racetrack: 0.085, rail: 0.12, railHeight: 0.055 };
    default:
      return { path: new RoundedPath(0.56, 0, 0.56), racetrack: 0.09, rail: 0.13, railHeight: 0.06 };
  }
}

export interface SeatSpot {
  index: number;
  t: number;
  edge: V2; // felt edge point
  inward: V2; // unit vector pointing to table center-ish
  tangent: V2; // unit vector to the player's left (clockwise direction)
  plate: V2; // where the player's name plate / avatar sits (outside the rail)
  stack: V2;
  cards: V2;
  bet: V2;
  button: V2;
  angle: number; // rotation (radians around y) so that local -z faces the table center from the seat
}

export interface Layout {
  shape: TableShape;
  dims: TableDims;
  seats: SeatSpot[];
  dealer: { t: number; edge: V2; inward: V2; deck: V2; muck: V2; angle: number; shuffle: V2; tray: V2 };
  board: V2[];
  board2: V2[];
  pot: V2;
  sidePots: V2[];
}

const add = (a: V2, b: V2, s = 1): V2 => ({ x: a.x + b.x * s, z: a.z + b.z * s });

/** Seat parameters around the perimeter for n seats: seat 0 at bottom center, uniform spacing, gap for the dealer. */
export function seatParams(n: number): number[] {
  if (n <= 2) return n === 1 ? [0] : [0, 0.5];
  // Seat 0 at bottom center, dealer at top center; the other seats split between the left and right arcs.
  const g = n >= 8 ? 0.07 : 0.085;
  const others = n - 1;
  const kL = Math.ceil(others / 2);
  const kR = others - kL;
  const arc = 0.5 - g;
  const out = [0];
  for (let i = 1; i <= kL; i++) out.push((arc * i) / (kL + 0.5));
  for (let i = kR; i >= 1; i--) out.push(1 - (arc * i) / (kR + 0.5));
  return out;
}

/** Dealer sits in the middle of the largest gap between seats. */
export function dealerT(ts: number[]): number {
  if (ts.length <= 2) return 0.75;
  if (ts.length >= 3) return 0.5;
  const sorted = [...ts].sort((a, b) => a - b);
  let best = 0,
    bestGap = -1;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 1;
    if (b - a > bestGap) {
      bestGap = b - a;
      best = (a + b) / 2;
    }
  }
  return best % 1;
}

export function computeLayout(shape: TableShape, nSeats: number): Layout {
  const dims = tableDims(shape);
  const P = dims.path;
  const ts = seatParams(nSeats);
  const seats: SeatSpot[] = ts.map((t, index) => {
    const { p, n } = P.at(t);
    const inward = { x: -n.x, z: -n.z };
    const tangent = { x: -inward.z, z: inward.x }; // rotate inward 90° -> player's left when facing center? (see below)
    const angle = Math.atan2(-inward.x, -inward.z);
    // local axes: forward = inward, right = (-inward.z, inward.x) rotated. Player's right hand (screen right for seat 0).
    const right = { x: -inward.z, z: inward.x };
    const r = (d: number, side: number) => add(add(p, inward, d), right, side);
    return {
      index,
      t,
      edge: p,
      inward,
      tangent,
      plate: add(p, n, dims.racetrack + dims.rail * 0.55),
      stack: r(0.13, 0.1),
      cards: r(0.2, -0.02),
      bet: r(0.36, 0),
      button: r(0.2, -0.13),
      angle,
    };
  });
  const dt = dealerT(ts);
  const d = P.at(dt);
  const din = { x: -d.n.x, z: -d.n.z };
  const dright = { x: -din.z, z: din.x };
  const dealer = {
    t: dt,
    edge: d.p,
    inward: din,
    deck: add(add(d.p, din, 0.12), dright, -0.1),
    muck: add(add(d.p, din, 0.13), dright, 0.12),
    shuffle: add(d.p, din, 0.16),
    tray: add(d.p, din, 0.04),
    angle: Math.atan2(-din.x, -din.z),
  };
  // Board in the center, laid out left-to-right facing the human; pot just beyond the board (toward the far side).
  const cw = 0.072;
  const center = { x: 0, z: -0.01 };
  const right = { x: -1, z: 0 };
  const up = { x: 0, z: 1 }; // toward the human
  const board = [-2, -1, 0, 1, 2].map((k) => add(center, right, -k * cw));
  const board2 = board.map((b) => add(b, up, 0.105)); // second run (run it twice) toward the player
  const pot = add(center, up, -0.16);
  const sidePots = [1, 2, 3, 4, 5].map((k) => add(pot, right, (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.09));
  return { shape, dims, seats, dealer, board, board2, pot, sidePots };
}
