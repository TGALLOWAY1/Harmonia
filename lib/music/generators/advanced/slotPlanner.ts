import type { TriadQuality } from "@/lib/theory/chord";
import type { Mode } from "@/lib/theory/harmonyEngine";
import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";

import {
  borrowedChordCatalogue,
  describeChromaticTriad,
  type BorrowedChordSpec,
} from "./modalInterchange";
import {
  CHROMATIC_TRANSFORMS,
  applyTransform,
  type NeoRiemannianTransform,
  type NeoRiemannianTriad,
} from "./neoRiemannian";
import { TENSION_TARGET_SCALE, planningTension } from "./tensionCurve";
import type { PlannedAdvancedChord } from "./types";

/**
 * Slot planning against the target curves.
 *
 * The template supplies the functional skeleton; this decides what actually
 * fills each slot by choosing, among the chords that can serve that function,
 * the one whose tension and brightness sit closest to the slot's targets.
 * Two sources of candidates:
 *
 * - **diatonic alternates** within the slot's functional family (tonic
 *   I/iii/vi, subdominant ii/IV, dominant V/vii°), which keep the template's
 *   argument while varying its surface;
 * - **one chromatic surprise per phrase** — a chord borrowed from a parallel
 *   mode, or reached from the previous chord by a Neo-Riemannian transform —
 *   against an otherwise diatonic context. One, deliberately: pleasure tracks
 *   the interaction of surprise with an otherwise predictable context
 *   (Cheung et al. 2019), and spreading chromaticism evenly is what
 *   dissolves a key.
 *
 * Choices are drawn by a seeded softmin over the fit, not an argmax, so
 * equally good chords still vary from seed to seed.
 */

export type SlotChoice =
  | { type: "diatonic"; degreeIndex: number; swapped: boolean }
  | { type: "chromatic"; spec: BorrowedChordSpec; transform?: NeoRiemannianTransform };

export type DegreeFamilyName = "tonic" | "subdominant" | "dominant";

export function familyForDegreeIndex(degreeIndex: number): DegreeFamilyName | null {
  if ([0, 2, 5].includes(degreeIndex)) return "tonic";
  if ([1, 3].includes(degreeIndex)) return "subdominant";
  if ([4, 6].includes(degreeIndex)) return "dominant";
  return null;
}

export function familyAlternates(degreeIndex: number): number[] {
  const family = familyForDegreeIndex(degreeIndex);
  if (family === "tonic") return [0, 2, 5].filter((idx) => idx !== degreeIndex);
  if (family === "subdominant") return [1, 3].filter((idx) => idx !== degreeIndex);
  if (family === "dominant") return [4, 6].filter((idx) => idx !== degreeIndex);
  return [];
}

/** Which harmonic functions may stand in for each family. */
const FAMILY_FUNCTIONS: Record<DegreeFamilyName, Set<string>> = {
  tonic: new Set(["tonic", "mediant"]),
  subdominant: new Set(["predominant", "mediant"]),
  dominant: new Set(["dominant", "applied", "predominant"]),
};

export type SlotPlannerParams = {
  baseDegreeIndices: number[];
  mode: Mode;
  scalePitchClasses: PitchClass[];
  allowRaisedDominant: boolean;
  /** Mood-scaled tension target per slot, 0..1. */
  tensionTargets: number[];
  /** Brightness target per slot, −1..1. */
  brightnessTargets: number[];
  /** Mood's chromatic appetite, 0..1: the chance of a surprise at all. */
  chromaticism: number;
  varyDiatonic: boolean;
  allowChromatic: boolean;
  /** Build a diatonic chord for inspection without disturbing the seed. */
  probeDegree: (degreeIndex: number, tensionLevel: number) => PlannedAdvancedChord;
  /** Build a chromatic chord for inspection without disturbing the seed. */
  probeChromatic: (spec: BorrowedChordSpec, tensionLevel: number) => PlannedAdvancedChord;
  /** Triad quality of a scale degree, after the raised-dominant rule. */
  triadQualityOf: (degreeIndex: number) => TriadQuality;
  random: () => number;
};

const SOFTMIN_TEMPERATURE = 0.12;

/** Draw an index in proportion to exp(fit / temperature). */
function drawByFit(fits: number[], random: () => number, temperature = SOFTMIN_TEMPERATURE): number {
  if (fits.length === 0) return -1;
  const best = Math.max(...fits);
  const weights = fits.map((fit) => Math.exp((fit - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let draw = random() * total;
  for (let i = 0; i < weights.length; i++) {
    draw -= weights[i];
    if (draw <= 0) return i;
  }
  return weights.length - 1;
}

function diatonicBrightnessOf(quality: TriadQuality): number {
  switch (quality) {
    case "maj": return 0.25;
    case "min": return -0.25;
    case "dim": return -0.4;
    default: return 0.1;
  }
}

export function planSlots(params: SlotPlannerParams): SlotChoice[] {
  const {
    baseDegreeIndices,
    tensionTargets,
    brightnessTargets,
    scalePitchClasses,
    probeDegree,
    probeChromatic,
    random,
  } = params;
  const n = baseDegreeIndices.length;
  const choices: SlotChoice[] = baseDegreeIndices.map((degreeIndex) => ({
    type: "diatonic",
    degreeIndex,
    swapped: false,
  }));
  if (n < 2) return choices;

  const target = (i: number) => (tensionTargets[i] ?? 0.5) * TENSION_TARGET_SCALE;
  const brightnessTarget = (i: number) => brightnessTargets[i] ?? 0;

  const offsetFromTonic = (pc: PitchClass): number =>
    (PITCH_CLASSES.indexOf(pc) - PITCH_CLASSES.indexOf(scalePitchClasses[0]) + 12) % 12;

  const degreeAt = (i: number): number | null => {
    const choice = choices[i];
    return choice && choice.type === "diatonic" ? choice.degreeIndex : null;
  };

  // --- Diatonic variation within functional families -----------------------
  // Interior slots always; the opener too when the curve asks it to open on
  // tension (the collapse shape). The final slot belongs to the cadence policy.
  const variableSlots: number[] = [];
  for (let i = 1; i < n - 1; i++) variableSlots.push(i);
  if ((tensionTargets[0] ?? 0) >= 0.5) variableSlots.unshift(0);

  if (params.varyDiatonic) {
    for (const i of variableSlots) {
      const templateDegree = baseDegreeIndices[i];
      const alternates =
        i === 0
          ? [4, 6].filter((d) => d !== templateDegree)
          : familyAlternates(templateDegree);
      if (alternates.length === 0) continue;

      const pool = [templateDegree, ...alternates];
      const fits = pool.map((degree, k) => {
        const probe = probeDegree(degree, tensionTargets[i] ?? 0.5);
        const tensionFit = -Math.abs(planningTension(probe, scalePitchClasses) - target(i));
        const brightnessFit =
          -0.35 * Math.abs(diatonicBrightnessOf(params.triadQualityOf(degree)) - brightnessTarget(i));
        // The template's own choice keeps a small prior: it is the phrase's argument.
        const prior = k === 0 ? 0.08 : 0;
        return tensionFit + brightnessFit + prior;
      });

      const pick = pool[drawByFit(fits, random)] ?? templateDegree;
      // A repeat next to its neighbour reads as one long chord and wastes a slot.
      if (pick === degreeAt(i - 1) || pick === degreeAt(i + 1)) continue;
      if (pick !== templateDegree) choices[i] = { type: "diatonic", degreeIndex: pick, swapped: true };
    }
  }

  // --- One chromatic surprise per phrase -----------------------------------
  if (!params.allowChromatic || n < 3) return choices;
  const surprises = n >= 8 ? 2 : 1;
  const catalogue = borrowedChordCatalogue(params.mode, params.allowRaisedDominant).filter(
    (spec) => !spec.finalOnly
  );
  if (catalogue.length === 0) return choices;

  const triadOf = (i: number): NeoRiemannianTriad | null => {
    const choice = choices[i];
    if (!choice) return null;
    if (choice.type === "chromatic") {
      if (choice.spec.triadQuality !== "maj" && choice.spec.triadQuality !== "min") return null;
      return { root: choice.spec.semitones, quality: choice.spec.triadQuality };
    }
    const quality = params.triadQualityOf(choice.degreeIndex);
    if (quality !== "maj" && quality !== "min") return null;
    return { root: offsetFromTonic(scalePitchClasses[choice.degreeIndex]), quality };
  };

  const rootOffsetAt = (i: number): number | null => {
    const triad = triadOf(i);
    if (triad) return triad.root;
    const choice = choices[i];
    if (!choice) return null;
    if (choice.type === "chromatic") return choice.spec.semitones;
    return offsetFromTonic(scalePitchClasses[choice.degreeIndex]);
  };

  const placed: number[] = [];
  for (let s = 0; s < surprises; s++) {
    // The mood decides how readily a surprise happens at all; a second one is rarer.
    const chance = s === 0 ? params.chromaticism : params.chromaticism * 0.5;
    if (random() >= chance) continue;

    const eligible = variableSlots.filter(
      (i) => !placed.some((p) => Math.abs(p - i) <= 1) && choices[i].type === "diatonic"
    );
    if (eligible.length === 0) continue;

    const options: { slot: number; spec: BorrowedChordSpec; transform?: NeoRiemannianTransform; fit: number }[] = [];

    for (const i of eligible) {
      const family = familyForDegreeIndex(baseDegreeIndices[i]) ?? "tonic";
      const pool = new Map<string, { spec: BorrowedChordSpec; transform?: NeoRiemannianTransform }>();
      for (const spec of catalogue) pool.set(spec.key, { spec });

      // Chords reachable from the previous chord by a transform, labelled by
      // the catalogue where it knows them, chromatic mediants otherwise.
      const previous = i > 0 ? triadOf(i - 1) : null;
      if (previous) {
        for (const transform of CHROMATIC_TRANSFORMS) {
          const reached = applyTransform(previous, transform);
          const spec = describeChromaticTriad(reached.root, reached.quality, params.mode, params.allowRaisedDominant);
          if (!spec || spec.finalOnly) continue;
          const existing = pool.get(spec.key);
          pool.set(spec.key, { spec: existing?.spec ?? spec, transform });
        }
      }

      for (const { spec, transform } of pool.values()) {
        const probe = probeChromatic(spec, tensionTargets[i] ?? 0.5);
        let fit = -Math.abs(planningTension(probe, scalePitchClasses) - target(i));
        fit -= 0.5 * Math.abs(spec.relativeBrightness - brightnessTarget(i));
        if (FAMILY_FUNCTIONS[family].has(spec.function)) fit += 0.2;
        // The slot that prepares the cadence needs a chord that pulls; a
        // colour chord there weakens the arrival the whole phrase is for.
        if (i === n - 2 && spec.function !== "dominant" && spec.function !== "applied") fit -= 0.15;
        // A named transform brings its own voice leading.
        if (transform) fit += 0.04;
        // Do not sit next to a chord on the same root: it reads as a mode
        // change on one chord rather than a new harmony.
        if (rootOffsetAt(i - 1) === spec.semitones || rootOffsetAt(i + 1) === spec.semitones) fit -= 0.3;
        options.push({ slot: i, spec, transform, fit });
      }
    }

    if (options.length === 0) continue;
    const pick = options[drawByFit(options.map((o) => o.fit), random, 0.1)];
    if (!pick) continue;
    choices[pick.slot] = { type: "chromatic", spec: pick.spec, transform: pick.transform };
    placed.push(pick.slot);
  }

  return choices;
}
