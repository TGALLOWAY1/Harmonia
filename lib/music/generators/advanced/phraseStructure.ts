import type { PhraseRole } from "./types";

/**
 * Phrase role templates by progression length.
 * Each position has a role that drives chord selection, substitution gating,
 * and extension application.
 */
const PHRASE_ROLE_TEMPLATES: Record<number, PhraseRole[]> = {
  2: ["opening", "cadence"],
  3: ["opening", "dominant", "cadence"],
  4: ["opening", "continuation", "dominant", "cadence"],
  5: ["opening", "continuation", "pre-dominant", "dominant", "cadence"],
  6: ["opening", "continuation", "pre-dominant", "dominant", "continuation", "cadence"],
  7: ["opening", "continuation", "continuation", "pre-dominant", "dominant", "continuation", "cadence"],
  8: ["opening", "continuation", "pre-dominant", "dominant", "opening", "continuation", "dominant", "cadence"],
};

/**
 * Tension curves by progression length.
 * Values 0.0 (fully resolved) to 1.0 (maximum tension).
 * These gate substitution insertion and extension richness.
 */
const TENSION_CURVES: Record<number, number[]> = {
  2: [0.1, 0.0],
  3: [0.1, 0.8, 0.0],
  4: [0.1, 0.3, 0.8, 0.0],
  5: [0.1, 0.3, 0.5, 0.8, 0.0],
  6: [0.1, 0.3, 0.5, 0.8, 0.3, 0.0],
  7: [0.1, 0.2, 0.3, 0.5, 0.8, 0.3, 0.0],
  8: [0.1, 0.2, 0.5, 0.7, 0.2, 0.3, 0.8, 0.0],
};

/**
 * Get phrase roles for a progression of the given length.
 * Falls back to interpolation for lengths outside 2-8.
 */
export function getPhraseRoles(numChords: number): PhraseRole[] {
  if (numChords <= 0) return [];
  if (numChords === 1) return ["cadence"];

  const clamped = Math.min(numChords, 8);
  const template = PHRASE_ROLE_TEMPLATES[clamped];
  if (template && template.length === numChords) return [...template];

  // For lengths > 8, build two sub-phrases
  if (numChords > 8) {
    const firstHalf = Math.ceil(numChords / 2);
    const secondHalf = numChords - firstHalf;
    const first = getPhraseRoles(firstHalf);
    const second = getPhraseRoles(secondHalf);
    return [...first, ...second];
  }

  // Fallback: use the clamped template
  if (template) return [...template];
  return Array.from({ length: numChords }, (_, i) =>
    i === 0 ? "opening" : i === numChords - 1 ? "cadence" : "continuation"
  );
}

/**
 * Get tension curve for a progression of the given length.
 * Values are 0.0 (resolved) to 1.0 (maximum tension).
 */
export function getTensionCurve(numChords: number): number[] {
  if (numChords <= 0) return [];
  if (numChords === 1) return [0.0];

  const clamped = Math.min(numChords, 8);
  const curve = TENSION_CURVES[clamped];
  if (curve && curve.length === numChords) return [...curve];

  // For lengths > 8, concatenate two sub-curves
  if (numChords > 8) {
    const firstHalf = Math.ceil(numChords / 2);
    const secondHalf = numChords - firstHalf;
    const first = getTensionCurve(firstHalf);
    const second = getTensionCurve(secondHalf);
    return [...first, ...second];
  }

  // Fallback: use the clamped curve
  if (curve) return [...curve];
  // Linear rise to 0.8 at 75% then resolve to 0.0
  return Array.from({ length: numChords }, (_, i) => {
    const pos = i / (numChords - 1);
    if (pos >= 0.95) return 0.0;
    return Math.min(0.8, pos * 1.1);
  });
}

/**
 * Weighted degree candidates for each phrase role in major modes.
 * Each entry is [degreeIndex, weight].
 */
export const MAJOR_ROLE_DEGREES: Record<PhraseRole, [number, number][]> = {
  opening:        [[0, 0.70], [5, 0.20], [2, 0.10]],
  continuation:   [[3, 0.35], [1, 0.25], [5, 0.25], [2, 0.15]],
  "pre-dominant": [[1, 0.45], [3, 0.40], [5, 0.15]],
  dominant:       [[4, 0.85], [6, 0.15]],
  cadence:        [[0, 0.85], [5, 0.15]],
};

/**
 * Weighted degree candidates for each phrase role in minor modes.
 */
export const MINOR_ROLE_DEGREES: Record<PhraseRole, [number, number][]> = {
  opening:        [[0, 0.70], [2, 0.20], [5, 0.10]],
  continuation:   [[3, 0.30], [5, 0.30], [6, 0.20], [2, 0.20]],
  "pre-dominant": [[1, 0.40], [3, 0.35], [5, 0.25]],
  dominant:       [[4, 0.60], [6, 0.25], [6, 0.15]],
  cadence:        [[0, 0.85], [5, 0.15]],
};

/**
 * Select a degree index based on weighted probabilities for the given role.
 */
export function selectDegreeForRole(
  role: PhraseRole,
  isMinor: boolean,
  random: () => number
): number {
  const candidates = isMinor ? MINOR_ROLE_DEGREES[role] : MAJOR_ROLE_DEGREES[role];
  const r = random();
  let cumulative = 0;

  for (const [degree, weight] of candidates) {
    cumulative += weight;
    if (r < cumulative) return degree;
  }

  // Fallback to last candidate
  return candidates[candidates.length - 1][0];
}
