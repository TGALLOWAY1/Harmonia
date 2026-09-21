/**
 * Master output settings (no Tone.js dependency).
 *
 * Two things the listener controls that are not part of an instrument's
 * identity: how loud the app is, and how much room it is playing in. Both live
 * here as plain data + pure maths so the settings store, the UI menus and the
 * audio chain all agree without importing Tone.
 */

/** Reverb character presets, from a close mix to a concert hall. */
export type SpaceId = "dry" | "room" | "hall";

export interface SpaceDefinition {
  id: SpaceId;
  label: string;
  /** One line of plain language for the settings UI. */
  description: string;
  /** Reverb decay in seconds. */
  decay: number;
  /** Pre-delay in seconds: a little distance before the reflections arrive. */
  preDelay: number;
  /**
   * Multiplier on each instrument's own reverb send. Instruments ask for
   * different amounts (a pad wants more room than a piano); the space scales
   * all of them together.
   */
  sendScale: number;
}

export const SPACES: Record<SpaceId, SpaceDefinition> = {
  dry: {
    id: "dry",
    label: "Dry",
    description: "No room — close and immediate.",
    decay: 0.6,
    preDelay: 0,
    sendScale: 0,
  },
  room: {
    id: "room",
    label: "Room",
    description: "A small studio room. The default.",
    decay: 1.8,
    preDelay: 0.012,
    sendScale: 1,
  },
  hall: {
    id: "hall",
    label: "Hall",
    description: "A long, wide hall for sustained writing.",
    decay: 3.6,
    preDelay: 0.03,
    sendScale: 1.7,
  },
};

/** Ordered for UI menus: driest first. */
export const SPACE_LIST: ReadonlyArray<SpaceDefinition> = [SPACES.dry, SPACES.room, SPACES.hall];

export const DEFAULT_SPACE: SpaceId = "room";

/** Map any (possibly stale/persisted) value to a valid space. */
export function resolveSpaceId(id: unknown): SpaceId {
  return id === "dry" || id === "room" || id === "hall" ? id : DEFAULT_SPACE;
}

export function getSpace(id: SpaceId): SpaceDefinition {
  return SPACES[resolveSpaceId(id)];
}

/* ─── Master volume ─── */

export const DEFAULT_MASTER_VOLUME = 0.8;

/** Quietest audible setting; below this the output is muted outright. */
export const MASTER_VOLUME_FLOOR_DB = -60;

/** Clamp (and sanitize) a persisted or user-supplied volume to 0–1. */
export function clampMasterVolume(value: unknown): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_MASTER_VOLUME;
  return Math.min(1, Math.max(0, v));
}

/**
 * Volume slider → decibels. A fader that moves in dB is what "twice as far up
 * sounds twice as loud" actually means; 1 is unity, 0 is silence.
 */
export function masterVolumeToDb(value: number): number {
  const v = clampMasterVolume(value);
  if (v <= 0) return -Infinity;
  const db = 20 * Math.log10(v);
  return db <= MASTER_VOLUME_FLOOR_DB ? -Infinity : db;
}

/** Volume slider → linear gain for a `Tone.Gain` node. */
export function masterVolumeToGain(value: number): number {
  const db = masterVolumeToDb(value);
  return Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
}
