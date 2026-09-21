/**
 * Audio Settings Store
 *
 * Everything about *how* Harmonia sounds that is not part of a progression:
 * the instrument, the audio quality mode, the lead voice for the melody lane,
 * the master volume and how much room the mix sits in. Persisted to
 * localStorage so the choices carry across sessions and are shared by every
 * surface that plays audio (main progression page, Sketchpad).
 *
 * Quality semantics:
 * - "lightweight" — pure synthesis, no downloads, works offline.
 * - "high"        — sampled instruments load lazily in the background while
 *                   the lightweight twin plays, then hot-swap in. Never blocks.
 *
 * Defaults to "high" because it no longer delays playback; users who have
 * enabled their browser's data-saver get "lightweight" on first run.
 *
 * The audio engine subscribes to this store (see `applyAudioSettings` in
 * `lib/audio/synthPresets.ts`), so volume and space changes take effect on the
 * live signal chain immediately — no re-creation of instruments, no UI needed.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_INSTRUMENT,
  FOLLOW_CHORDS,
  resolveMelodyInstrumentId,
  resolvePresetId,
  type AudioQuality,
  type MelodyInstrumentId,
  type SoundPresetId,
} from "../audio/instrumentCatalog";
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_SPACE,
  clampMasterVolume,
  resolveSpaceId,
  type SpaceId,
} from "../audio/audioSpace";

export { resolveMelodyInstrument, FOLLOW_CHORDS } from "../audio/instrumentCatalog";
export type { MelodyInstrumentId } from "../audio/instrumentCatalog";
export type { SpaceId } from "../audio/audioSpace";

function initialQuality(): AudioQuality {
  if (typeof navigator !== "undefined") {
    const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return "lightweight";
  }
  return "high";
}

interface AudioSettingsState {
  /** Selected instrument sound (identity is independent of quality). */
  instrumentId: SoundPresetId;
  /** Playback quality mode. */
  quality: AudioQuality;
  /**
   * Lead voice for the melody lane: a specific instrument, or "follow" to use
   * whatever the chords are playing.
   */
  melodyInstrumentId: MelodyInstrumentId;
  /** Master output level, 0 (silent) to 1 (unity). */
  masterVolume: number;
  /** How much room the mix sits in. */
  space: SpaceId;

  setInstrument: (id: SoundPresetId) => void;
  setQuality: (quality: AudioQuality) => void;
  setMelodyInstrument: (id: MelodyInstrumentId) => void;
  setMasterVolume: (volume: number) => void;
  setSpace: (space: SpaceId) => void;
}

export const useAudioSettingsStore = create<AudioSettingsState>()(
  persist(
    (set) => ({
      instrumentId: DEFAULT_INSTRUMENT,
      quality: initialQuality(),
      melodyInstrumentId: FOLLOW_CHORDS,
      masterVolume: DEFAULT_MASTER_VOLUME,
      space: DEFAULT_SPACE,

      setInstrument: (id) => set({ instrumentId: resolvePresetId(id) }),
      setQuality: (quality) =>
        set({ quality: quality === "high" ? "high" : "lightweight" }),
      setMelodyInstrument: (id) => set({ melodyInstrumentId: resolveMelodyInstrumentId(id) }),
      setMasterVolume: (volume) => set({ masterVolume: clampMasterVolume(volume) }),
      setSpace: (space) => set({ space: resolveSpaceId(space) }),
    }),
    {
      name: "harmonia-audio-settings",
      version: 2,
      // Sanitize persisted values: an instrument id from an older build that
      // no longer exists, or a volume someone typed into localStorage by hand,
      // must resolve to something playable — never crash, never deafen.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AudioSettingsState>;
        return {
          ...current,
          ...p,
          instrumentId: resolvePresetId(p.instrumentId),
          quality:
            p.quality === "lightweight" || p.quality === "high" ? p.quality : current.quality,
          melodyInstrumentId: resolveMelodyInstrumentId(p.melodyInstrumentId),
          masterVolume:
            p.masterVolume === undefined
              ? current.masterVolume
              : clampMasterVolume(p.masterVolume),
          space: p.space === undefined ? current.space : resolveSpaceId(p.space),
        };
      },
    },
  ),
);
