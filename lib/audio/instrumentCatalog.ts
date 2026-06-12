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
  | "organ";

/**
 * Playback quality mode.
 * - "lightweight": pure synthesis, zero downloads, instant start.
 * - "high": sampled instruments stream in the background and hot-swap in when
 *   ready; playback starts immediately on the lightweight realization.
 */
export type AudioQuality = "lightweight" | "high";

export interface InstrumentCatalogEntry {
  id: SoundPresetId;
  label: string;
  category: "keys" | "synth";
  /** True when a sampled (high-quality) realization exists for this sound. */
  hasHighQuality: boolean;
}

/** Ordered list of selectable instruments (drives UI menus). */
export const INSTRUMENT_CATALOG: ReadonlyArray<InstrumentCatalogEntry> = [
  { id: "piano", label: "Lush Piano", category: "keys", hasHighQuality: true },
  { id: "electric-piano", label: "Electric Piano", category: "keys", hasHighQuality: true },
  { id: "soft-keys", label: "Soft Keys", category: "keys", hasHighQuality: false },
  { id: "filtered-saw", label: "Filtered Saw", category: "synth", hasHighQuality: false },
  { id: "organ", label: "Organ", category: "synth", hasHighQuality: false },
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
