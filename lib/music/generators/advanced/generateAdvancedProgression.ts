import {
  buildSeventhFromScale,
  buildTriadFromScale,
  formatChordSymbol,
  type SeventhQuality,
  type TriadQuality,
} from "@/lib/theory/chord";
import { midiToNoteName, PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import { getScaleDefinition } from "@/lib/theory/scale";
import type { ScaleType } from "@/lib/theory/types";

import { applyComplexityExtensions, type QualityHint } from "./extensions";
import { getPhraseRoles, getTensionCurve, selectDegreeForRole } from "./phraseStructure";
import {
  applyTritoneSubstitutions,
  injectSecondaryDominants,
  insertPassingDiminished,
  insertSuspensions,
  validateChromaticDensity,
} from "./substitutions";
import type {
  AdvancedProgressionOptions,
  AdvancedProgressionResult,
  DurationClass,
  PlannedAdvancedChord,
} from "./types";
import { pickBestVoiceLedCandidate } from "./voiceLeading";
import { generateVoicingCandidates } from "./voicing";

const MODE_TO_SCALE_TYPE: Record<AdvancedProgressionOptions["mode"], ScaleType> = {
  ionian: "major",
  aeolian: "natural_minor",
  dorian: "dorian",
  mixolydian: "mixolydian",
  phrygian: "phrygian",
};

const MAJORISH_ROMANS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"] as const;
const MINORISH_ROMANS = ["i", "ii°", "III", "iv", "v", "bVI", "bVII"] as const;

const MAJORISH_TEMPLATES: number[][] = [
  [0, 3, 4, 0],   // I - IV - V - I (authentic cadence)
  [0, 5, 3, 4],   // I - vi - IV - V (50s progression)
  [0, 1, 4, 0],   // I - ii - V - I (jazz ii-V-I)
  [0, 5, 1, 4],   // I - vi - ii - V (circle of fifths descent)
  [0, 3, 1, 4],   // I - IV - ii - V (subdominant approach)
  [0, 4, 5, 3],   // I - V - vi - IV (pop/axis progression)
  [0, 5, 3, 4],   // I - vi - IV - V (doo-wop)
  [5, 3, 0, 4],   // vi - IV - I - V (modern pop)
  [0, 2, 5, 3],   // I - iii - vi - IV (emotional pop)
  [0, 3, 5, 4],   // I - IV - vi - V
  [0, 4, 3, 0],   // I - V - IV - I (plagal rock)
  [0, 1, 5, 4],   // I - ii - vi - V
  [0, 3, 0, 4],   // I - IV - I - V (blues-influenced)
  [0, 2, 3, 4],   // I - iii - IV - V (ascending motion)
  [0, 5, 4, 3],   // I - vi - V - IV (descending)
];

const MINORISH_TEMPLATES: number[][] = [
  [0, 5, 3, 6],   // i - bVI - iv - bVII
  [0, 3, 6, 4],   // i - iv - bVII - v
  [0, 6, 5, 4],   // i - bVII - bVI - v
  [0, 5, 1, 4],   // i - bVI - ii° - v
  [0, 3, 4, 0],   // i - iv - v - i
  [0, 6, 5, 0],   // i - bVII - bVI - i
  [0, 5, 6, 0],   // i - bVI - bVII - i (Andalusian-ish)
  [0, 3, 6, 5],   // i - iv - bVII - bVI
  [0, 2, 5, 4],   // i - III - bVI - v (modal)
  [0, 6, 3, 4],   // i - bVII - iv - v
  [0, 3, 5, 6],   // i - iv - bVI - bVII
  [0, 4, 5, 0],   // i - v - bVI - i
  [0, 2, 6, 3],   // i - III - bVII - iv
  [5, 6, 0, 4],   // bVI - bVII - i - v
  [0, 3, 0, 6],   // i - iv - i - bVII
];

function clampVoiceRange(low: number, high: number): { low: number; high: number } {
  if (low <= high) return { low, high };
  return { low: high, high: low };
}

function createSeededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function transposePitchClass(root: PitchClass, semitones: number): PitchClass {
  const index = PITCH_CLASSES.indexOf(root);
  return PITCH_CLASSES[(index + semitones + 120) % 12];
}

function dominantPitchClasses(root: PitchClass): PitchClass[] {
  return [
    root,
    transposePitchClass(root, 4),
    transposePitchClass(root, 7),
    transposePitchClass(root, 10),
  ];
}

// ---------------------------------------------------------------------------
// Phrase-aware length adaptation
// ---------------------------------------------------------------------------

/**
 * Adapt template to target length using phrase-role-aware padding.
 * Instead of random degree selection, uses role-weighted candidates
 * for each new position.
 */
function adaptLength(
  template: number[],
  numChords: number,
  isMinor: boolean,
  random: () => number
): number[] {
  if (numChords <= 0) return [];
  if (template.length === numChords) return [...template];
  if (template.length > numChords) return template.slice(0, numChords);

  const padded = [...template];
  const roles = getPhraseRoles(numChords);

  // For each position beyond the template, select a degree based on role
  while (padded.length < numChords) {
    const role = roles[padded.length] ?? "continuation";
    const degree = selectDegreeForRole(role, isMinor, random);
    padded.push(degree);
  }

  return padded;
}

// ---------------------------------------------------------------------------
// Functional substitution
// ---------------------------------------------------------------------------

function familyForDegreeIndex(degreeIndex: number): "tonic" | "subdominant" | "dominant" | null {
  if ([0, 2, 5].includes(degreeIndex)) return "tonic";
  if ([1, 3].includes(degreeIndex)) return "subdominant";
  if ([4, 6].includes(degreeIndex)) return "dominant";
  return null;
}

function familyAlternates(degreeIndex: number): number[] {
  const family = familyForDegreeIndex(degreeIndex);
  if (family === "tonic") return [0, 2, 5].filter((idx) => idx !== degreeIndex);
  if (family === "subdominant") return [1, 3].filter((idx) => idx !== degreeIndex);
  if (family === "dominant") return [4, 6].filter((idx) => idx !== degreeIndex);
  return [];
}

/**
 * Apply functional substitution with weighted probabilities.
 * Key changes:
 * - Never substitute at protected positions (first/last)
 * - Weight substitution candidates: I(1.0) > vi(0.4) > iii(0.15)
 */
function maybeApplyFunctionalSwap(
  degreeIndices: number[],
  enabled: boolean,
  random: () => number
): { indices: number[]; swappedIndex: number | null } {
  if (!enabled || degreeIndices.length < 3) {
    return { indices: degreeIndices, swappedIndex: null };
  }

  if (random() < 0.45) {
    return { indices: degreeIndices, swappedIndex: null };
  }

  // Only swap interior positions (not first or last — these are protected)
  const interior = Array.from({ length: Math.max(0, degreeIndices.length - 2) }, (_, i) => i + 1);
  const interiorPick = interior[Math.floor(random() * interior.length)];

  if (interiorPick === undefined) {
    return { indices: degreeIndices, swappedIndex: null };
  }

  const current = degreeIndices[interiorPick] ?? 0;
  const alternates = familyAlternates(current);
  if (alternates.length === 0) {
    return { indices: degreeIndices, swappedIndex: null };
  }

  const replacement = alternates[Math.floor(random() * alternates.length)] ?? current;
  const next = [...degreeIndices];
  next[interiorPick] = replacement;

  return {
    indices: next,
    swappedIndex: interiorPick,
  };
}

// ---------------------------------------------------------------------------
// Chord plan building
// ---------------------------------------------------------------------------

function mapTriadToSymbolQuality(quality: TriadQuality): string {
  switch (quality) {
    case "maj": return "maj";
    case "min": return "min";
    case "dim": return "dim";
    case "aug": return "aug";
    default: return "maj";
  }
}

function mapSeventhToSymbolQuality(quality: SeventhQuality): string {
  switch (quality) {
    case "maj7": return "maj7";
    case "min7": return "min7";
    case "dom7": return "dom7";
    case "half-dim7": return "half-dim7";
    case "dim7": return "dim7";
    default: return "maj7";
  }
}

function qualityHintFromTriad(quality: TriadQuality, isDominant: boolean): QualityHint {
  if (isDominant) return "dom";
  if (quality === "maj") return "maj";
  if (quality === "dim") return "dim";
  return "min";
}

function buildDiatonicChordPlan(params: {
  root: PitchClass;
  degreeLabel: string;
  degreeIndex: number;
  scale: ReturnType<typeof getScaleDefinition>;
  complexity: AdvancedProgressionOptions["complexity"];
  random: () => number;
  kind: PlannedAdvancedChord["kind"];
  tensionLevel?: number;
  isProtected?: boolean;
}): PlannedAdvancedChord {
  const { root, degreeLabel, degreeIndex, scale, complexity, random, kind, tensionLevel, isProtected } = params;

  const triad = buildTriadFromScale(scale, degreeIndex);
  const seventh = buildSeventhFromScale(scale, degreeIndex);

  const isDominant = degreeIndex === 4 || degreeLabel.startsWith("V/") || degreeLabel.startsWith("sub(V");
  const triadQuality = isDominant ? "maj" : triad.quality;
  const qualityHint = qualityHintFromTriad(triad.quality, isDominant);

  const basePitchClasses =
    complexity === 1
      ? buildTriadFromScale(scale, degreeIndex).pitchClasses
      : isDominant
        ? dominantPitchClasses(root)
        : buildSeventhFromScale(scale, degreeIndex).pitchClasses;

  const expandedPitchClasses = applyComplexityExtensions({
    root,
    basePitchClasses,
    complexity,
    qualityHint,
    isDominant,
    random,
    tensionLevel: tensionLevel ?? 0.5,
  });

  let symbolQuality: string;
  if (complexity === 1) {
    symbolQuality = mapTriadToSymbolQuality(triadQuality);
  } else if (isDominant) {
    symbolQuality = "dom7";
  } else {
    symbolQuality = mapSeventhToSymbolQuality(seventh.quality);
  }

  let symbol = formatChordSymbol(root, symbolQuality);

  if (complexity === 3 && qualityHint !== "dim") {
    symbol = `${symbol}(9)`;
  }

  if (complexity >= 4 && isDominant) {
    symbol = `${root}7alt`;
  }

  if (complexity >= 3 && qualityHint === "maj" && (tensionLevel ?? 0.5) > 0.4 && random() > 0.72) {
    symbol = `${symbol}(13)`;
  }

  return {
    degreeLabel,
    symbol,
    root,
    pitchClasses: expandedPitchClasses,
    kind,
    isDominant,
    role: "structural",
    durationClass: "full",
    tensionLevel: tensionLevel ?? 0.5,
    isProtected: isProtected ?? false,
  };
}

function limitLength(chords: PlannedAdvancedChord[], maxLength: number): PlannedAdvancedChord[] {
  if (chords.length <= maxLength) return chords;
  return chords.slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Duration class helpers
// ---------------------------------------------------------------------------

function durationToBeats(dc: DurationClass | undefined): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateAdvancedProgression(
  options: AdvancedProgressionOptions
): AdvancedProgressionResult {
  const numChords = options.numChords ?? 4;
  const scaleType = MODE_TO_SCALE_TYPE[options.mode] ?? "major";
  const isMinor = options.mode !== "ionian" && options.mode !== "mixolydian";
  const romans = isMinor ? MINORISH_ROMANS : MAJORISH_ROMANS;

  const seed = options.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const random = createSeededRandom(seed);

  // --- Phrase structure ---
  const phraseRoles = getPhraseRoles(numChords);
  const tensionCurve = getTensionCurve(numChords);

  // --- Template selection and adaptation ---
  const chosenTemplatePool = isMinor ? MINORISH_TEMPLATES : MAJORISH_TEMPLATES;
  const template = chosenTemplatePool[Math.floor(random() * chosenTemplatePool.length)] ?? chosenTemplatePool[0];
  const baseDegreeIndices = adaptLength(template, numChords, isMinor, random);

  const functionalSwap = maybeApplyFunctionalSwap(
    baseDegreeIndices,
    options.useFunctionalSubstitutions ?? options.complexity >= 3,
    random
  );

  // --- Build diatonic chord plans with tension levels ---
  const scale = getScaleDefinition(options.rootKey, scaleType);
  const plannedDiatonic = functionalSwap.indices.map((degreeIndex, idx) => {
    const root = scale.pitchClasses[degreeIndex] ?? scale.pitchClasses[0];
    const degreeLabel = romans[degreeIndex] ?? romans[0];
    const tension = tensionCurve[idx] ?? 0.5;
    const isProtected = idx === 0 || idx === functionalSwap.indices.length - 1;

    return buildDiatonicChordPlan({
      root,
      degreeLabel,
      degreeIndex,
      scale,
      complexity: options.complexity,
      random,
      kind: functionalSwap.swappedIndex === idx ? "functional-substitution" : "diatonic",
      tensionLevel: tension,
      isProtected,
    });
  });

  // --- Apply substitutions (gated by tension and context) ---
  let planned = plannedDiatonic;
  planned = injectSecondaryDominants(planned, options, random);
  planned = applyTritoneSubstitutions(planned, options, random);
  planned = insertPassingDiminished(planned, options, random);
  planned = insertSuspensions(planned, options, random);

  // --- Chromatic density validation (2/3 rule) ---
  planned = validateChromaticDensity(planned);

  // --- Resolution heuristic: ensure progression ends on tonic ---
  if (planned.length > 0) {
    const lastChord = planned[planned.length - 1];
    if (lastChord.kind === "diatonic" || lastChord.kind === "functional-substitution") {
      const tonicRoot = scale.pitchClasses[0];
      if (lastChord.root !== tonicRoot) {
        planned[planned.length - 1] = buildDiatonicChordPlan({
          root: tonicRoot,
          degreeLabel: romans[0],
          degreeIndex: 0,
          scale,
          complexity: options.complexity,
          random,
          kind: "diatonic",
          tensionLevel: 0.0, // cadence = fully resolved
          isProtected: true,
        });
      }
    }
  }

  planned = limitLength(planned, numChords);

  // --- Voice each chord ---
  const { low, high } = clampVoiceRange(options.rangeLow, options.rangeHigh);
  const center = (low + high) / 2;

  const voiced = [] as AdvancedProgressionResult["chords"];
  const costs: number[] = [];
  let previousVoicing: number[] | null = null;

  for (const chord of planned) {
    const candidates = generateVoicingCandidates(chord, {
      style: options.voicingStyle,
      voiceCount: options.voiceCount,
      rangeLow: low,
      rangeHigh: high,
    });

    const selection = pickBestVoiceLedCandidate(previousVoicing, candidates, center);
    const finalVoicing = [...selection.voicing].sort((a, b) => a - b);

    voiced.push({
      degreeLabel: chord.degreeLabel,
      symbol: chord.symbol,
      midi: finalVoicing,
      notes: finalVoicing.map((midi) => midiToNoteName(midi)),
      durationClass: chord.durationClass ?? "full",
    });

    costs.push(selection.cost);
    previousVoicing = finalVoicing;
  }

  return {
    chords: voiced,
    labels: voiced.map((chord) => `${chord.degreeLabel} - ${chord.symbol}`),
    debug: {
      seed,
      planned,
      voiceLeadingCosts: costs,
    },
  };
}
