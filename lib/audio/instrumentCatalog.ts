/**
 * Instrument Catalog (metadata only — no Tone.js dependency)
 *
 * The user-facing list of instruments and audio quality modes. UI components
 * and the settings store import from here so they never pull Tone.js into
 * their module graph; the actual synth/sampler construction lives in
 * `synthPresets.ts`, which consumes this catalog.
 */

/** Stable instrument identifiers. Persisted in localStorage — don't rename. */
export type SoundPresetId =
  | "piano"
  | "electric-piano"
  | "soft-keys"
  | "filtered-saw"
  | "organ"
  | "warm-strings"
  | "vibraphone"
  | "pluck";

/**
 * Playback quality mode.
 * - "lightweight": pure synthesis, zero downloads, instant start.
 * - "high": sampled instruments stream in the background and hot-swap in when
 *   ready; playback starts immediately on the lightweight realization.
 */
export type AudioQuality = "lightweight" | "high";

/** Menu grouping. Purely presentational — not persisted. */
export type InstrumentCategory = "keys" | "synth" | "strings" | "mallet" | "plucked";

export interface InstrumentCatalogEntry {
  id: SoundPresetId;
  label: string;
  category: InstrumentCategory;
  /** True when a sampled (high-quality) realization exists for this sound. */
  hasHighQuality: boolean;
  /**
   * True when playing harder changes the *timbre*, not just the level — the
   * instrument has a velocity-driven bright layer or transient. The audition
   * harness asserts loudness and brightness both rise with velocity for these.
   */
  velocitySensitive: boolean;
}

/** Ordered list of selectable instruments (drives UI menus). */
export const INSTRUMENT_CATALOG: ReadonlyArray<InstrumentCatalogEntry> = [
  { id: "piano", label: "Lush Piano", category: "keys", hasHighQuality: true, velocitySensitive: true },
  { id: "electric-piano", label: "Electric Piano", category: "keys", hasHighQuality: true, velocitySensitive: true },
  { id: "soft-keys", label: "Soft Keys", category: "keys", hasHighQuality: false, velocitySensitive: true },
  { id: "filtered-saw", label: "Filtered Saw", category: "synth", hasHighQuality: false, velocitySensitive: true },
  { id: "organ", label: "Organ", category: "synth", hasHighQuality: false, velocitySensitive: true },
  { id: "warm-strings", label: "Warm Strings", category: "strings", hasHighQuality: false, velocitySensitive: true },
  { id: "vibraphone", label: "Vibraphone", category: "mallet", hasHighQuality: false, velocitySensitive: true },
  { id: "pluck", label: "Pluck", category: "plucked", hasHighQuality: false, velocitySensitive: true },
];

/** Back-compat alias used by existing menus. */
export const SOUND_PRESETS = INSTRUMENT_CATALOG;

export const DEFAULT_INSTRUMENT: SoundPresetId = "piano";

const CATALOG_BY_ID = new Map(INSTRUMENT_CATALOG.map((e) => [e.id, e]));

/** Map any (possibly stale/persisted) id to a valid catalog entry id. */
export function resolvePresetId(id: unknown): SoundPresetId {
  return CATALOG_BY_ID.has(id as SoundPresetId) ? (id as SoundPresetId) : DEFAULT_INSTRUMENT;
}

export function getCatalogEntry(id: SoundPresetId): InstrumentCatalogEntry {
  return CATALOG_BY_ID.get(resolvePresetId(id))!;
}

/** True when the preset has a sampled realization (relevant in "high" mode). */
export function presetHasHighQuality(id: SoundPresetId): boolean {
  return getCatalogEntry(id).hasHighQuality;
}

/* ─── Melody voice ─── */

/**
 * The melody lane either follows the chord instrument (the historical
 * behaviour, and the default) or plays a lead voice of its own.
 */
export const FOLLOW_CHORDS = "follow" as const;
export type MelodyInstrumentId = SoundPresetId | typeof FOLLOW_CHORDS;

/** Map any (possibly stale/persisted) value to a valid melody selection. */
export function resolveMelodyInstrumentId(id: unknown): MelodyInstrumentId {
  if (id === FOLLOW_CHORDS) return FOLLOW_CHORDS;
  return CATALOG_BY_ID.has(id as SoundPresetId) ? (id as SoundPresetId) : FOLLOW_CHORDS;
}

/**
 * Which instrument the melody lane should actually play.
 *
 * Tone-free on purpose: the UI can call
 * `useInstrument(resolveMelodyInstrument(instrumentId, melodyInstrumentId), { role: "melody" })`
 * without knowing anything about the audio engine.
 */
export function resolveMelodyInstrument(
  instrumentId: unknown,
  melodyInstrumentId: unknown,
): SoundPresetId {
  const melody = resolveMelodyInstrumentId(melodyInstrumentId);
  return melody === FOLLOW_CHORDS ? resolvePresetId(instrumentId) : melody;
}
