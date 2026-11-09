import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Panel, Tabs, toast } from '../kit';
import { back } from '../router';
import { MiniCard } from '../cardsUi';
import { fullDeck, handClass } from '../../engine/cards';
import { cryptoRng, shuffle } from '../../engine/rng';
import { handPercentile, countOuts } from '../../ai/range';
import { OPEN_BY_BEHIND } from '../../ai/brain';
import { recordTrainer, profileStore } from '../../state/profile';
import { useStore } from '../../state/store';
import { listHands } from '../../storage/history';

type T = 'tutorial' | 'preflop' | 'odds' | 'outs' | 'review';

const TUTORIAL = [
  { t: 'Welcome to the table', b: 'You sit at the bottom. Five to eight opponents play around the table; the dealer sits across from you.' },
  { t: 'Your cards', b: 'Two cards land face down in front of you. Touch and hold to peek at the corners, or tap to flip them up.' },
  { t: 'Acting', b: 'When it is your turn the brass and wooden buttons light up: Fold, Check or Call, Bet or Raise, All-in.' },
  { t: 'Sizing bets', b: 'Tap Raise… to open the bet panel: slide the brass slider, tap chips, use ± or the keypad. The panel shows the chips you will push and the price you give your opponents.' },
  { t: 'Pot odds', b: 'If you must call 50 into a pot of 150, you are risking 50 to win 200: you need 25% equity. The coach shows this when enabled (Settings → Coach).' },
  { t: 'Position', b: 'Acting last is an advantage. Play more hands on the button and fewer from early position.' },
  { t: 'Practice', b: 'Use the trainers in this screen, then try a Quick Play game against Beginner bots.' },
];

const POS = ['UTG', 'Hijack', 'Cutoff', 'Button', 'Small Blind'];

function PreflopTrainer() {
  const [q, setQ] = useState(() => newPreflop());
  const [ans, setAns] = useState<string | null>(null);
  function newPreflop() {
    const d = shuffle(fullDeck(), cryptoRng);
    const pos = Math.floor(cryptoRng.next() * POS.length);
    const behind = 5 - pos; // 6-max: players left to act incl. blinds
    return { a: d[0], b: d[1], pos, behind };
  }
  const pct = handPercentile(q.a, q.b);
  const range = OPEN_BY_BEHIND[q.behind];
  const correct = pct <= range ? 'raise' : 'fold';
  const choose = (c: string) => {
    if (ans) return;
    setAns(c);
    const ok = c === correct;
    const un = recordTrainer('preflop', ok);
    if (un.length) toast('🏆 Achievement unlocked!');
  };
  return (
    <Panel kind="felt" class="stitched trainer">
      <p>6-max, everyone folds to you in the <b>{POS[q.pos]}</b>. Open-raise or fold?</p>
      <div class="hh-cards" style={{ justifyContent: 'center', margin: '14px 0' }}>
        <MiniCard card={q.a} size={64} />
        <MiniCard card={q.b} size={64} />
      </div>
      <div class="row" style={{ justifyContent: 'center' }}>
        <Button variant="red" onClick={() => choose('fold')} disabled={!!ans}>Fold</Button>
        <Button variant="brass" onClick={() => choose('raise')} disabled={!!ans}>Raise</Button>
      </div>
      {ans && (
        <div class={`feedback ${ans === correct ? 'ok' : 'bad'}`}>
          <b>{ans === correct ? 'Correct!' : 'Not quite.'}</b> {handClass(q.a, q.b)} is in the top {(pct * 100).toFixed(0)}% of starting hands. From the {POS[q.pos]} ({q.behind} player{q.behind > 1 ? 's' : ''} still to act) a solid opening range is about the top {(range * 100).toFixed(0)}% → <b>{correct}</b>.
          <div style={{ marginTop: '8px' }}><Button onClick={() => { setQ(newPreflop()); setAns(null); }}>Next hand</Button></div>
        </div>
      )}
    </Panel>
  );
}

function OddsTrainer() {
  const mk = () => {
    const pot = [60, 100, 150, 200, 300, 450][Math.floor(cryptoRng.next() * 6)];
    const bet = Math.round((pot * [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5][Math.floor(cryptoRng.next() * 7)]) / 5) * 5;
    const need = bet / (pot + 2 * bet);
    const opts = shuffle([need, need + 0.08, Math.max(0.05, need - 0.07), need + 0.15].map((x) => Math.round(x * 100)), cryptoRng);
    return { pot, bet, need: Math.round(need * 100), opts };
  };
  const [q, setQ] = useState(mk);
  const [ans, setAns] = useState<number | null>(null);
  return (
    <Panel kind="felt" class="stitched trainer">
      <p>The pot is <b>{q.pot}</b>. Your opponent bets <b>{q.bet}</b>. What equity do you need to call profitably?</p>
      <div class="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        {q.opts.map((o) => (
          <Button key={o} disabled={ans !== null} onClick={() => { setAns(o); recordTrainer('potOdds', o === q.need); }}>{o}%</Button>
        ))}
      </div>
      {ans !== null && (
        <div class={`feedback ${ans === q.need ? 'ok' : 'bad'}`}>
          <b>{ans === q.need ? 'Correct!' : 'Not quite.'}</b> You call {q.bet} to win {q.pot + q.bet}: {q.bet} / ({q.pot} + {q.bet} + {q.bet}) = <b>{q.need}%</b>.
          <div style={{ marginTop: '8px' }}><Button onClick={() => { setQ(mk()); setAns(null); }}>Next</Button></div>
        </div>
      )}
    </Panel>
  );
}

function OutsTrainer() {
  const mk = () => {
    for (let k = 0; k < 500; k++) {
      const d = shuffle(fullDeck(), cryptoRng);
      const hole = [d[0], d[1]];
      const board = [d[2], d[3], d[4]];
      const o = countOuts(hole, board);
      if (o.outs >= 4 && o.outs <= 15) {
        const opts = shuffle([o.outs, o.outs + 2, Math.max(1, o.outs - 3), o.outs + 5], cryptoRng);
        return { hole, board, outs: o.outs, desc: o.desc, opts: [...new Set(opts)] };
      }
    }
    return { hole: [0, 1], board: [2, 3, 4], outs: 0, desc: '', opts: [0] };
  };
  const [q, setQ] = useState(mk);
  const [ans, setAns] = useState<number | null>(null);
  return (
    <Panel kind="felt" class="stitched trainer">
      <p>How many outs improve your hand on the turn?</p>
      <div class="hh-cards" style={{ justifyContent: 'center', margin: '10px 0', gap: '6px' }}>
        {q.hole.map((c) => <MiniCard key={c} card={c} size={52} />)}
        <span style={{ width: '20px' }} />
        {q.board.map((c) => <MiniCard key={c} card={c} size={52} />)}
      </div>
      <div class="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        {q.opts.map((o) => (
          <Button key={o} disabled={ans !== null} onClick={() => { setAns(o); recordTrainer('outs', o === q.outs); }}>{o}</Button>
        ))}
      </div>
      {ans !== null && (
        <div class={`feedback ${ans === q.outs ? 'ok' : 'bad'}`}>
          <b>{ans === q.outs ? 'Correct!' : 'Not quite.'}</b> {q.outs} outs ({q.desc}). Rule of 2 and 4: about {q.outs * 2}% to hit on the next card, about {Math.min(100, q.outs * 4)}% by the river.
          <div style={{ marginTop: '8px' }}><Button onClick={() => { setQ(mk()); setAns(null); }}>Next</Button></div>
        </div>
      )}
    </Panel>
  );
}

function SpotReview() {
  const [items, setItems] = useState<{ date: number; text: string }[] | null>(null);
  useEffect(() => {
    void listHands().then((hs) => setItems(hs.flatMap((h) => (h.summary.mistakes ?? []).map((m) => ({ date: h.date, text: m }))).slice(0, 50)));
  }, []);
  return (
    <Panel kind="paper">
      <h3>Spots the coach flagged in your recent hands</h3>
      {items === null ? <p>Loading…</p> : items.length === 0 ? <p>No flagged spots yet. Keep “Mistake review” on (Settings → Coach) and play some hands.</p> : (
        <ul>{items.map((m, i) => <li key={i}><span class="muted">{new Date(m.date).toLocaleDateString('en-US')}</span> — {m.text}</li>)}</ul>
      )}
    </Panel>
  );
}

export function TrainingScreen() {
  const [tab, setTab] = useState<T>('tutorial');
  const [step, setStep] = useState(0);
  const p = useStore(profileStore);
  const score = useMemo(() => p.trainer, [p]);
  return (
    <div class="screen wood-dark" data-testid="training-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Training</h1>
        <span class="badge ok num">Preflop {score.preflop[0]}/{score.preflop[1]} · Odds {score.potOdds[0]}/{score.potOdds[1]} · Outs {score.outs[0]}/{score.outs[1]}</span>
      </div>
      <Tabs tabs={[{ id: 'tutorial', label: 'Tutorial' }, { id: 'preflop', label: 'Preflop' }, { id: 'odds', label: 'Pot odds' }, { id: 'outs', label: 'Outs' }, { id: 'review', label: 'Spot review' }]} value={tab} onChange={setTab} />
      <div class="screen-body panel wood" style={{ borderRadius: '12px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          {tab === 'tutorial' && (
            <Panel kind="paper">
              <div class="muted">Step {step + 1} of {TUTORIAL.length}</div>
              <h2>{TUTORIAL[step].t}</h2>
              <p style={{ fontSize: '1.1em', lineHeight: 1.5 }}>{TUTORIAL[step].b}</p>
              <div class="actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <Button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
                <Button variant="green" disabled={step === TUTORIAL.length - 1} onClick={() => setStep(step + 1)}>Next</Button>
              </div>
            </Panel>
          )}
          {tab === 'preflop' && <PreflopTrainer />}
          {tab === 'odds' && <OddsTrainer />}
          {tab === 'outs' && <OutsTrainer />}
          {tab === 'review' && <SpotReview />}
        </div>
      </div>
    </div>
  );
}
