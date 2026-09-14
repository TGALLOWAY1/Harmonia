/**
 * Core Music Theory Types
 * 
 * Defines types for pitch classes, scales, and other music theory concepts.
 */

import type { PitchClass } from "./midiUtils";

export type ScaleType =
  | "major"
  | "natural_minor"
  | "dorian"
  | "mixolydian"
  | "phrygian"
  // Five-note scale. Everything that consumes a ScaleDefinition must therefore
  // read `pitchClasses.length` rather than assuming seven degrees.
  | "major_pentatonic";

export type ScaleDefinition = {
  root: PitchClass;
  type: ScaleType;
  pitchClasses: PitchClass[];
};

