// Monte Carlo equity of all 169 starting-hand classes vs 1, 2 and 5 random opponents -> src/ai/preflopTable.json
import { writeFileSync } from 'node:fs';
import { evaluate } from '../src/engine/evaluator.ts';
import { RANKS } from '../src/engine/cards.ts';
import { SeededRng } from '../src/engine/rng.ts';

const rng = new SeededRng(99);
const classes: { name: string; a: number; b: number }[] = [];
for (let r1 = 12; r1 >= 0; r1--)
  for (let r2 = r1; r2 >= 0; r2--) {
    if (r1 === r2) classes.push({ name: RANKS[r1] + RANKS[r2], a: r1 * 4, b: r2 * 4 + 1 });
    else {
      classes.push({ name: RANKS[r1] + RANKS[r2] + 's', a: r1 * 4, b: r2 * 4 });
      classes.push({ name: RANKS[r1] + RANKS[r2] + 'o', a: r1 * 4, b: r2 * 4 + 1 });
    }
  }
function equity(a: number, b: number, opp: number, iters: number) {
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (c !== a && c !== b) deck.push(c);
  let won = 0;
  const seven = new Array(7);
  for (let it = 0; it < iters; it++) {
    // partial shuffle
    const need = 5 + opp * 2;
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(deck.length - i);
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    seven[0] = a; seven[1] = b;
    for (let k = 0; k < 5; k++) seven[2 + k] = deck[k];
    const me = evaluate(seven, 7);
    let best = -1, ties = 0, beaten = false;
    for (let o = 0; o < opp; o++) {
      seven[0] = deck[5 + o * 2]; seven[1] = deck[6 + o * 2];
      const s = evaluate(seven, 7);
      if (s > me) { beaten = true; break; }
      if (s === me) ties++;
    }
    if (!beaten) won += 1 / (ties + 1);
  }
  return won / iters;
}
const out = classes.map((c) => ({ name: c.name, e1: +equity(c.a, c.b, 1, 12000).toFixed(4), e2: +equity(c.a, c.b, 2, 8000).toFixed(4), e5: +equity(c.a, c.b, 5, 5000).toFixed(4) }));
// Playability rank: blend heads-up and multiway equity (suited/connected hands play better multiway)
const score = (x: (typeof out)[0]) => x.e1 * 0.55 + x.e2 * 0.25 * 1.6 + x.e5 * 0.2 * 3.2;
const sorted = [...out].sort((a, b) => score(b) - score(a));
const table: Record<string, { e1: number; e2: number; e5: number; rank: number; pct: number }> = {};
let cum = 0;
for (const [i, x] of sorted.entries()) {
  const combos = x.name.length === 2 ? 6 : x.name.endsWith('s') ? 4 : 12;
  table[x.name] = { e1: x.e1, e2: x.e2, e5: x.e5, rank: i, pct: +((cum + combos / 2) / 1326).toFixed(4) };
  cum += combos;
}
writeFileSync(new URL('../src/ai/preflopTable.json', import.meta.url), JSON.stringify(table));
console.log('top 12:', sorted.slice(0, 12).map((x) => x.name).join(' '));
console.log('bottom 5:', sorted.slice(-5).map((x) => x.name).join(' '));
