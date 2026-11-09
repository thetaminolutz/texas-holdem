// Headless bot-vs-bot simulator. Usage: tsx scripts/simulate.ts [hands=50000] [workers=4]
// 6-handed No-Limit cash tables, stacks reset to 100bb every hand; difficulty and archetype are rotated through seats.
// Reports bb/100 by difficulty and by archetype.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHand, applyAction, type HandInit } from '../src/engine/game.ts';
import { fullDeck } from '../src/engine/cards.ts';
import { SeededRng, shuffle } from '../src/engine/rng.ts';
import { decide } from '../src/ai/brain.ts';
import { buildView } from '../src/ai/view.ts';
import { analyzeHand, accumulate, emptyStats } from '../src/ai/opponentModel.ts';
import { ARCHETYPES } from '../src/ai/characters.ts';
import type { Archetype, BotContext, OpponentStats } from '../src/ai/types.ts';
import type { Difficulty } from '../src/ai/difficulty.ts';

const DIFFS: Difficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert'];
const ARCHS = Object.keys(ARCHETYPES) as Archetype[];

interface Result {
  byDiff: Record<string, { net: number; hands: number }>;
  byArch: Record<string, { net: number; hands: number }>;
  byPair: Record<string, { net: number; hands: number }>;
  hands: number;
  errors: number;
}

function runChunk(hands: number, seed: number, mode: 'difficulty' | 'archetype'): Result {
  const rng = new SeededRng(seed);
  const bb = 20;
  const N = 6;
  const res: Result = { byDiff: {}, byArch: {}, byPair: {}, hands: 0, errors: 0 };
  const stats: Record<string, OpponentStats> = {};
  const tilt: Record<string, number> = {};
  for (let h = 0; h < hands; h++) {
    // seat composition: in 'difficulty' mode each table has a mix of difficulties with a fixed balanced archetype (Pro/TAG);
    // in 'archetype' mode all bots are 'medium' with varied archetypes.
    const players = Array.from({ length: N }, (_, i) => {
      const d = mode === 'difficulty' ? DIFFS[(i + Math.floor(h / 50)) % DIFFS.length] : 'medium';
      const a = mode === 'difficulty' ? (['TAG', 'Pro', 'LAG', 'Rock', 'Station'] as Archetype[])[(i * 3 + Math.floor(h / 200)) % 5] : ARCHS[(i + Math.floor(h / 40)) % ARCHS.length];
      const id = `${d}-${a}-${i}-${Math.floor(h / 1000)}`;
      return { id, d, a };
    });
    const init: HandInit = {
      handId: 'sim' + h,
      handNo: h,
      config: { sb: bb / 2, bb, ante: 0, structure: 'NL', straddle: false, runItTwice: false },
      players: players.map((p, i) => ({ id: p.id, name: p.id, stack: 100 * bb, seat: i })),
      button: h % N,
      deck: shuffle(fullDeck(), rng),
    };
    const s = createHand(init);
    let guard = 0;
    try {
      while (s.street !== 'complete') {
        if (++guard > 300) throw new Error('loop');
        if (s.pendingRuns) {
          applyAction(s, { type: 'runs', amount: 1 });
          continue;
        }
        const i = s.toAct!;
        const p = players[i];
        const opps: Record<string, OpponentStats> = {};
        for (const q of players) if (q.id !== p.id && stats[q.id]) opps[q.id] = stats[q.id];
        const ctx: BotContext = { archetype: p.a, difficulty: p.d, personality: ARCHETYPES[p.a].p, tilt: tilt[p.id] ?? 0, confidence: 0, opponents: opps, seed: 1 };
        const dec = decide(buildView(s, i), ctx, rng);
        applyAction(s, dec.action);
      }
    } catch (e) {
      res.errors++;
      continue;
    }
    const flags = analyzeHand(s);
    s.players.forEach((pl, i) => {
      stats[pl.id] = accumulate(stats[pl.id] ?? emptyStats(), flags[i]);
      const net = (pl.stack - pl.startStack) / bb;
      const p = players[i];
      const t = tilt[p.id] ?? 0;
      tilt[p.id] = Math.max(0, Math.min(1, t * 0.9 + (net < -40 ? ARCHETYPES[p.a].p.tiltProne * 0.5 : 0)));
      const add = (m: Record<string, { net: number; hands: number }>, k: string) => {
        m[k] ??= { net: 0, hands: 0 };
        m[k].net += net;
        m[k].hands++;
      };
      add(res.byDiff, p.d);
      add(res.byArch, p.a);
      add(res.byPair, `${p.d}/${p.a}`);
    });
    res.hands++;
  }
  return res;
}

function merge(a: Result, b: Result): Result {
  const m = (x: Record<string, any>, y: Record<string, any>) => {
    for (const [k, v] of Object.entries(y)) {
      x[k] ??= { net: 0, hands: 0 };
      x[k].net += v.net;
      x[k].hands += v.hands;
    }
  };
  m(a.byDiff, b.byDiff);
  m(a.byArch, b.byArch);
  m(a.byPair, b.byPair);
  a.hands += b.hands;
  a.errors += b.errors;
  return a;
}

if (!isMainThread) {
  const { hands, seed, mode } = workerData;
  parentPort!.postMessage(runChunk(hands, seed, mode));
} else {
  const total = Number(process.argv[2] ?? 50000);
  const nw = Number(process.argv[3] ?? 4);
  const t0 = Date.now();
  const run = (mode: 'difficulty' | 'archetype', hands: number) =>
    Promise.all(
      Array.from({ length: nw }, (_, i) =>
        new Promise<Result>((resolve, reject) => {
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: { hands: Math.ceil(hands / nw), seed: 1000 + i * 7919 + (mode === 'archetype' ? 13 : 0), mode }, execArgv: ['--import', 'tsx'] });
          w.on('message', resolve);
          w.on('error', reject);
        }),
      ),
    ).then((rs) => rs.reduce(merge));
  const diffRes = await run('difficulty', total);
  const archRes = await run('archetype', Math.round(total / 2));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const fmt = (m: Record<string, { net: number; hands: number }>, order?: string[]) =>
    (order ?? Object.keys(m))
      .filter((k) => m[k])
      .map((k) => `| ${k.padEnd(12)} | ${(((m[k].net / m[k].hands) * 100)).toFixed(1).padStart(8)} | ${String(m[k].hands).padStart(8)} |`)
      .join('\n');
  const report = `### Bot simulator report

Run: ${diffRes.hands.toLocaleString()} hands (difficulty ladder, mixed archetypes TAG/Pro/LAG/Rock/Station) + ${archRes.hands.toLocaleString()} hands (archetypes, all Medium), 6-max NL, 100bb deep, ${secs}s on ${nw} threads. Errors: ${diffRes.errors + archRes.errors}.

**By difficulty (bb/100)**

| Difficulty   |   bb/100 | hands    |
|--------------|---------:|---------:|
${fmt(diffRes.byDiff, DIFFS)}

**By archetype at Medium difficulty (bb/100)**

| Archetype    |   bb/100 | hands    |
|--------------|---------:|---------:|
${fmt(archRes.byArch)}
`;
  console.log(report);
  writeFileSync(new URL('../sim-report.md', import.meta.url), report);
}
