import { useEffect, useState } from 'preact/hooks';
import { Button, Panel, confirmDialog, toast, formatChips } from '../kit';
import { back, go } from '../router';
import { listHands, clearHands, type StoredHand } from '../../storage/history';
import { MiniCard } from '../cardsUi';
import { replayHand, handToText } from '../../engine/game';

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function HistoryScreen() {
  const [hands, setHands] = useState<StoredHand[] | null>(null);
  useEffect(() => {
    void listHands().then(setHands);
  }, []);
  return (
    <div class="screen wood-dark" data-testid="history-screen">
      <div class="screen-head">
        <Button onClick={back} label="Back">‹ Back</Button>
        <h1 class="embossed">Hand History</h1>
        <Button size="small" disabled={!hands?.length} onClick={() => download(`holdem-hands-${Date.now()}.json`, JSON.stringify(hands, null, 1), 'application/json')}>Export JSON</Button>
        <Button size="small" disabled={!hands?.length} onClick={() => download(`holdem-hands-${Date.now()}.txt`, (hands ?? []).map((h) => handToText(replayHand(h.init, h.actions))).join('\n\n'), 'text/plain')}>Export text</Button>
        <Button size="small" variant="red" disabled={!hands?.length} onClick={async () => { if (await confirmDialog('Delete hand history?', 'All stored hands will be removed.', 'Delete', true)) { await clearHands(); setHands([]); toast('History cleared'); } }}>Clear</Button>
      </div>
      <div class="screen-body">
        {hands === null && <p>Loading…</p>}
        {hands?.length === 0 && <Panel kind="leather"><p>No hands yet. Play a game and your hands appear here (the last 500 are kept).</p></Panel>}
        <div class="hh-list">
          {hands?.map((h) => (
            <button key={h.key} class="hh-item panel leather" onClick={() => go('replay', { id: h.key })} data-testid="hh-item">
              <div class="hh-date muted">{new Date(h.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · #{h.init.handNo} · {h.mode}</div>
              <div class="hh-cards">
                {h.summary.hole.map((c) => <MiniCard key={c} card={c} size={22} />)}
                <span style={{ width: '10px' }} />
                {h.summary.board.map((c) => <MiniCard key={c} card={c} size={22} />)}
              </div>
              <div class="hh-res num" style={{ color: h.summary.net > 0 ? '#9ff0a8' : h.summary.net < 0 ? '#f0a0a0' : '#e6d3a8' }}>
                {h.summary.net > 0 ? '+' : ''}{formatChips(h.summary.net)} <span class="muted">({(h.summary.net / h.summary.bb).toFixed(1)} bb)</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
