/**
 * Playback Settings Store
 *
 * Holds user-facing playback controls (velocity, humanization, sustain, style)
 * and persists them to localStorage via Zustand's `persist` middleware so the
 * feel of playback carries across sessions.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlaybackStyle, SustainMode } from "../audio/humanization";

export const CHORD_VELOCITY_MIN = 0.2;
export const CHORD_VELOCITY_MAX = 1;

/**
 * Melody level sits above 1 by default so the melody carries over the chords
 * the way a real lead voice/instrument would, without letting the user push
 * it into distortion territory (the dynamics model still clamps the final
 * velocity to [0.15, 1]; this is the multiplier applied before that clamp).
 */
export const MELODY_LEVEL_MIN = 0.5;
export const MELODY_LEVEL_MAX = 1.5;

interface PlaybackSettingsState {
  /** Base chord velocity (0.20–1.00). */
  chordVelocity: number;
  /** Humanization amount (0 = off, 1 = full natural variation). */
  humanize: number;
  /** Sustain behaviour. */
  sustainMode: SustainMode;
  /** Articulation style. */
  playbackStyle: PlaybackStyle;
  /** Melody volume relative to the chords (0.50–1.50), default above 1. */
  melodyLevel: number;

  setChordVelocity: (value: number) => void;
  setHumanize: (value: number) => void;
  setSustainMode: (mode: SustainMode) => void;
  setPlaybackStyle: (style: PlaybackStyle) => void;
  setMelodyLevel: (value: number) => void;
}

export const usePlaybackSettingsStore = create<PlaybackSettingsState>()(
  persist(
    (set) => ({
      chordVelocity: 0.7,
      humanize: 0.5,
      sustainMode: "natural",
      playbackStyle: "block",
      melodyLevel: 1.15,

      setChordVelocity: (value) =>
        set({ chordVelocity: Math.min(CHORD_VELOCITY_MAX, Math.max(CHORD_VELOCITY_MIN, value)) }),
      setHumanize: (value) => set({ humanize: Math.min(1, Math.max(0, value)) }),
      setSustainMode: (mode) => set({ sustainMode: mode }),
      setPlaybackStyle: (style) => set({ playbackStyle: style }),
      setMelodyLevel: (value) =>
        set({ melodyLevel: Math.min(MELODY_LEVEL_MAX, Math.max(MELODY_LEVEL_MIN, value)) }),
    }),
    {
      name: "harmonia-playback-settings",
    },
  ),
);
