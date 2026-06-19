/**
 * Melody → chord harmonization engine.
 *
 * Public entry point: `harmonizeMelody` turns a drawn melody plus a key/scale
 * into a deterministic, explainable diatonic chord progression.
 */

export {
  harmonizeMelody,
  buildDiatonicCandidates,
  splitMelodyIntoRegions,
  noteImportanceWeight,
  scoreChordForRegion,
  scoreChordTransition,
  isScalePitchClass,
  snapMidiToScale,
} from "./harmonizeMelody";

export type {
  HarmonizationStyle,
  ChordCandidate,
  HarmonizedRegion,
  HarmonizationResult,
  HarmonizeOptions,
} from "./types";
