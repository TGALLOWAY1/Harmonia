import type { PitchClass } from "@/lib/theory/midiUtils";
import type { DurationClass } from "../advanced/types";

/** A single note in a generated melody. */
export type MelodyNote = {
  id: string;
  midi: number;
  noteWithOctave: string; // e.g. "C5"
  pitchClass: PitchClass;
  /** Duration in beats (aligned to the rhythmic grid). */
  durationBeats: number;
  /** Beat offset from the start of the progression. */
  startBeat: number;
  /** Index of the chord this note sounds over. */
  chordIndex: number;
  /** Whether this note is a chord tone of the underlying chord. */
  isChordTone: boolean;
  /** How this note was created. */
  source: "generated" | "drawn";
};

/** The full generated melody for a progression. */
export type Melody = {
  notes: MelodyNote[];
  /** Octave in which the melody lives (e.g. 5 for C5-range). */
  octave: number;
};

/** Style of melody generation. */
export type MelodyStyle = "lyrical" | "rhythmic" | "arpeggiated";

/**
 * Emotional character of the melody. Moods drive register, contour shape,
 * rhythmic density, leap sizes, ornamentation amount, and tension scaling.
 */
export type MelodyMood = "dark" | "emotional" | "dreamy" | "energetic";

/** Planned overall melodic shape for the phrase. */
export type ContourShape =
  | "rising"
  | "falling"
  | "arch"
  | "inverted-arch"
  | "wave"
  | "stair-step";

/**
 * How tightly the melody is bound to the underlying chord's tones.
 *   - expressive: chord tones (incl. chromatic ones) are reachable and strongly
 *                 preferred on strong beats; diatonic notes a semitone off a
 *                 chord tone are avoided, but scale/passing tones remain allowed.
 *   - strict:     every strong-beat note must be an actual chord tone; scale and
 *                 passing tones are only permitted on weak beats.
 */
export type MelodyHarmony = "expressive" | "strict";

/** Options for the melody generator. */
export type MelodyGenerationOptions = {
  /** Scale pitch classes (7 notes) in order. */
  scalePitchClasses: PitchClass[];
  /** The chords to generate melody over. */
  chords: {
    midiNotes: number[];
    pitchClasses: PitchClass[];
    root: PitchClass;
    durationClass?: DurationClass;
  }[];
  style: MelodyStyle;
  /** How tightly the melody follows the chord tones (default "expressive"). */
  harmony?: MelodyHarmony;
  /** Emotional character of the melody (default "emotional"). */
  mood?: MelodyMood;
  /** Tension curve (0-1 per chord) — drives contour and note density. */
  tensionCurve?: number[];
  /** Octave for the melody (default 5). */
  octave?: number;
  /** Seed for deterministic generation. */
  seed?: number;
  /**
   * Number of candidate melodies to generate and score; the best is kept
   * (default 8). 1 skips the selection loop for a single fast pass.
   */
  candidateCount?: number;
};
