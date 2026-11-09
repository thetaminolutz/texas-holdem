import { db } from './db';
import { settingsStore, migrateSettings, patchSettings } from '../state/settings';

export const BACKUP_FORMAT = 'felt-oak-holdem-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  kv: Record<string, unknown>;
  hands: Record<string, unknown>;
}

export async function buildBackup(): Promise<BackupFile> {
  const kv: Record<string, unknown> = {};
  for (const k of await db.keys('kv')) kv[k] = await db.get('kv', k);
  kv.settings = settingsStore.get();
  const hands: Record<string, unknown> = {};
  for (const k of await db.keys('hands')) hands[k] = await db.get('hands', k);
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), kv, hands };
}

export async function exportBackup(): Promise<'shared' | 'downloaded'> {
  patchSettings('meta', { lastBackup: Date.now() });
  const data = await buildBackup();
  const json = JSON.stringify(data);
  const name = `holdem-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'application/json' }) : null;
  // iOS: the share sheet ("Save to Files") is the most reliable path inside a home-screen app.
  if (file && (navigator as any).canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Hold'em backup" });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export function validateBackup(x: unknown): x is BackupFile {
  const b = x as BackupFile;
  return !!b && b.format === BACKUP_FORMAT && typeof b.kv === 'object' && typeof b.hands === 'object';
}

export async function importBackup(text: string): Promise<{ kv: number; hands: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!validateBackup(parsed)) throw new Error('This is not a Hold\'em backup file.');
  await db.clear('kv');
  await db.clear('hands');
  let kvn = 0;
  for (const [k, v] of Object.entries(parsed.kv)) {
    await db.set('kv', k, v);
    kvn++;
  }
  let hn = 0;
  for (const [k, v] of Object.entries(parsed.hands)) {
    await db.set('hands', k, v);
    hn++;
  }
  settingsStore.set(migrateSettings(parsed.kv.settings));
  return { kv: kvn, hands: hn };
}

export async function resetEverything() {
  await db.clear('kv');
  await db.clear('hands');
  await db.clear('blobs');
}
