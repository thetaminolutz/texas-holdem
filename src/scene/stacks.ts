// Arranging chips into realistic, slightly imperfect stacks.
import * as THREE from 'three';
import { breakdown } from './catalog';
import { CHIP } from './chips';
import type { V2 } from './layout';
import { mulberry32 } from '../util/noise';

export interface ColumnSpec {
  denom: number;
  count: number;
  x: number;
  z: number;
}

/**
 * Lay out an amount as stack columns: one column per denomination (tall columns split at `maxPer`),
 * arranged side by side perpendicular to `facing` (unit vector pointing toward the table center).
 */
export function layoutColumns(amount: number, at: V2, facing: V2, maxPer = 20, spacing = CHIP.r * 2.12): ColumnSpec[] {
  const parts = breakdown(amount);
  const cols: { denom: number; count: number }[] = [];
  for (const p of parts) {
    let c = p.count;
    while (c > 0) {
      const n = Math.min(maxPer, c);
      cols.push({ denom: p.denom, count: n });
      c -= n;
    }
  }
  // biggest denominations in the back row if many columns
  const right = { x: -facing.z, z: facing.x };
  const perRow = cols.length > 6 ? Math.ceil(cols.length / 2) : cols.length;
  return cols.map((c, i) => {
    const row = Math.floor(i / perRow);
    const k = i % perRow;
    const n = Math.min(perRow, cols.length - row * perRow);
    const off = (k - (n - 1) / 2) * spacing;
    const back = row * spacing * 0.95 + (row ? spacing * 0.0 : 0);
    return { denom: c.denom, count: c.count, x: at.x + right.x * off - facing.x * back, z: at.z + right.z * off - facing.z * back };
  });
}

/** Per-chip resting transform within a column, with tiny natural imperfections. */
export function chipRest(col: { x: number; z: number }, index: number, seed: number, base = 0, out?: { pos: THREE.Vector3; quat: THREE.Quaternion }) {
  const rnd = mulberry32(seed * 1013 + index * 7919);
  const j = 0.0007;
  const pos = out?.pos ?? new THREE.Vector3();
  pos.set(col.x + (rnd() - 0.5) * j, base + index * CHIP.h + 0.00002 * index, col.z + (rnd() - 0.5) * j);
  const quat = out?.quat ?? new THREE.Quaternion();
  const e = new THREE.Euler((rnd() - 0.5) * 0.012, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.012, 'YXZ');
  quat.setFromEuler(e);
  return { pos, quat };
}
