import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import type { AdvancedProgressionOptions, PlannedAdvancedChord } from "./types";

function transposePitchClass(root: PitchClass, semitones: number): PitchClass {
  const index = PITCH_CLASSES.indexOf(root);
  return PITCH_CLASSES[(index + semitones + 120) % 12];
}

function toIntervals(root: PitchClass, notes: PitchClass[]): number[] {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  return notes.map((note) => {
    const noteIndex = PITCH_CLASSES.indexOf(note);
    return (noteIndex - rootIndex + 12) % 12;
  });
}

function fromIntervals(root: PitchClass, intervals: number[]): PitchClass[] {
  return Array.from(new Set(intervals.map((interval) => transposePitchClass(root, interval))));
}

function buildDominant(root: PitchClass, degreeLabel: string, kind: PlannedAdvancedChord["kind"]): PlannedAdvancedChord {
  return {
    degreeLabel,
    symbol: `${root}7`,
    root,
    pitchClasses: fromIntervals(root, [0, 4, 7, 10]),
    kind,
    isDominant: true,
    role: kind === "secondary-dominant" ? "approach" : "structural",
    durationClass: kind === "secondary-dominant" ? "half" : "full",
  };
}

function chromaticDistance(from: PitchClass, to: PitchClass): number {
  const fromIndex = PITCH_CLASSES.indexOf(from);
  const toIndex = PITCH_CLASSES.indexOf(to);
  return (toIndex - fromIndex + 12) % 12;
}

// ---------------------------------------------------------------------------
// Context-scored secondary dominant insertion
// ---------------------------------------------------------------------------

/** Strong diatonic target degrees for secondary dominants. */
const STRONG_TARGETS = new Set([0, 3, 4, 5]); // I, IV, V, vi

/**
 * Score whether a secondary dominant insertion is appropriate at this position.
 * Returns true if the score exceeds threshold.
 */
function scoreSecondaryDominantInsertion(
  target: PlannedAdvancedChord,
  prevChord: PlannedAdvancedChord | null,
  chromaticCount: number,
  totalChords: number,
  tension: number
): number {
  let score = 0;

  // Bonus: target is a strong diatonic chord
  if (target.kind === "diatonic" && !target.isDominant) score += 2;

  // Bonus: position has high tension
  if (tension > 0.5) score += 1;

  // Penalty: adjacent chord is already non-diatonic
  if (prevChord && prevChord.kind !== "diatonic" && prevChord.kind !== "functional-substitution") {
    score -= 3;
  }

  // Penalty: low tension position
  if (tension < 0.3) score -= 2;

  // Penalty: too many chromatic chords already
  if (totalChords > 0 && chromaticCount / totalChords > 0.33) score -= 1;

  return score;
}

export function injectSecondaryDominants(
  chords: PlannedAdvancedChord[],
  options: AdvancedProgressionOptions,
  random: () => number
): PlannedAdvancedChord[] {
  if (!options.useSecondaryDominants || chords.length < 2) return chords;

  const result: PlannedAdvancedChord[] = [];
  let insertions = 0;
  // Limit insertions to floor(numChords / 3) — prevents overexpansion
  const maxInsertions = Math.max(1, Math.floor(chords.length / 3));
  let chromaticCount = 0;

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const tension = chord.tensionLevel ?? 0.5;

    // Don't insert before protected chords (first/last positions)
    if (i > 0 && insertions < maxInsertions && !chord.isProtected) {
      const prevChord = result.length > 0 ? result[result.length - 1] : null;
      const score = scoreSecondaryDominantInsertion(chord, prevChord, chromaticCount, result.length, tension);

      // Only insert if score > 2 AND random check passes
      if (score > 2 && random() > 0.5) {
        const secondaryRoot = transposePitchClass(chord.root, 7);
        const secDom = buildDominant(secondaryRoot, `V/${chord.degreeLabel}`, "secondary-dominant");
        secDom.tensionLevel = tension;
        result.push(secDom);
        insertions++;
        chromaticCount++;
      }
    }

    result.push(chord);
    if (chord.kind !== "diatonic" && chord.kind !== "functional-substitution") {
      chromaticCount++;
    }
  }

  // REMOVED: forced secondary dominant insertion when insertions === 0
  // The audit identifies this as problematic — it guarantees chromatic chords
  // even in short/simple progressions where they're musically inappropriate.

  return result;
}

// ---------------------------------------------------------------------------
// Tritone substitution
// ---------------------------------------------------------------------------

export function applyTritoneSubstitutions(
  chords: PlannedAdvancedChord[],
  options: AdvancedProgressionOptions,
  random: () => number
): PlannedAdvancedChord[] {
  if (!options.useTritoneSubstitution) return chords;

  return chords.map((chord) => {
    if (!chord.isDominant || random() < 0.5) return chord;
    // Don't tritone-sub protected chords
    if (chord.isProtected) return chord;

    const originalIntervals = toIntervals(chord.root, chord.pitchClasses);
    const substitutedRoot = transposePitchClass(chord.root, 6);

    return {
      degreeLabel: `sub(${chord.degreeLabel})`,
      symbol: `${substitutedRoot}7`,
      root: substitutedRoot,
      pitchClasses: fromIntervals(substitutedRoot, originalIntervals),
      kind: "tritone-substitution",
      isDominant: true,
      role: chord.role,
      durationClass: chord.durationClass,
      tensionLevel: chord.tensionLevel,
    } satisfies PlannedAdvancedChord;
  });
}

// ---------------------------------------------------------------------------
// Passing diminished insertion
// ---------------------------------------------------------------------------

export function insertPassingDiminished(
  chords: PlannedAdvancedChord[],
  options: AdvancedProgressionOptions,
  random: () => number
): PlannedAdvancedChord[] {
  if (!options.usePassingChords || chords.length < 2) return chords;

  const result: PlannedAdvancedChord[] = [];
  let insertions = 0;
  const maxInsertions = Math.max(1, Math.floor(chords.length / 3));

  for (let i = 0; i < chords.length - 1; i++) {
    const current = chords[i];
    const next = chords[i + 1];
    result.push(current);

    const movement = chromaticDistance(current.root, next.root);
    const isWholeStep = movement === 2 || movement === 10;
    const tension = current.tensionLevel ?? 0.5;

    // Only insert if: whole step motion, under limit, tension allows, random check passes
    // AND adjacent chord is not already non-diatonic (prevent chromatic clusters)
    const adjacentIsChromatic = current.kind !== "diatonic" && current.kind !== "functional-substitution";
    const nextIsChromatic = next.kind !== "diatonic" && next.kind !== "functional-substitution";

    if (!isWholeStep || insertions >= maxInsertions || random() < 0.5) continue;
    if (adjacentIsChromatic || nextIsChromatic) continue;
    if (tension < 0.3) continue;

    const step = movement === 2 ? 1 : -1;
    const passingRoot = transposePitchClass(current.root, step);
    result.push({
      degreeLabel: "pass°",
      symbol: `${passingRoot}°7`,
      root: passingRoot,
      pitchClasses: fromIntervals(passingRoot, [0, 3, 6, 9]),
      kind: "passing",
      isDominant: false,
      role: "passing",
      durationClass: "quarter",
      tensionLevel: tension,
    });
    insertions++;
  }

  result.push(chords[chords.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Suspension insertion
// ---------------------------------------------------------------------------

export function insertSuspensions(
  chords: PlannedAdvancedChord[],
  options: AdvancedProgressionOptions,
  random: () => number
): PlannedAdvancedChord[] {
  if (!options.useSuspensions) return chords;

  const result: PlannedAdvancedChord[] = [];
  let insertions = 0;
  const maxInsertions = Math.max(1, Math.floor(chords.length / 3));

  for (const chord of chords) {
    const tension = chord.tensionLevel ?? 0.5;

    if (chord.isDominant && insertions < maxInsertions && tension > 0.4 && random() > 0.55) {
      result.push({
        degreeLabel: `${chord.degreeLabel}(sus4)`,
        symbol: `${chord.root}sus4`,
        root: chord.root,
        pitchClasses: fromIntervals(chord.root, [0, 5, 7, 10]),
        kind: "suspension",
        isDominant: true,
        role: "suspension",
        durationClass: "quarter",
        tensionLevel: tension,
      });
      insertions++;
    }

    result.push(chord);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Chromatic density validation (2/3 rule)
// ---------------------------------------------------------------------------

/**
 * Enforce the 2/3 rule: in any sliding window of 4 consecutive chords,
 * at least 2 must be diatonic. Removes the least important chromatic chord
 * when violated.
 */
export function validateChromaticDensity(chords: PlannedAdvancedChord[]): PlannedAdvancedChord[] {
  if (chords.length < 4) return chords;

  const result = [...chords];
  let changed = true;

  // Keep iterating until no violations remain
  while (changed) {
    changed = false;
    for (let i = 0; i <= result.length - 4; i++) {
      const window = result.slice(i, i + 4);
      const diatonicCount = window.filter(
        (c) => c.kind === "diatonic" || c.kind === "functional-substitution"
      ).length;

      if (diatonicCount < 2) {
        // Find the least important non-diatonic chord in the window to remove
        // Priority: passing > suspension > secondary-dominant > tritone-sub
        const removalPriority: PlannedAdvancedChord["kind"][] = [
          "passing", "suspension", "tritone-substitution", "secondary-dominant",
        ];

        for (const kind of removalPriority) {
          const idx = window.findIndex(
            (c) => c.kind === kind && !c.isProtected
          );
          if (idx !== -1) {
            result.splice(i + idx, 1);
            changed = true;
            break;
          }
        }
        if (changed) break; // restart scan after removal
      }
    }
  }

  return result;
}
