/**
 * Audio Settings Store
 *
 * Holds the user's instrument choice and audio quality mode, persisted to
 * localStorage so they carry across sessions and are shared by every surface
 * that plays audio (main progression page, Sketchpad).
 *
 * Quality semantics:
 * - "lightweight" — pure synthesis, no downloads, works offline.
 * - "high"        — sampled instruments load lazily in the background while
 *                   the lightweight twin plays, then hot-swap in. Never blocks.
 *
 * Defaults to "high" because it no longer delays playback; users who have
 * enabled their browser's data-saver get "lightweight" on first run.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_INSTRUMENT,
  resolvePresetId,
  type AudioQuality,
  type SoundPresetId,
} from "../audio/instrumentCatalog";

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

  setInstrument: (id: SoundPresetId) => void;
  setQuality: (quality: AudioQuality) => void;
}

export const useAudioSettingsStore = create<AudioSettingsState>()(
  persist(
    (set) => ({
      instrumentId: DEFAULT_INSTRUMENT,
      quality: initialQuality(),

      setInstrument: (id) => set({ instrumentId: resolvePresetId(id) }),
      setQuality: (quality) =>
        set({ quality: quality === "high" ? "high" : "lightweight" }),
    }),
    {
      name: "harmonia-audio-settings",
      version: 1,
      // Sanitize persisted values: an instrument id from an older build that
      // no longer exists must resolve to a valid catalog entry, never crash.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AudioSettingsState>;
        return {
          ...current,
          ...p,
          instrumentId: resolvePresetId(p.instrumentId),
          quality:
            p.quality === "lightweight" || p.quality === "high" ? p.quality : current.quality,
        };
      },
    },
  ),
);
