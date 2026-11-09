// The Director choreographs every card and chip on the table with physically based motion and synced sound.
import * as THREE from 'three';
import type { TableScene } from './TableScene';
import { Animator, ArcMotion, DropMotion, FlickMotion, Parallel, Sequence, SlideMotion, Tween, type Motion } from './anim';
import { cardQuat, CARD_SIZE, type CardObj } from './cards';
import { CHIP, type ChipObj } from './chips';
import { DENOMS, breakdown } from './catalog';
import type { V2 } from './layout';
import { sfx } from '../audio/sfx';
import { mulberry32 } from '../util/noise';
import type { ShuffleStyle } from '../state/settings';

const CARD_REST = 0.0006;
const DECK_STEP = 0.00036;

export interface Pile {
  chips: ChipObj[];
  at: V2;
  facing: V2;
  maxPer: number;
  seed: number;
}

function pileAmount(p: Pile) {
  return p.chips.reduce((a, c) => a + c.denom, 0);
}

interface SeatVis {
  stack: Pile;
  bet: Pile;
  hole: CardObj[];
  folded: boolean;
}

const rnd = mulberry32(12345);
const jitter = (s: number) => (rnd() - 0.5) * s;
const yawFacing = (inward: V2) => Math.atan2(inward.x, inward.z) + Math.PI;

export interface DirectorOpts {
  chipIntensity: 'subtle' | 'normal' | 'dramatic';
  dealStyle: 'flick' | 'slide';
  slowRollRiver: boolean;
}

export class Director {
  anim: Animator;
  seats: SeatVis[] = [];
  deck: CardObj[] = [];
  muck: CardObj[] = [];
  board: CardObj[] = [];
  board2: CardObj[] = [];
  pots: Pile[] = [];
  opts: DirectorOpts = { chipIntensity: 'normal', dealStyle: 'flick', slowRollRiver: false };
  humanSeat = 0;
  revealed = false;

  constructor(public scene: TableScene) {
    this.anim = new Animator(scene);
    this.resetSeats();
  }

  get L() {
    return this.scene.layout;
  }

  private pan(x: number) {
    return Math.max(-1, Math.min(1, x / 1.1));
  }

  resetSeats() {
    const L = this.L;
    const old = this.seats;
    this.seats = L.seats.map((s, i) => ({
      stack: { chips: old[i]?.stack.chips ?? [], at: s.stack, facing: s.inward, maxPer: 12, seed: i * 101 + 7 },
      bet: { chips: old[i]?.bet.chips ?? [], at: s.bet, facing: s.inward, maxPer: 20, seed: i * 97 + 3 },
      hole: old[i]?.hole ?? [],
      folded: false,
    }));
    // release chips of seats that no longer exist
    for (let i = L.seats.length; i < old.length; i++) {
      old[i].stack.chips.forEach((c) => this.scene.chips.release(c));
      old[i].bet.chips.forEach((c) => this.scene.chips.release(c));
    }
  }

  // ---------------------------------------------------------------- piles
  /** Target transforms for all chips of a pile: grouped by denomination into columns. */
  private pileTargets(p: Pile): Map<ChipObj, { pos: THREE.Vector3; quat: THREE.Quaternion }> {
    const byDenom = new Map<number, ChipObj[]>();
    for (const c of p.chips) {
      if (!byDenom.has(c.denom)) byDenom.set(c.denom, []);
      byDenom.get(c.denom)!.push(c);
    }
    const denoms = [...byDenom.keys()].sort((a, b) => b - a);
    const cols: ChipObj[][] = [];
    for (const d of denoms) {
      const list = byDenom.get(d)!.sort((a, b) => a.pos.y - b.pos.y);
      for (let i = 0; i < list.length; i += p.maxPer) cols.push(list.slice(i, i + p.maxPer));
    }
    const right = { x: -p.facing.z, z: p.facing.x };
    const spacing = CHIP.r * 2.12;
    const perRow = cols.length > 6 ? Math.ceil(cols.length / 2) : cols.length;
    const out = new Map<ChipObj, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
    cols.forEach((col, i) => {
      const row = Math.floor(i / perRow);
      const k = i % perRow;
      const n = Math.min(perRow, cols.length - row * perRow);
      const off = (k - (n - 1) / 2) * spacing;
      const back = row * spacing * 0.95;
      const cx = p.at.x + right.x * off - p.facing.x * back;
      const cz = p.at.z + right.z * off - p.facing.z * back;
      col.forEach((c, j) => {
        const r = mulberry32(p.seed * 7 + c.id * 13);
        const pos = new THREE.Vector3(cx + (r() - 0.5) * 0.0008, j * CHIP.h + j * 0.00002, cz + (r() - 0.5) * 0.0008);
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.01, r() * Math.PI * 2, (r() - 0.5) * 0.01, 'YXZ'));
        out.set(c, { pos, quat });
      });
    });
    return out;
  }

  private placePileInstant(p: Pile) {
    for (const [c, t] of this.pileTargets(p)) {
      c.pos.copy(t.pos);
      c.quat.copy(t.quat);
    }
    this.scene.chips.dirty = true;
  }

  /** Smoothly re-arrange a pile (chips glide to their columns). */
  private relayoutMotion(p: Pile, duration = 0.28, except = new Set<ChipObj>()): Motion {
    const ms: Motion[] = [];
    for (const [c, t] of this.pileTargets(p)) {
      if (except.has(c)) continue;
      if (c.pos.distanceToSquared(t.pos) < 1e-8) continue;
      const lift = Math.abs(c.pos.x - t.pos.x) + Math.abs(c.pos.z - t.pos.z) > 0.004 ? 0.012 : 0;
      ms.push(new ArcMotion(c, t.pos, t.quat, duration, lift));
    }
    return new Parallel(ms);
  }

  private spawnPile(p: Pile, amount: number) {
    for (const part of breakdown(amount)) {
      for (let i = 0; i < part.count; i++) {
        const c = this.scene.chips.alloc(part.denom);
        if (c) p.chips.push(c);
      }
    }
  }

  setPileInstant(p: Pile, amount: number) {
    p.chips.forEach((c) => this.scene.chips.release(c));
    p.chips = [];
    this.spawnPile(p, amount);
    this.placePileInstant(p);
  }

  /**
   * Choose chips from a pile adding up exactly to `amount`. If impossible, larger chips are broken into
   * change (returned in `breaks`) — the caller animates the change-making.
   */
  private planTake(p: Pile, amount: number): { take: Map<number, number>; breaks: { denom: number; into: number[] }[] } {
    const avail = new Map<number, number>();
    for (const c of p.chips) avail.set(c.denom, (avail.get(c.denom) ?? 0) + 1);
    const breaks: { denom: number; into: number[] }[] = [];
    for (let guard = 0; guard < 40; guard++) {
      const take = new Map<number, number>();
      let rest = amount;
      for (const d of [...avail.keys()].sort((a, b) => b - a)) {
        const n = Math.min(avail.get(d)!, Math.floor(rest / d));
        if (n > 0) {
          take.set(d, n);
          rest -= n * d;
        }
      }
      if (rest === 0) return { take, breaks };
      // break the smallest chip larger than what's missing (not already fully used)
      const candidates = [...avail.keys()].filter((d) => d > rest && (avail.get(d)! - (take.get(d) ?? 0)) > 0).sort((a, b) => a - b);
      const d = candidates[0] ?? [...avail.keys()].filter((x) => avail.get(x)! > 0).sort((a, b) => b - a)[0];
      if (d === undefined) return { take, breaks };
      const into: number[] = [];
      let r = d;
      for (const dd of [...DENOMS].filter((x) => x < d).reverse()) {
        // natural change: at most 5 of each lower denom, rest further down
        let n = Math.floor(r / dd);
        if (dd !== 1 && n > 5 && r - 5 * dd > 0) n = 5;
        for (let k = 0; k < n; k++) into.push(dd);
        r -= n * dd;
      }
      avail.set(d, avail.get(d)! - 1);
      for (const x of into) avail.set(x, (avail.get(x) ?? 0) + 1);
      breaks.push({ denom: d, into });
    }
    return { take: new Map(), breaks };
  }

  /** Animate change-making: chips go to the dealer's tray, change comes back. */
  private async makeChange(p: Pile, breaks: { denom: number; into: number[] }[]) {
    if (!breaks.length) return;
    const tray = this.L.dealer.tray;
    const out: Motion[] = [];
    const removed: ChipObj[] = [];
    for (const b of breaks) {
      const idx = p.chips.map((c, i) => [c, i] as const).filter(([c]) => c.denom === b.denom).sort((a, b2) => b2[0].pos.y - a[0].pos.y)[0];
      if (!idx) continue;
      const chip = idx[0];
      p.chips.splice(p.chips.indexOf(chip), 1);
      removed.push(chip);
      out.push(new SlideMotion(chip, new THREE.Vector3(tray.x + jitter(0.03), 0, tray.z + jitter(0.02)), 0.45));
    }
    sfx.chipSlide(this.pan(p.at.x), 0.4);
    await this.anim.run(new Parallel(out));
    removed.forEach((c) => this.scene.chips.release(c));
    // change arrives as a little sliding stack
    const incoming: ChipObj[] = [];
    breaks.forEach((b) =>
      b.into.forEach((d) => {
        const c = this.scene.chips.alloc(d);
        if (!c) return;
        c.pos.set(tray.x + jitter(0.01), incoming.length * CHIP.h, tray.z + jitter(0.01));
        c.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
        incoming.push(c);
        p.chips.push(c);
      }),
    );
    const targets = this.pileTargets(p);
    const ms: Motion[] = [];
    incoming.forEach((c, i) => {
      const t = targets.get(c)!;
      ms.push(new SlideMotion(c, t.pos, 0.5, i * 0.015, t.quat, undefined, i / incoming.length));
    });
    ms.push(this.relayoutMotion(p, 0.3, new Set(incoming)));
    sfx.chips(incoming.length, this.pan(p.at.x), 0.35);
    await this.anim.run(new Parallel(ms));
  }

  /** Move `amount` worth of chips from pile `from` to pile `to`. style: toss (arc) or push (slide). */
  private async transfer(from: Pile, to: Pile, amount: number, style: 'toss' | 'push' | 'slide', opts: { stagger?: number; duration?: number } = {}) {
    if (amount <= 0) return;
    const have = pileAmount(from);
    if (have < amount) {
      // visual pile is short (should not happen) — spawn missing chips at the source
      const add = amount - have;
      for (const part of breakdown(add))
        for (let i = 0; i < part.count; i++) {
          const c = this.scene.chips.alloc(part.denom);
          if (c) {
            c.pos.set(from.at.x, 0, from.at.z);
            from.chips.push(c);
          }
        }
      this.placePileInstant(from);
    }
    let plan = this.planTake(from, amount);
    if (plan.breaks.length) {
      await this.makeChange(from, plan.breaks);
      plan = this.planTake(from, amount);
    }
    const moving: ChipObj[] = [];
    for (const [d, n] of plan.take) {
      const list = from.chips.filter((c) => c.denom === d).sort((a, b) => b.pos.y - a.pos.y);
      moving.push(...list.slice(0, n));
    }
    from.chips = from.chips.filter((c) => !moving.includes(c));
    to.chips.push(...moving);
    const targets = this.pileTargets(to);
    const ms: Motion[] = [];
    const dramatic = this.opts.chipIntensity === 'dramatic';
    const subtle = this.opts.chipIntensity === 'subtle';
    const dur = opts.duration ?? (style === 'push' ? 0.65 : 0.5);
    // group by destination column so chips travel as small stacks
    moving.sort((a, b) => a.denom - b.denom || a.pos.y - b.pos.y);
    let landed = 0;
    moving.forEach((c, i) => {
      const t = targets.get(c)!;
      const delay = (opts.stagger ?? (style === 'toss' ? 0.025 : 0.004)) * i;
      if (style === 'toss') {
        const hi = new THREE.Vector3(t.pos.x, t.pos.y + 0.012, t.pos.z);
        const h = subtle ? 0.02 : dramatic ? 0.07 : 0.04;
        ms.push(
          new Sequence([
            new ArcMotion(c, hi, t.quat, dur, h, delay, undefined, (k) => 1 - Math.pow(1 - k, 2)),
            new DropMotion(c, t.pos.y, 0, (first) => {
              if (first && landed++ % 3 === 0) sfx.chips(1, this.pan(t.pos.x));
            }),
          ]),
        );
        if (dramatic && amount > 0) {
          // splash: some chips scatter a little and settle
          if (rnd() < 0.15) t.pos.add(new THREE.Vector3(jitter(0.01), 0, jitter(0.01)));
        }
      } else {
        ms.push(new SlideMotion(c, t.pos, dur, delay, t.quat, undefined, (c.pos.y / CHIP.h) / 20));
      }
    });
    ms.push(this.relayoutMotion(from, 0.3));
    ms.push(this.relayoutMotion(to, 0.3, new Set(moving)));
    if (style === 'toss') sfx.chips(Math.max(2, moving.length), this.pan(from.at.x), 0.05);
    else sfx.chipSlide(this.pan(from.at.x), dur);
    await this.anim.run(new Parallel(ms));
    if (style !== 'toss') sfx.chips(Math.min(6, moving.length), this.pan(to.at.x));
    sfx.chipSettle(this.pan(to.at.x));
  }

  /** Color up a big pile into fewer, larger chips (dealer exchanges them). */
  private async colorUp(p: Pile) {
    const amount = pileAmount(p);
    const want = breakdown(amount);
    const wantCount = want.reduce((a, b) => a + b.count, 0);
    if (p.chips.length <= 60 || wantCount >= p.chips.length * 0.8) return;
    const tray = this.L.dealer.tray;
    // send everything, receive the efficient breakdown
    const old = p.chips;
    p.chips = [];
    const ms: Motion[] = old.map((c, i) => new SlideMotion(c, new THREE.Vector3(tray.x + jitter(0.04), c.pos.y, tray.z + jitter(0.03)), 0.5, i * 0.003));
    sfx.chipSlide(this.pan(p.at.x), 0.5);
    await this.anim.run(new Parallel(ms));
    old.forEach((c) => this.scene.chips.release(c));
    const incoming: ChipObj[] = [];
    for (const part of want)
      for (let i = 0; i < part.count; i++) {
        const c = this.scene.chips.alloc(part.denom);
        if (!c) continue;
        c.pos.set(tray.x, incoming.length * CHIP.h * 0.2, tray.z);
        incoming.push(c);
        p.chips.push(c);
      }
    const targets = this.pileTargets(p);
    await this.anim.run(new Parallel(incoming.map((c, i) => new SlideMotion(c, targets.get(c)!.pos, 0.55, i * 0.01, targets.get(c)!.quat))));
    sfx.chips(incoming.length, this.pan(p.at.x));
  }

  // ---------------------------------------------------------------- stacks & bets
  setStack(seat: number, amount: number) {
    const s = this.seats[seat];
    if (!s) return;
    this.setPileInstant(s.stack, amount);
  }
  setBet(seat: number, amount: number) {
    const s = this.seats[seat];
    if (!s) return;
    this.setPileInstant(s.bet, amount);
  }
  stackAmount(seat: number) {
    return pileAmount(this.seats[seat].stack);
  }

  async bet(seat: number, add: number, allIn: boolean) {
    const s = this.seats[seat];
    if (!s || add <= 0) return;
    if (allIn && this.opts.chipIntensity !== 'subtle') {
      // dramatic push: the whole stack slides forward as columns
      await this.transfer(s.stack, s.bet, add, 'push', { duration: 0.8, stagger: 0.002 });
    } else {
      const big = add >= 20 * (this.minChip() || 1);
      await this.transfer(s.stack, s.bet, add, big && this.opts.chipIntensity === 'dramatic' ? 'toss' : 'toss');
    }
  }

  private minChip() {
    return 1;
  }

  async returnBet(seat: number, amount: number) {
    const s = this.seats[seat];
    if (!s) return;
    await this.transfer(s.bet, s.stack, amount, 'slide');
  }

  /** Sweep all bets into the pot(s). potAmounts = total in each pot after collecting. */
  async collectBets(potAmounts: number[]) {
    const L = this.L;
    while (this.pots.length < potAmounts.length) {
      const i = this.pots.length;
      const at = i === 0 ? L.pot : L.sidePots[(i - 1) % L.sidePots.length];
      this.pots.push({ chips: [], at, facing: L.dealer.inward, maxPer: 16, seed: 900 + i });
    }
    const all: ChipObj[] = [];
    this.seats.forEach((s) => {
      all.push(...s.bet.chips);
      s.bet.chips = [];
    });
    if (!all.length && potAmounts.length <= 1) return;
    // 1) sweep: every bet slides to the pot area
    const center = this.pots[0].at;
    const ms: Motion[] = all.map((c, i) => new SlideMotion(c, new THREE.Vector3(center.x + jitter(0.06), c.pos.y, center.z + jitter(0.04)), 0.55, (i % 8) * 0.01, null, undefined, 0.5));
    if (all.length) {
      sfx.chipSlide(0, 0.55);
      await this.anim.run(new Parallel(ms));
    }
    // 2) distribute into pot piles
    const pooled: ChipObj[] = [...all];
    this.pots.forEach((p) => {
      pooled.push(...p.chips);
      p.chips = [];
    });
    const temp: Pile = { chips: pooled, at: center, facing: L.dealer.inward, maxPer: 16, seed: 1 };
    for (let i = 0; i < potAmounts.length; i++) {
      const amt = potAmounts[i];
      if (i === potAmounts.length - 1) {
        this.pots[i].chips.push(...temp.chips);
        temp.chips = [];
      } else {
        let plan = this.planTake(temp, amt);
        if (plan.breaks.length) {
          // change made instantly in the pot (dealer does it as part of the sweep)
          for (const b of plan.breaks) {
            const c = temp.chips.find((x) => x.denom === b.denom)!;
            temp.chips.splice(temp.chips.indexOf(c), 1);
            this.scene.chips.release(c);
            b.into.forEach((d) => {
              const n = this.scene.chips.alloc(d);
              if (n) {
                n.pos.copy(c.pos);
                temp.chips.push(n);
              }
            });
          }
          plan = this.planTake(temp, amt);
        }
        for (const [d, n] of plan.take) {
          const list = temp.chips.filter((c) => c.denom === d).slice(0, n);
          temp.chips = temp.chips.filter((c) => !list.includes(c));
          this.pots[i].chips.push(...list);
        }
      }
    }
    // extra pots no longer needed
    for (let i = potAmounts.length; i < this.pots.length; i++) {
      this.pots[i].chips.forEach((c) => this.scene.chips.release(c));
    }
    this.pots.length = potAmounts.length;
    const lay: Motion[] = this.pots.map((p) => this.relayoutMotion(p, 0.35));
    await this.anim.run(new Parallel(lay));
    sfx.chips(6, 0);
    for (const p of this.pots) await this.colorUp(p);
  }

  setPotsInstant(potAmounts: number[]) {
    this.pots.forEach((p) => p.chips.forEach((c) => this.scene.chips.release(c)));
    this.pots = [];
    const L = this.L;
    potAmounts.forEach((amt, i) => {
      const at = i === 0 ? L.pot : L.sidePots[(i - 1) % L.sidePots.length];
      const p: Pile = { chips: [], at, facing: L.dealer.inward, maxPer: 16, seed: 900 + i };
      this.spawnPile(p, amt);
      this.placePileInstant(p);
      this.pots.push(p);
    });
  }

  /** Push (part of) pot `potIndex` to the winners. */
  async payout(potIndex: number, winners: { seat: number; amount: number }[]) {
    const pot = this.pots[potIndex] ?? this.pots[0];
    if (!pot) return;
    const ms: Promise<void>[] = [];
    // split pots: divide physically first, then push each share
    for (const w of winners) {
      const s = this.seats[w.seat];
      if (!s) continue;
      ms.push(this.transfer(pot, s.stack, w.amount, 'push', { duration: 0.8, stagger: 0.003 }));
      // sequential for clarity when split
      await ms[ms.length - 1];
    }
    if (pot.chips.length === 0) {
      const i = this.pots.indexOf(pot);
      if (i >= 0 && potIndex !== 0) this.pots.splice(i, 1);
    }
    for (const w of winners) {
      const s = this.seats[w.seat];
      if (s) await this.colorUp(s.stack);
    }
  }

  clearPots() {
    this.pots.forEach((p) => p.chips.forEach((c) => this.scene.chips.release(c)));
    this.pots = [];
  }

  // ---------------------------------------------------------------- cards
  private deckYaw() {
    return yawFacing(this.L.dealer.inward) + Math.PI / 2;
  }
  private deckPos(i: number) {
    const d = this.L.dealer.deck;
    return new THREE.Vector3(d.x, CARD_REST + i * DECK_STEP, d.z);
  }

  /** Put all 52 cards into the deck pile instantly. */
  resetDeckInstant() {
    const cards = this.scene.cards.cards;
    this.deck = [];
    this.muck = [];
    this.board = [];
    this.board2 = [];
    this.seats.forEach((s) => (s.hole = []));
    for (let i = 0; i < 52; i++) {
      const c = cards[i];
      c.visible = true;
      c.face = -1;
      c.glow = 0;
      c.dim = 0;
      c.bend = 0;
      c.pos.copy(this.deckPos(i)).add(new THREE.Vector3(jitter(0.0006), 0, jitter(0.0006)));
      cardQuat(this.deckYaw() + jitter(0.01), true, c.quat);
      this.deck.push(c);
    }
    for (let i = 52; i < cards.length; i++) cards[i].visible = false;
    this.scene.cards.dirty = true;
  }

  /** Gather every card on the table back to the dealer, stack and square the deck. */
  async gatherCards() {
    const all = [...this.muck, ...this.board, ...this.board2, ...this.seats.flatMap((s) => s.hole)];
    this.muck = [];
    this.board = [];
    this.board2 = [];
    this.seats.forEach((s) => {
      s.hole = [];
      s.folded = false;
    });
    this.revealed = false;
    if (!all.length) return;
    const d = this.L.dealer.deck;
    const base = this.deck.length;
    const ms: Motion[] = [];
    // sweep: cards slide (face down) toward the dealer, then are stacked
    all.forEach((c, i) => {
      c.glow = 0;
      c.dim = 0;
      c.bend = 0;
      const mid = new THREE.Vector3(d.x + jitter(0.08), CARD_REST + 0.002, d.z + jitter(0.05));
      const q = cardQuat(this.deckYaw() + jitter(0.4), true);
      ms.push(new Sequence([new ArcMotion(c, mid, q, 0.45, 0.02, i * 0.012), new ArcMotion(c, this.deckPos(base + i), cardQuat(this.deckYaw() + jitter(0.06), true), 0.25, 0.01, 0)]));
    });
    sfx.cardSlide(0, 0.5, 0, 0.18);
    await this.anim.run(new Parallel(ms));
    all.forEach((c) => (c.face = -1));
    this.deck.push(...all);
    await this.squareUp();
  }

  private async squareUp() {
    const ms = this.deck.map((c, i) => new Tween(0.15, (k) => {
      const t = this.deckPos(i);
      c.pos.lerp(t, k);
      c.quat.slerp(cardQuat(this.deckYaw(), true), k);
    }));
    sfx.squareUp();
    await this.anim.run(new Parallel(ms));
  }

  async shuffle(style: ShuffleStyle, quick: boolean) {
    if (this.deck.length < 10) return;
    const st = style === 'random' ? (['riffle', 'bridge', 'overhand', 'wash', 'cut'] as const)[Math.floor(rnd() * 5)] : style;
    if (quick) {
      await this.riffle(false, 0.6);
      return this.cut();
    }
    switch (st) {
      case 'riffle':
        await this.riffle(false);
        await this.riffle(false);
        return this.cut();
      case 'bridge':
        await this.riffle(true);
        await this.riffle(true);
        return this.cut();
      case 'overhand':
        await this.overhand();
        return this.cut();
      case 'wash':
        await this.wash();
        return this.cut();
      case 'cut':
        await this.cut();
        await this.cut();
        return;
    }
  }

  /** Riffle: split, lift the inner edges with bent cards, interleave in a cascade, (bridge) arch and release. */
  private async riffle(bridge: boolean, speed = 1) {
    const n = this.deck.length;
    const d = this.L.dealer.deck;
    const yaw = this.deckYaw();
    const along = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // card's local x in world (short side)
    const side = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // card's local z (long side)
    const half = Math.floor(n / 2 + jitter(6));
    const left = this.deck.slice(0, half);
    const right = this.deck.slice(half);
    const sep = CARD_SIZE.h * 0.62;
    // 1) split into two halves side by side (along the long axis)
    const split: Motion[] = [];
    left.forEach((c, i) => split.push(new ArcMotion(c, new THREE.Vector3(d.x - side.x * sep, CARD_REST + i * DECK_STEP, d.z - side.z * sep), null, 0.28 / speed, 0.015)));
    right.forEach((c, i) => split.push(new ArcMotion(c, new THREE.Vector3(d.x + side.x * sep, CARD_REST + i * DECK_STEP, d.z + side.z * sep), null, 0.28 / speed, 0.015)));
    await this.anim.run(new Parallel(split));
    // 2) thumbs bend the inner corners up (card bending in the shader) and tilt
    const tilt = 0.22;
    const bendM: Motion[] = [];
    const tiltQ = (dir: number) => cardQuat(yaw, true).premultiply(new THREE.Quaternion().setFromAxisAngle(along, dir * tilt));
    left.forEach((c) => bendM.push(new Tween(0.18 / speed, (k) => {
      c.bend = 0.7 * k;
      c.bendSign = -1;
      c.quat.copy(cardQuat(yaw, true)).slerp(tiltQ(1), k);
    })));
    right.forEach((c) => bendM.push(new Tween(0.18 / speed, (k) => {
      c.bend = 0.7 * k;
      c.bendSign = -1;
      c.quat.copy(cardQuat(yaw, true)).slerp(tiltQ(-1), k);
    })));
    await this.anim.run(new Parallel(bendM));
    // 3) cascade: release cards alternately from the bottom into the center pile
    const order: CardObj[] = [];
    let a = 0,
      b = 0;
    while (a < left.length || b < right.length) {
      const takeA = b >= right.length || (a < left.length && rnd() < 0.5 + (left.length - a - (right.length - b)) * 0.05);
      const chunk = 1 + (rnd() < 0.25 ? 1 : 0);
      for (let k = 0; k < chunk; k++) {
        if (takeA && a < left.length) order.push(left[a++]);
        else if (!takeA && b < right.length) order.push(right[b++]);
      }
    }
    const dur = (bridge ? 0.85 : 0.7) / speed;
    if (!this.anim.instant) sfx.riffle(dur / Math.max(0.25, this.anim.speed));
    const cas: Motion[] = order.map((c, i) => {
      const fromLeft = left.includes(c);
      const target = new THREE.Vector3(d.x + side.x * (fromLeft ? -1 : 1) * 0.008 + jitter(0.001), CARD_REST + i * DECK_STEP, d.z + side.z * (fromLeft ? -1 : 1) * 0.008);
      return new Tween(0.09, (k) => {
        c.pos.lerp(target, k);
        c.quat.slerp(cardQuat(yaw, true), k);
        c.bend = 0.7 * (1 - k);
      }, (i / order.length) * dur);
    });
    await this.anim.run(new Parallel(cas));
    if (bridge) {
      // bridge: arch the whole deck upward, then let it cascade flat
      sfx.bridge();
      await this.anim.run(
        new Parallel(
          order.map((c, i) => new Tween(0.5 / speed, (k) => {
            const lift = Math.sin(k * Math.PI) * 0.012;
            c.bend = Math.sin(k * Math.PI) * 0.6;
            c.bendSign = 1;
            c.pos.y = CARD_REST + i * DECK_STEP + lift;
          })),
        ),
      );
    }
    this.deck = order;
    await this.anim.run(
      new Parallel(
        this.deck.map((c, i) => new Tween(0.18 / speed, (k) => {
          c.pos.lerp(this.deckPos(i), k);
          c.bend = 0;
        })),
      ),
    );
    sfx.squareUp();
  }

  /** Table-top strip/overhand shuffle: packets from the top build a new pile beside the deck. */
  private async overhand() {
    const d = this.L.dealer.deck;
    const side = this.L.dealer.inward;
    const right = { x: -side.z, z: side.x };
    const dest = new THREE.Vector3(d.x + right.x * 0.1, 0, d.z + right.z * 0.1);
    const packets: CardObj[][] = [];
    let rest = [...this.deck];
    while (rest.length) {
      const k = Math.min(rest.length, 4 + Math.floor(rnd() * 8));
      packets.push(rest.slice(rest.length - k));
      rest = rest.slice(0, rest.length - k);
    }
    const newDeck: CardObj[] = [];
    for (const p of packets) {
      const ms = p.map((c, i) => new ArcMotion(c, new THREE.Vector3(dest.x + jitter(0.002), CARD_REST + (newDeck.length + i) * DECK_STEP, dest.z + jitter(0.002)), null, 0.16, 0.02));
      newDeck.push(...p);
      sfx.cardSlide(this.pan(dest.x), 0.1, 0, 0.1);
      await this.anim.run(new Parallel(ms));
    }
    this.deck = newDeck;
    await this.anim.run(new Parallel(this.deck.map((c, i) => new ArcMotion(c, this.deckPos(i), null, 0.3, 0.02))));
    sfx.squareUp();
  }

  /** Wash / scramble: spread cards across the felt, swirl, gather. */
  private async wash() {
    const d = this.L.dealer.deck;
    const center = new THREE.Vector3(d.x + this.L.dealer.inward.x * 0.15, CARD_REST, d.z + this.L.dealer.inward.z * 0.15);
    const states = this.deck.map((c) => ({ c, a: rnd() * Math.PI * 2, r: 0.04 + rnd() * 0.16, w: (rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 2), yaw: rnd() * 6.28 }));
    if (!this.anim.instant) sfx.wash(1.6 / Math.max(0.25, this.anim.speed));
    await this.anim.run(
      new Parallel(states.map((s, i) => new Tween(0.4, (k) => {
        const t = new THREE.Vector3(center.x + Math.cos(s.a) * s.r, CARD_REST + i * 0.00005, center.z + Math.sin(s.a) * s.r * 0.6);
        s.c.pos.lerp(t, k);
        s.c.quat.slerp(cardQuat(s.yaw, true), k);
      }, i * 0.004))),
    );
    await this.anim.run(
      new Parallel(states.map((s, i) => new Tween(1.2, (k, dt) => {
        s.a += s.w * dt * 1.4;
        s.yaw += s.w * dt * 0.8;
        s.r = Math.max(0.03, s.r + Math.sin(k * 9 + i) * dt * 0.05);
        s.c.pos.set(center.x + Math.cos(s.a) * s.r, CARD_REST + i * 0.00005, center.z + Math.sin(s.a) * s.r * 0.6);
        cardQuat(s.yaw, true, s.c.quat);
      }))),
    );
    // shuffle order cosmetically
    this.deck = states.sort(() => rnd() - 0.5).map((s) => s.c);
    await this.anim.run(new Parallel(this.deck.map((c, i) => new ArcMotion(c, this.deckPos(i), cardQuat(this.deckYaw(), true), 0.45, 0.01, i * 0.003))));
    sfx.squareUp();
  }

  /** Cut: lift the top half aside, put the bottom half on top. */
  async cut() {
    const n = this.deck.length;
    const k = Math.floor(n * (0.35 + rnd() * 0.3));
    const top = this.deck.slice(k);
    const bottom = this.deck.slice(0, k);
    const d = this.L.dealer.deck;
    const side = this.L.dealer.inward;
    const off = new THREE.Vector3(-side.z * 0.085, 0, side.x * 0.085);
    await this.anim.run(new Parallel(top.map((c, i) => new ArcMotion(c, new THREE.Vector3(d.x + off.x, CARD_REST + i * DECK_STEP, d.z + off.z), null, 0.3, 0.025))));
    sfx.cardSlide(0, 0.1, 0, 0.12);
    await this.anim.run(new Parallel(bottom.map((c, i) => new ArcMotion(c, new THREE.Vector3(d.x, CARD_REST + (top.length + i) * DECK_STEP + 0.004, d.z), null, 0.3, 0.04))));
    await this.anim.run(new Parallel(top.map((c, i) => new ArcMotion(c, new THREE.Vector3(d.x, CARD_REST + i * DECK_STEP, d.z), null, 0.28, 0.01))));
    this.deck = [...top, ...bottom];
    await this.squareUp();
  }

  private holeTarget(seat: number, k: number, human: boolean) {
    const st = this.L.seats[seat];
    const right = { x: -st.inward.z, z: st.inward.x };
    const off = (k - 0.5) * CARD_SIZE.w * (human ? 0.62 : 0.34);
    const pos = new THREE.Vector3(st.cards.x + right.x * off + jitter(0.003), CARD_REST + k * 0.0005, st.cards.z + right.z * off + jitter(0.003));
    const yaw = yawFacing(st.inward) - (k - 0.5) * (human ? 0.17 : 0.08) + jitter(0.06);
    return { pos, yaw };
  }

  /** Deal hole cards one at a time, clockwise starting left of the button. */
  async dealHole(order: number[], rounds: number, humanSeat: number, humanFaces: number[]) {
    this.humanSeat = humanSeat;
    this.revealed = false;
    const flick = this.opts.dealStyle === 'flick';
    const gap = flick ? 0.09 : 0.14;
    const ms: Motion[] = [];
    let n = 0;
    for (let r = 0; r < rounds; r++)
      for (const seat of order) {
        const c = this.deck.pop();
        if (!c) continue;
        const human = seat === humanSeat;
        c.face = human ? humanFaces[r] ?? -1 : -1;
        this.seats[seat].hole.push(c);
        const t = this.holeTarget(seat, r, human);
        const q = cardQuat(t.yaw, true);
        const delay = n * gap;
        const pan = this.pan(t.pos.x);
        if (flick) {
          ms.push(new FlickMotion(c, t.pos, q, { speed: 2.6, slideFrac: 0.2, spin: jitter(1.2), delay, onLand: () => sfx.cardLand(pan) }));
          setTimeoutScaled(this.anim, delay, () => sfx.cardFlick(this.pan(this.L.dealer.deck.x)));
        } else {
          ms.push(new SlideMotion(c, t.pos, 0.42, delay, q));
          setTimeoutScaled(this.anim, delay, () => sfx.cardSlide(pan, 0.35));
        }
        n++;
      }
    await this.anim.run(new Parallel(ms));
  }

  /** Reveal (flip face up) the human's hole cards. */
  async revealHuman() {
    const s = this.seats[this.humanSeat];
    if (!s || this.revealed || s.folded) return;
    this.revealed = true;
    const ms = s.hole.map((c, k) => {
      const t = this.holeTarget(this.humanSeat, k, true);
      const e = new THREE.Euler().setFromQuaternion(c.quat, 'YXZ');
      return new ArcMotion(c, c.pos.clone(), cardQuat(e.y, false), 0.32, 0.03, k * 0.08, () => sfx.cardFlip(this.pan(t.pos.x)));
    });
    await this.anim.run(new Parallel(ms));
  }

  /** Corner peek amount for human cards (0..1), driven by touch-and-hold. */
  setPeek(amount: number) {
    const s = this.seats[this.humanSeat];
    if (!s || this.revealed) return;
    s.hole.forEach((c, k) => {
      c.bend = amount * (k === 1 ? 1 : 0.85);
      c.bendSign = -1;
    });
    this.scene.cards.dirty = true;
    this.scene.requestRender();
  }

  async burn() {
    const c = this.deck.pop();
    if (!c) return;
    const m = this.L.dealer.muck;
    const pos = new THREE.Vector3(m.x + jitter(0.01), CARD_REST + this.muck.length * DECK_STEP, m.z + jitter(0.01));
    this.muck.push(c);
    sfx.cardSlide(this.pan(m.x), 0.18, 0, 0.1);
    await this.anim.run(new SlideMotion(c, pos, 0.3, 0, cardQuat(this.deckYaw() + jitter(0.3), true)));
  }

  /** Deal board cards face down to their spots, then flip them (flop staggered, turn/river with suspense). */
  async dealBoard(faces: number[], startIndex: number, run: number, street: 'flop' | 'turn' | 'river') {
    const spots = run === 2 ? this.L.board2 : this.L.board;
    const target = run === 2 ? this.board2 : this.board;
    const cards: CardObj[] = [];
    const ms: Motion[] = [];
    faces.forEach((f, i) => {
      const c = this.deck.pop();
      if (!c) return;
      c.face = f;
      const sp = spots[startIndex + i];
      const pos = new THREE.Vector3(sp.x + jitter(0.002), CARD_REST, sp.z + jitter(0.002));
      const q = cardQuat(jitter(0.03), true);
      cards.push(c);
      target.push(c);
      ms.push(new SlideMotion(c, street === 'flop' ? pos.clone().setX(spots[startIndex].x + jitter(0.003)).setZ(spots[startIndex].z) : pos, 0.38, i * 0.03, q));
    });
    sfx.cardSlide(0, 0.35);
    await this.anim.run(new Parallel(ms));
    if (street === 'flop') {
      // flip the flop as one packet, then spread it
      await this.anim.wait(0.12);
      const flipMs = cards.map((c) => {
        const e = new THREE.Euler().setFromQuaternion(c.quat, 'YXZ');
        return new ArcMotion(c, c.pos.clone(), cardQuat(e.y, false), 0.36, 0.035);
      });
      sfx.cardFlip(0);
      await this.anim.run(new Parallel(flipMs));
      const spread = cards.map((c, i) => {
        const sp = spots[startIndex + i];
        return new SlideMotion(c, new THREE.Vector3(sp.x + jitter(0.002), CARD_REST + i * 0.0002, sp.z + jitter(0.002)), 0.32, i * 0.06);
      });
      sfx.cardSlide(0, 0.3, 0, 0.1);
      await this.anim.run(new Parallel(spread));
    } else {
      const slow = street === 'river' && this.opts.slowRollRiver;
      await this.anim.wait(slow ? 0.9 : 0.25);
      const c = cards[0];
      if (slow) {
        // peel the corner first for suspense
        await this.anim.run(new Tween(0.7, (k) => {
          c.bend = Math.sin(k * Math.PI) * 0.8;
          c.bendSign = -1;
        }));
      }
      const e = new THREE.Euler().setFromQuaternion(c.quat, 'YXZ');
      sfx.cardFlip(0);
      await this.anim.run(new ArcMotion(c, c.pos.clone(), cardQuat(e.y, false), slow ? 0.55 : 0.36, 0.04));
    }
  }

  async fold(seat: number) {
    const s = this.seats[seat];
    if (!s || !s.hole.length) return;
    s.folded = true;
    const m = this.L.dealer.muck;
    const ms: Motion[] = s.hole.map((c, k) => {
      const pos = new THREE.Vector3(m.x + jitter(0.04), CARD_REST + (this.muck.length + k) * DECK_STEP + 0.0005, m.z + jitter(0.03));
      this.muck.push(c);
      // folded cards are tossed forward face down with spin and slide into the muck
      return new FlickMotion(c, pos, cardQuat(rnd() * 6.28, true), { speed: 1.6, slideFrac: 0.35, spin: jitter(3), delay: k * 0.04 });
    });
    s.hole.forEach((c) => (c.bend = 0));
    s.hole = [];
    sfx.foldThud(this.pan(this.L.seats[seat].cards.x));
    sfx.cardSlide(this.pan(this.L.seats[seat].cards.x), 0.4, 0.05, 0.1);
    await this.anim.run(new Parallel(ms));
  }

  /** Flip a player's hole cards face up at showdown. */
  async show(seat: number, faces: number[]) {
    const s = this.seats[seat];
    if (!s) return;
    const ms = s.hole.map((c, k) => {
      c.face = faces[k];
      c.bend = 0;
      const e = new THREE.Euler().setFromQuaternion(c.quat, 'YXZ');
      // spread slightly so both are readable
      const t = this.holeTarget(seat, k, true);
      return new ArcMotion(c, new THREE.Vector3(t.pos.x, CARD_REST + k * 0.0005, t.pos.z), cardQuat(e.y, false), 0.38, 0.04, k * 0.1);
    });
    sfx.cardFlip(this.pan(this.L.seats[seat].cards.x));
    await this.anim.run(new Parallel(ms));
  }

  /** Muck at showdown (losing hand not shown). */
  async muckHand(seat: number) {
    await this.fold(seat);
  }

  /** Winning five cards lift and glow, others dim. */
  async highlight(faces: number[], keepSeats: number[]) {
    const set = new Set(faces);
    const live = [...this.board, ...this.board2, ...keepSeats.flatMap((s) => this.seats[s]?.hole ?? [])];
    const ms: Motion[] = [];
    for (const c of [...this.board, ...this.board2, ...this.seats.flatMap((s) => s.hole)]) {
      const win = live.includes(c) && set.has(c.face);
      const y0 = c.pos.y;
      ms.push(new Tween(0.35, (k) => {
        c.glow = win ? k : 0;
        c.dim = win ? 0 : k * 0.85;
        c.pos.y = win ? CARD_REST + 0.006 * Math.sin(Math.min(1, k) * Math.PI * 0.5) : y0;
      }));
    }
    await this.anim.run(new Parallel(ms));
  }

  clearHighlight() {
    for (const c of this.scene.cards.cards) {
      c.glow = 0;
      c.dim = 0;
    }
    this.scene.cards.dirty = true;
  }

  /** Dealer button and blind buttons. */
  async moveButtons(button: number, sb: number | null, bb: number | null, instant = false) {
    const place = (g: THREE.Group, seat: number | null, offset: number) => {
      if (seat === null || !this.L.seats[seat]) {
        g.visible = false;
        return null;
      }
      const st = this.L.seats[seat];
      const right = { x: -st.inward.z, z: st.inward.x };
      const to = new THREE.Vector3(st.button.x + right.x * offset, 0, st.button.z + right.z * offset);
      if (!g.visible || instant) {
        g.position.copy(to);
        g.visible = true;
        return null;
      }
      const pose = { pos: g.position, quat: g.quaternion };
      return new SlideMotion(pose, to, 0.6);
    };
    const ms = [place(this.scene.buttons.dealer, button, 0), place(this.scene.buttons.sb, sb, -0.05), place(this.scene.buttons.bb, bb, -0.05)].filter(Boolean) as Motion[];
    if (ms.length) {
      sfx.chipSlide(0, 0.4);
      await this.anim.run(new Parallel(ms));
    }
    this.scene.requestRender();
  }

  /** Idle fidget: a bot riffles/toys with a few chips from its stack (purely cosmetic). */
  async fidget(seat: number) {
    const s = this.seats[seat];
    if (!s || s.stack.chips.length < 4 || this.anim.busy) return;
    const top = [...s.stack.chips].sort((a, b) => b.pos.y - a.pos.y).slice(0, 3);
    const st = this.L.seats[seat];
    const right = { x: -st.inward.z, z: st.inward.x };
    const saved = top.map((c) => ({ c, pos: c.pos.clone(), quat: c.quat.clone() }));
    const side = new THREE.Vector3(st.stack.x - right.x * 0.06, 0, st.stack.z - right.z * 0.06);
    const ms1 = top.map((c, i) => new ArcMotion(c, side.clone().setY(i * CHIP.h), null, 0.35, 0.02, i * 0.08, () => sfx.chips(1, this.pan(side.x))));
    await this.anim.run(new Parallel(ms1));
    await this.anim.wait(0.3);
    const ms2 = saved.reverse().map((x, i) => new ArcMotion(x.c, x.pos, x.quat, 0.3, 0.02, i * 0.09, () => sfx.chips(1, this.pan(x.pos.x))));
    await this.anim.run(new Parallel(ms2));
  }

  /** Instantly clear all cards/chips (e.g. leaving the table). */
  clearAll() {
    this.scene.chips.releaseAll();
    this.seats.forEach((s) => {
      s.stack.chips = [];
      s.bet.chips = [];
      s.hole = [];
    });
    this.pots = [];
    this.resetDeckInstant();
  }

  /** Instantly lay out hole cards for a seat (resume). */
  placeHoleInstant(seat: number, faces: number[], faceUp: boolean, human: boolean) {
    const s = this.seats[seat];
    if (!s) return;
    faces.forEach((f, k) => {
      const c = this.deck.pop();
      if (!c) return;
      c.face = f;
      const t = this.holeTarget(seat, k, human);
      c.pos.copy(t.pos);
      cardQuat(t.yaw, !faceUp, c.quat);
      s.hole.push(c);
    });
    if (human && faceUp) this.revealed = true;
    this.scene.cards.dirty = true;
  }

  placeBoardInstant(faces: number[], run: number) {
    const spots = run === 2 ? this.L.board2 : this.L.board;
    faces.forEach((f, i) => {
      const c = this.deck.pop();
      if (!c) return;
      c.face = f;
      c.pos.set(spots[i].x, CARD_REST, spots[i].z);
      cardQuat(0, false, c.quat);
      (run === 2 ? this.board2 : this.board).push(c);
    });
    this.scene.cards.dirty = true;
  }

  placeMuckInstant(count: number) {
    const m = this.L.dealer.muck;
    for (let i = 0; i < count; i++) {
      const c = this.deck.pop();
      if (!c) return;
      c.pos.set(m.x + jitter(0.03), CARD_REST + this.muck.length * DECK_STEP, m.z + jitter(0.02));
      cardQuat(rnd() * 6.28, true, c.quat);
      this.muck.push(c);
    }
  }
}

/** setTimeout in animation time (respects speed and skipping). */
function setTimeoutScaled(anim: Animator, seconds: number, fn: () => void) {
  if (anim.instant) return;
  void anim.wait(seconds).then(fn);
}
