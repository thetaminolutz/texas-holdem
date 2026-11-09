import { db } from '../storage/db';
import { Store } from './store';

export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type Wear = 'new' | 'light' | 'worn' | 'vintage';
export type TableShape = 'oval' | 'round' | 'rect';
export type WoodType = 'oak' | 'walnut' | 'mahogany' | 'ebony';
export type ShuffleStyle = 'riffle' | 'bridge' | 'overhand' | 'wash' | 'cut' | 'random';
export type AnimSpeed = 'off' | '0.5' | '1' | '1.5' | '2' | 'instant';
export type CameraPreset = 'player' | 'top' | 'cinematic';
export type UiTheme = 'wood' | 'leather' | 'metal';
export type DeckStyle = 'classic' | 'large' | 'four';
export type LightMood = 'warm' | 'smoky' | 'cool' | 'noir';
export type BettingStructure = 'NL' | 'PL' | 'FL';
export type RunItTwice = 'off' | 'ask' | 'always';
export type TimeoutAction = 'checkfold' | 'fold';

export interface Settings {
  version: number;
  gameplay: {
    players: number;
    startingStack: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    structure: BettingStructure;
    levelBy: 'hands' | 'minutes';
    levelLength: number;
    rebuys: boolean;
    straddle: boolean;
    runItTwice: RunItTwice;
    autoMuck: boolean;
    autoPostBlinds: boolean;
    gameSpeed: number; // bot think-time multiplier 0.25..2
    turnTimer: number; // seconds, 0 = off
    timeoutAction: TimeoutAction;
    showBotCards: boolean;
    defaultDifficulty: string;
    stepSize: 'bb' | 'halfbb' | 'one' | 'custom';
    customStep: number;
    quickBets: number[]; // pot fractions
  };
  look: {
    tableShape: TableShape;
    wood: WoodType;
    felt: string;
    leather: string;
    trim: 'brass' | 'chrome';
    lighting: LightMood;
    deckStyle: DeckStyle;
    cardBack: number;
    chipSet: number;
    avatarStyle: 'portrait' | 'monogram';
    uiTheme: UiTheme;
    wear: Wear;
    camera: CameraPreset;
    quality: Quality;
    colorScheme: 'auto' | 'light' | 'dark';
    fontScale: number;
  };
  anim: {
    speed: AnimSpeed;
    shuffleStyle: ShuffleStyle;
    quickShuffle: boolean;
    dealStyle: 'flick' | 'slide';
    chipIntensity: 'subtle' | 'normal' | 'dramatic';
    cinematic: boolean;
    idleFidget: boolean;
    reduceMotion: boolean;
    slowRollRiver: boolean;
    cameraSway: boolean;
  };
  audio: {
    master: number;
    effects: number;
    music: number;
    musicOn: boolean;
    spatial: boolean;
    sounds: Record<string, boolean>;
  };
  access: {
    colorblind: boolean;
    highContrast: boolean;
    largeTargets: boolean;
    leftHanded: boolean;
  };
  coach: {
    potOdds: boolean;
    equity: boolean;
    hud: boolean;
    coach: boolean;
    mistakeReview: boolean;
    tableTalk: boolean;
  };
  meta: {
    lastBackup: number;
    firstRun: number;
    tutorialDone: boolean;
  };
}

export const SOUND_KEYS = [
  'cards',
  'shuffle',
  'chips',
  'knock',
  'fold',
  'bell',
  'timer',
  'win',
  'ui',
] as const;

export const SETTINGS_VERSION = 3;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    gameplay: {
      players: 6,
      startingStack: 2000,
      smallBlind: 10,
      bigBlind: 20,
      ante: 0,
      structure: 'NL',
      levelBy: 'hands',
      levelLength: 12,
      rebuys: true,
      straddle: false,
      runItTwice: 'off',
      autoMuck: true,
      autoPostBlinds: true,
      gameSpeed: 1,
      turnTimer: 0,
      timeoutAction: 'checkfold',
      showBotCards: true,
      defaultDifficulty: 'medium',
      stepSize: 'bb',
      customStep: 50,
      quickBets: [0.33, 0.5, 0.75, 1],
    },
    look: {
      tableShape: 'oval',
      wood: 'walnut',
      felt: '#1f6b3f',
      leather: '#3a1f14',
      trim: 'brass',
      lighting: 'warm',
      deckStyle: 'classic',
      cardBack: 0,
      chipSet: 0,
      avatarStyle: 'portrait',
      uiTheme: 'wood',
      wear: 'light',
      camera: 'player',
      quality: 'auto',
      colorScheme: 'auto',
      fontScale: 1,
    },
    anim: {
      speed: '1',
      shuffleStyle: 'riffle',
      quickShuffle: false,
      dealStyle: 'flick',
      chipIntensity: 'normal',
      cinematic: true,
      idleFidget: true,
      reduceMotion: false,
      slowRollRiver: false,
      cameraSway: true,
    },
    audio: {
      master: 0.8,
      effects: 0.9,
      music: 0.35,
      musicOn: false,
      spatial: true,
      sounds: Object.fromEntries(SOUND_KEYS.map((k) => [k, true])),
    },
    access: { colorblind: false, highContrast: false, largeTargets: false, leftHanded: false },
    coach: { potOdds: true, equity: false, hud: false, coach: false, mistakeReview: true, tableTalk: true },
    meta: { lastBackup: 0, firstRun: Date.now(), tutorialDone: false },
  };
}

/** Deep-merge stored data onto defaults so new fields get defaults and corrupt fields are dropped. */
function mergeDefaults<T>(def: T, stored: unknown): T {
  if (stored === null || typeof stored !== 'object' || Array.isArray(def)) {
    if (Array.isArray(def) && Array.isArray(stored)) return stored as T;
    return typeof stored === typeof def && stored !== null ? (stored as T) : def;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(def as object)) {
    const dv = (def as Record<string, unknown>)[k];
    const sv = (stored as Record<string, unknown>)[k];
    if (sv === undefined) out[k] = dv;
    else if (dv !== null && typeof dv === 'object' && !Array.isArray(dv)) out[k] = mergeDefaults(dv, sv);
    else out[k] = typeof sv === typeof dv ? sv : dv;
  }
  return out as T;
}

export function migrateSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  // v1 -> v2: animation speed stored as number
  if ((s.version ?? 1) < 2 && s.anim && typeof s.anim.speed === 'number') s.anim.speed = String(s.anim.speed);
  // v2 -> v3: 'theme' renamed to look.uiTheme
  if ((s.version ?? 1) < 3 && s.look && s.look.theme) s.look.uiTheme = s.look.theme;
  const merged = mergeDefaults(defaultSettings(), s);
  merged.version = SETTINGS_VERSION;
  return merged;
}

export const settingsStore = new Store<Settings>(defaultSettings());

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export async function loadSettings() {
  const raw = await db.get('kv', 'settings');
  settingsStore.set(migrateSettings(raw));
  settingsStore.subscribe(() => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void db.set('kv', 'settings', settingsStore.get()), 200);
  });
}

export function flushSettings() {
  return db.set('kv', 'settings', settingsStore.get());
}

export function patchSettings<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) {
  settingsStore.update((s) => ({ ...s, [section]: { ...(s[section] as object), ...patch } }));
}

export function animSpeedFactor(s: Settings): number {
  if (s.anim.reduceMotion) return 3;
  switch (s.anim.speed) {
    case 'off':
      return 0;
    case 'instant':
      return 8;
    default:
      return Number(s.anim.speed);
  }
}
