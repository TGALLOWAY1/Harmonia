/**
 * Scale Generation Functions
 *
 * Provides functions to generate heptatonic (7-note) scales and modes as well
 * as the 5-note major pentatonic scale, based on a root pitch class.
 *
 * Scales are described by their step pattern (semitones between consecutive
 * degrees, summing to 12). The number of degrees therefore falls out of the
 * pattern length, so callers must never assume a ScaleDefinition has 7
 * pitch classes — `major_pentatonic` has 5.
 */

import type { PitchClass } from "./midiUtils";
import type { ScaleDefinition, ScaleType } from "./types";

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

// Scale intervals in semitones
const MAJOR_INTERVALS = [2, 2, 1, 2, 2, 2, 1]; // W-W-H-W-W-W-H
const NATURAL_MINOR_INTERVALS = [2, 1, 2, 2, 1, 2, 2]; // W-H-W-W-H-W-W
const DORIAN_INTERVALS = [2, 1, 2, 2, 2, 1, 2]; // W-H-W-W-W-H-W
const MIXOLYDIAN_INTERVALS = [2, 2, 1, 2, 2, 1, 2]; // W-W-H-W-W-H-W
const PHRYGIAN_INTERVALS = [1, 2, 2, 2, 1, 2, 2]; // H-W-W-W-H-W-W
// Major pentatonic = major scale with the 4th and 7th (the two half steps)
// removed: 1-2-3-5-6. Dropping them is what makes it "unable to sound wrong" —
// there is no tritone and no leading tone anywhere in the scale.
const MAJOR_PENTATONIC_INTERVALS = [2, 2, 3, 2, 3]; // W-W-m3-W-m3

/**
 * Rotate pitch classes starting from a given root
 * Returns 12 pitch classes in order, wrapping around
 * @param start - The starting pitch class
 * @returns Array of 12 pitch classes starting from `start`
 */
function rotatePitchClasses(start: PitchClass): PitchClass[] {
  const startIndex = PITCH_CLASS_ORDER.indexOf(start);
  if (startIndex === -1) {
    throw new Error(`Invalid pitch class: ${start}`);
  }

  const rotated: PitchClass[] = [];
  for (let i = 0; i < 12; i++) {
    const index = (startIndex + i) % 12;
    rotated.push(PITCH_CLASS_ORDER[index]);
  }
  return rotated;
}

/**
 * Get a scale definition for a given root and scale type
 * @param root - The root pitch class of the scale
 * @param type - The type of scale, e.g. "major", "natural_minor", "major_pentatonic"
 * @returns ScaleDefinition with root, type, and ordered pitch classes. The
 *          length matches the scale (7 for the modes, 5 for major pentatonic).
 * @example getScaleDefinition("C", "major") -> { root: "C", type: "major", pitchClasses: ["C", "D", "E", "F", "G", "A", "B"] }
 * @example getScaleDefinition("A", "natural_minor") -> { root: "A", type: "natural_minor", pitchClasses: ["A", "B", "C", "D", "E", "F", "G"] }
 * @example getScaleDefinition("C", "major_pentatonic") -> { root: "C", type: "major_pentatonic", pitchClasses: ["C", "D", "E", "G", "A"] }
 */
export function getScaleDefinition(
  root: PitchClass,
  type: ScaleType
): ScaleDefinition {
  // Choose the interval set based on scale type
  let intervals: number[];
  switch (type) {
    case "major":
      intervals = MAJOR_INTERVALS;
      break;
    case "natural_minor":
      intervals = NATURAL_MINOR_INTERVALS;
      break;
    case "dorian":
      intervals = DORIAN_INTERVALS;
      break;
    case "mixolydian":
      intervals = MIXOLYDIAN_INTERVALS;
      break;
    case "phrygian":
      intervals = PHRYGIAN_INTERVALS;
      break;
    case "major_pentatonic":
      intervals = MAJOR_PENTATONIC_INTERVALS;
      break;
    default:
      throw new Error(`Unsupported scale type: ${type}`);
  }

  // Get rotated pitch classes starting from root
  const rotatedPitchClasses = rotatePitchClasses(root);

  // Build the scale by walking through intervals. The final interval closes the
  // octave back onto the root, so we walk all but the last one; an N-step
  // pattern therefore yields N unique pitch classes.
  const pitchClasses: PitchClass[] = [root]; // Start with root
  let currentIndex = 0;

  for (let i = 0; i < intervals.length - 1; i++) {
    currentIndex = (currentIndex + intervals[i]) % 12;
    pitchClasses.push(rotatedPitchClasses[currentIndex]);
  }

  return {
    root,
    type,
    pitchClasses,
  };
}

/**
 * Get a major scale definition
 * @param root - The root pitch class of the major scale
 * @returns ScaleDefinition for the major scale
 * @example getMajorScale("C") -> { root: "C", type: "major", pitchClasses: ["C", "D", "E", "F", "G", "A", "B"] }
 */
export function getMajorScale(root: PitchClass): ScaleDefinition {
  return getScaleDefinition(root, "major");
}

/**
 * Get a natural minor scale definition
 * @param root - The root pitch class of the natural minor scale
 * @returns ScaleDefinition for the natural minor scale
 * @example getNaturalMinorScale("A") -> { root: "A", type: "natural_minor", pitchClasses: ["A", "B", "C", "D", "E", "F", "G"] }
 */
export function getNaturalMinorScale(root: PitchClass): ScaleDefinition {
  return getScaleDefinition(root, "natural_minor");
}

/**
 * Get a Dorian mode scale definition
 * Dorian is the second mode of the major scale: W-H-W-W-W-H-W
 * @param root - The root pitch class of the Dorian scale
 * @returns ScaleDefinition for the Dorian scale
 * @example getDorianScale("D") -> { root: "D", type: "dorian", pitchClasses: ["D", "E", "F", "G", "A", "B", "C"] }
 */
export function getDorianScale(root: PitchClass): ScaleDefinition {
  return getScaleDefinition(root, "dorian");
}

/**
 * Get a Mixolydian mode scale definition
 * Mixolydian is the fifth mode of the major scale: W-W-H-W-W-H-W
 * @param root - The root pitch class of the Mixolydian scale
 * @returns ScaleDefinition for the Mixolydian scale
 * @example getMixolydianScale("G") -> { root: "G", type: "mixolydian", pitchClasses: ["G", "A", "B", "C", "D", "E", "F"] }
 */
export function getMixolydianScale(root: PitchClass): ScaleDefinition {
  return getScaleDefinition(root, "mixolydian");
}

/**
 * Get a Phrygian mode scale definition
 * Phrygian is the third mode of the major scale: H-W-W-W-H-W-W
 * @param root - The root pitch class of the Phrygian scale
 * @returns ScaleDefinition for the Phrygian scale
 * @example getPhrygianScale("E") -> { root: "E", type: "phrygian", pitchClasses: ["E", "F", "G", "A", "B", "C", "D"] }
 */
export function getPhrygianScale(root: PitchClass): ScaleDefinition {
  return getScaleDefinition(root, "phrygian");
}

/**
 * Get a major pentatonic scale definition
 * Major pentatonic is the major scale without its 4th and 7th degrees: 1-2-3-5-6
 * @param root - The root pitch class of the major pentatonic scale
 * @returns ScaleDefinition for the major pentatonic scale (5 pitch classes)
 * @example getMajorPentatonicScale("C") -> { root: "C", type: "major_pentatonic", pitchClasses: ["C", "D", "E", "G", "A"] }
 */
export function getMajorPentatonicScale(root: PitchClass): ScaleDefinition {
  return getScaleDefinition(root, "major_pentatonic");
}
