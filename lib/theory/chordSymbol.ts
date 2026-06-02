/**
 * Chord Symbol → Pitch Classes (single source of truth)
 *
 * `getChordPitchClasses` is the canonical converter from a chord *symbol*
 * (e.g. "D7", "Cmaj7", "Bbmin7", "F#dim7", "G7b9") into the set of pitch
 * classes the symbol implies. Every downstream system that needs to know which
 * notes are valid for a chord should derive them here rather than from fragile
 * scale-degree assumptions.
 *
 * The engine uses sharp-only, enharmonically-correct pitch classes
 * (Bb -> A#, Eb -> D#), consistent with the rest of `lib/theory`.
 */

import { PITCH_CLASSES, type PitchClass } from "./midiUtils";

// ---------------------------------------------------------------------------
// Root normalization (shared flat -> sharp mapping)
// ---------------------------------------------------------------------------

const FLAT_TO_SHARP: Record<string, PitchClass> = {
  Db: "C#",
  Eb: "D#",
  Fb: "E",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
};

/**
 * Normalize a root note string (A-G with optional # or b) to a sharp-only
 * PitchClass. Returns null if the string is not a valid note name.
 */
export function normalizeRoot(input: string): PitchClass | null {
  const match = input.trim().match(/^([A-Ga-g])(#|b)?/);
  if (!match) return null;

  let root = match[1].toUpperCase();
  if (match[2] === "#") {
    root += "#";
  } else if (match[2] === "b") {
    root = FLAT_TO_SHARP[root + "b"] ?? root;
  }

  return PITCH_CLASSES.includes(root as PitchClass) ? (root as PitchClass) : null;
}

// ---------------------------------------------------------------------------
// Quality -> interval (semitone) sets, measured from the root
// ---------------------------------------------------------------------------

/**
 * Interval sets for every supported chord quality. Intervals are semitones
 * above the root. The keys are *normalized* quality tokens (see
 * `normalizeQuality`).
 *
 * `7alt` returns a superset of the common dominant alterations so that any
 * single altered tone the generator picks (b9/#9/b5/#5) is still a subset.
 */
const QUALITY_INTERVALS: Record<string, number[]> = {
  // Triads
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  "7sus2": [0, 2, 7, 10],

  // Sixths
  "6": [0, 4, 7, 9],
  min6: [0, 3, 7, 9],

  // Sevenths
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10], // half-diminished
  dim7: [0, 3, 6, 9],

  // Ninths
  "9": [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  min9: [0, 3, 7, 10, 2],

  // Add chords
  add9: [0, 4, 7, 2],

  // Altered dominants
  "7b9": [0, 4, 7, 10, 1],
  "7#9": [0, 4, 7, 10, 3],
  "7b5": [0, 4, 6, 10],
  "7#5": [0, 4, 8, 10],
  // Superset of tones the generator can place on an altered dominant:
  // root, 3rd, 5th, b7, b9/9/#9, b5/#5, b13/13. Deliberately excludes the
  // major 7th (11) so a stray maj7 on a dominant is still flagged as invalid.
  "7alt": [0, 4, 7, 10, 1, 2, 3, 6, 8, 9],
};

/**
 * Maps a raw quality token (exact string) to a canonical QUALITY_INTERVALS key.
 * Exact matching avoids the substring pitfalls of regex normalization (e.g.
 * "m7" must NOT be read as "M7"/maj7, and "dim7" contains a literal "m7").
 *
 * The capitalisation of `m` vs `M` is significant: lowercase = minor.
 */
const QUALITY_SYNONYMS: Record<string, string> = {
  "": "maj",
  M: "maj",
  maj: "maj",
  major: "maj",
  Δ: "maj7",
  "Δ7": "maj7",
  M7: "maj7",
  maj7: "maj7",
  maj9: "maj9",

  m: "min",
  min: "min",
  minor: "min",
  "-": "min",
  m6: "min6",
  min6: "min6",
  m7: "min7",
  min7: "min7",
  "-7": "min7",
  m9: "min9",
  min9: "min9",

  m7b5: "m7b5",
  "ø": "m7b5",
  "ø7": "m7b5",
  halfdim: "m7b5",
  "half-dim": "m7b5",
  "half-dim7": "m7b5",

  dim: "dim",
  "°": "dim",
  o: "dim",
  dim7: "dim7",
  "°7": "dim7",
  o7: "dim7",

  aug: "aug",
  "+": "aug",

  "7": "7",
  dom7: "7",
  "6": "6",
  "9": "9",
  add9: "add9",

  "7b9": "7b9",
  "7#9": "7#9",
  "7b5": "7b5",
  "7#5": "7#5",
  "7alt": "7alt",

  sus2: "sus2",
  sus4: "sus4",
  sus: "sus4",
  "7sus4": "7sus4",
  "7sus2": "7sus2",
};

/**
 * Normalize a raw quality string (the remainder after the root) into a key of
 * QUALITY_INTERVALS. Tolerant of common notation synonyms and the internal
 * symbol forms the generator emits (°, +, trailing (9)/(13)).
 *
 * Returns null when the quality is unrecognized.
 */
function normalizeQuality(raw: string): { quality: string; addNinth: boolean; addThirteenth: boolean } | null {
  // Strip trailing extension annotations the generator appends, e.g. "7(9)",
  // "maj7(13)". These add tones on top of the base quality.
  let addNinth = false;
  let addThirteenth = false;
  const q = raw
    .trim()
    .replace(/\((9|13)\)/g, (_, n) => {
      if (n === "9") addNinth = true;
      if (n === "13") addThirteenth = true;
      return "";
    });

  const quality = QUALITY_SYNONYMS[q] ?? q;
  if (!(quality in QUALITY_INTERVALS)) return null;
  return { quality, addNinth, addThirteenth };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function pitchClassFromRoot(root: PitchClass, semitones: number): PitchClass {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  return PITCH_CLASSES[(rootIndex + ((semitones % 12) + 12)) % 12];
}

/**
 * Convert a chord symbol into its set of pitch classes (sharp-only,
 * enharmonically correct), ordered low-to-high by interval from the root.
 *
 * Returns an empty array when the symbol cannot be parsed — callers should
 * treat that as "skip validation" rather than "no notes", to avoid false
 * fallbacks on exotic symbols.
 *
 * @example getChordPitchClasses("D7")     -> ["D", "F#", "A", "C"]
 * @example getChordPitchClasses("Cmaj7")  -> ["C", "E", "G", "B"]
 * @example getChordPitchClasses("Bbmin7") -> ["A#", "C#", "F", "G#"]
 */
export function getChordPitchClasses(symbol: string): PitchClass[] {
  if (!symbol) return [];
  const trimmed = symbol.trim();

  const root = normalizeRoot(trimmed);
  if (!root) return [];

  // Remove the matched root (note letter + optional accidental) to get quality.
  const rootMatch = trimmed.match(/^([A-Ga-g])(#|b)?/);
  const remainder = rootMatch ? trimmed.slice(rootMatch[0].length) : "";

  const parsed = normalizeQuality(remainder);
  if (!parsed) return [];

  const intervals = [...QUALITY_INTERVALS[parsed.quality]];
  if (parsed.addNinth) intervals.push(2);
  if (parsed.addThirteenth) intervals.push(9);

  // De-duplicate preserving authored chord order (root, 3rd, 5th, 7th, then
  // upper extensions/alterations) and map to pitch classes.
  const seen = new Set<number>();
  const result: PitchClass[] = [];
  for (const raw of intervals) {
    const interval = ((raw % 12) + 12) % 12;
    if (seen.has(interval)) continue;
    seen.add(interval);
    result.push(pitchClassFromRoot(root, interval));
  }
  return result;
}

/**
 * Convenience: the pitch class of a single MIDI note (mod 12).
 * Re-exported here so validation sites have a one-stop import.
 */
export function toPitchClass(midi: number): PitchClass {
  return PITCH_CLASSES[((midi % 12) + 12) % 12];
}
