// Hand history persistence (event-sourced: init + actions), capped to the most recent hands.
import { db } from './db';
import type { Action, HandInit } from '../engine/game';

export interface StoredHand {
  key: string;
  date: number;
  mode: string;
  humanId: string;
  init: HandInit;
  actions: Action[];
  summary: { net: number; pot: number; bb: number; winners: string[]; hole: number[]; board: number[]; result: string; mistakes?: string[] };
}

const MAX_HANDS = 500;

export async function saveHand(h: Omit<StoredHand, 'key'>) {
  const key = `${String(h.date).padStart(15, '0')}-${h.init.handId}`;
  await db.set('hands', key, { ...h, key });
  const keys = (await db.keys('hands')).sort();
  if (keys.length > MAX_HANDS) for (const k of keys.slice(0, keys.length - MAX_HANDS)) await db.del('hands', k);
}

export async function listHands(): Promise<StoredHand[]> {
  const keys = (await db.keys('hands')).sort().reverse();
  const out: StoredHand[] = [];
  for (const k of keys) {
    const h = await db.get<StoredHand>('hands', k);
    if (h) out.push(h);
  }
  return out;
}

export async function getHand(key: string) {
  return db.get<StoredHand>('hands', key);
}

export async function clearHands() {
  await db.clear('hands');
}
