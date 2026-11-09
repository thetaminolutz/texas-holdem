import { RANKS, SUIT_SYMBOLS, parseCards, rankOf, suitOf } from '../engine/cards';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';

export function MiniCard(props: { card: number; size?: number; down?: boolean; dim?: boolean }) {
  const s = useStore(settingsStore);
  const four = s.look.deckStyle === 'four' || s.access.colorblind;
  const size = props.size ?? 34;
  if (props.down || props.card < 0)
    return <span class="mini-card down" style={{ width: size, height: size * 1.4 }} aria-label="face-down card" />;
  const r = RANKS[rankOf(props.card)];
  const su = suitOf(props.card);
  const color = four ? ['#1d7a33', '#1d4fa8', '#c0201c', '#141414'][su] : su === 1 || su === 2 ? '#c0201c' : '#141414';
  const label = `${r === 'T' ? '10' : r}`;
  return (
    <span class="mini-card" style={{ width: size, height: size * 1.4, color, opacity: props.dim ? 0.45 : 1, fontSize: size * 0.42 }} aria-label={`${label} of ${['clubs', 'diamonds', 'hearts', 'spades'][su]}`}>
      <span class="r">{label}</span>
      <span class="s">{SUIT_SYMBOLS[su]}</span>
    </span>
  );
}

export const HAND_RANKINGS: { name: string; cards: string; desc: string; odds: string }[] = [
  { name: 'Royal Flush', cards: 'As Ks Qs Js Ts', desc: 'A, K, Q, J, 10, all the same suit.', odds: '1 in 30,940' },
  { name: 'Straight Flush', cards: '9h 8h 7h 6h 5h', desc: 'Five cards in sequence, all the same suit.', odds: '1 in 3,590' },
  { name: 'Four of a Kind', cards: 'Qc Qd Qh Qs 7c', desc: 'Four cards of the same rank.', odds: '1 in 595' },
  { name: 'Full House', cards: 'Kh Kd Ks Tc Th', desc: 'Three of a kind plus a pair.', odds: '1 in 38' },
  { name: 'Flush', cards: 'Ad Jd 8d 6d 2d', desc: 'Any five cards of the same suit.', odds: '1 in 33' },
  { name: 'Straight', cards: 'Tc 9d 8h 7s 6c', desc: 'Five cards in sequence (A can be high or low).', odds: '1 in 22' },
  { name: 'Three of a Kind', cards: '7c 7d 7h Ks 2d', desc: 'Three cards of the same rank.', odds: '1 in 20' },
  { name: 'Two Pair', cards: 'Ah Ad 8c 8s 4d', desc: 'Two different pairs.', odds: '1 in 4' },
  { name: 'Pair', cards: 'Jh Jc 9d 5s 3h', desc: 'Two cards of the same rank.', odds: '1 in 2.3' },
  { name: 'High Card', cards: 'Ah Qd 9c 6s 3h', desc: 'None of the above — highest card plays.', odds: '1 in 5.7' },
];

export function HandRankings(props: { compact?: boolean }) {
  return (
    <div class="rankings" data-testid="hand-rankings">
      {HAND_RANKINGS.map((h, i) => (
        <div key={h.name} class="ranking-row">
          <span class="rank-no num">{i + 1}</span>
          <span class="rank-cards">
            {parseCards(h.cards).map((c) => (
              <MiniCard key={c} card={c} size={props.compact ? 24 : 30} />
            ))}
          </span>
          <span class="rank-text">
            <b>{h.name}</b>
            {!props.compact && <span class="hint"> — {h.desc} <i class="muted">(7-card odds ≈ {h.odds})</i></span>}
          </span>
        </div>
      ))}
    </div>
  );
}
