// Card representation: integer 0..51, card = rank * 4 + suit. rank 0 = Two ... 12 = Ace. suit 0..3 = c, d, h, s.
export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
export const SUIT_NAMES = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const makeCard = (rank: number, suit: number): Card => rank * 4 + suit;

export function cardToString(c: Card): string {
  return RANKS[rankOf(c)] + SUITS[suitOf(c)];
}
export function cardToPretty(c: Card): string {
  const r = RANKS[rankOf(c)];
  return (r === 'T' ? '10' : r) + SUIT_SYMBOLS[suitOf(c)];
}
export function cardLongName(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`;
}
export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error('bad card ' + s);
  return makeCard(r, su);
}
export function parseCards(s: string): Card[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard);
}
export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Canonical 169-class name for two hole cards, e.g. "AKs", "QQ", "T9o". */
export function handClass(a: Card, b: Card): string {
  let r1 = rankOf(a);
  let r2 = rankOf(b);
  if (r2 > r1) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANKS[r1] + RANKS[r2];
  return RANKS[r1] + RANKS[r2] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}
