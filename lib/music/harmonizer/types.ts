/**
 * Types for the melody → chord harmonization engine.
 *
 * The harmonizer takes a drawn melody plus a key/scale and produces a
 * deterministic, explainable chord progression that fits the melody. It is
 * intentionally rule-based (no randomness, no ML) so the result is reproducible
 * and the reasoning can be shown to the user.
 */

import type { PitchClass } from "@/lib/theory/midiUtils";
import type { ScaleType } from "@/lib/theory/types";
import type { TriadQuality, SeventhQuality } from "@/lib/theory/chord";
import type { Chord } from "@/lib/theory/progressionTypes";
import type { MelodyNote } from "@/lib/music/generators/melody/types";
import type { Speller } from "@/lib/theory/spelling";

/**
 * The five harmonization "flavours". `bestFit` is the pure melody-fit result;
 * the others bias chord selection toward a mood without abandoning melody fit.
 */
export type HarmonizationStyle =
  | "bestFit"
  | "darker"
  | "brighter"
  | "tense"
  | "simple";

/** A diatonic chord the harmonizer can choose for a region. */
export type ChordCandidate = {
  /** Sharp-canonical display symbol, e.g. "Dm", "A#". */
  symbol: string;
  /** Sharp-canonical root pitch class. */
  root: PitchClass;
  /** Theory quality, e.g. "min", "maj", "dim", "min7". */
  quality: TriadQuality | SeventhQuality;
  /** Roman numeral for the active key, e.g. "i", "ii°", "VII". */
  romanNumeral: string;
  /** Pitch classes that make up the chord. */
  pitchClasses: PitchClass[];
  /** 0-based scale degree (0 = tonic). */
  degreeIndex: number;
  /** Whether this candidate is a seventh chord. */
  isSeventh: boolean;
};

/** A slice of the melody (one bar by default) and the chord chosen for it. */
export type HarmonizedRegion = {
  /** 0-based region/bar index. */
  index: number;
  startBeat: number;
  endBeat: number;
  melodyNotes: MelodyNote[];
  candidate: ChordCandidate;
  chord: Chord;
  explanation: string;
  score: number;
};

export type HarmonizationResult = {
  chords: Chord[];
  regions: HarmonizedRegion[];
  explanations: string[];
  style: HarmonizationStyle;
};

export type HarmonizeOptions = {
  /** The drawn melody notes (any order). */
  melodyNotes: MelodyNote[];
  /** Tonic of the key, sharp-canonical (e.g. "D"). */
  root: PitchClass;
  /** Scale type of the key (e.g. "natural_minor"). */
  scaleType: ScaleType;
  /** Beats per harmonic region/bar (default 4). */
  beatsPerBar?: number;
  /** Octave to voice the chords in (default 3). */
  octave?: number;
  /** Whether to also consider diatonic seventh chords (default false). */
  includeSevenths?: boolean;
  /** Which harmonization flavour to produce (default "bestFit"). */
  style?: HarmonizationStyle;
  /**
   * Optional enharmonic speller for the active key. When provided, chord
   * symbols, note names, and explanations are spelled to match the key
   * (e.g. "A#" → "Bb" in D minor). When omitted, everything stays
   * sharp-canonical.
   */
  speller?: Speller;
};
