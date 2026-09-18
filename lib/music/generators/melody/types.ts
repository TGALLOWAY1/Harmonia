import type { PitchClass } from "@/lib/theory/midiUtils";
import type { ChordKind, DurationClass, HarmonicFunction } from "../advanced/types";

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

/** One phrase of the generated melody's form, for display and analysis. */
export type MelodyPhrase = {
  startBeat: number;
  endBeat: number;
  /** A = the basic idea, A' its restatement, B the departure, A'' the return. */
  material: "A" | "A'" | "B" | "A''";
  /** How the phrase closes: a half cadence, an imperfect close, or the final cadence. */
  cadence: "half" | "imperfect" | "authentic" | "final";
  isClimax: boolean;
  /** Beat of the phrase's highest note. */
  peakBeat: number;
};

/** The full generated melody for a progression. */
export type Melody = {
  notes: MelodyNote[];
  /** Octave in which the melody lives (e.g. 5 for C5-range). */
  octave: number;
  /** The phrase form the melody was composed in (absent for drawn melodies). */
  phrases?: MelodyPhrase[];
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

/**
 * Phrase form. "auto" chooses by length: one closed phrase under 12 beats, a
 * period (question / answer) up to about six bars, then statement /
 * restatement / departure / conclusion cycles.
 */
export type MelodyForm = "auto" | "single" | "period" | "cycles";

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
    /**
     * Optional hints from the chord engine or the store. The engine infers
     * quality, function and tension from the pitch classes when they are
     * absent, so callers may pass only the four fields above.
     */
    symbol?: string;
    romanNumeral?: string;
    kind?: ChordKind;
    functionTag?: HarmonicFunction;
    isDominant?: boolean;
    bass?: PitchClass;
    /** Realised tension 0–1, when the caller already knows it. */
    tension?: number;
  }[];
  style: MelodyStyle;
  /** How tightly the melody follows the chord tones (default "expressive"). */
  harmony?: MelodyHarmony;
  /** Emotional character of the melody (default "emotional"). */
  mood?: MelodyMood;
  /**
   * Tension per chord (0–1), for example the chord engine's own curve. When
   * absent the engine derives one from the chords' functions.
   */
  tensionCurve?: number[];
  /** Phrase form (default "auto"). */
  form?: MelodyForm;
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
