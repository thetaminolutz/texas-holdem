import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Panel, Switch, formatChips } from '../kit';
import { back } from '../router';
import { getHand, type StoredHand } from '../../storage/history';
import { replayHand, totalPot, handToText } from '../../engine/game';
import { MiniCard } from '../cardsUi';
import { cardToPretty } from '../../engine/cards';

export function ReplayScreen(props: { handId: string }) {
  const [h, setH] = useState<StoredHand | null>(null);
  const [step, setStep] = useState(0);
  const [revealAll, setRevealAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    void getHand(props.handId).then((x) => setH(x ?? null));
  }, [props.handId]);
  const total = h?.actions.length ?? 0;
  const state = useMemo(() => (h ? replayHand(h.init, h.actions.slice(0, step)) : null), [h, step]);
  const final = useMemo(() => (h ? replayHand(h.init, h.actions) : null), [h]);
  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(total, s + 1)), 900);
    return () => clearTimeout(t);
  }, [playing, step, total]);
  if (!h || !state || !final) return <div class="screen wood-dark"><div class="screen-head"><Button onClick={back}>‹ Back</Button><h1 class="embossed">Replay</h1></div><div class="screen-body">Loading…</div></div>;
  const n = state.players.length;
  const lastAct = step > 0 ? h.actions[step - 1] : null;
  const shownFinal = new Set(final.events.filter((e) => e.t === 'show').map((e) => (e as any).p));
  return (
    <div class="screen wood-dark" data-testid="replay-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Replay · Hand #{h.init.handNo}</h1>
        <label class="row" style={{ minHeight: 0 }}><span class="muted">Reveal all cards</span><Switch label="Reveal all" checked={revealAll} onChange={setRevealAll} /></label>
      </div>
      <div class="screen-body">
        <div class="replay-table felt panel">
          {state.players.map((p, i) => {
            const a = (i / n) * Math.PI * 2 + Math.PI / 2;
            const isHuman = p.id === h.humanId;
            const show = isHuman || revealAll || (shownFinal.has(i) && state.street === 'complete');
            return (
              <div key={p.id} class={`replay-seat ${p.folded ? 'folded' : ''} ${state.toAct === i ? 'turn' : ''}`} style={{ left: `${50 + Math.cos(a) * 42}%`, top: `${50 + Math.sin(a) * 38}%` }}>
                <div class="plate-name">{isHuman ? 'You' : p.name}{state.button === i ? ' Ⓓ' : ''}</div>
                <div class="hh-cards">{p.hole.map((c) => <MiniCard key={c} card={show ? c : -1} size={24} down={!show} />)}</div>
                <div class="num plate-stack">{formatChips(p.stack)}</div>
                {p.committed > 0 && <div class="bet-label" style={{ position: 'static' }}>{formatChips(p.committed)}</div>}
                {p.lastAction && <div class="muted" style={{ fontSize: '11px' }}>{p.lastAction}</div>}
              </div>
            );
          })}
          <div class="replay-center">
            <div class="hh-cards">{state.board.map((c) => <MiniCard key={c} card={c} size={34} />)}</div>
            {state.board2 && <div class="hh-cards">{state.board2.map((c) => <MiniCard key={c} card={c} size={28} />)}</div>}
            <div class="plaque brass engraved" style={{ marginTop: '6px' }}>Pot {formatChips(totalPot(state))}</div>
          </div>
        </div>
        <div class="replay-controls">
          <Button onClick={() => setStep(0)} label="First">⏮</Button>
          <Button onClick={() => setStep(Math.max(0, step - 1))} label="Previous">◀</Button>
          <Button variant="green" onClick={() => setPlaying(!playing)} label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</Button>
          <Button onClick={() => setStep(Math.min(total, step + 1))} label="Next" testid="replay-next">▶</Button>
          <Button onClick={() => setStep(total)} label="Last">⏭</Button>
          <span class="muted num">Step {step} / {total}{lastAct ? ` · ${lastAct.type}${lastAct.amount ? ' ' + lastAct.amount : ''}` : ''}</span>
        </div>
        <Panel kind="paper" style={{ marginTop: '12px' }}>
          <h3>Result: {h.summary.result}</h3>
          <div>Board: {final.board.map(cardToPretty).join(' ') || '—'}</div>
          <pre class="hh-text">{handToText(final)}</pre>
        </Panel>
      </div>
    </div>
  );
}
