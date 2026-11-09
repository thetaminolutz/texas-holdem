import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Slider, type Detent, formatChips } from './kit';
import type { HumanTurn } from '../state/gameController';
import { breakdown, CHIP_SETS, DENOMS } from '../scene/catalog';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { sfx } from '../audio/sfx';

export function ChipIcon(props: { denom: number; size?: number; onClick?: () => void; label?: string }) {
  const s = useStore(settingsStore);
  const st = (CHIP_SETS[s.look.chipSet] ?? CHIP_SETS[0])[props.denom] ?? CHIP_SETS[0][1];
  const size = props.size ?? 34;
  const txt = props.denom >= 1000 ? `${props.denom / 1000}K` : String(props.denom);
  return (
    <button
      class="chip-icon"
      aria-label={props.label ?? `${props.denom} chip`}
      onClick={() => {
        props.onClick?.();
      }}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${st.inlay} 0 38%, ${st.text} 38% 41%, transparent 41%), repeating-conic-gradient(${st.base} 0 30deg, ${st.spot} 30deg 45deg), ${st.base}`,
        color: st.text,
        fontSize: size * (txt.length > 3 ? 0.24 : 0.3),
      }}
    >
      {txt}
    </button>
  );
}

export function betDetents(t: HumanTurn, extra: number[] = []): Detent[] {
  const L = t.legal;
  const currentBet = t.committed + t.toCall;
  const potTo = (f: number) => Math.round(currentBet + f * (t.pot + t.toCall));
  const raw: [string, number][] = [
    ['Min', L.minTo],
    ['⅓', potTo(1 / 3)],
    ['½', potTo(0.5)],
    ['⅔', potTo(2 / 3)],
    ['¾', potTo(0.75)],
    ['Pot', potTo(1)],
    ['2×', potTo(2)],
    ['All-in', L.maxTo],
  ];
  for (const f of extra) if (![1 / 3, 0.5, 2 / 3, 0.75, 1, 2].some((x) => Math.abs(x - f) < 0.01)) raw.push([`${f}×`, potTo(f)]);
  const out: Detent[] = [];
  for (const [label, v] of raw) {
    if (v < L.minTo || v > L.maxTo) continue;
    if (out.some((d) => Math.abs(d.value - v) < Math.max(1, (L.maxTo - L.minTo) * 0.03))) continue;
    out.push({ label, value: v });
  }
  return out;
}

export function BetControls(props: { turn: HumanTurn; structure: string; onConfirm: (to: number) => void; onCancel: () => void }) {
  const t = props.turn;
  const L = t.legal;
  const s = useStore(settingsStore);
  const [amount, setAmount] = useState(L.minTo);
  const [keypad, setKeypad] = useState(false);
  const [typed, setTyped] = useState('');
  useEffect(() => setAmount(L.minTo), [L.minTo, L.maxTo]);
  const fixed = L.minTo === L.maxTo;
  const step = s.gameplay.stepSize === 'bb' ? t.bb : s.gameplay.stepSize === 'halfbb' ? Math.max(1, t.bb / 2) : s.gameplay.stepSize === 'one' ? 1 : s.gameplay.customStep;
  const detents = useMemo(() => betDetents(t, s.gameplay.quickBets), [t, s.gameplay.quickBets]);
  const clampAmt = (v: number) => Math.max(L.minTo, Math.min(L.maxTo, Math.round(v)));
  const add = amount - t.committed;
  const chips = breakdown(add);
  const currentBet = t.committed + t.toCall;
  const potAfter = t.pot + add;
  const oppPrice = amount > currentBet ? (amount - currentBet) / (potAfter + (amount - currentBet)) : 0;
  const valid = amount >= L.minTo && amount <= L.maxTo;
  const allIn = amount >= L.maxTo && t.committed + t.stack === L.maxTo;
  const chipDenoms = DENOMS.filter((d) => d <= Math.max(t.bb * 50, L.maxTo / 4) && d >= Math.min(t.bb / 4, 25) && d <= L.maxTo).slice(-6);
  const quick = s.gameplay.quickBets;
  return (
    <div class="bet-panel panel leather" data-testid="bet-panel">
      <div class="bet-head">
        <div class="bet-amount embossed" aria-live="polite">
          {L.isBet ? 'Bet' : 'Raise to'} <span class="num" data-testid="bet-amount">{formatChips(amount)}</span>
          {allIn && <span class="badge bad" style={{ marginLeft: '8px' }}>ALL-IN</span>}
        </div>
        <div class="bet-preview">
          {chips.slice(0, 5).map((c) => (
            <span key={c.denom} class="chip-col" title={`${c.count} × ${c.denom}`}>
              <ChipIcon denom={c.denom} size={26} label={`remove one ${c.denom} chip`} onClick={() => setAmount(clampAmt(amount - c.denom))} />
              <span class="num">×{c.count}</span>
            </span>
          ))}
        </div>
      </div>
      <div class="muted bet-info">
        Pot after bet: <b class="num">{formatChips(potAfter)}</b> · Opponents need <b>{(oppPrice * 100).toFixed(0)}%</b> equity to call
        {!valid && <span class="badge warn" style={{ marginLeft: '6px' }}>Min {formatChips(L.minTo)}</span>}
      </div>
      {!fixed && (
        <>
          <div style={{ padding: '0 6px 18px' }}>
            <Slider label="Bet amount" min={L.minTo} max={L.maxTo} step={Math.max(1, Math.min(step, Math.round((L.maxTo - L.minTo) / 200) || 1))} value={amount} onChange={(v) => setAmount(clampAmt(v))} detents={detents} format={(v) => formatChips(v)} testid="bet-slider" />
          </div>
          <div class="bet-row">
            <button class="knob" aria-label="Decrease bet" onClick={() => { sfx.ui('detent'); setAmount(clampAmt(amount - step)); }}>−</button>
            <button class="knob" aria-label="Increase bet" onClick={() => { sfx.ui('detent'); setAmount(clampAmt(amount + step)); }}>+</button>
            {quick.map((f) => {
              const v = clampAmt(currentBet + f * (t.pot + t.toCall));
              return (
                <Button key={f} size="small" onClick={() => setAmount(v)} label={`${f} pot`}>
                  {f === 1 ? 'Pot' : f === 0.5 ? '½' : f === 0.33 ? '⅓' : f === 0.66 ? '⅔' : f === 0.75 ? '¾' : f === 0.25 ? '¼' : `${f}×`}
                </Button>
              );
            })}
            <Button size="small" onClick={() => setKeypad(!keypad)} label="Keypad">⌨</Button>
          </div>
          <div class="bet-row chips-row" aria-label="Add chips">
            {chipDenoms.map((d) => (
              <ChipIcon key={d} denom={d} size={40} label={`add ${d}`} onClick={() => { sfx.chips(1, 0); setAmount(clampAmt(amount + d)); }} />
            ))}
          </div>
          {keypad && (
            <div class="keypad">
              <div class="keypad-display inset num">{typed || '0'}</div>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  class="key"
                  onClick={() => {
                    sfx.ui('press');
                    let nt = typed;
                    if (k === 'C') nt = '';
                    else if (k === '⌫') nt = typed.slice(0, -1);
                    else nt = (typed + k).replace(/^0+/, '').slice(0, 9);
                    setTyped(nt);
                    if (nt) setAmount(clampAmt(Number(nt)));
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div class="bet-row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={props.onCancel} testid="bet-cancel">Cancel</Button>
        <Button variant="brass" size="big" disabled={!valid} onClick={() => props.onConfirm(amount)} testid="bet-confirm">
          {L.isBet ? 'Bet' : 'Raise'} {formatChips(amount)}
        </Button>
      </div>
    </div>
  );
}
