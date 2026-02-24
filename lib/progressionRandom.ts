/**
 * Simple random chord progression generator.
 * Picks 4 chords at random from the diatonic triads (I, ii, iii, IV, V, vi, vii°).
 * No mood or complexity parameters—just random diatonic selection.
 */

import type { PitchClass, ScaleType } from "./theory";
import { getScaleDefinition } from "./theory/scale";
import { buildTriadFromScale } from "./theory/chord";
import type { TriadQuality } from "./theory/chord";

/** Roman numeral for each scale degree by mode */
const DEGREE_TO_ROMAN: Record<ScaleType, string[]> = {
  major: ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
  natural_minor: ["i", "ii°", "III", "iv", "v", "VI", "VII"],
  dorian: ["i", "ii", "III", "IV", "v", "vi°", "VII"],
  mixolydian: ["I", "ii", "iii°", "IV", "v", "vi", "VII"],
  phrygian: ["i", "II", "III", "iv", "v°", "VI", "vii"],
};

function qualityToSuffix(q: TriadQuality): string {
  switch (q) {
    case "maj":
      return "";
    case "min":
      return "m";
    case "dim":
      return "dim";
    case "aug":
      return "aug";
    default:
      return "";
  }
}

/** Simple closed voicing: root at octave 3, third and fifth at 4 */
function pitchClassesToNotesWithOctave(pitchClasses: PitchClass[]): string[] {
  if (pitchClasses.length === 0) return [];
  return [
    pitchClasses[0] + "3",
    pitchClasses[1] + "4",
    pitchClasses[2] + "4",
  ];
}

export type ProgressionChord = {
  degree: string;
  symbol: string;
  quality: string;
  notes: PitchClass[];
  notesWithOctave: string[];
};

/**
 * Generate a random 4-chord progression from diatonic triads.
 */
export function generateRandomProgression(
  root: PitchClass,
  scaleType: ScaleType
): ProgressionChord[] {
  const scale = getScaleDefinition(root, scaleType);
  const romans = DEGREE_TO_ROMAN[scaleType];
  const result: ProgressionChord[] = [];

  for (let i = 0; i < 4; i++) {
    const degreeIndex = Math.floor(Math.random() * 7);
    const triad = buildTriadFromScale(scale, degreeIndex);
    const degree = romans[degreeIndex];
    const suffix = qualityToSuffix(triad.quality);
    const symbol = triad.root + suffix;

    result.push({
      degree,
      symbol,
      quality: triad.quality,
      notes: triad.pitchClasses,
      notesWithOctave: pitchClassesToNotesWithOctave(triad.pitchClasses),
    });
  }

  return result;
}
