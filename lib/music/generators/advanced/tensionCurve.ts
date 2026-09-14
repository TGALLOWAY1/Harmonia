import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";

import { getTensionCurve } from "./phraseStructure";
import type { HarmonicFunction, PlannedAdvancedChord, TensionShape } from "./types";

/**
 * Target-tension curves — the spine of the planner.
 *
 * Every other stage reads the same per-slot target: which chord goes in a
 * slot, how rich it may become, how thickly it is voiced and how it is scored
 * are all decided against it. Before this, the curve only gated extensions
 * and nothing checked whether the chords chosen actually followed it.
 *
 * Shapes and the per-chord tension formula follow Herremans & Chew (MorpheuS)
 * as summarised in CHORD_PROGRESSION_ASSESSMENT.md §5.2.
 */

export const TENSION_SHAPES: TensionShape[] = [
  "phrase",
  "arch",
  "ramp",
  "question",
  "plateau",
  "collapse",
];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Target tension per slot for a named shape.
 *
 * - `phrase`   classical arch peaking on the dominant slot (length-keyed table)
 * - `arch`     depart, peak in the middle, return
 * - `ramp`     relentless build; pairs naturally with an open ending
 * - `question` antecedent rising to a half cadence, consequent closing fully
 * - `plateau`  stillness, then one surge before the close
 * - `collapse` start at maximum tension and decay to rest
 */
export function tensionCurveFor(shape: TensionShape, numChords: number): number[] {
  if (numChords <= 0) return [];
  if (numChords === 1) return [0];
  const last = numChords - 1;

  switch (shape) {
    case "phrase":
      return getTensionCurve(numChords);

    case "arch":
      if (numChords === 2) return [0.6, 0];
      return Array.from({ length: numChords }, (_, i) => 0.9 * Math.sin((Math.PI * i) / last));

    case "ramp":
      return Array.from({ length: numChords }, (_, i) => (0.9 * i) / last);

    case "question": {
      const half = Math.ceil(numChords / 2);
      const rest = numChords - half;
      // Antecedent: rise to the half cadence.
      const antecedent =
        half === 1
          ? [0.6]
          : Array.from({ length: half }, (_, i) => 0.1 + (0.5 * i) / (half - 1));
      // Consequent: re-depart, build harder, and close.
      let consequent: number[];
      if (rest <= 0) consequent = [];
      else if (rest === 1) consequent = [0];
      else if (rest === 2) consequent = [0.85, 0];
      else {
        consequent = Array.from({ length: rest - 1 }, (_, j) => 0.3 + (0.55 * j) / (rest - 2));
        consequent.push(0);
      }
      return [...antecedent, ...consequent];
    }

    case "plateau":
      return Array.from({ length: numChords }, (_, i) => {
        if (i === last) return 0;
        if (i === last - 1) return 0.9;
        return 0.2;
      });

    case "collapse":
      return Array.from({ length: numChords }, (_, i) => 0.9 * (1 - i / last));

    default:
      return getTensionCurve(numChords);
  }
}

// ---------------------------------------------------------------------------
// Per-chord tension
// ---------------------------------------------------------------------------

/** Functional tension by harmonic function. */
export const FUNCTIONAL_TENSION: Record<HarmonicFunction, number> = {
  tonic: 0.0,
  mediant: 0.25,
  predominant: 0.5,
  dominant: 0.85,
  applied: 0.95,
  // Remote chromatic harmony (Neapolitan, chromatic mediants, hexatonic pole)
  // is colour before it is pull: tense, but not a dominant.
  chromatic: 0.9,
};

/**
 * The formula reaches 1.0 only for a fully chromatic, dissonant, inverted
 * remote chord arriving by leap; a root-position diatonic V7 realises about
 * 0.55. Curve targets are written on the conventional 0..1 scale (0.8-0.9 at
 * the peak), so they are multiplied by this before being compared with a
 * chord's realised tension.
 */
export const TENSION_TARGET_SCALE = 0.7;

const WEIGHTS = {
  functional: 0.4,
  chromaticism: 0.2,
  dissonance: 0.15,
  inversion: 0.1,
  voiceLeading: 0.15,
} as const;

/** Tension a chord carries by function alone. */
export function functionalTension(chord: PlannedAdvancedChord): number {
  const tag = harmonicFunctionOf(chord);
  const base = FUNCTIONAL_TENSION[tag];
  // A dominant-function chord without a leading tone (modal v, bVII) pulls
  // less hard than a true dominant.
  if (tag === "dominant" && !chord.isDominant) return 0.6;
  return base;
}

/** Infer the harmonic function of a chord the planner did not tag. */
export function harmonicFunctionOf(chord: PlannedAdvancedChord): HarmonicFunction {
  if (chord.functionTag) return chord.functionTag;
  switch (chord.kind) {
    case "secondary-dominant":
    case "tritone-substitution":
      return "applied";
    case "passing":
    case "suspension":
      return "dominant";
    case "borrowed":
      return "chromatic";
    default:
      break;
  }
  if (chord.degreeIndex !== undefined) {
    switch (chord.degreeIndex) {
      case 0: return "tonic";
      case 2:
      case 5: return "mediant";
      case 1:
      case 3: return "predominant";
      default: return "dominant";
    }
  }
  if (chord.isDominant) return "dominant";
  const label = chord.degreeLabel.replace(/[°+#b]/g, "").toLowerCase();
  if (label === "i") return "tonic";
  if (label === "iii" || label === "vi") return "mediant";
  if (label === "ii" || label === "iv") return "predominant";
  return "dominant";
}

/** Fraction of the chord's pitch classes that lie outside the home scale. */
export function chromaticism(chord: PlannedAdvancedChord, scalePitchClasses: PitchClass[]): number {
  if (chord.pitchClasses.length === 0) return 0;
  const inScale = new Set(scalePitchClasses);
  const outside = chord.pitchClasses.filter((pc) => !inScale.has(pc)).length;
  return outside / chord.pitchClasses.length;
}

function intervalsFromRoot(chord: PlannedAdvancedChord): number[] {
  const rootIndex = PITCH_CLASSES.indexOf(chord.root);
  return chord.pitchClasses.map((pc) => (PITCH_CLASSES.indexOf(pc) - rootIndex + 12) % 12);
}

/**
 * Sonic dissonance from the chord's own construction: tones beyond the triad,
 * a tritone anywhere in the chord, and altered tones.
 */
export function dissonance(chord: PlannedAdvancedChord): number {
  const intervals = intervalsFromRoot(chord);
  const set = new Set(intervals);
  let score = 0.25 * Math.max(0, intervals.length - 3);

  // Any tritone between two chord tones.
  if (intervals.some((a) => set.has((a + 6) % 12))) score += 0.2;

  // Alterations: b9, b13/#5, #9 against a major third, #11 against a fifth.
  const hasAlteration =
    set.has(1) || set.has(8) || (set.has(3) && set.has(4)) || (set.has(6) && set.has(7));
  if (hasAlteration) score += 0.2;

  return clamp01(score);
}

/** How unstable an inversion sounds. Second inversion is the least stable. */
export function inversionInstability(inversion: number | undefined): number {
  switch (inversion) {
    case 0: return 0;
    case 1: return 0.35;
    case 2: return 0.75;
    case 3: return 0.6;
    default: return inversion === undefined ? 0 : 0.5;
  }
}

/** Normalised voice-leading distance into a voicing (0 = every voice held). */
export function voiceLeadingDistance(previous: number[] | null | undefined, next: number[]): number {
  if (!previous || previous.length === 0 || next.length === 0) return 0;
  const a = [...previous].sort((x, y) => x - y);
  const b = [...next].sort((x, y) => x - y);
  const count = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.abs(a[i] - b[i]);
  // Four semitones per voice is already a lot of motion for a chord change.
  return clamp01(total / (count * 4));
}

/**
 * Tension a chord carries before it is voiced — the three terms the planner
 * can know when choosing chords. On the same scale as `chordTension`, which
 * adds the two voicing-dependent terms once the chord is realised.
 */
export function planningTension(chord: PlannedAdvancedChord, scalePitchClasses: PitchClass[]): number {
  return clamp01(
    WEIGHTS.functional * functionalTension(chord) +
      WEIGHTS.chromaticism * chromaticism(chord, scalePitchClasses) +
      WEIGHTS.dissonance * dissonance(chord)
  );
}

/**
 * The full deterministic tension score of a realised chord:
 *
 * `0.40·functional + 0.20·chromaticism + 0.15·dissonance
 *  + 0.10·inversionInstability + 0.15·voiceLeadingDistance`
 */
export function chordTension(params: {
  chord: PlannedAdvancedChord;
  scalePitchClasses: PitchClass[];
  inversion?: number;
  previousVoicing?: number[] | null;
  voicing?: number[];
}): number {
  const { chord, scalePitchClasses, inversion, previousVoicing, voicing } = params;
  const raw =
    WEIGHTS.functional * functionalTension(chord) +
    WEIGHTS.chromaticism * chromaticism(chord, scalePitchClasses) +
    WEIGHTS.dissonance * dissonance(chord) +
    WEIGHTS.inversion * inversionInstability(inversion) +
    WEIGHTS.voiceLeading * (voicing ? voiceLeadingDistance(previousVoicing, voicing) : 0);
  return clamp01(raw);
}
