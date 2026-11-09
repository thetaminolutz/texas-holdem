import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, RollingNumber, formatChips, confirmDialog, toast } from '../kit';
import { home, go, routeStore } from '../router';
import { useStore, Store } from '../../state/store';
import { settingsStore, animSpeedFactor, patchSettings } from '../../state/settings';
import { TableScene } from '../../scene/TableScene';
import { Director } from '../../scene/director';
import { GameController, type GameView, type SeatView } from '../../state/gameController';
import { setupForMode, type GameSetupSpec } from '../../state/modes';
import { Avatar } from '../avatar';
import { BetControls } from '../BetControls';
import { MiniCard, HandRankings } from '../cardsUi';
import { lifecycle } from '../../state/lifecycle';
import { loadProfile } from '../../state/profile';
import { sfx } from '../../audio/sfx';
import { describe as describeScore, evaluate } from '../../engine/evaluator';
import { handPercentile } from '../../ai/range';

/** Spec handed over from the setup screen. */
export const pendingSetup = new Store<GameSetupSpec | null>(null);

function SeatPlate(props: { s: SeatView; refCb: (el: HTMLDivElement | null) => void; hud: boolean; monogram: boolean; onInfo: () => void }) {
  const s = props.s;
  const cls = ['seat-plate', 'panel', 'leather', s.isTurn ? 'turn' : '', s.folded ? 'folded' : '', s.busted ? 'busted' : '', s.winner ? 'winner' : '', s.isHuman ? 'human' : ''].join(' ');
  return (
    <div ref={props.refCb} class={cls} data-testid={`seat-${s.seat}`} role="group" aria-label={`${s.name}, ${s.stack} chips${s.folded ? ', folded' : ''}${s.isTurn ? ', to act' : ''}`} onClick={props.onInfo}>
      <div class="plate-row">
        <div class="avatar-wrap">
          <Avatar seed={s.avatarSeed} name={s.name} size={44} monogram={props.monogram} human={s.isHuman} />
          {s.isTurn && <svg class="turn-ring" viewBox="0 0 50 50"><circle cx="25" cy="25" r="23" /></svg>}
          {s.thinking && <span class="thinking">•••</span>}
        </div>
        <div class="plate-text">
          <div class="plate-name">{s.isHuman ? 'You' : s.name.replace(/\s*".*?"\s*/, ' ')}</div>
          <div class="plate-stack num">{s.busted ? 'OUT' : <RollingNumber value={s.stack} format={formatChips} />}</div>
        </div>
      </div>
      {s.lastAction && !s.busted && <div class={`action-badge a-${s.lastAction.toLowerCase().replace(/[^a-z]/g, '')}`}>{s.lastAction}</div>}
      {s.handName && <div class="hand-name">{s.handName}</div>}
      {props.hud && s.hud && !s.isHuman && (
        <div class="hud-stats num" title="VPIP / PFR / AF (hands)">
          {Math.round(s.hud.vpip * 100)}/{Math.round(s.hud.pfr * 100)}/{s.hud.af.toFixed(1)} <span class="muted">({s.hud.hands})</span>
        </div>
      )}
      {s.talk && <div class="speech">{s.talk}</div>}
    </div>
  );
}

export function GameScreen(props: { resume: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const plateRefs = useRef<(HTMLDivElement | null)[]>([]);
  const betRefs = useRef<(HTMLDivElement | null)[]>([]);
  const potRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<GameController | null>(null);
  const settings = useStore(settingsStore);
  const [view, setView] = useState<GameView | null>(null);
  const [loading, setLoading] = useState('Setting up the table…');
  const [raising, setRaising] = useState(false);
  const [panel, setPanel] = useState<null | 'pause' | 'rankings' | 'log' | 'recap' | 'seat' | 'table'>(null);
  const [seatInfo, setSeatInfo] = useState<SeatView | null>(null);
  const [preAction, setPreAction] = useState<'checkfold' | 'callany' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<string>('high');

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    let disposed = false;
    let scene: TableScene | null = null;
    let ctrl: GameController | null = null;
    const unsubs: (() => void)[] = [];
    (async () => {
      await loadProfile();
      const s = settingsStore.get();
      const saved = props.resume ? await GameController.readSave() : null;
      const spec = saved?.spec ?? pendingSetup.get() ?? setupForMode('quick', s);
      scene = new TableScene(canvasRef.current!, s, spec.players);
      (window as any).__scene = scene;
      await scene.init((p, l) => !disposed && setLoading(`${l} ${Math.round(p * 100)}%`));
      if (disposed) return;
      const director = new Director(scene);
      ctrl = new GameController(director);
      ctrlRef.current = ctrl;
      if (saved) {
        try {
          await ctrl.loadSaved(saved);
          if (ctrl.table.seats.length !== spec.players) await scene.setSeatCount(ctrl.table.seats.length);
        } catch (e) {
          console.warn('Saved game unreadable, starting fresh', e);
          toast('Saved game was damaged — starting a new game');
          ctrl.newGame(spec);
        }
      } else ctrl.newGame(spec);
      (window as any).__game = { get handsCompleted() { return ctrl!.handsCompleted; }, ctrl };
      unsubs.push(ctrl.view.subscribe((v) => setView(v)));
      scene.onFrame = () => positionHud();
      setQuality(scene.quality);
      scene.onQualityChange = (q) => {
        setQuality(q);
        toast(`Graphics adjusted to ${q} for smooth play`);
      };
      unsubs.push(lifecycle.addSaver(() => ctrl?.save()));
      unsubs.push(
        lifecycle.onVisibility((hidden) => {
          scene?.pause(hidden);
        }),
      );
      setLoading('');
      void ctrl.run().catch((e) => {
        console.error(e);
        setError(String(e?.stack ?? e));
      });
    })().catch((e) => {
      console.error(e);
      setError(String(e?.stack ?? e));
    });
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
      void ctrl?.save();
      ctrl?.stop();
      scene?.dispose();
      (window as any).__game = undefined;
    };
  }, []);

  // apply look/animation settings live
  useEffect(() => {
    const c = ctrlRef.current;
    if (!c) return;
    void c.director.scene.applyLook(settings);
    c.director.anim.speed = animSpeedFactor(settings);
    c.director.opts = { chipIntensity: settings.anim.chipIntensity, dealStyle: settings.anim.dealStyle, slowRollRiver: settings.anim.slowRollRiver };
  }, [settings.look, settings.anim, settings.access.colorblind]);

  useEffect(() => {
    if (!view?.human) {
      setRaising(false);
    }
  }, [view?.human]);

  // ---------------------------------------------------------------- HUD positioning (every rendered frame)
  const positionHud = () => {
    const c = ctrlRef.current;
    if (!c) return;
    const sc = c.director.scene;
    const L = sc.layout;
    const H = hudRef.current;
    if (!H) return;
    const w = H.clientWidth,
      h = H.clientHeight;
    L.seats.forEach((seat, i) => {
      const el = plateRefs.current[i];
      if (el) {
        let p = sc.project(seat.plate.x, 0.08, seat.plate.z);
        if (i === 0) p = sc.project(seat.plate.x, 0.08, seat.plate.z);
        const hw = el.offsetWidth / 2 + 6;
        const hh = el.offsetHeight / 2 + 6;
        const x = Math.max(hw, Math.min(w - hw, p.x));
        const y = Math.max(hh + 44, Math.min(h - hh - 4, p.y));
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
      const b = betRefs.current[i];
      if (b) {
        const p = sc.project(seat.bet.x - seat.inward.x * 0.0, 0.01, seat.bet.z + 0.0);
        b.style.transform = `translate(${p.x}px, ${p.y + 22}px) translate(-50%, 0)`;
      }
    });
    if (potRef.current) {
      const p = sc.project(L.pot.x, 0.02, L.pot.z);
      potRef.current.style.transform = `translate(${p.x}px, ${p.y - 34}px) translate(-50%, -100%)`;
    }
  };
  useEffect(() => {
    positionHud();
  });

  // ---------------------------------------------------------------- canvas gestures: peek, reveal, orbit, pinch, skip
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinch = 0;
    let downAt = 0;
    let downPos = { x: 0, y: 0 };
    let moved = false;
    let peeking = false;
    let peekTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTap = 0;
    const overHumanCards = (x: number, y: number) => {
      const c = ctrlRef.current;
      if (!c) return false;
      const st = c.director.scene.layout.seats[0];
      if (!st || !c.director.seats[0]?.hole.length) return false;
      const p = c.director.scene.project(st.cards.x, 0, st.cards.z);
      const r = canvas.getBoundingClientRect();
      return Math.hypot(x - r.left - p.x, y - r.top - p.y) < 80;
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downAt = performance.now();
      downPos = { x: e.clientX, y: e.clientY };
      moved = false;
      if (pointers.size === 1 && overHumanCards(e.clientX, e.clientY) && !ctrlRef.current?.director.revealed) {
        peekTimer = setTimeout(() => {
          peeking = true;
          animatePeek(1);
        }, 180);
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    let peekVal = 0;
    let peekRaf = 0;
    const animatePeek = (target: number) => {
      cancelAnimationFrame(peekRaf);
      const step = () => {
        peekVal += (target - peekVal) * 0.25;
        if (Math.abs(target - peekVal) < 0.01) peekVal = target;
        ctrlRef.current?.director.setPeek(peekVal);
        if (peekVal !== target) peekRaf = requestAnimationFrame(step);
      };
      step();
      if (target > 0) sfx.cardSlide(0, 0.15, 0, 0.06);
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) {
        moved = true;
        if (peekTimer && !peeking) {
          clearTimeout(peekTimer);
          peekTimer = null;
        }
      }
      const rig = ctrlRef.current?.director.scene.rig;
      if (!rig || peeking) return;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch > 0) rig.pinch(d / lastPinch);
        lastPinch = d;
        rig.pan((e.clientX - prev.x) * 0.5, (e.clientY - prev.y) * 0.5);
      } else if (moved) rig.orbit(e.clientX - prev.x, e.clientY - prev.y);
      ctrlRef.current?.director.scene.requestRender();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (peekTimer) clearTimeout(peekTimer);
      peekTimer = null;
      const c = ctrlRef.current;
      if (peeking) {
        peeking = false;
        animatePeek(0);
        return;
      }
      if (!c || moved) return;
      const now = performance.now();
      if (now - downAt < 300) {
        if (overHumanCards(e.clientX, e.clientY) && !c.director.revealed && c.director.seats[0]?.hole.length) {
          void c.director.revealHuman().then(() => c.refresh({ humanRevealed: true }));
        } else if (now - lastTap < 320) {
          c.director.scene.rig.resetUser();
          c.director.scene.requestRender();
        } else if (c.director.anim.busy) {
          c.skipAnimations();
        }
        lastTap = now;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      ctrlRef.current?.director.scene.rig.pinch(e.deltaY > 0 ? 0.95 : 1.05);
      ctrlRef.current?.director.scene.requestRender();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ctrlRef.current;
      const v = c?.view.get();
      if (!c || !v) return;
      if (e.key === 'Escape') setPanel(panel ? null : 'pause');
      if (!v.human || raising) return;
      const L = v.human.legal;
      if (e.key === 'f' && L.canFold) c.act({ type: 'fold' });
      if (e.key === 'c') c.act(L.canCheck ? { type: 'check' } : { type: 'call' });
      if (e.key === 'r' && L.canRaise) setRaising(true);
      if (e.key === 'a' && L.canRaise) c.act({ type: 'allin' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, raising]);

  useEffect(() => {
    const c = ctrlRef.current;
    if (!c) return;
    c.setPaused(panel === 'pause');
  }, [panel]);

  useEffect(() => {
    if (view?.message) toast(view.message);
  }, [view?.message]);

  const c = ctrlRef.current;
  const v = view;
  const turn = v?.human ?? null;
  const act = (a: Parameters<GameController['act']>[0]) => {
    setRaising(false);
    c?.act(a);
  };
  const quitToMenu = async () => {
    await c?.save();
    home();
  };
  const humanSeat = v?.seats[0];
  const hole = v?.humanHole ?? [];
  const handName = hole.length === 2 && v && v.board.length >= 3 && v.humanRevealed ? describeScore(evaluate([...hole, ...v.board])) : null;
  const preflopStrength = hole.length === 2 && v?.humanRevealed && v.board.length === 0 ? Math.round((1 - handPercentile(hole[0], hole[1])) * 100) : null;
  const lefty = settings.access.leftHanded;

  if (error)
    return (
      <div class="screen wood-dark" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div class="dialog paper">
          <h2>The table collapsed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px', maxHeight: '40vh', overflow: 'auto' }}>{error}</pre>
          <div class="actions">
            <Button onClick={() => home()}>Main Menu</Button>
          </div>
        </div>
      </div>
    );

  return (
    <div class={`game-screen ${lefty ? 'lefty' : ''}`} data-testid="game-screen">
      <canvas ref={canvasRef} class="table-canvas" data-testid="table-canvas" aria-label="Poker table" />
      <div class="vignette" />
      {(settings.look.quality === 'ultra' || (settings.look.quality === 'auto' && quality === 'ultra')) && !settings.anim.reduceMotion && <div class="dof" />}
      <div class="hud" ref={hudRef}>
        {v?.seats.map(
          (s, i) =>
            s && (
              <SeatPlate
                key={s.id}
                s={s}
                refCb={(el) => { plateRefs.current[i] = el; }}
                hud={settings.coach.hud}
                monogram={settings.look.avatarStyle === 'monogram'}
                onInfo={() => {
                  if (!s.isHuman) {
                    setSeatInfo(s);
                    setPanel('seat');
                  }
                }}
              />
            ),
        )}
        {v?.seats.map(
          (s, i) =>
            s &&
            s.bet > 0 && (
              <div key={'b' + s.id} class="bet-label num" ref={(el) => { betRefs.current[i] = el; }}>
                {formatChips(s.bet)}
              </div>
            ),
        )}
        {v && v.pots.length > 0 && (
          <div class="pot-label" ref={potRef} data-testid="pot-label">
            <div class="plaque brass engraved">
              Pot <RollingNumber value={v.pots.reduce((a, b) => a + b, 0)} format={formatChips} />
              {v.pots.length > 1 && <div class="side-pots num">{v.pots.map((p, i) => (i === 0 ? `Main ${formatChips(p)}` : `Side ${i} ${formatChips(p)}`)).join(' · ')}</div>}
            </div>
          </div>
        )}
      </div>

      {/* top bar */}
      <div class="top-bar">
        <Button size="small" onClick={() => setPanel('pause')} label="Menu" testid="pause">☰</Button>
        <div class="plaque brass engraved info-plaque" aria-live="polite">
          <span>Hand #{v?.handNo ?? 0}</span>
          <span>
            Blinds {v?.sb}/{v?.bb}
            {v?.ante ? ` · Ante ${v.ante}` : ''}
          </span>
          {v?.nextLevel && <span class="muted">Next {v.nextLevel.sb}/{v.nextLevel.bb} in {v.nextLevel.in}</span>}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <Button size="small" onClick={() => setPanel('rankings')} label="Hand rankings">♠ Ranks</Button>
          <Button size="small" onClick={() => setPanel('log')} label="Action log">Log</Button>
          <Button size="small" onClick={() => setPanel('recap')} label="Last hand" disabled={!v?.lastHand}>Recap</Button>
        </div>
      </div>

      {/* bottom: human info + actions */}
      <div class={`action-bar ${lefty ? 'left' : ''}`} data-testid="action-bar">
        <div class="me-panel panel leather">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div class="me-cards">{hole.length ? hole.map((c) => <MiniCard key={c} card={c} size={30} down={!v?.humanRevealed} />) : <span class="muted">—</span>}</div>
            <div>
              <div class="plate-name">You {humanSeat?.isButton ? <span class="badge ok">D</span> : null}</div>
              <div class="plate-stack num" data-testid="my-stack">{humanSeat ? <RollingNumber value={humanSeat.stack} format={formatChips} /> : '—'}</div>
            </div>
          </div>
          {v?.humanRevealed && (handName || preflopStrength !== null) && (
            <div class="me-hand">{handName ?? `Starting hand: top ${100 - (preflopStrength ?? 0)}%`}</div>
          )}
          {turn && (settings.coach.potOdds || settings.coach.equity || settings.coach.coach) && (
            <div class="coach" data-testid="coach">
              {settings.coach.potOdds && v?.coach.potOdds != null && <div>Pot odds: <b>{(v.coach.potOdds * 100).toFixed(0)}%</b> needed</div>}
              {settings.coach.potOdds && v?.coach.outs && v.coach.outs.outs > 0 && <div>Outs: <b>{v.coach.outs.outs}</b> <span class="muted">({v.coach.outs.desc})</span></div>}
              {settings.coach.equity && (
                <div class="equity-meter" title="Estimated equity">
                  <div class="fill" style={{ width: `${Math.round((v?.coach.equity ?? 0) * 100)}%` }} />
                  <span>{v?.coach.equity != null ? `Equity ${(v.coach.equity * 100).toFixed(0)}%` : 'Calculating…'}</span>
                </div>
              )}
              {settings.coach.coach && v?.coach.advice && (
                <div class="advice">
                  Coach: <b>{v.coach.advice.action.type}{v.coach.advice.action.amount ? ` ${formatChips(v.coach.advice.action.amount)}` : ''}</b>
                  <div class="muted">{v.coach.advice.reason?.replace(' (mistake)', '')}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div class="actions-wrap">
          {turn && v?.timer && <TimerBar endsAt={v.timer.endsAt} total={v.timer.total} />}
          {turn && raising && turn.legal.canRaise ? (
            <BetControls
              turn={turn}
              structure={c?.table.config.structure ?? 'NL'}
              onCancel={() => setRaising(false)}
              onConfirm={(to) => act({ type: turn.legal.isBet ? 'bet' : 'raise', amount: to })}
            />
          ) : turn ? (
            <div class="action-buttons">
              {turn.legal.canFold && (
                <Button variant="red" size="big" onClick={() => act({ type: 'fold' })} testid="act-fold">Fold</Button>
              )}
              {turn.legal.canCheck ? (
                <Button variant="green" size="big" onClick={() => act({ type: 'check' })} testid="act-check">Check</Button>
              ) : (
                <Button variant="green" size="big" onClick={() => act({ type: 'call' })} testid="act-call" sub={turn.legal.callAmount >= turn.stack ? 'All-in' : undefined}>
                  Call {formatChips(turn.legal.callAmount)}
                </Button>
              )}
              {turn.legal.canRaise && (
                <Button variant="brass" size="big" onClick={() => setRaising(true)} testid="act-raise">
                  {turn.legal.isBet ? 'Bet' : 'Raise'}…
                </Button>
              )}
              {turn.legal.canRaise && turn.legal.maxTo === turn.committed + turn.stack && (
                <Button variant="black" size="big" onClick={async () => {
                  if (turn.stack > turn.bb * 20 && !(await confirmDialog('All-in?', `Push all ${formatChips(turn.stack)} chips?`, 'All-in', true))) return;
                  act({ type: 'allin' });
                }} testid="act-allin">All-in</Button>
              )}
            </div>
          ) : (
            v && hole.length > 0 && !humanSeat?.folded && v.street !== 'complete' && (
              <div class="pre-actions" aria-label="Pre-select your action">
                {(['checkfold', 'check', 'callany'] as const).map((p) => (
                  <label key={p} class={`pre ${preAction === p ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={preAction === p}
                      onChange={() => {
                        const np = preAction === p ? null : p;
                        setPreAction(np);
                        c?.setPreAction(np);
                        sfx.ui('switch');
                      }}
                    />
                    {p === 'checkfold' ? 'Check / Fold' : p === 'check' ? 'Check' : 'Call any'}
                  </label>
                ))}
              </div>
            )
          )}
        </div>
      </div>
      <div class="sr-only" aria-live="polite">{v?.log[v.log.length - 1]?.text}</div>

      {loading && (
        <div class="loading-overlay wood-dark">
          <div class="plaque brass engraved">{loading}</div>
        </div>
      )}

      {/* dialogs */}
      {v?.askRuns && (
        <div class="overlay">
          <div class="dialog paper">
            <h2>Run it twice?</h2>
            <p>All players are all-in. Deal the remaining board twice and split each pot between the two runs?</p>
            <div class="actions">
              <Button onClick={() => c?.chooseRuns(1)} testid="runs-1">Once</Button>
              <Button variant="green" onClick={() => c?.chooseRuns(2)} testid="runs-2">Twice</Button>
            </div>
          </div>
        </div>
      )}
      {v?.rebuyOffer && (
        <div class="overlay">
          <div class="dialog paper">
            <h2>Out of chips</h2>
            <p>Buy in again for {formatChips(c?.table.config.startingStack ?? 0)}?</p>
            <div class="actions">
              <Button onClick={() => { c?.answerRebuy(false); home(); }}>Leave table</Button>
              <Button variant="green" onClick={() => c?.answerRebuy(true)} testid="rebuy">Rebuy</Button>
            </div>
          </div>
        </div>
      )}
      {v?.finished && (
        <div class="overlay">
          <div class="dialog paper" data-testid="tournament-result">
            <h2>{v.finished.place === 1 ? '🏆 Champion!' : `You finished ${ordinal(v.finished.place)}`}</h2>
            {v.finished.prize > 0 && <p>Prize: <b>{formatChips(v.finished.prize)}</b> chips</p>}
            <table class="data">
              <tbody>
                {v.finished.places.map((p) => (
                  <tr key={p.name}>
                    <td>{ordinal(p.place)}</td>
                    <td>{p.name}</td>
                    <td class="num">{p.prize ? formatChips(p.prize) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="actions">
              <Button onClick={() => home()}>Main Menu</Button>
              <Button variant="green" onClick={() => { home(); go('play'); }}>Play again</Button>
            </div>
          </div>
        </div>
      )}
      {panel === 'pause' && (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div class="dialog panel leather pause-menu" data-testid="pause-menu">
            <h2 class="embossed">Paused</h2>
            <div class="menu-btn-list">
              <Button variant="green" block onClick={() => setPanel(null)} testid="resume">Resume</Button>
              <Button block onClick={() => setPanel('rankings')}>Hand rankings</Button>
              <Button block onClick={() => setPanel('log')}>Action log</Button>
              <Button block disabled={!v?.lastHand} onClick={() => setPanel('recap')}>Last hand recap</Button>
              {c?.canChangeSeats() && <Button block onClick={() => setPanel('table')}>Table &amp; seats</Button>}
              <Button block onClick={async () => { await c?.save(); routeStore.set({ name: 'game', params: { resume: true } }); go('settings'); }}>Settings</Button>
              <Button
                block
                onClick={() => patchSettings('anim', { speed: settings.anim.speed === 'instant' ? '1' : 'instant' })}
              >
                Animations: {settings.anim.speed === 'instant' ? 'Instant' : 'Normal'}
              </Button>
              <Button variant="red" block onClick={quitToMenu} testid="quit">Save &amp; quit to menu</Button>
            </div>
          </div>
        </div>
      )}
      {panel === 'table' && c && (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div class="dialog paper">
            <h2>Table &amp; seats</h2>
            <p>Seats: <b>{c.table.seats.length}</b>. Changes apply between hands; the table re-arranges itself.</p>
            <div class="actions" style={{ justifyContent: 'flex-start' }}>
              <Button disabled={c.table.seats.length <= 2} onClick={async () => { if (await c.changeSeatCount(c.table.seats.length - 1)) toast('A player left'); else toast('Wait for the hand to finish'); }}>− Remove a player</Button>
              <Button disabled={c.table.seats.length >= 9} onClick={async () => { if (await c.changeSeatCount(c.table.seats.length + 1)) toast('A player joined'); else toast('Wait for the hand to finish'); }}>+ Add a player</Button>
              <Button onClick={() => { const a = c.humanTopUp(); toast(a > 0 ? `Topped up ${formatChips(a)}` : 'Already at the maximum (or hand in progress)'); }}>Top up my stack</Button>
            </div>
            <div class="actions"><Button onClick={() => setPanel(null)}>Close</Button></div>
          </div>
        </div>
      )}
      {panel === 'rankings' && (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div class="dialog paper">
            <h2>Hand rankings</h2>
            <HandRankings compact />
            <div class="actions"><Button onClick={() => setPanel(null)}>Close</Button></div>
          </div>
        </div>
      )}
      {panel === 'log' && (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div class="dialog paper">
            <h2>Action log</h2>
            <div class="scroll log-list">
              {v?.log.slice().reverse().map((l, i) => (
                <div key={i} class={`log-line k-${l.kind}`}>{l.text}</div>
              ))}
            </div>
            <div class="actions"><Button onClick={() => setPanel(null)}>Close</Button></div>
          </div>
        </div>
      )}
      {panel === 'recap' && v?.lastHand && (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div class="dialog paper">
            <h2>Last hand</h2>
            <p><b>{v.lastHand.summary}</b></p>
            {v.lastHand.mistakes.length > 0 && (
              <div class="mistakes">
                <h3>Coach review</h3>
                <ul>{v.lastHand.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
            <pre class="hh-text">{v.lastHand.text}</pre>
            <div class="actions"><Button onClick={() => setPanel(null)}>Close</Button></div>
          </div>
        </div>
      )}
      {panel === 'seat' && seatInfo && (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div class="dialog paper">
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
              <Avatar seed={seatInfo.avatarSeed} name={seatInfo.name} size={84} />
              <div>
                <h2>{seatInfo.name}</h2>
                <div>{seatInfo.archetype} · <b>{seatInfo.difficulty}</b></div>
              </div>
            </div>
            <p><i>{seatInfo.bio}</i></p>
            {seatInfo.hud && (
              <p class="num">VPIP {Math.round(seatInfo.hud.vpip * 100)}% · PFR {Math.round(seatInfo.hud.pfr * 100)}% · AF {seatInfo.hud.af.toFixed(1)} · {seatInfo.hud.hands} hands observed</p>
            )}
            <div class="actions"><Button onClick={() => setPanel(null)}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimerBar(props: { endsAt: number; total: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, props.endsAt - now);
  const k = left / props.total;
  return (
    <div class="timer-bar" role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div class="fill" style={{ width: `${k * 100}%`, background: k < 0.25 ? '#c0302a' : k < 0.5 ? '#d9a030' : '#3a9a5a' }} />
    </div>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
