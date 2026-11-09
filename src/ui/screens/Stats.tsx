import { useEffect } from 'preact/hooks';
import { Button, Panel } from '../kit';
import { back } from '../router';
import { useStore } from '../../state/store';
import { profileStore, loadProfile, pct } from '../../state/profile';

/** Bankroll chart drawn by hand as SVG (no chart library). */
export function BankrollChart(props: { data: number[]; height?: number }) {
  const d = props.data.length > 1 ? props.data : [0, 0];
  const W = 640,
    H = props.height ?? 220,
    P = 36;
  const min = Math.min(0, ...d),
    max = Math.max(0, ...d);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (d.length - 1)) * (W - P * 1.4);
  const y = (v: number) => H - P * 0.8 - ((v - min) / span) * (H - P * 1.6);
  const path = d.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(d.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = 4;
  const last = d[d.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Bankroll chart, current ${last.toFixed(1)} big blinds over ${d.length - 1} hands`}>
      <defs>
        <linearGradient id="bk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={last >= 0 ? '#7fe08f' : '#e07f7f'} stop-opacity="0.45" />
          <stop offset="1" stop-color={last >= 0 ? '#7fe08f' : '#e07f7f'} stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} rx="10" fill="rgba(0,0,0,0.25)" />
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = min + (span * i) / ticks;
        return (
          <g key={i}>
            <line x1={P} x2={W - P * 0.4} y1={y(v)} y2={y(v)} stroke="rgba(255,240,200,0.12)" />
            <text x={P - 6} y={y(v) + 4} fill="#e6d3a8" font-size="11" text-anchor="end">{v.toFixed(0)}</text>
          </g>
        );
      })}
      <line x1={P} x2={W - P * 0.4} y1={y(0)} y2={y(0)} stroke="rgba(255,240,200,0.45)" stroke-dasharray="4 4" />
      <path d={area} fill="url(#bk)" />
      <path d={path} fill="none" stroke={last >= 0 ? '#9ff0a8' : '#f09f9f'} stroke-width="2.2" stroke-linejoin="round" />
      <text x={W - P * 0.4} y={14} fill="#e6d3a8" font-size="11" text-anchor="end">big blinds won · {d.length - 1} hands</text>
    </svg>
  );
}

export function StatsScreen() {
  const p = useStore(profileStore);
  useEffect(() => {
    void loadProfile();
  }, []);
  const af = p.calls > 0 ? (p.bets / p.calls).toFixed(2) : p.bets > 0 ? '∞' : '—';
  const bb100 = p.hands > 0 ? ((p.netBB / p.hands) * 100).toFixed(1) : '—';
  const rows: [string, string][] = [
    ['Hands played', p.hands.toLocaleString()],
    ['Hands won', `${p.handsWon.toLocaleString()} (${pct(p.handsWon, p.hands)})`],
    ['VPIP', pct(p.vpip, p.hands)],
    ['PFR', pct(p.pfr, p.hands)],
    ['3-Bet', pct(p.threeBet, p.threeBetOpp)],
    ['WTSD', pct(p.wtsd, p.sawFlop)],
    ['W$SD', pct(p.wsd, p.wtsd)],
    ['Aggression factor', af],
    ['bb/100', bb100],
    ['Net (chips)', p.netChips.toLocaleString()],
    ['Biggest pot won', `${p.biggestPot.toLocaleString()} (${p.biggestPotBB.toFixed(0)} bb)`],
    ['Best hand', p.bestHand?.name ?? '—'],
    ['Best / worst streak', `${p.bestStreak} / ${p.worstStreak}`],
    ['Sit & Go: played / won / cashed', `${p.sngPlayed} / ${p.sngWon} / ${p.sngCashes}`],
  ];
  const opps = Object.entries(p.opponents).sort((a, b) => b[1].hands - a[1].hands).slice(0, 20);
  return (
    <div class="screen wood-dark" data-testid="stats-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Profile &amp; Statistics</h1>
      </div>
      <div class="screen-body">
        <div class="grid2">
          <Panel kind="leather">
            <h3 class="embossed">Lifetime</h3>
            <table class="data">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}><th>{k}</th><td class="num">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel kind="leather">
            <h3 class="embossed">Bankroll</h3>
            <BankrollChart data={p.bankroll} />
            <h3 class="embossed" style={{ marginTop: '12px' }}>Opponents</h3>
            {opps.length === 0 ? <p class="muted">Play some hands to build records.</p> : (
              <table class="data">
                <thead><tr><th>Opponent</th><th>Hands</th><th>Your net</th></tr></thead>
                <tbody>
                  {opps.map(([n, r]) => (
                    <tr key={n}><td>{n}</td><td class="num">{r.hands}</td><td class="num" style={{ color: r.net >= 0 ? '#9ff0a8' : '#f0a0a0' }}>{r.net >= 0 ? '+' : ''}{r.net.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
