// Named bot characters with archetypes, personalities, bios and table talk.
import type { Archetype, Personality } from './types';
import type { Difficulty } from './difficulty';

export const ARCHETYPES: Record<Archetype, { label: string; desc: string; p: Personality }> = {
  TAG: { label: 'Tight-Aggressive', desc: 'Plays few hands, bets them hard.', p: { vpip: 0.22, aggr: 0.7, bluff: 0.9, sticky: 0.3, trap: 0.2, sizing: 1, tiltProne: 0.3, chatty: 0.3 } },
  LAG: { label: 'Loose-Aggressive', desc: 'Wide ranges, relentless pressure.', p: { vpip: 0.34, aggr: 0.8, bluff: 1.35, sticky: 0.35, trap: 0.15, sizing: 1.1, tiltProne: 0.45, chatty: 0.5 } },
  Rock: { label: 'Rock', desc: 'Waits for premium hands. Rarely bluffs.', p: { vpip: 0.13, aggr: 0.45, bluff: 0.35, sticky: 0.2, trap: 0.3, sizing: 0.9, tiltProne: 0.15, chatty: 0.15 } },
  Station: { label: 'Calling Station', desc: 'Calls almost anything, hates folding.', p: { vpip: 0.5, aggr: 0.2, bluff: 0.4, sticky: 0.85, trap: 0.2, sizing: 0.8, tiltProne: 0.4, chatty: 0.6 } },
  Maniac: { label: 'Maniac', desc: 'Raises everything. Chaos incarnate.', p: { vpip: 0.62, aggr: 0.95, bluff: 2.0, sticky: 0.5, trap: 0.05, sizing: 1.4, tiltProne: 0.7, chatty: 0.9 } },
  Nit: { label: 'Nit', desc: 'Folds unless holding the nuts.', p: { vpip: 0.1, aggr: 0.4, bluff: 0.2, sticky: 0.12, trap: 0.25, sizing: 0.85, tiltProne: 0.2, chatty: 0.1 } },
  Pro: { label: 'Balanced Pro', desc: 'Solid, balanced and adaptive.', p: { vpip: 0.25, aggr: 0.68, bluff: 1.0, sticky: 0.4, trap: 0.25, sizing: 1, tiltProne: 0.1, chatty: 0.25 } },
  Tourist: { label: 'Tourist', desc: 'Here for fun. Limps and calls a lot.', p: { vpip: 0.45, aggr: 0.3, bluff: 0.6, sticky: 0.6, trap: 0.1, sizing: 0.7, tiltProne: 0.5, chatty: 0.8 } },
  Trickster: { label: 'Trickster', desc: 'Traps, check-raises and loves to bluff.', p: { vpip: 0.3, aggr: 0.62, bluff: 1.6, sticky: 0.4, trap: 0.6, sizing: 1.2, tiltProne: 0.35, chatty: 0.6 } },
};

export interface Character {
  name: string;
  archetype: Archetype;
  bio: string;
  avatarSeed: number;
}

export const CHARACTERS: Character[] = [
  { name: 'Mia Calloway', archetype: 'TAG', bio: 'Actuary by day. Counts outs faster than you count chips.', avatarSeed: 11 },
  { name: 'Viktor Hale', archetype: 'LAG', bio: 'Former chess hustler who never met a pot he would not attack.', avatarSeed: 23 },
  { name: 'Grandpa Joe', archetype: 'Rock', bio: 'Has played the same Thursday game since 1971.', avatarSeed: 37 },
  { name: 'Lucky Lou', archetype: 'Station', bio: 'Believes every river card is meant for him.', avatarSeed: 41 },
  { name: 'Rex "Wild" Moreno', archetype: 'Maniac', bio: 'Shoves first, asks questions never.', avatarSeed: 53 },
  { name: 'Agnes Pruitt', archetype: 'Nit', bio: 'Folded aces once. Still thinks it was right.', avatarSeed: 67 },
  { name: 'Dr. Sana Iqbal', archetype: 'Pro', bio: 'Game theorist. Balanced to a fault.', avatarSeed: 71 },
  { name: 'Chad Whitmore', archetype: 'Tourist', bio: 'On vacation. Loves a good flop.', avatarSeed: 83 },
  { name: 'Felix "The Fox" Grey', archetype: 'Trickster', bio: 'Never shows the same move twice.', avatarSeed: 97 },
  { name: 'Ingrid Sol', archetype: 'TAG', bio: 'Patient, precise, and quietly deadly.', avatarSeed: 103 },
  { name: 'Marco Bellini', archetype: 'LAG', bio: 'Plays poker the way he drives: fast.', avatarSeed: 109 },
  { name: 'Ruth Abernathy', archetype: 'Rock', bio: 'Knits between hands. Never misses a bet.', avatarSeed: 127 },
  { name: 'Dale Pickens', archetype: 'Station', bio: '"I had to see it."', avatarSeed: 131 },
  { name: 'Kenji Mori', archetype: 'Pro', bio: 'Online grinder trying the felt.', avatarSeed: 139 },
  { name: 'Bella Rossi', archetype: 'Trickster', bio: 'Smiles the same with air or the nuts.', avatarSeed: 149 },
  { name: 'Hank Dawson', archetype: 'Tourist', bio: 'Retired trucker with a story for every card.', avatarSeed: 157 },
  { name: 'Olga Petrova', archetype: 'Maniac', bio: 'Thinks folding is a myth.', avatarSeed: 163 },
  { name: 'Theo Lark', archetype: 'Nit', bio: 'Waits. And waits. And waits.', avatarSeed: 173 },
];

export const TALK: Record<string, string[]> = {
  win: ['Ship it!', 'Thank you very much.', 'I knew it.', 'Nice hand, folks.', 'Read you like a book.', 'That’s poker!'],
  lose: ['Unbelievable.', 'Nice catch.', 'Of course.', 'Well played.', 'You had it.', 'Every time...'],
  bigbet: ['Let’s make it interesting.', 'I’ll put you to the test.', 'Your move.', 'How much do you love that hand?'],
  allin: ['All in!', 'I’m all in.', 'Let’s gamble!', 'Everything.'],
  fold: ['Too rich for me.', 'I’m out.', 'Next hand.', 'Not this time.'],
  call: ['I’ll take a look.', 'Call.', 'Let’s see it.'],
  check: ['Check.', 'Your action.'],
  tilt: ['This deck hates me.', 'I need a break.', 'Rigged, I tell you.'],
};

export function pickTalk(kind: keyof typeof TALK, r: number): string {
  const list = TALK[kind];
  return list[Math.floor(r * list.length) % list.length];
}

export function difficultyForChoice(choice: string, seatIndex: number, r: number): Difficulty {
  if (choice === 'mixed') return (['beginner', 'easy', 'medium', 'hard', 'expert'] as Difficulty[])[(seatIndex + Math.floor(r * 5)) % 5];
  if (choice === 'adaptive') return 'medium';
  return (choice as Difficulty) ?? 'medium';
}
