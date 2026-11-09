/// <reference lib="webworker" />
// Runs bot decisions (Monte Carlo equity vs ranges) off the main thread.
import { decide, coachAdvice } from '../ai/brain';
import { equityVsRanges, fullRange } from '../ai/range';
import { CryptoRng } from '../engine/rng';

const rng = new CryptoRng();
self.onmessage = (e: MessageEvent) => {
  const { id, kind, view, ctx, hole, board, opponents, iters } = e.data;
  try {
    let result: unknown;
    if (kind === 'decide') result = decide(view, ctx, rng);
    else if (kind === 'coach') result = coachAdvice(view, ctx?.opponents ?? {}, rng);
    else if (kind === 'equity') result = equityVsRanges(hole, board, Array.from({ length: opponents }, () => fullRange()), iters ?? 1500, rng);
    (self as any).postMessage({ id, result });
  } catch (err) {
    (self as any).postMessage({ id, error: String(err) });
  }
};
