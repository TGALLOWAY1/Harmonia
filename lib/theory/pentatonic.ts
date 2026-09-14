/**
 * Major Pentatonic Harmony
 *
 * Harmonising a pentatonic scale is not the same problem as harmonising a
 * 7-note mode, so it gets its own vocabulary rather than being forced through
 * the tertian (stack-of-thirds) machinery in `chord.ts`.
 *
 * Why: the usual "stack every other scale degree" recipe assumes seven
 * degrees. Applied to five degrees it produces chords whose names don't match
 * their notes. And the familiar major-key chords don't survive either — in C
 * major pentatonic (C D E G A) there is no F and no B, so IV (F A C), V (G B D)
 * and iii (E G B) are all unavailable as ordinary triads.
 *
 * The rule this module enforces is simply: **every chord tone must be a note of
 * the scale**. Working that rule through for C major pentatonic leaves exactly
 * four usable chord roots:
 *
 * | Degree | Root | Available chords              | Why                       |
 * |--------|------|-------------------------------|---------------------------|
 * | I      | C    | C, C6, Cadd9, C6(9), Csus2    | full major triad in scale |
 * | II     | D    | Dsus4, D7sus4, Dsus2, D7sus2  | no F, so no 3rd → sus     |
 * | (III)  | E    | — none —                      | needs B for any 3rd/7th   |
 * | V      | G    | Gsus4, Gsus2                  | no B, so no 3rd → sus     |
 * | vi     | A    | Am, Am7, Asus4                | full minor triad in scale |
 *
 * That "missing" III is a real property of the scale, not an oversight: E has
 * no scale-mate a 3rd or 7th away, so it is used melodically but never as a
 * chord root.
 *
 * The result is the sus-and-6th sound pentatonic harmony actually has in folk,
 * gospel, and modal pop: no tritone, no leading tone, so motion between the
 * chords is colouristic rather than functional. Nothing here is chromatic, and
 * nothing is random — chord choice is a pure function of (degree, complexity).
 */

import { getChordPitchClasses } from "./chordSymbol";
import type { PitchClass } from "./midiUtils";
import { getScaleDefinition } from "./scale";
import type { ScaleDefinition } from "./types";

/**
 * Scale-degree indices (into a 5-note `ScaleDefinition`) that can carry a
 * chord. Index 2 (the 3rd degree) is deliberately absent — see the table above.
 */
export const PENTATONIC_CHORD_DEGREES = [0, 1, 3, 4] as const;

export type PentatonicChordDegree = (typeof PENTATONIC_CHORD_DEGREES)[number];

/**
 * Roman numerals for the chord-bearing degrees. Case follows the chord it
 * carries: `vi` is minor, `I` is major, and the sus degrees (`II`, `V`) have no
 * third at all, so they are written upper-case by convention.
 */
const DEGREE_LABELS: Record<PentatonicChordDegree, string> = {
  0: "I",
  1: "II",
  3: "V",
  4: "vi",
};

/** Complexity dial shared with the advanced generator (1 = plain, 4 = most colour). */
export type PentatonicComplexity = 1 | 2 | 3 | 4;

/**
 * Chord symbol suffix chosen for each degree at each complexity level.
 *
 * Higher complexity adds scale tones (a 6th, a 9th, a sus 7th) rather than
 * chromatic tension, because there is no chromatic tension available: every
 * suffix below resolves to pitch classes that are already in the scale.
 */
const DEGREE_SUFFIX_BY_COMPLEXITY: Record<
  PentatonicChordDegree,
  Record<PentatonicComplexity, string>
> = {
  // I: the only degree with a complete major triad.        C / C6 / Cadd9 / C6(9)
  0: { 1: "", 2: "6", 3: "add9", 4: "6(9)" },
  // II: no 3rd available (needs the missing 4th degree).   Dsus4 / D7sus4 / D7sus2
  1: { 1: "sus4", 2: "7sus4", 3: "7sus4", 4: "7sus2" },
  // V: no 3rd available (needs the missing 7th degree).    Gsus4 / Gsus2
  3: { 1: "sus4", 2: "sus2", 3: "sus2", 4: "sus2" },
  // vi: the only degree with a complete minor triad.       Am / Am7
  4: { 1: "m", 2: "m7", 3: "m7", 4: "m7" },
};

/**
 * Every chord that fits the scale on each degree, richest-sounding first.
 * Used to offer alternatives (substitutions, chord palettes) rather than to
 * generate progressions.
 */
const DEGREE_VARIANT_SUFFIXES: Record<PentatonicChordDegree, string[]> = {
  0: ["", "6", "add9", "6(9)", "sus2"],
  1: ["sus4", "7sus4", "sus2", "7sus2"],
  3: ["sus4", "sus2"],
  4: ["m", "m7", "sus4"],
};

/**
 * Chord-quality token matching the suffix, for consumers that store quality
 * separately from the symbol (the `Chord` type, substitution options).
 */
const SUFFIX_TO_QUALITY: Record<string, string> = {
  "": "maj",
  "6": "6",
  add9: "add9",
  "6(9)": "6(9)",
  sus2: "sus2",
  sus4: "sus4",
  "7sus2": "7sus2",
  "7sus4": "7sus4",
  m: "min",
  m7: "min7",
};

export type PentatonicChord = {
  /** Index into the 5-note scale's `pitchClasses`. */
  degreeIndex: PentatonicChordDegree;
  /** Roman numeral, e.g. "I", "II", "V", "vi". */
  degreeLabel: string;
  /** Chord symbol, e.g. "C6(9)", "Dsus4", "Am7". */
  symbol: string;
  root: PitchClass;
  quality: string;
  /** Pitch classes implied by `symbol` — always a subset of the scale. */
  pitchClasses: PitchClass[];
};

function buildChord(
  scale: ScaleDefinition,
  degreeIndex: PentatonicChordDegree,
  suffix: string
): PentatonicChord {
  const root = scale.pitchClasses[degreeIndex] ?? scale.pitchClasses[0];
  const symbol = `${root}${suffix}`;

  return {
    degreeIndex,
    degreeLabel: DEGREE_LABELS[degreeIndex],
    symbol,
    root,
    quality: SUFFIX_TO_QUALITY[suffix] ?? suffix,
    // `getChordPitchClasses` is the project's single source of truth for
    // symbol -> notes, so the symbol and the notes can never drift apart.
    pitchClasses: getChordPitchClasses(symbol),
  };
}

/**
 * The chord for one pentatonic degree at a given complexity.
 * @example getPentatonicChord(getMajorPentatonicScale("C"), 1, 2) -> D7sus4 (D G A C)
 */
export function getPentatonicChord(
  scale: ScaleDefinition,
  degreeIndex: PentatonicChordDegree,
  complexity: PentatonicComplexity
): PentatonicChord {
  const suffix = DEGREE_SUFFIX_BY_COMPLEXITY[degreeIndex][complexity];
  return buildChord(scale, degreeIndex, suffix);
}

/**
 * Every scale-safe chord available on one pentatonic degree.
 * @example getPentatonicChordVariants(getMajorPentatonicScale("C"), 4) -> Am, Am7, Asus4
 */
export function getPentatonicChordVariants(
  scale: ScaleDefinition,
  degreeIndex: PentatonicChordDegree
): PentatonicChord[] {
  return DEGREE_VARIANT_SUFFIXES[degreeIndex].map((suffix) =>
    buildChord(scale, degreeIndex, suffix)
  );
}

/**
 * The full chord palette for a major pentatonic key — one chord per usable
 * degree, in scale order (I, II, V, vi).
 */
export function getMajorPentatonicChords(
  keyRoot: PitchClass,
  complexity: PentatonicComplexity = 2
): PentatonicChord[] {
  const scale = getScaleDefinition(keyRoot, "major_pentatonic");
  return PENTATONIC_CHORD_DEGREES.map((degree) =>
    getPentatonicChord(scale, degree, complexity)
  );
}

/** Every scale-safe chord in the key, across all degrees and variants. */
export function getAllMajorPentatonicChords(keyRoot: PitchClass): PentatonicChord[] {
  const scale = getScaleDefinition(keyRoot, "major_pentatonic");
  return PENTATONIC_CHORD_DEGREES.flatMap((degree) =>
    getPentatonicChordVariants(scale, degree)
  );
}

/** True when `degreeIndex` is a degree that can carry a chord (i.e. not the 3rd). */
export function isPentatonicChordDegree(
  degreeIndex: number
): degreeIndex is PentatonicChordDegree {
  return (PENTATONIC_CHORD_DEGREES as readonly number[]).includes(degreeIndex);
}

/**
 * Progression templates, as degree indices into the 5-note scale.
 *
 * Pentatonic harmony has no dominant, so these lean on the I–vi pull (the two
 * complete triads) and use II/V as colour in between, the way a folk or gospel
 * vamp does. Every template opens or closes on a tonic-family chord so the
 * phrase still has a shape.
 */
export const MAJOR_PENTATONIC_TEMPLATES: number[][] = [
  [0, 3, 4, 0], // I - V - vi - I
  [0, 4, 3, 0], // I - vi - V - I
  [0, 4, 1, 3], // I - vi - II - V
  [0, 1, 3, 0], // I - II - V - I
  [0, 3, 1, 4], // I - V - II - vi
  [4, 0, 3, 0], // vi - I - V - I
  [0, 4, 0, 3], // I - vi - I - V
  [0, 1, 4, 3], // I - II - vi - V
  [4, 1, 0, 3], // vi - II - I - V
  [0, 3, 0, 4], // I - V - I - vi
  [4, 3, 4, 0], // vi - V - vi - I
  [0, 4, 3, 1], // I - vi - V - II
];
