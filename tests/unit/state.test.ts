import { describe, it, expect } from 'vitest';
import { migrateSettings, defaultSettings, SETTINGS_VERSION } from '../../src/state/settings';
import { createTable, nextHandInit, applyHandResult, activeSeats, standardLevels, type TableSeat } from '../../src/engine/table';
import { createHand, applyAction, getLegal } from '../../src/engine/game';
import { SeededRng } from '../../src/engine/rng';
import { validateBackup, BACKUP_FORMAT } from '../../src/storage/backup';

describe('settings migration', () => {
  it('fills defaults, keeps valid values and upgrades old versions', () => {
    const m = migrateSettings({ version: 1, anim: { speed: 2 }, look: { theme: 'leather', felt: '#123456' }, junk: 5 });
    expect(m.version).toBe(SETTINGS_VERSION);
    expect(m.anim.speed).toBe('2');
    expect(m.look.uiTheme).toBe('leather');
    expect(m.look.felt).toBe('#123456');
    expect(m.gameplay.players).toBe(defaultSettings().gameplay.players);
    expect((m as any).junk).toBeUndefined();
  });
  it('recovers from corrupt data', () => {
    expect(migrateSettings('garbage').version).toBe(SETTINGS_VERSION);
    expect(migrateSettings({ look: { quality: 42 } }).look.quality).toBe('auto');
  });
});

describe('backup format', () => {
  it('validates', () => {
    expect(validateBackup({ format: BACKUP_FORMAT, version: 1, kv: {}, hands: {} })).toBe(true);
    expect(validateBackup({ format: 'x' })).toBe(false);
  });
});

describe('table edge cases', () => {
  const seats = (stacks: number[]): TableSeat[] => stacks.map((s, i) => ({ seat: i, id: 'p' + i, name: 'P' + i, stack: s, isHuman: i === 0, busted: false, sittingOut: false, buyIns: 1 }));
  it('handles the transition from 3-handed to heads-up (button posts SB)', () => {
    const t = createTable({ mode: 'sng', seats: 3, structure: 'NL', startingStack: 100, levels: standardLevels(5, 10, 0, true), levelBy: 'hands', levelLength: 50, rebuys: false, straddle: false, runItTwice: false, payouts: [1], tournament: true }, seats([100, 100, 5]), new SeededRng(1));
    // make seat 2 bust: play a hand where they're all-in and lose (random) until someone busts
    let guard = 0;
    while (activeSeats(t).length === 3 && guard++ < 200) {
      const init = nextHandInit(t, new SeededRng(guard));
      const h = createHand(init);
      while (h.street !== 'complete') {
        if (h.pendingRuns) applyAction(h, { type: 'runs', amount: 1 });
        else applyAction(h, getLegal(h)!.canCheck ? { type: 'check' } : { type: 'call' });
      }
      applyHandResult(t, h);
    }
    expect(activeSeats(t).length).toBe(2);
    const init = nextHandInit(t, new SeededRng(999));
    const h = createHand(init);
    expect(h.players.length).toBe(2);
    expect(h.sbIdx).toBe(h.button);
    expect(h.toAct).toBe(h.button);
  });
  it('multi-way all-in with four different stacks conserves chips', () => {
    const t = createTable({ mode: 'cash', seats: 5, structure: 'NL', startingStack: 1000, levels: [{ sb: 5, bb: 10, ante: 1 }], levelBy: 'none', levelLength: 10, rebuys: true, straddle: false, runItTwice: false, payouts: [1], tournament: false }, seats([50, 300, 700, 1200, 2500]), new SeededRng(4));
    for (let k = 0; k < 50; k++) {
      if (activeSeats(t).length < 2) break;
      const h = createHand(nextHandInit(t, new SeededRng(k + 10)));
      while (h.street !== 'complete') {
        if (h.pendingRuns) applyAction(h, { type: 'runs', amount: 2 });
        else applyAction(h, { type: 'allin' });
      }
      applyHandResult(t, h);
      expect(t.seats.reduce((a, s) => a + (s ? s.stack : 0), 0)).toBe(4750);
    }
  });
});
