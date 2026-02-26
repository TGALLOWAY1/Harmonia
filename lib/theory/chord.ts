/**
 * Chord Generation Functions
 * 
 * Provides functions to generate triads, seventh chords, and diatonic chord sets
 * based on scales and scale degrees.
 */

import type { PitchClass } from "./midiUtils";
import type { ScaleDefinition, ScaleType } from "./types";
import { getMajorScale, getNaturalMinorScale } from "./scale";

export type TriadQuality = "maj" | "min" | "dim" | "aug";

export type SeventhQuality = "maj7" | "min7" | "dom7" | "half-dim7" | "dim7";

// ChordQuality is defined later in this file with exhaustive coverage

export type Triad = {
  root: PitchClass;
  quality: TriadQuality;
  pitchClasses: PitchClass[]; // length 3
};

export type SeventhChord = {
  root: PitchClass;
  quality: SeventhQuality;
  pitchClasses: PitchClass[]; // length 4
};

export type RomanNumeral =
  | "I"
  | "ii"
  | "iii"
  | "IV"
  | "V"
  | "vi"
  | "vii°"
  | "i"
  | "ii°"
  | "III"
  | "iv"
  | "v"
  | "VI"
  | "VII";

export type DiatonicTriad = {
  degree: RomanNumeral;
  triad: Triad;
};

export type DiatonicSeventh = {
  degree: RomanNumeral;
  seventh: SeventhChord;
};

export type DiatonicChordSet = {
  keyRoot: PitchClass;
  keyType: ScaleType;
  triads: DiatonicTriad[];
  sevenths: DiatonicSeventh[];
};

const PITCH_CLASS_ORDER: PitchClass[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * Get a pitch class that is a given number of semitones above the root
 * @param root - Starting pitch class
 * @param semitones - Number of semitones to add (0-11)
 * @returns Pitch class that is semitones above root
 */
function addSemitones(root: PitchClass, semitones: number): PitchClass {
  const rootIndex = PITCH_CLASS_ORDER.indexOf(root);
  if (rootIndex === -1) {
    throw new Error(`Invalid pitch class: ${root}`);
  }
  const targetIndex = (rootIndex + semitones) % 12;
  return PITCH_CLASS_ORDER[targetIndex];
}

/**
 * Calculate the semitone interval between two pitch classes
 * @param from - Starting pitch class
 * @param to - Ending pitch class
 * @returns Number of semitones (0-11)
 */
function semitoneInterval(from: PitchClass, to: PitchClass): number {
  const fromIndex = PITCH_CLASS_ORDER.indexOf(from);
  const toIndex = PITCH_CLASS_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) {
    throw new Error(`Invalid pitch class: ${from} or ${to}`);
  }
  return (toIndex - fromIndex + 12) % 12;
}

/**
 * Determine triad quality based on intervals
 * @param root - Root pitch class
 * @param third - Third pitch class
 * @param fifth - Fifth pitch class
 * @returns TriadQuality
 */
function determineTriadQuality(
  root: PitchClass,
  third: PitchClass,
  fifth: PitchClass
): TriadQuality {
  const rootToThird = semitoneInterval(root, third);
  const thirdToFifth = semitoneInterval(third, fifth);

  // Major third = 4 semitones, minor third = 3 semitones
  const isMajorThird = rootToThird === 4;
  const isMinorThird = rootToThird === 3;
  const isMajorThirdAbove = thirdToFifth === 4;
  const isMinorThirdAbove = thirdToFifth === 3;

  if (isMajorThird && isMinorThirdAbove) {
    return "maj"; // Major triad: M3 + m3
  }
  if (isMinorThird && isMajorThirdAbove) {
    return "min"; // Minor triad: m3 + M3
  }
  if (isMinorThird && isMinorThirdAbove) {
    return "dim"; // Diminished triad: m3 + m3
  }
  if (isMajorThird && isMajorThirdAbove) {
    return "aug"; // Augmented triad: M3 + M3
  }

  // Fallback (shouldn't happen with diatonic chords)
  return "maj";
}

/**
 * Determine seventh chord quality based on intervals
 * @param root - Root pitch class
 * @param third - Third pitch class
 * @param fifth - Fifth pitch class
 * @param seventh - Seventh pitch class
 * @returns SeventhQuality
 */
function determineSeventhQuality(
  root: PitchClass,
  third: PitchClass,
  fifth: PitchClass,
  seventh: PitchClass
): SeventhQuality {
  const rootToThird = semitoneInterval(root, third);
  const thirdToFifth = semitoneInterval(third, fifth);
  const fifthToSeventh = semitoneInterval(fifth, seventh);

  // Check all three intervals together to determine quality
  // maj7: M3 + m3 + M3 (e.g., C E G B) -> 4, 3, 4
  if (rootToThird === 4 && thirdToFifth === 3 && fifthToSeventh === 4) {
    return "maj7";
  }

  // min7: m3 + M3 + m3 (e.g., C Eb G Bb) -> 3, 4, 3
  if (rootToThird === 3 && thirdToFifth === 4 && fifthToSeventh === 3) {
    return "min7";
  }

  // dom7: M3 + m3 + m3 (e.g., C E G Bb) -> 4, 3, 3
  if (rootToThird === 4 && thirdToFifth === 3 && fifthToSeventh === 3) {
    return "dom7";
  }

  // half-dim7: m3 + m3 + M3 (e.g., B D F A) -> 3, 3, 4
  if (rootToThird === 3 && thirdToFifth === 3 && fifthToSeventh === 4) {
    return "half-dim7";
  }

  // dim7: m3 + m3 + m3 (e.g., B D F Ab) -> 3, 3, 3
  if (rootToThird === 3 && thirdToFifth === 3 && fifthToSeventh === 3) {
    return "dim7";
  }

  // Fallback to min7 (most common in natural minor)
  return "min7";
}

/**
 * Build a triad from a scale using scale-degree stacking
 * @param scale - The scale definition
 * @param scaleDegreeIndex - 0-based scale degree (0 = I, 1 = ii, etc.)
 * @returns Triad with root, quality, and pitch classes
 */
export function buildTriadFromScale(
  scale: ScaleDefinition,
  scaleDegreeIndex: number
): Triad {
  if (scaleDegreeIndex < 0 || scaleDegreeIndex >= 7) {
    throw new Error(
      `Scale degree index must be between 0 and 6, got ${scaleDegreeIndex}`
    );
  }

  const root = scale.pitchClasses[scaleDegreeIndex];
  const third = scale.pitchClasses[(scaleDegreeIndex + 2) % 7];
  const fifth = scale.pitchClasses[(scaleDegreeIndex + 4) % 7];

  const quality = determineTriadQuality(root, third, fifth);

  return {
    root,
    quality,
    pitchClasses: [root, third, fifth],
  };
}

/**
 * Build a seventh chord from a scale using scale-degree stacking
 * @param scale - The scale definition
 * @param scaleDegreeIndex - 0-based scale degree (0 = I, 1 = ii, etc.)
 * @returns SeventhChord with root, quality, and pitch classes
 */
export function buildSeventhFromScale(
  scale: ScaleDefinition,
  scaleDegreeIndex: number
): SeventhChord {
  if (scaleDegreeIndex < 0 || scaleDegreeIndex >= 7) {
    throw new Error(
      `Scale degree index must be between 0 and 6, got ${scaleDegreeIndex}`
    );
  }

  const root = scale.pitchClasses[scaleDegreeIndex];
  const third = scale.pitchClasses[(scaleDegreeIndex + 2) % 7];
  const fifth = scale.pitchClasses[(scaleDegreeIndex + 4) % 7];
  const seventh = scale.pitchClasses[(scaleDegreeIndex + 6) % 7];

  const quality = determineSeventhQuality(root, third, fifth, seventh);

  return {
    root,
    quality,
    pitchClasses: [root, third, fifth, seventh],
  };
}

/**
 * Get Roman numeral for a scale degree in a given key
 * @param degreeIndex - 0-based scale degree
 * @param keyType - Type of key (major or natural_minor)
 * @returns Roman numeral string
 */
function getRomanNumeral(
  degreeIndex: number,
  keyType: ScaleType
): RomanNumeral {
  if (keyType === "major") {
    const majorNumerals: RomanNumeral[] = [
      "I",
      "ii",
      "iii",
      "IV",
      "V",
      "vi",
      "vii°",
    ];
    return majorNumerals[degreeIndex];
  } else {
    // natural_minor
    const minorNumerals: RomanNumeral[] = [
      "i",
      "ii°",
      "III",
      "iv",
      "v",
      "VI",
      "VII",
    ];
    return minorNumerals[degreeIndex];
  }
}

/**
 * Get all diatonic chords (triads and sevenths) for a given key
 * @param keyRoot - Root pitch class of the key
 * @param keyType - Type of key (major or natural_minor)
 * @returns DiatonicChordSet with triads and sevenths for all 7 scale degrees
 */
export function getDiatonicChords(
  keyRoot: PitchClass,
  keyType: ScaleType
): DiatonicChordSet {
  // Get the scale
  const scale =
    keyType === "major"
      ? getMajorScale(keyRoot)
      : getNaturalMinorScale(keyRoot);

  // Build triads and sevenths for each scale degree
  const triads: DiatonicTriad[] = [];
  const sevenths: DiatonicSeventh[] = [];

  for (let i = 0; i < 7; i++) {
    const degree = getRomanNumeral(i, keyType);
    const triad = buildTriadFromScale(scale, i);
    const seventh = buildSeventhFromScale(scale, i);

    triads.push({ degree, triad });
    sevenths.push({ degree, seventh });
  }

  return {
    keyRoot,
    keyType,
    triads,
    sevenths,
  };
}

export type ChordQuality =
  | TriadQuality
  | SeventhQuality
  | ""
  | "m"
  | "7"
  | "sus2"
  | "sus4"
  | "add9"
  | "m(add9)"
  | "maj(add9)";

/**
 * Build a triad or expanded chord directly from root and quality
 * @param root - Root pitch class
 * @param quality - Chord quality
 * @returns Object with root, quality, and pitch classes
 */
export function buildTriadFromRoot(
  root: PitchClass,
  quality: string
): any {
  let third: PitchClass;
  let fifth: PitchClass;
  let extra: PitchClass[] = [];

  // Normalize quality for internal switch
  let q = quality;
  if (q === "") q = "maj";
  if (q === "m") q = "min";

  switch (q) {
    case "maj":
    case "maj7":
    case "7":
    case "maj(add9)":
      third = addSemitones(root, 4);
      fifth = addSemitones(root, 7);
      if (q === "maj(add9)") extra.push(addSemitones(root, 2));
      break;
    case "min":
    case "m7":
    case "m(add9)":
      third = addSemitones(root, 3);
      fifth = addSemitones(root, 7);
      if (q === "m(add9)") extra.push(addSemitones(root, 2));
      break;
    case "dim":
      third = addSemitones(root, 3);
      fifth = addSemitones(root, 6);
      break;
    case "aug":
      third = addSemitones(root, 4);
      fifth = addSemitones(root, 8);
      break;
    case "sus2":
      third = addSemitones(root, 2);
      fifth = addSemitones(root, 7);
      break;
    case "sus4":
      third = addSemitones(root, 5);
      fifth = addSemitones(root, 7);
      break;
    case "add9":
      third = addSemitones(root, 4);
      fifth = addSemitones(root, 7);
      extra.push(addSemitones(root, 2));
      break;
    default:
      // Fallback to major triad
      third = addSemitones(root, 4);
      fifth = addSemitones(root, 7);
  }

  return {
    root,
    quality,
    pitchClasses: [root, third, fifth, ...extra],
  };
}

/**
 * Format a chord symbol from root and quality
 */
export function formatChordSymbol(
  root: PitchClass,
  quality: string
): string {
  switch (quality) {
    case "":
    case "maj":
      return root;
    case "m":
    case "min":
      return `${root}m`;
    case "maj7":
      return `${root}maj7`;
    case "m7":
      return `${root}m7`;
    case "7":
      return `${root}7`;
    case "dim":
      return `${root}°`;
    case "aug":
      return `${root}+`;
    case "half-dim7":
      return `${root}m7b5`;
    case "dim7":
      return `${root}°7`;
    case "sus2":
      return `${root}sus2`;
    case "sus4":
      return `${root}sus4`;
    case "add9":
      return `${root}add9`;
    case "m(add9)":
      return `${root}m(add9)`;
    case "maj(add9)":
      return `${root}maj(add9)`;
    default:
      return `${root}${quality}`; // Best effort
  }
}

