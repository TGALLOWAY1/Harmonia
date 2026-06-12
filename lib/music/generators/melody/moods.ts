/**
 * Mood profiles for the melody engine.
 *
 * A MoodProfile parameterises every stage of the pipeline — register,
 * contour preference, rhythmic density, leap behaviour, ornamentation,
 * and tension scaling — so that the four moods are audibly distinct.
 * MelodyStyle modulates the chosen mood rather than competing with it.
 */

import type { ContourShape, MelodyMood, MelodyStyle } from "./types";

export type OrnamentKind =
  | "passing"
  | "neighbor"
  | "suspension"
  | "anticipation"
  | "appoggiatura";

export type MoodProfile = {
  /** MIDI center of the melody register (assumes octave 5; shifted otherwise). */
  registerCenter: number;
  /** Max semitones above/below the register center. */
  registerSpan: number;
  /** Relative weights for contour shape selection. */
  contourWeights: Partial<Record<ContourShape, number>>;
  /** 0–1: probability mass toward shorter, denser notes. */
  rhythmDensity: number;
  /** 0–1: chance of off-beat onsets within motifs. */
  syncopationChance: number;
  /** 0–1: chance of carving a breathing rest into a motif. */
  restChance: number;
  /** 0–1: chance of a pickup (anacrusis) into each phrase segment. */
  pickupChance: number;
  /** Hard limit on melodic interval, in semitones. */
  maxLeap: number;
  /** 0–1: preference for leaps over steps when shaping motifs. */
  leapChance: number;
  /** 0–1: ornamentation (non-chord-tone) amount. */
  nctDensity: number;
  /** Which non-chord-tone devices this mood may use. */
  nctPalette: OrnamentKind[];
  /** Multiplier applied to the phrase tension curve. */
  tensionScale: number;
  /** 0–1: preference for sustained notes in intros and phrase endings. */
  longNoteBias: number;
};

export const MOOD_PROFILES: Record<MelodyMood, MoodProfile> = {
  dark: {
    registerCenter: 65,
    registerSpan: 7,
    contourWeights: { falling: 0.4, "inverted-arch": 0.3, wave: 0.3 },
    rhythmDensity: 0.3,
    syncopationChance: 0.15,
    restChance: 0.3,
    pickupChance: 0.2,
    maxLeap: 7,
    leapChance: 0.15,
    nctDensity: 0.5,
    nctPalette: ["passing", "neighbor", "suspension"],
    tensionScale: 1.2,
    longNoteBias: 0.6,
  },
  emotional: {
    registerCenter: 71,
    registerSpan: 10,
    contourWeights: { arch: 0.45, wave: 0.3, rising: 0.25 },
    rhythmDensity: 0.45,
    syncopationChance: 0.2,
    restChance: 0.2,
    pickupChance: 0.4,
    maxLeap: 9,
    leapChance: 0.25,
    nctDensity: 0.6,
    nctPalette: ["passing", "neighbor", "suspension", "anticipation", "appoggiatura"],
    tensionScale: 1.0,
    longNoteBias: 0.5,
  },
  dreamy: {
    registerCenter: 74,
    registerSpan: 9,
    contourWeights: { wave: 0.4, arch: 0.3, "stair-step": 0.3 },
    rhythmDensity: 0.25,
    syncopationChance: 0.1,
    restChance: 0.35,
    pickupChance: 0.15,
    maxLeap: 12,
    leapChance: 0.35,
    nctDensity: 0.4,
    nctPalette: ["suspension", "anticipation", "neighbor"],
    tensionScale: 0.7,
    longNoteBias: 0.8,
  },
  energetic: {
    registerCenter: 72,
    registerSpan: 12,
    contourWeights: { rising: 0.35, "stair-step": 0.35, arch: 0.3 },
    rhythmDensity: 0.8,
    syncopationChance: 0.5,
    restChance: 0.1,
    pickupChance: 0.5,
    maxLeap: 12,
    leapChance: 0.4,
    nctDensity: 0.3,
    nctPalette: ["passing", "neighbor", "anticipation"],
    tensionScale: 1.1,
    longNoteBias: 0.2,
  },
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Apply the user's melody style as a modulation on top of the mood profile,
 * preserving the three styles' established characters: lyrical = longer and
 * more ornamented, rhythmic = denser and more syncopated, arpeggiated =
 * chord-tone leaps with little ornamentation.
 */
export function applyStyleToMood(profile: MoodProfile, style: MelodyStyle): MoodProfile {
  switch (style) {
    case "lyrical":
      return {
        ...profile,
        rhythmDensity: clamp01(profile.rhythmDensity - 0.1),
        nctDensity: clamp01(profile.nctDensity + 0.1),
      };
    case "rhythmic":
      return {
        ...profile,
        rhythmDensity: clamp01(profile.rhythmDensity + 0.2),
        syncopationChance: clamp01(profile.syncopationChance + 0.15),
      };
    case "arpeggiated":
      return {
        ...profile,
        leapChance: clamp01(profile.leapChance + 0.2),
        nctDensity: clamp01(profile.nctDensity - 0.2),
      };
  }
}

/** Low/high MIDI bounds of the melody register for a mood and octave. */
export function moodRegister(profile: MoodProfile, octave: number): { low: number; high: number } {
  const shift = (octave - 5) * 12;
  const center = profile.registerCenter + shift;
  // Keep within the piano-roll display range (C4–C6 at octave 5).
  const low = Math.max(center - profile.registerSpan, 60 + shift);
  const high = Math.min(center + profile.registerSpan, 84 + shift);
  return { low, high };
}
