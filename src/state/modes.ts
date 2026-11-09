// Game modes -> table configuration and seating.
import { standardLevels, defaultPayouts, type TableConfig, type TableSeat, type GameMode } from '../engine/table';
import type { Settings } from './settings';
import { CHARACTERS, difficultyForChoice } from '../ai/characters';
import type { Archetype } from '../ai/types';
import { cryptoRng, shuffle } from '../engine/rng';

export interface BotSetup {
  name: string;
  archetype: Archetype;
  difficulty: string;
  avatarSeed: number;
  stack: number;
  bio?: string;
}

export interface GameSetupSpec {
  mode: GameMode;
  players: number;
  startingStack: number;
  sb: number;
  bb: number;
  ante: number;
  structure: 'NL' | 'PL' | 'FL';
  tournament: boolean;
  levelBy: 'hands' | 'minutes' | 'none';
  levelLength: number;
  rebuys: boolean;
  straddle: boolean;
  runItTwice: 'off' | 'ask' | 'always';
  payouts: number[];
  difficulty: string;
  bots: BotSetup[];
}

export const MODE_INFO: Record<GameMode, { title: string; desc: string }> = {
  quick: { title: 'Quick Play', desc: 'Jump straight into a 6-max cash game with your default settings.' },
  cash: { title: 'Cash Game', desc: 'Deep-stacked ring game. Rebuy and top up any time; players come and go.' },
  sng: { title: 'Sit & Go', desc: 'Single-table tournament with rising blinds and prizes for the top finishers.' },
  headsup: { title: 'Heads-Up Duel', desc: 'You against one opponent. Winner takes all.' },
  custom: { title: 'Custom Game', desc: 'Configure every parameter: seats, bots, blinds, structure, rules.' },
};

export function pickBots(n: number, difficulty: string, stack: number): BotSetup[] {
  const pool = shuffle([...CHARACTERS], cryptoRng);
  return Array.from({ length: n }, (_, i) => {
    const c = pool[i % pool.length];
    return { name: c.name, archetype: c.archetype, difficulty: difficultyForChoice(difficulty, i, cryptoRng.next()), avatarSeed: c.avatarSeed, stack, bio: c.bio };
  });
}

export function setupForMode(mode: GameMode, s: Settings): GameSetupSpec {
  const g = s.gameplay;
  const base: GameSetupSpec = {
    mode,
    players: g.players,
    startingStack: g.startingStack,
    sb: g.smallBlind,
    bb: g.bigBlind,
    ante: g.ante,
    structure: g.structure,
    tournament: false,
    levelBy: 'none',
    levelLength: g.levelLength,
    rebuys: g.rebuys,
    straddle: g.straddle,
    runItTwice: g.runItTwice,
    payouts: [1],
    difficulty: g.defaultDifficulty,
    bots: [],
  };
  switch (mode) {
    case 'quick':
      base.players = 6;
      base.rebuys = true;
      break;
    case 'cash':
      base.startingStack = g.bigBlind * 100;
      base.rebuys = true;
      break;
    case 'sng':
      base.tournament = true;
      base.levelBy = g.levelBy;
      base.rebuys = false;
      base.straddle = false;
      base.payouts = defaultPayouts(g.players);
      break;
    case 'headsup':
      base.players = 2;
      base.tournament = true;
      base.levelBy = g.levelBy;
      base.rebuys = false;
      base.payouts = [1];
      break;
    case 'custom':
      break;
  }
  base.bots = pickBots(base.players - 1, base.difficulty, base.startingStack);
  return base;
}

export function buildTable(spec: GameSetupSpec): { config: TableConfig; seats: TableSeat[] } {
  const config: TableConfig = {
    mode: spec.mode,
    seats: spec.players,
    structure: spec.structure,
    startingStack: spec.startingStack,
    levels: spec.tournament ? standardLevels(spec.sb, spec.bb, spec.ante, true) : [{ sb: spec.sb, bb: spec.bb, ante: spec.ante }],
    levelBy: spec.tournament ? spec.levelBy : 'none',
    levelLength: spec.levelLength,
    rebuys: spec.rebuys,
    straddle: spec.straddle,
    runItTwice: spec.runItTwice !== 'off',
    payouts: spec.payouts,
    tournament: spec.tournament,
  };
  const seats: TableSeat[] = [{ seat: 0, id: 'human', name: 'You', stack: spec.startingStack, isHuman: true, busted: false, sittingOut: false, buyIns: 1 }];
  spec.bots.slice(0, spec.players - 1).forEach((b, i) => {
    seats.push({
      seat: i + 1,
      id: `bot-${i + 1}-${b.avatarSeed}`,
      name: b.name,
      stack: b.stack || spec.startingStack,
      isHuman: false,
      bot: { archetype: b.archetype, difficulty: b.difficulty, avatarSeed: b.avatarSeed },
      busted: false,
      sittingOut: false,
      buyIns: 1,
    });
  });
  return { config, seats };
}
