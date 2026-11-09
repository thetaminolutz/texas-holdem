// Catalog of cosmetic options (names only; the visuals are procedurally generated).
export const CARD_BACK_NAMES = [
  'Classic Red',
  'Classic Blue',
  'Guilloche Green',
  'Art Deco Gold',
  'Geometric Navy',
  'Leather Embossed',
  'Paisley Burgundy',
  'Rosette Black',
  'Diamond Lattice',
  'Sunburst Teal',
  'Herringbone Grey',
  'Celtic Knot',
] as const;

export const CHIP_SET_NAMES = ['Casino Classic', 'Monte Carlo', 'Vintage Clay', 'Midnight'] as const;

/** Denominations available on the table, smallest first. */
export const DENOMS = [1, 5, 10, 25, 50, 100, 500, 1000, 5000, 10000, 25000, 100000] as const;

export interface ChipStyle {
  base: string;
  spot: string;
  inlay: string;
  text: string;
}

/** Chip colors per set and denomination. */
export const CHIP_SETS: Record<number, ChipStyle>[] = [
  {
    1: { base: '#e9e4d8', spot: '#2a5ba8', inlay: '#f4f0e6', text: '#2a5ba8' },
    5: { base: '#b3201f', spot: '#f1ece0', inlay: '#f4f0e6', text: '#b3201f' },
    10: { base: '#1f4fa0', spot: '#f1ece0', inlay: '#f4f0e6', text: '#1f4fa0' },
    25: { base: '#23803e', spot: '#f1ece0', inlay: '#f4f0e6', text: '#23803e' },
    50: { base: '#d06a1a', spot: '#1b1b1b', inlay: '#f4f0e6', text: '#a04e0e' },
    100: { base: '#1b1b1b', spot: '#f1ece0', inlay: '#f4f0e6', text: '#1b1b1b' },
    500: { base: '#6a2b8a', spot: '#f1d65a', inlay: '#f4f0e6', text: '#6a2b8a' },
    1000: { base: '#e8c330', spot: '#1b1b1b', inlay: '#f4f0e6', text: '#8a6a00' },
    5000: { base: '#8a5a2b', spot: '#f1ece0', inlay: '#f4f0e6', text: '#6a3f16' },
    10000: { base: '#e48fb0', spot: '#1b1b1b', inlay: '#f4f0e6', text: '#a43e6a' },
    25000: { base: '#2bb0b0', spot: '#1b1b1b', inlay: '#f4f0e6', text: '#167070' },
    100000: { base: '#9a9da4', spot: '#b3201f', inlay: '#f4f0e6', text: '#4a4d54' },
  },
];
// Derived sets: shift palette for variety
const shift = (hex: string, f: number, mixTo: [number, number, number]) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * (1 - f) + mixTo[i] * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};
for (const [f, to, spot] of [
  [0.18, [255, 230, 190], '#e9d9a0'],
  [0.3, [140, 110, 80], '#e8dcc0'],
  [0.4, [10, 10, 20], '#c9c9d0'],
] as const) {
  const set: Record<number, ChipStyle> = {};
  for (const [k, v] of Object.entries(CHIP_SETS[0])) {
    set[Number(k)] = { base: shift(v.base, f, to as any), spot: spot, inlay: shift(v.inlay, f * 0.5, to as any), text: shift(v.text, f, to as any) };
  }
  CHIP_SETS.push(set);
}

/**
 * Change-making with a natural look: like real players, prefer stacks of 5-20 chips of mid denominations
 * over a single high-value chip. The largest denomination used is the biggest one that yields at least ~6 chips.
 */
export function breakdown(amount: number, maxDenom = Infinity): { denom: number; count: number }[] {
  const out: { denom: number; count: number }[] = [];
  let rest = Math.round(amount);
  if (rest <= 0) return out;
  const usable = [...DENOMS].filter((d) => d <= maxDenom);
  let top = usable[0];
  for (const d of usable) if (rest / d >= 6 || d === usable[0]) top = d;
  // never use more than ~60 chips: bump denomination if needed
  for (const d of usable) if (d > top && rest / top > 60) top = d;
  const ds = usable.filter((d) => d <= top).reverse();
  for (const d of ds) {
    if (rest <= 0) break;
    const c = Math.floor(rest / d);
    if (c > 0) {
      out.push({ denom: d, count: c });
      rest -= c * d;
    }
  }
  return out;
}
