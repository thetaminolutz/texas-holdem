import type { ComponentChildren, CSSProperties } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Store, useStore } from '../state/store';
import { sfx } from '../audio/sfx';

type BtnVariant = 'wood' | 'red' | 'green' | 'blue' | 'brass' | 'black';

export function Button(props: {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: 'small' | 'big';
  block?: boolean;
  disabled?: boolean;
  sub?: string;
  label?: string;
  class?: string;
  testid?: string;
  style?: CSSProperties;
}) {
  const cls = ['btn', props.variant && props.variant !== 'wood' ? `btn-${props.variant}` : '', props.size ? `btn-${props.size}` : '', props.block ? 'btn-block' : '', props.class ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      class={cls}
      disabled={props.disabled}
      aria-label={props.label}
      data-testid={props.testid}
      style={props.style}
      onPointerDown={() => sfx.ui('press')}
      onClick={() => {
        sfx.ui('release');
        props.onClick?.();
      }}
    >
      {props.children}
      {props.sub && <span class="sub">{props.sub}</span>}
    </button>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; testid?: string }) {
  return (
    <button
      class="switch"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      data-testid={props.testid}
      onClick={() => {
        sfx.ui('switch');
        props.onChange(!props.checked);
      }}
    >
      <span class="lbl on">ON</span>
      <span class="lbl off">OFF</span>
      <span class="lever" />
    </button>
  );
}

export interface Detent {
  value: number;
  label: string;
}

/** Brass slider with optional detents that snap when close. */
export function Slider(props: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  detents?: Detent[];
  label: string;
  format?: (v: number) => string;
  testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastDetent = useRef<number | null>(null);
  const range = props.max - props.min || 1;
  const pct = ((props.value - props.min) / range) * 100;
  const fromEvent = useCallback(
    (clientX: number) => {
      const el = ref.current!;
      const r = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left - 14) / (r.width - 28)));
      let v = props.min + t * range;
      // snap to detents within 2.5% of track
      let snapped: number | null = null;
      for (const d of props.detents ?? []) {
        if (Math.abs(d.value - v) / range < 0.025) {
          v = d.value;
          snapped = d.value;
        }
      }
      if (snapped !== null && snapped !== lastDetent.current) sfx.ui('detent');
      lastDetent.current = snapped;
      const step = props.step ?? 1;
      if (snapped === null) v = Math.round(v / step) * step;
      v = Math.min(props.max, Math.max(props.min, v));
      props.onChange(v);
      return v;
    },
    [props.min, props.max, props.step, props.detents, props.onChange],
  );
  return (
    <div
      ref={ref}
      class="slider"
      role="slider"
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={props.format ? props.format(props.value) : String(props.value)}
      tabIndex={0}
      data-testid={props.testid}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        fromEvent(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && fromEvent(e.clientX)}
      onPointerUp={(e) => {
        dragging.current = false;
        props.onCommit?.(fromEvent(e.clientX));
      }}
      onKeyDown={(e) => {
        const step = props.step ?? 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') props.onChange(Math.min(props.max, props.value + step));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') props.onChange(Math.max(props.min, props.value - step));
      }}
    >
      <div class="track">
        <div class="fill" style={{ width: `${pct}%` }} />
        {(props.detents ?? []).map((d) => (
          <div class="detent" key={d.label} style={{ left: `${((d.value - props.min) / range) * 100}%` }}>
            <span>{d.label}</span>
          </div>
        ))}
      </div>
      <div class="thumb" style={{ left: `calc(14px + (100% - 28px) * ${pct / 100})` }} />
    </div>
  );
}

export function Seg<T extends string | number>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  testid?: string;
}) {
  return (
    <div class="seg" role="group" aria-label={props.label} data-testid={props.testid}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          aria-pressed={o.value === props.value}
          onClick={() => {
            sfx.ui('switch');
            props.onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          class="tab"
          aria-selected={t.id === props.value}
          data-testid={`tab-${t.id}`}
          onClick={() => {
            sfx.ui('tab');
            props.onChange(t.id);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Row(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <div class="row">
      <span class="label">
        {props.label}
        {props.hint && <span class="hint">{props.hint}</span>}
      </span>
      {props.children}
    </div>
  );
}

export function Panel(props: { kind?: 'wood' | 'leather' | 'paper' | 'felt' | 'metal'; class?: string; children: ComponentChildren; style?: CSSProperties }) {
  return (
    <div class={`panel ${props.kind ?? 'leather'} ${props.class ?? ''}`} style={props.style}>
      {props.children}
    </div>
  );
}

export function Plaque(props: { children: ComponentChildren; class?: string; screws?: boolean }) {
  return (
    <div class={`plaque brass engraved ${props.class ?? ''}`} style={{ position: 'relative' }}>
      {props.screws && (
        <>
          <span class="screw" style={{ left: '5px', top: '5px' }} />
          <span class="screw" style={{ right: '5px', top: '5px' }} />
          <span class="screw" style={{ left: '5px', bottom: '5px' }} />
          <span class="screw" style={{ right: '5px', bottom: '5px' }} />
        </>
      )}
      {props.children}
    </div>
  );
}

// ---------- Dialogs ----------
export interface DialogSpec {
  title: string;
  body: ComponentChildren;
  actions: { label: string; variant?: BtnVariant; value: string }[];
  resolve: (v: string | null) => void;
}
export const dialogStore = new Store<DialogSpec | null>(null);

export function showDialog(title: string, body: ComponentChildren, actions: DialogSpec['actions']): Promise<string | null> {
  return new Promise((resolve) => dialogStore.set({ title, body, actions, resolve }));
}

export async function confirmDialog(title: string, body: ComponentChildren, okLabel = 'Confirm', danger = false) {
  const r = await showDialog(title, body, [
    { label: 'Cancel', value: 'cancel' },
    { label: okLabel, value: 'ok', variant: danger ? 'red' : 'green' },
  ]);
  return r === 'ok';
}

export function DialogHost() {
  const d = useStore(dialogStore);
  useEffect(() => {
    if (!d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialogStore.set(null);
        d.resolve(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d]);
  if (!d) return null;
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={d.title}>
      <div class="dialog paper">
        <h2>{d.title}</h2>
        <div>{d.body}</div>
        <div class="actions">
          {d.actions.map((a) => (
            <Button
              key={a.value}
              variant={a.variant}
              testid={`dlg-${a.value}`}
              onClick={() => {
                dialogStore.set(null);
                d.resolve(a.value);
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Toasts ----------
export const toastStore = new Store<{ id: number; text: string }[]>([]);
let toastId = 1;
export function toast(text: string, ms = 2600) {
  const id = toastId++;
  toastStore.update((t) => [...t, { id, text }]);
  setTimeout(() => toastStore.update((t) => t.filter((x) => x.id !== id)), ms);
}
export function ToastHost() {
  const ts = useStore(toastStore);
  return (
    <div class="toasts" aria-live="polite">
      {ts.map((t) => (
        <div key={t.id} class="toast plaque brass engraved">
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Smoothly rolling number display (for stack totals, pots). */
export function RollingNumber(props: { value: number; format?: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(props.value);
  const from = useRef(props.value);
  useEffect(() => {
    const start = performance.now();
    const a = shown;
    const b = props.value;
    from.current = a;
    if (a === b) return;
    let raf = 0;
    const dur = props.ms ?? 500;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (b - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.value]);
  return <span class="num">{props.format ? props.format(shown) : shown.toLocaleString('en-US')}</span>;
}

export function formatChips(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2) + 'M';
  if (n >= 1e5) return Math.round(n / 1e3) + 'K';
  return n.toLocaleString('en-US');
}
