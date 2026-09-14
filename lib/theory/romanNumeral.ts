import { buildTriadFromScale, type TriadQuality } from "./chord";
import { PITCH_CLASSES } from "./midiUtils";
import type { ScaleDefinition } from "./types";

/** Semitone offsets of the major scale, used as the reference for accidentals. */
const MAJOR_REFERENCE = [0, 2, 4, 5, 7, 9, 11];

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

/** Semitones from the scale's tonic up to the pitch class at `degreeIndex`. */
function semitonesFromTonic(scale: ScaleDefinition, degreeIndex: number): number {
  const tonic = PITCH_CLASSES.indexOf(scale.pitchClasses[0]);
  const degree = PITCH_CLASSES.indexOf(scale.pitchClasses[degreeIndex]);
  return (degree - tonic + 12) % 12;
}

/**
 * Accidental prefix for a degree, relative to where the major scale puts it.
 *
 * Mixolydian's 7th sits a semitone below the major 7th, so it reads "bVII";
 * Lydian's 4th would sit a semitone above and read "#IV".
 */
function accidentalFor(actual: number, reference: number): string {
  const delta = ((actual - reference + 18) % 12) - 6; // signed, in [-6, 5]
  if (delta === 0) return "";
  if (delta < 0) return "b".repeat(Math.min(2, -delta));
  return "#".repeat(Math.min(2, delta));
}

/** Case and suffix the numeral according to the triad built on that degree. */
function styleNumeral(numeral: string, quality: TriadQuality): string {
  switch (quality) {
    case "maj":
      return numeral;
    case "aug":
      return `${numeral}+`;
    case "dim":
      return `${numeral.toLowerCase()}°`;
    case "min":
    default:
      return numeral.toLowerCase();
  }
}

/**
 * Derive roman numerals from a scale's own pitch classes rather than from a
 * fixed major/minor table.
 *
 * Two hardcoded tables cannot describe five heptatonic modes: dorian's
 * characteristic major IV and phrygian's bII both come out wrong, so the label
 * ends up describing a different chord than the one that sounds. Reading the
 * scale keeps the label and the symbol in agreement for every mode.
 *
 * Returns an empty array for scales that do not stack thirds (pentatonic) —
 * those carry their own labels in `lib/theory/pentatonic.ts`.
 */
export function romanNumeralsForScale(scale: ScaleDefinition): string[] {
  if (scale.pitchClasses.length !== 7) return [];

  return scale.pitchClasses.map((_, degreeIndex) => {
    const actual = semitonesFromTonic(scale, degreeIndex);
    const prefix = accidentalFor(actual, MAJOR_REFERENCE[degreeIndex]);
    const { quality } = buildTriadFromScale(scale, degreeIndex);
    return `${prefix}${styleNumeral(NUMERALS[degreeIndex], quality)}`;
  });
}
