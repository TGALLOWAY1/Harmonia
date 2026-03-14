import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import type { AdvancedComplexity } from "./types";

export type QualityHint = "maj" | "min" | "dim" | "dom";

export type ExtensionInput = {
  root: PitchClass;
  basePitchClasses: PitchClass[];
  complexity: AdvancedComplexity;
  qualityHint: QualityHint;
  isDominant: boolean;
  random: () => number;
  /** Tension level 0.0–1.0 from phrase structure. Gates extension richness. */
  tensionLevel?: number;
};

function pitchClassOffset(root: PitchClass, semitones: number): PitchClass {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  const index = (rootIndex + semitones + 120) % 12;
  return PITCH_CLASSES[index];
}

function intervalFromRoot(root: PitchClass, note: PitchClass): number {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  const noteIndex = PITCH_CLASSES.indexOf(note);
  return (noteIndex - rootIndex + 12) % 12;
}

function uniquePitchClasses(root: PitchClass, intervals: number[]): PitchClass[] {
  const sortedUnique = Array.from(new Set(intervals.map((interval) => (interval + 120) % 12))).sort((a, b) => a - b);
  return sortedUnique.map((interval) => pitchClassOffset(root, interval));
}

function preferredSeventh(qualityHint: QualityHint): number {
  if (qualityHint === "maj") return 11;
  if (qualityHint === "dim") return 9;
  return 10;
}

/**
 * Apply complexity extensions gated by tension level.
 *
 * Key changes from original:
 * - Tension < 0.3: extensions limited to 7th max (stable chords stay simple)
 * - Tension 0.3-0.5: 9th allowed on ~60% of chords (weighted toward dominants)
 * - Tension 0.5-0.7: 9th + 13th allowed (building tension)
 * - Tension > 0.7: all extensions + alterations (maximum tension)
 * - Dominant chords get richer treatment than tonic/subdominant
 */
export function applyComplexityExtensions(input: ExtensionInput): PitchClass[] {
  const { root, basePitchClasses, complexity, qualityHint, isDominant, random } = input;
  const tension = input.tensionLevel ?? 0.5; // default to mid-tension for backwards compat

  const intervals = basePitchClasses.map((pc) => intervalFromRoot(root, pc));

  // Complexity 2+: add 7th
  if (complexity >= 2) {
    intervals.push(preferredSeventh(qualityHint));
  }

  // Complexity 3+: selectively add 9th and 13th, gated by tension
  if (complexity >= 3 && qualityHint !== "dim") {
    // 9th: apply based on tension level and randomness
    // At high tension or on dominant chords: more likely
    // At low tension on non-dominant: less likely
    const ninthThreshold = isDominant ? 0.3 : 0.55 - tension * 0.3;
    if (random() > ninthThreshold) {
      intervals.push(2); // add9
    }

    // 13th: only on major/dominant chords, at higher tension
    if ((qualityHint === "maj" || qualityHint === "dom") && tension > 0.4) {
      const thirteenthThreshold = isDominant ? 0.6 : 0.8;
      if (random() > thirteenthThreshold) {
        intervals.push(9); // add13
      }
    }
  }

  // Complexity 4+: alterations only on dominants at high tension
  if (complexity >= 4 && isDominant && tension > 0.5) {
    const alterations = [1, 3, 8] as const; // b9, #9, b13
    const picked = alterations[Math.floor(random() * alterations.length)] ?? 1;
    intervals.push(picked);
    // Second alteration only at very high tension
    if (tension > 0.7 && random() > 0.6) {
      intervals.push(1);
    }
  }

  return uniquePitchClasses(root, intervals);
}

export function getComplexitySuffix(complexity: AdvancedComplexity, isDominant: boolean): string {
  if (complexity === 1) return "";
  if (complexity === 2) return "7";
  if (complexity === 3) return "9";
  if (isDominant && complexity >= 4) return "7alt";
  return "9";
}
