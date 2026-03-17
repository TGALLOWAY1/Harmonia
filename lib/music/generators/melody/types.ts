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
  /** Tension curve (0-1 per chord) — drives contour and note density. */
  tensionCurve?: number[];
  /** Octave for the melody (default 5). */
  octave?: number;
  /** Seed for deterministic generation. */
  seed?: number;
};
