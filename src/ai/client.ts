// Main-thread client for the AI worker, with a synchronous fallback if workers are unavailable.
import type { BotContext, BotView, Decision } from './types';
import { decide, coachAdvice } from './brain';
import { equityVsRanges, fullRange } from './range';
import { cryptoRng } from '../engine/rng';

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();

function getWorker(): Worker | null {
  if (failed) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.rej(new Error(e.data.error));
        else p.res(e.data.result);
      };
      worker.onerror = () => {
        failed = true;
        for (const p of pending.values()) p.rej(new Error('worker failed'));
        pending.clear();
      };
    } catch {
      failed = true;
      return null;
    }
  }
  return worker;
}

function call<T>(msg: object, fallback: () => T): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.resolve(fallback());
  const id = nextId++;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej });
    w.postMessage({ id, ...msg });
  }).catch(() => fallback());
}

export function botDecide(view: BotView, ctx: BotContext): Promise<Decision> {
  return call({ kind: 'decide', view, ctx }, () => decide(view, ctx, cryptoRng));
}
export function coach(view: BotView, opponents: BotContext['opponents']): Promise<Decision> {
  return call({ kind: 'coach', view, ctx: { opponents } }, () => coachAdvice(view, opponents, cryptoRng));
}
export function rawEquity(hole: number[], board: number[], opponents: number, iters = 1500): Promise<number> {
  return call({ kind: 'equity', hole, board, opponents, iters }, () => equityVsRanges(hole, board, Array.from({ length: opponents }, () => fullRange()), iters, cryptoRng));
}
export function terminateAi() {
  worker?.terminate();
  worker = null;
}
