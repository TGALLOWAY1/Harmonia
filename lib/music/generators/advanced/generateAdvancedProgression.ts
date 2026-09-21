import {
  buildSeventhFromScale,
  buildTriadFromScale,
  formatChordSymbol,
  type SeventhQuality,
  type TriadQuality,
} from "@/lib/theory/chord";
import { midiToNoteName, pitchClassToMidi, PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import { getChordPitchClasses, toPitchClass } from "@/lib/theory/chordSymbol";
import {
  MAJOR_PENTATONIC_TEMPLATES,
  getPentatonicChord,
  isPentatonicChordDegree,
  type PentatonicChordDegree,
} from "@/lib/theory/pentatonic";
import { romanNumeralsForScale } from "@/lib/theory/romanNumeral";
import { getScaleDefinition } from "@/lib/theory/scale";
import type { ScaleType } from "@/lib/theory/types";

import { inversionOfVoicing, planBassLine } from "./bassLine";
import { chordMoodProfile, DEFAULT_CHORD_MOOD, harmonicRhythmFor, type ChordMoodProfile } from "./chordMoods";
import { applyComplexityExtensions, type QualityHint } from "./extensions";
import {
  brightnessTargetsFor,
  buildBorrowedChordPlan,
  diatonicBrightness,
  picardyTonic,
  resolveBrightnessCurve,
} from "./modalInterchange";
import { parsimoniousVoicing } from "./neoRiemannian";
import {
  getPhraseRoles,
  selectDegreeForRole,
  type DegreeFamily,
} from "./phraseStructure";
import { scoreProgression } from "./progressionScore";
import { voicingRoughness } from "./roughness";
import { planSlots } from "./slotPlanner";
import {
  applyTritoneSubstitutions,
  injectSecondaryDominants,
  insertPassingDiminished,
  insertSuspensions,
  validateChromaticDensity,
} from "./substitutions";
import { chordIdentities, tendencyPenalty } from "./tendencyTones";
import { tensionCurveFor } from "./tensionCurve";
import type {
  AdvancedProgressionOptions,
  AdvancedProgressionResult,
  CadenceMode,
  VoiceCount,
  DurationClass,
  HarmonicFunction,
  NoteRole,
  PlannedAdvancedChord,
  VoicingSearch,
} from "./types";
import {
  calculateVoiceLeadingCost,
  pickBestVoiceLedCandidate,
  PLANNED_BASS_BONUS,
  ROOT_POSITION_BONUS,
  spanPenalty,
} from "./voiceLeading";
import { generateVoicingCandidates, normalizeVoicingToRange } from "./voicing";
import { searchVoicings } from "./voicingSearch";

const MODE_TO_SCALE_TYPE: Record<AdvancedProgressionOptions["mode"], ScaleType> = {
  ionian: "major",
  aeolian: "natural_minor",
  dorian: "dorian",
  mixolydian: "mixolydian",
  phrygian: "phrygian",
  major_pentatonic: "major_pentatonic",
};

/**
 * Modes whose fifth degree is raised to a major/dominant chord.
 *
 * In ionian the fifth is already major, so this is a no-op. In aeolian, raising
 * it is the deliberate harmonic-minor V that gives minor keys a leading tone.
 * Dorian, phrygian and mixolydian are defined against their parent scales by
 * precisely this chord, so raising it there erases the mode the user picked.
 */
const MODES_WITH_RAISED_DOMINANT: ReadonlySet<AdvancedProgressionOptions["mode"]> = new Set([
  "ionian",
  "aeolian",
]);

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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

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
  family: DegreeFamily,
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
    const degree = selectDegreeForRole(role, family, random);
    padded.push(degree);
  }

  return padded;
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

/**
 * Derive the extension quality hint from the *seventh* quality rather than the
 * triad. This is critical: a chord like D7 (♭VII in E minor) has a major triad
 * but a dominant seventh — keying off the triad would push a major 7th (C#) on
 * top of the dom7 (C), producing notes that contradict the "D7" symbol.
 */
function qualityHintFromSeventh(quality: SeventhQuality, isDominant: boolean): QualityHint {
  if (isDominant) return "dom";
  switch (quality) {
    case "maj7": return "maj";
    case "dom7": return "dom";
    case "dim7": return "dim";
    // min7 and half-dim7 both carry a minor 7th (interval 10)
    default: return "min";
  }
}

/** Harmonic function of a scale degree, for the tension model. */
function functionForDegree(degreeIndex: number): HarmonicFunction {
  switch (degreeIndex) {
    case 0: return "tonic";
    case 2:
    case 5: return "mediant";
    case 1:
    case 3: return "predominant";
    default: return "dominant";
  }
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
  /** Whether degree 5 may be raised to a major/dominant chord in this mode. */
  allowRaisedDominant?: boolean;
}): PlannedAdvancedChord {
  const { root, degreeLabel, degreeIndex, scale, complexity, random, kind, tensionLevel, isProtected } = params;
  const allowRaisedDominant = params.allowRaisedDominant ?? true;

  const triad = buildTriadFromScale(scale, degreeIndex);
  const seventh = buildSeventhFromScale(scale, degreeIndex);

  // Applied dominants (V/x, sub(V/x)) are dominant by construction in any mode.
  // The diatonic fifth degree is only a dominant where the mode has a leading tone.
  const isDominant =
    (degreeIndex === 4 && allowRaisedDominant) ||
    degreeLabel.startsWith("V/") ||
    degreeLabel.startsWith("sub(V");
  const triadQuality = isDominant ? "maj" : triad.quality;
  // For complexity 1 (triads), key the hint off the triad; for seventh chords
  // and beyond, key it off the actual seventh quality so we never add a 7th
  // that contradicts the chord symbol.
  const qualityHint =
    complexity === 1
      ? qualityHintFromTriad(triad.quality, isDominant)
      : qualityHintFromSeventh(seventh.quality, isDominant);

  const basePitchClasses =
    complexity === 1
      ? // Dominant degrees are labelled major (raised leading tone) — build a
        // major triad so the notes match the symbol; otherwise use the diatonic triad.
        isDominant
        ? [root, transposePitchClass(root, 4), transposePitchClass(root, 7)]
        : buildTriadFromScale(scale, degreeIndex).pitchClasses
      : isDominant
        ? dominantPitchClasses(root)
        : buildSeventhFromScale(scale, degreeIndex).pitchClasses;

  const extension = applyComplexityExtensions({
    root,
    basePitchClasses,
    complexity,
    qualityHint,
    isDominant,
    random,
    tensionLevel: tensionLevel ?? 0.5,
  });
  const expandedPitchClasses = extension.pitchClasses;

  let symbolQuality: string;
  if (complexity === 1) {
    symbolQuality = mapTriadToSymbolQuality(triadQuality);
  } else if (isDominant) {
    symbolQuality = "dom7";
  } else {
    symbolQuality = mapSeventhToSymbolQuality(seventh.quality);
  }

  // Build the symbol from what the extension step *actually* added, so the
  // symbol and the pitch classes always agree (required for validation).
  let symbol: string;
  if (complexity >= 4 && isDominant && extension.addedAlteration) {
    symbol = `${root}7alt`;
  } else {
    symbol = formatChordSymbol(root, symbolQuality);
    if (extension.addedNinth) symbol = `${symbol}(9)`;
    if (extension.addedThirteenth) symbol = `${symbol}(13)`;
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
    degreeIndex,
    functionTag: functionForDegree(degreeIndex),
    brightness: diatonicBrightness(triadQuality),
  };
}

function limitLength(chords: PlannedAdvancedChord[], maxLength: number): PlannedAdvancedChord[] {
  if (chords.length <= maxLength) return chords;
  return chords.slice(0, maxLength);
}

/** Chords that occupy a slot the user asked for, as opposed to inserted passing events. */
function isStructuralKind(kind: PlannedAdvancedChord["kind"]): boolean {
  return kind === "diatonic" || kind === "functional-substitution" || kind === "borrowed";
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
// Validation, safe fallback, and note roles
// ---------------------------------------------------------------------------

/**
 * Build a safe, in-range closed voicing directly from a chord symbol's pitch
 * classes. Used as a fallback when a generated voicing fails validation, so the
 * chord symbol is always the source of truth for the notes that get committed.
 */
function buildSafeVoicing(pitchClasses: PitchClass[], rangeLow: number, rangeHigh: number): number[] {
  const baseOctave = Math.floor((rangeLow + rangeHigh) / 2 / 12) - 1;
  const midi = pitchClasses.map((pc) => pitchClassToMidi(pc, baseOctave));
  // Stack ascending so notes don't collide.
  midi.sort((a, b) => a - b);
  for (let i = 1; i < midi.length; i++) {
    while (midi[i] <= midi[i - 1]) midi[i] += 12;
  }
  const normalized = normalizeVoicingToRange(midi, rangeLow, rangeHigh);
  return normalized ?? midi.sort((a, b) => a - b);
}

/** Classify a note's role relative to a chord root (sharp-only intervals). */
function roleForInterval(interval: number): NoteRole {
  const mod = ((interval % 12) + 12) % 12;
  // Core chord tones: root (0), 3rd (3/4), 5th (7), 7th (9/10/11).
  if (mod === 0 || mod === 3 || mod === 4 || mod === 7 || mod === 9 || mod === 10 || mod === 11) {
    return "chordTone";
  }
  // Natural extensions: 9th (2), 11th (5), 13th (9 handled above as 6th/13th).
  if (mod === 2 || mod === 5) return "extension";
  // Everything else (b9, #9, b5/#11, #5/b13) is an alteration.
  return "alteration";
}

/**
 * Assign a role to each voiced note. The lowest note is tagged "bass"; the rest
 * are classified by their interval from the chord root.
 */
function assignRoles(midiAscending: number[], root: PitchClass): NoteRole[] {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  return midiAscending.map((midi, idx) => {
    if (idx === 0) return "bass";
    const interval = (PITCH_CLASSES.indexOf(toPitchClass(midi)) - rootIndex + 12) % 12;
    return roleForInterval(interval);
  });
}

// ---------------------------------------------------------------------------
// Voicing stage (shared by every mode)
// ---------------------------------------------------------------------------

/** How much a voicing's distance from its register target costs, per semitone. */
const REGISTER_WEIGHT = 0.3;
/** Weight on sensory roughness; see roughness.ts for the scale. */
const ROUGHNESS_WEIGHT = 0.25;
/** Bonus for the voice leading a Neo-Riemannian transform names. */
const TRANSFORM_BONUS = 2;
/** Beam search bounds — sized so the search costs about what greedy did. */
const BEAM_WIDTH = 4;
const MAX_CANDIDATES_PER_CHORD = 16;
/** Seeded jitter ceiling, matching the greedy path's tie band. */
const JITTER = 0.5;
/**
 * How much an unresolved tendency tone costs the search.
 *
 * `tendencyTones.ts` returns a penalty on a unit scale — 1.0 for a chordal
 * seventh left hanging, 1.6 for a leading tone stranded in the soprano. This
 * is the factor that puts it on the same scale as `calculateVoiceLeadingCost`,
 * where one extra semitone of motion in one voice is worth about 0.25 and two
 * voicings within `COST_TIE_BAND` (0.5) count as equally good. At 2.0 a single
 * unresolved seventh costs about as much as four extra semitones of voice
 * motion spread across the chord: enough to win every time the alternatives
 * are close, not enough to force a badly spaced or out-of-register voicing.
 * Calibrated by sweep; see §1a of CHORD_PROGRESSION_ASSESSMENT.md.
 */
const TENDENCY_WEIGHT = 2.0;

/**
 * Turn a finished chord plan into voiced MIDI: connect per-chord voicing
 * candidates across the whole progression, validate each choice against the
 * chord symbol, and tag each note with its harmonic role.
 *
 * Each candidate is charged for its own qualities (distance from the register
 * the tension curve asks for, whether it puts the planned bass note in the
 * bass, sensory roughness) and for the voice leading from the chord before;
 * a bounded Viterbi search then picks the cheapest path rather than the
 * cheapest next step.
 *
 * This is deliberately independent of how the plan was built, so the tertian
 * and pentatonic planners share one code path — and one validation gate.
 */
/**
 * Every voicing each chord could take, before the bass plan narrows them.
 * Generated ahead of the plan so the planner knows which bass pitches are
 * actually voiceable.
 */
function candidateVoicingsFor(
  planned: PlannedAdvancedChord[],
  options: AdvancedProgressionOptions,
  mood: ChordMoodProfile
): number[][][] {
  const { low, high } = clampVoiceRange(options.rangeLow, options.rangeHigh);
  return planned.map((chord) => {
    // Density follows the mood, and rises with the chord's own tension so the
    // peak of the phrase is thicker than its opening.
    const tension = chord.tensionLevel ?? 0.5;
    const densityShift = Math.round(mood.densityBias * 1.5 + (tension - 0.5));
    const voiceCount = Math.max(3, Math.min(5, options.voiceCount + densityShift)) as VoiceCount;
    const candidates = generateVoicingCandidates(chord, {
      style: options.voicingStyle,
      voiceCount,
      rangeLow: low,
      rangeHigh: high,
    });
    // A range too narrow for any shaped candidate still gets a playable chord.
    return candidates.length > 0 ? candidates : [buildSafeVoicing(chord.pitchClasses, low, high)];
  });
}

function voicePlannedChords(
  planned: PlannedAdvancedChord[],
  options: AdvancedProgressionOptions,
  seed: number,
  mood: ChordMoodProfile,
  allCandidates: number[][][]
): AdvancedProgressionResult {
  const { low, high } = clampVoiceRange(options.rangeLow, options.rangeHigh);
  // Aim at the mood's register rather than the midpoint of the allowed range,
  // clamped so a mood can colour the texture but never escape the user's range.
  const center = Math.max(low + 6, Math.min(high - 6, mood.registerCenter));
  // Seeded, so a given seed still reproduces exactly — but the voicing stage
  // has a source of variation for breaking near-ties.
  const voicingRng = createSeededRandom(seed ^ 0x2545f491);
  const search: VoicingSearch = options.voicingSearch ?? "beam";

  // How strictly each chord's candidates could honour the bass plan: the exact
  // pitch, only its pitch class, or not at all. Dependent candidates are held
  // to the same standard so a transform cannot override the plan.
  const bassAgreement = (chord: PlannedAdvancedChord, voicing: number[]): "pitch" | "pc" | "none" => {
    const bass = Math.min(...voicing);
    if (chord.plannedBassMidi !== undefined && bass === chord.plannedBassMidi) return "pitch";
    if (chord.plannedBass !== undefined && ((bass % 12) + 12) % 12 === PITCH_CLASSES.indexOf(chord.plannedBass)) {
      return "pc";
    }
    return "none";
  };
  const strictness: ("pitch" | "pc" | "none")[] = [];

  const candidatesPerChord = planned.map((chord, index) => {
    const candidates = allCandidates[index] ?? [buildSafeVoicing(chord.pitchClasses, low, high)];
    // The bass-line planner decided what sits underneath this chord, and at
    // which pitch; keep only the candidates that honour it, falling back to
    // the pitch class and then to everything when the range allows nothing
    // closer.
    if (chord.plannedBass !== undefined) {
      const exact = candidates.filter((voicing) => bassAgreement(chord, voicing) === "pitch");
      if (exact.length > 0) {
        strictness[index] = "pitch";
        return exact;
      }
      const sameClass = candidates.filter((voicing) => bassAgreement(chord, voicing) === "pc");
      if (sameClass.length > 0) {
        strictness[index] = "pc";
        return sameClass;
      }
    }
    strictness[index] = "none";
    return candidates;
  });

  /** Whether a candidate meets the bass standard its chord's regular candidates met. */
  const honoursPlan = (index: number, voicing: number[]): boolean => {
    const required = strictness[index] ?? "none";
    if (required === "none") return true;
    const agreement = bassAgreement(planned[index], voicing);
    return agreement === "pitch" || (required === "pc" && agreement === "pc");
  };

  // The register rises with tension, so the phrase's peak sits higher than
  // its opening and its cadence settles back down.
  const registerTargetFor = (chord: PlannedAdvancedChord): number =>
    Math.max(low + 6, Math.min(high - 6, center + ((chord.tensionLevel ?? 0.5) - 0.4) * 6));

  // What each chord *is*, so the transition cost can tell a leading tone from
  // any other note. Built once per progression and handed to the search.
  const identities = chordIdentities(planned);
  // Major pentatonic has no leading tone and no functional dominant, and its
  // sevenths are scale tones of sus chords rather than dissonances that owe a
  // resolution — so the tendency rules have nothing to say there and the
  // pentatonic path is left exactly as it was.
  const tendencyWeight =
    options.mode === "major_pentatonic" ? 0 : Math.max(0, options.tendencyWeight ?? TENDENCY_WEIGHT);

  const jitters = new Map<string, number>();
  const jitterFor = (index: number, voicing: number[]): number => {
    const key = `${index}:${voicing.join(",")}`;
    let value = jitters.get(key);
    if (value === undefined) {
      value = voicingRng() * JITTER;
      jitters.set(key, value);
    }
    return value;
  };

  const emission = (index: number, voicing: number[]): number => {
    const chord = planned[index];
    const centre = (voicing[0] + voicing[voicing.length - 1]) / 2;
    let cost = Math.abs(centre - registerTargetFor(chord)) * REGISTER_WEIGHT;
    if (index === 0) cost += spanPenalty(voicing) * 0.1;

    const bass = ((Math.min(...voicing) % 12) + 12) % 12;
    if (chord.plannedBass !== undefined) {
      if (bass === PITCH_CLASSES.indexOf(chord.plannedBass)) cost -= PLANNED_BASS_BONUS;
    } else if (
      (index === 0 || index === planned.length - 1) &&
      bass === PITCH_CLASSES.indexOf(chord.root)
    ) {
      cost -= ROOT_POSITION_BONUS;
    }

    cost += ROUGHNESS_WEIGHT * voicingRoughness(voicing);
    cost += jitterFor(index, voicing);
    return cost;
  };

  // A chord reached by a Neo-Riemannian transform brings its own voice
  // leading: hold the common tones, move the rest by the least possible. It
  // still has to put the planned note in the bass; the plan is not optional.
  const dependentCandidates = (index: number, previous: number[]) => {
    const chord = planned[index];
    if (!chord.transform) return [];
    const voicing = parsimoniousVoicing(
      previous,
      chord.pitchClasses.map((pc) => PITCH_CLASSES.indexOf(pc)),
      { low, high }
    );
    return voicing && honoursPlan(index, voicing) ? [{ voicing, bonus: TRANSFORM_BONUS }] : [];
  };

  let chosen: number[][];
  let costs: number[];

  if (search === "greedy") {
    chosen = [];
    costs = [];
    let previous: number[] | null = null;
    planned.forEach((chord, index) => {
      const extra = previous ? dependentCandidates(index, previous).map((entry) => entry.voicing) : [];
      const isStructuralArrival = index === 0 || index === planned.length - 1;
      const selection = pickBestVoiceLedCandidate(
        previous,
        [...candidatesPerChord[index], ...extra],
        registerTargetFor(chord),
        {
          preferRootPosition: isStructuralArrival,
          rootPitchClass: PITCH_CLASSES.indexOf(chord.root),
          preferredBassPitchClass:
            chord.plannedBass !== undefined ? PITCH_CLASSES.indexOf(chord.plannedBass) : undefined,
          rng: voicingRng,
          tendency:
            tendencyWeight > 0 && index > 0
              ? { weight: tendencyWeight, from: identities[index - 1], to: identities[index] }
              : undefined,
        }
      );
      chosen.push(selection.voicing);
      costs.push(selection.cost);
      previous = selection.voicing;
    });
  } else {
    const searched = searchVoicings({
      candidates: candidatesPerChord,
      identities,
      emission,
      transition: (previous, next, _index, context) =>
        calculateVoiceLeadingCost(previous, next) +
        (tendencyWeight > 0 ? tendencyWeight * tendencyPenalty(previous, next, context) : 0),
      dependentCandidates,
      beamWidth: BEAM_WIDTH,
      maxCandidates: MAX_CANDIDATES_PER_CHORD,
    });
    chosen = searched.voicings;
    costs = searched.costs;
  }

  // Report the geometric voice-leading cost only.
  //
  // The whole-progression rubric reads these numbers to compare eight *chord
  // plans*, and a chord that owes a resolution can owe one no voicing is able
  // to take — the leading tone of a `V7` running into a root-position `Imaj7`
  // at four voices has nowhere to go, because the only C in the chord is the
  // bass. Leaving the tendency term in the reported costs therefore charges
  // the plan for containing a dominant at all. Measured over 400 seeds at the
  // defaults: with the term left in, the share of generations carrying a
  // dominant falls from 47.8% to 37.0%; taking it out recovers 39.5%. The term
  // belongs to the voicing search, which is where it stays.
  if (tendencyWeight > 0) {
    costs = costs.map((cost, index) => {
      if (index === 0) return cost;
      const previous = chosen[index - 1];
      const current = chosen[index];
      if (!previous || !current) return cost;
      const penalty = tendencyPenalty(previous, current, {
        from: identities[index - 1],
        to: identities[index],
      });
      return cost - tendencyWeight * penalty;
    });
  }

  const voiced = [] as AdvancedProgressionResult["chords"];

  planned.forEach((chord, index) => {
    let finalVoicing = [...(chosen[index] ?? buildSafeVoicing(chord.pitchClasses, low, high))].sort(
      (a, b) => a - b
    );

    // --- Validation: every voiced pitch class must be implied by the symbol ---
    // The chord symbol is the single source of truth. If the voicing somehow
    // contains a tone the symbol doesn't allow, log a structured warning and
    // fall back to a safe voicing built directly from the symbol.
    const allowed = getChordPitchClasses(chord.symbol);
    if (allowed.length > 0) {
      const offending = finalVoicing
        .map((m) => toPitchClass(m))
        .filter((pc) => !allowed.includes(pc));
      if (offending.length > 0) {
        console.warn("[harmonia] invalid chord voicing — falling back to safe voicing", {
          symbol: chord.symbol,
          degree: chord.degreeLabel,
          expected: allowed,
          got: finalVoicing.map((m) => toPitchClass(m)),
          offending,
          seed,
        });
        finalVoicing = buildSafeVoicing(allowed, low, high);
      }
    }

    const { bass, inversion } = inversionOfVoicing(finalVoicing, chord.root);

    voiced.push({
      degreeLabel: chord.degreeLabel,
      symbol: chord.symbol,
      midi: finalVoicing,
      notes: finalVoicing.map((midi) => midiToNoteName(midi)),
      roles: assignRoles(finalVoicing, chord.root),
      durationClass: chord.durationClass ?? "full",
      bass,
      inversion,
    });
  });

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

// ---------------------------------------------------------------------------
// Finishing a candidate: bass plan, voicing, debug
// ---------------------------------------------------------------------------

type Candidate = {
  result: AdvancedProgressionResult;
  planned: PlannedAdvancedChord[];
  tensionCurve: number[];
  brightnessTargets: number[];
  scalePitchClasses: PitchClass[];
};

/**
 * Plan the bass line for a finished chord plan, voice it, and attach the
 * curves the planner worked against so the scorer can judge the result on
 * the same terms.
 */
function finishCandidate(params: {
  planned: PlannedAdvancedChord[];
  options: AdvancedProgressionOptions;
  seed: number;
  mood: ChordMoodProfile;
  tonic: PitchClass;
  tensionCurve: number[];
  brightnessTargets: number[];
  scalePitchClasses: PitchClass[];
}): Candidate {
  const { options, seed, mood } = params;
  // Voicing candidates come first so the planner only asks for bass pitches
  // that some voicing can actually put in the bass.
  const candidates = candidateVoicingsFor(params.planned, options, mood);
  const bassPlan = planBassLine(params.planned, {
    tonic: params.tonic,
    cadence: options.cadence ?? "resolve",
    rhythm: mood.harmonicRhythm,
    range: clampVoiceRange(options.rangeLow, options.rangeHigh),
    availableBassPitches: candidates.map((list) => new Set(list.map((voicing) => Math.min(...voicing)))),
    // The bass lives roughly a tenth below the mood's register centre.
    registerCentre: mood.registerCenter - 10,
    random: createSeededRandom(seed ^ 0x3c6ef372),
  });
  const planned = params.planned.map((chord, idx) => ({
    ...chord,
    plannedBass: bassPlan[idx]?.bass,
    plannedBassMidi: bassPlan[idx]?.pitch,
    plannedInversion: bassPlan[idx]?.inversion,
  }));

  const result = voicePlannedChords(planned, options, seed, mood, candidates);
  if (result.debug) {
    result.debug.tensionCurve = params.tensionCurve;
    result.debug.brightnessTargets = params.brightnessTargets;
    result.debug.bassPlan = bassPlan;
  }

  return {
    result,
    planned,
    tensionCurve: params.tensionCurve,
    brightnessTargets: params.brightnessTargets,
    scalePitchClasses: params.scalePitchClasses,
  };
}

// ---------------------------------------------------------------------------
// Major pentatonic generator
// ---------------------------------------------------------------------------

/**
 * Clean up a raw list of pentatonic degree indices before it becomes chords:
 *
 * 1. Drop any degree that can't carry a chord (only the 3rd).
 * 2. End on the tonic, matching the tertian path's cadence rule.
 * 3. Remove adjacent repeats — including the doubled tonic that step 2 creates
 *    when a template already ended near the tonic. A chord repeated back to
 *    back reads as one long chord, which wastes a slot the user asked for.
 *
 * Entirely deterministic: the same input always yields the same output.
 */
function resolvePentatonicDegrees(rawDegrees: number[]): PentatonicChordDegree[] {
  if (rawDegrees.length === 0) return [];

  const degrees: PentatonicChordDegree[] = rawDegrees.map((degree) =>
    isPentatonicChordDegree(degree) ? degree : 0
  );

  // Cadence on the tonic.
  degrees[degrees.length - 1] = 0;

  // Break adjacent repeats by preferring motion away from the previous chord,
  // ordered by how much contrast each degree gives: V and II are the colour
  // chords, vi is the other complete triad, I the tonic.
  const PREFERENCE: PentatonicChordDegree[] = [3, 1, 4, 0];

  for (let i = 1; i < degrees.length; i++) {
    if (degrees[i] !== degrees[i - 1]) continue;

    const next = degrees[i + 1];
    const replacement = PREFERENCE.find(
      (candidate) => candidate !== degrees[i - 1] && candidate !== next
    );
    // The last position must stay on the tonic, so fix the one before it instead.
    if (i === degrees.length - 1) {
      const previousReplacement = PREFERENCE.find(
        (candidate) => candidate !== 0 && candidate !== degrees[i - 2]
      );
      if (previousReplacement !== undefined) degrees[i - 1] = previousReplacement;
      continue;
    }
    if (replacement !== undefined) degrees[i] = replacement;
  }

  return degrees;
}

/**
 * Plan and voice a progression in major pentatonic.
 *
 * This is a separate path rather than a branch inside the tertian planner
 * because almost every step of that pipeline assumes seven degrees and a
 * leading tone. Pentatonic has neither, so:
 *
 * - chords come from the curated scale-safe vocabulary in `lib/theory/pentatonic`
 *   rather than from stacked thirds;
 * - the complexity dial adds scale tones (6ths, 9ths, sus 7ths) instead of
 *   extensions that would drag in notes from outside the scale;
 * - the chromatic toggles (secondary dominants, tritone subs, passing
 *   diminished, borrowed chords) are skipped — every one of them introduces a
 *   note the scale does not contain, which is exactly what a pentatonic
 *   setting is asking to avoid.
 *
 * The phrase-shape machinery (tension curve, tonic cadence, bass plan) is
 * reused as-is, so progressions still open and close where a listener expects.
 */
function generatePentatonicProgression(
  options: AdvancedProgressionOptions,
  seed: number,
  mood: ChordMoodProfile
): Candidate {
  const numChords = options.numChords ?? 4;
  const random = createSeededRandom(seed);

  const scale = getScaleDefinition(options.rootKey, "major_pentatonic");
  const tensionCurve = tensionCurveFor(options.tensionShape ?? "phrase", numChords).map((t) =>
    clamp01(t * mood.tensionScale)
  );
  const brightnessTargets = brightnessTargetsFor(
    resolveBrightnessCurve(options.brightnessCurve, options.mood ?? DEFAULT_CHORD_MOOD),
    mood.brightness,
    numChords
  );
  const rhythm = harmonicRhythmFor(mood.harmonicRhythm, numChords);

  const template =
    MAJOR_PENTATONIC_TEMPLATES[Math.floor(random() * MAJOR_PENTATONIC_TEMPLATES.length)] ??
    MAJOR_PENTATONIC_TEMPLATES[0];

  const degreeIndices = resolvePentatonicDegrees(
    adaptLength(template, numChords, "major_pentatonic", random)
  );

  const planned: PlannedAdvancedChord[] = degreeIndices.map((degreeIndex, idx) => {
    const isLast = idx === degreeIndices.length - 1;
    const chord = getPentatonicChord(scale, degreeIndex, options.complexity);

    return {
      degreeLabel: chord.degreeLabel,
      symbol: chord.symbol,
      root: chord.root,
      pitchClasses: chord.pitchClasses,
      kind: "diatonic",
      // No leading tone exists in this scale, so no chord here is a dominant.
      isDominant: false,
      role: isLast ? "cadential" : "structural",
      durationClass: rhythm[idx] ?? "full",
      tensionLevel: isLast ? 0 : tensionCurve[idx] ?? 0.5,
      isProtected: idx === 0 || isLast,
      functionTag: degreeIndex === 0 ? "tonic" : degreeIndex === 3 ? "dominant" : "predominant",
    };
  });

  return finishCandidate({
    planned: limitLength(planned, numChords),
    options,
    seed,
    mood,
    tonic: scale.pitchClasses[0],
    tensionCurve,
    brightnessTargets,
    scalePitchClasses: scale.pitchClasses,
  });
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

/**
 * Decide the chord the progression ends on.
 *
 * "resolve" rewrites the final chord to the tonic whatever it currently is —
 * including a chromatic insertion, which the previous kind-gated version left
 * alone and so frequently ended on. "open" leaves the plan's own ending in
 * place, which is what makes half cadences, deceptive endings and loop-friendly
 * progressions (I-V-vi-IV chief among them) reachable at all.
 *
 * A minor-mode progression may close on its major tonic instead — the Picardy
 * third — when the phrase is asked to end bright; that is decided by the
 * caller and passed in as `picardy`.
 *
 * Must run after the length cap: rewriting a chord that is about to be sliced
 * off resolves nothing.
 */
function applyCadence(
  planned: PlannedAdvancedChord[],
  params: {
    cadence: CadenceMode;
    scale: ReturnType<typeof getScaleDefinition>;
    romans: string[];
    complexity: AdvancedProgressionOptions["complexity"];
    random: () => number;
    allowRaisedDominant: boolean;
    picardy: boolean;
    mode: AdvancedProgressionOptions["mode"];
  }
): PlannedAdvancedChord[] {
  if (planned.length === 0) return planned;
  if (params.cadence === "open") return planned;

  const { scale, romans, complexity, random, allowRaisedDominant } = params;
  const tonicRoot = scale.pitchClasses[0];
  const lastChord = planned[planned.length - 1];
  const next = [...planned];

  if (params.picardy) {
    next[next.length - 1] = picardyTonic({ tonic: tonicRoot, complexity, mode: params.mode });
    return next;
  }

  if (lastChord.root === tonicRoot && lastChord.kind === "diatonic") return planned;

  next[next.length - 1] = buildDiatonicChordPlan({
    root: tonicRoot,
    degreeLabel: romans[0] ?? "I",
    degreeIndex: 0,
    scale,
    complexity,
    random,
    kind: "diatonic",
    tensionLevel: 0.0, // cadence = fully resolved
    isProtected: true,
    allowRaisedDominant,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/** How many candidate progressions are drawn and scored per generation. */
const DEFAULT_CANDIDATES = 8;

/** Derive an independent sub-seed so each candidate explores a different draw. */
function deriveSeed(baseSeed: number, index: number): number {
  return (baseSeed + index * 0x9e3779b1) >>> 0;
}

/**
 * Plan and voice one progression. Everything above this used to BE the
 * generator; it is now a single draw that the orchestrator can compare against
 * its siblings.
 */
function generateCandidate(
  options: AdvancedProgressionOptions,
  seed: number,
  mood: ChordMoodProfile
): Candidate {
  const numChords = options.numChords ?? 4;
  const scaleType = MODE_TO_SCALE_TYPE[options.mode] ?? "major";
  const isMinor = options.mode !== "ionian" && options.mode !== "mixolydian";
  const allowRaisedDominant = MODES_WITH_RAISED_DOMINANT.has(options.mode);
  const cadence = options.cadence ?? "resolve";

  const random = createSeededRandom(seed);

  // --- Phrase structure: the spine ---
  // Every slot gets a target tension from the chosen shape (scaled by the
  // mood, so "dreamy" stays flat where "dark" bites) and a target brightness.
  const tensionCurve = tensionCurveFor(options.tensionShape ?? "phrase", numChords).map((t) =>
    clamp01(t * mood.tensionScale)
  );
  const brightnessTargets = brightnessTargetsFor(
    resolveBrightnessCurve(options.brightnessCurve, options.mood ?? DEFAULT_CHORD_MOOD),
    mood.brightness,
    numChords
  );
  // Chord lengths come from the mood's harmonic-rhythm profile rather than
  // every chord being hardcoded to a full bar.
  const rhythm = harmonicRhythmFor(mood.harmonicRhythm, numChords);

  // --- Template selection and adaptation ---
  const chosenTemplatePool = isMinor ? MINORISH_TEMPLATES : MAJORISH_TEMPLATES;
  const template = chosenTemplatePool[Math.floor(random() * chosenTemplatePool.length)] ?? chosenTemplatePool[0];
  const baseDegreeIndices = adaptLength(
    template,
    numChords,
    isMinor ? "minor" : "major",
    random
  );

  // --- Slot planning against the curves ---
  const scale = getScaleDefinition(options.rootKey, scaleType);
  // Labels come from the scale itself, so they agree with the chords that sound
  // in every mode rather than only in ionian and aeolian.
  const romans = romanNumeralsForScale(scale);
  const tonic = scale.pitchClasses[0];

  // Probes inspect what a chord *would* be without consuming the seed.
  const probeRandom = () => 0.5;
  const slots = planSlots({
    baseDegreeIndices,
    mode: options.mode,
    scalePitchClasses: scale.pitchClasses,
    allowRaisedDominant,
    tensionTargets: tensionCurve,
    brightnessTargets,
    chromaticism: mood.chromaticism,
    varyDiatonic: options.useFunctionalSubstitutions ?? true,
    allowChromatic: options.useModalInterchange ?? false,
    probeDegree: (degreeIndex, tensionLevel) =>
      buildDiatonicChordPlan({
        root: scale.pitchClasses[degreeIndex] ?? tonic,
        degreeLabel: romans[degreeIndex] ?? romans[0],
        degreeIndex,
        scale,
        complexity: options.complexity,
        random: probeRandom,
        kind: "diatonic",
        tensionLevel,
        allowRaisedDominant,
      }),
    probeChromatic: (spec, tensionLevel) =>
      buildBorrowedChordPlan({ spec, tonic, complexity: options.complexity, tensionLevel }),
    triadQualityOf: (degreeIndex) =>
      degreeIndex === 4 && allowRaisedDominant ? "maj" : buildTriadFromScale(scale, degreeIndex).quality,
    random,
  });

  const plannedSlots = slots.map((choice, idx) => {
    const tension = tensionCurve[idx] ?? 0.5;
    const isProtected = idx === 0 || idx === slots.length - 1;

    if (choice.type === "chromatic") {
      return {
        ...buildBorrowedChordPlan({
          spec: choice.spec,
          tonic,
          complexity: options.complexity,
          tensionLevel: tension,
          transform: choice.transform,
          source: choice.transform ? `neo-riemannian:${choice.transform}` : undefined,
        }),
        isProtected,
      };
    }

    return buildDiatonicChordPlan({
      root: scale.pitchClasses[choice.degreeIndex] ?? tonic,
      degreeLabel: romans[choice.degreeIndex] ?? romans[0],
      degreeIndex: choice.degreeIndex,
      scale,
      complexity: options.complexity,
      random,
      kind: choice.swapped ? "functional-substitution" : "diatonic",
      tensionLevel: tension,
      isProtected,
      allowRaisedDominant,
    });
  });

  // --- Apply substitutions (gated by tension and context) ---
  let planned = plannedSlots;
  planned = injectSecondaryDominants(planned, options, random);
  planned = applyTritoneSubstitutions(planned, options, random);
  planned = insertPassingDiminished(planned, options, random);
  planned = insertSuspensions(planned, options, random);

  // --- Chromatic density validation (2/3 rule) ---
  planned = validateChromaticDensity(planned);

  // --- Length cap runs BEFORE the cadence ---
  // The substitution passes above grow the array past numChords. Capping after
  // the cadence was written would slice the resolution back off, so the chord
  // the listener actually ends on must be decided first.
  planned = limitLength(planned, numChords);

  // --- Resolution: ensure the progression ends where the cadence asks ---
  // A minor progression asked to end bright may close on a Picardy third.
  const tonicIsMinor = buildTriadFromScale(scale, 0).quality === "min";
  const picardy =
    tonicIsMinor &&
    cadence === "resolve" &&
    (options.useModalInterchange ?? false) &&
    random() < clamp01(brightnessTargets[numChords - 1] ?? 0) * mood.chromaticism;

  planned = applyCadence(planned, {
    cadence,
    scale,
    romans,
    complexity: options.complexity,
    random,
    allowRaisedDominant,
    picardy,
    mode: options.mode,
  });

  // --- Harmonic rhythm: structural chords take the mood's profile ---
  // Inserted chromatic chords keep the shorter duration they were given; those
  // are passing events and lengthening them would defeat the point.
  planned = planned.map((chord, idx) =>
    isStructuralKind(chord.kind)
      ? { ...chord, durationClass: rhythm[idx] ?? chord.durationClass }
      : chord
  );

  return finishCandidate({
    planned,
    options,
    seed,
    mood,
    tonic,
    tensionCurve,
    brightnessTargets,
    scalePitchClasses: scale.pitchClasses,
  });
}

/**
 * Draw several candidate progressions and keep the best.
 *
 * The melody engine has always done this — eight candidates, scored, argmax.
 * Chord generation was a single pass, so a bad template draw or an awkward
 * voicing sweep went straight to the user. Scoring whole progressions is what
 * lets the generator prefer one that cadences, moves its bass and describes a
 * register arc over one that merely happens to be legal.
 */
export function generateAdvancedProgression(
  options: AdvancedProgressionOptions
): AdvancedProgressionResult {
  const baseSeed = options.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const mood = chordMoodProfile(options.mood);
  const candidateCount = Math.max(1, options.candidateCount ?? DEFAULT_CANDIDATES);
  const scaleType = MODE_TO_SCALE_TYPE[options.mode] ?? "major";
  const tonic = getScaleDefinition(options.rootKey, scaleType).pitchClasses[0];
  const isPentatonic = options.mode === "major_pentatonic";

  // A mood's preferred ending applies only when the caller has not asked for one.
  const resolved: AdvancedProgressionOptions = {
    ...options,
    cadence: options.cadence ?? mood.cadence,
  };

  const scored: { candidate: Candidate; total: number }[] = [];

  for (let k = 0; k < candidateCount; k++) {
    const subSeed = deriveSeed(baseSeed, k);
    const candidate = isPentatonic
      ? generatePentatonicProgression(resolved, subSeed, mood)
      : generateCandidate(resolved, subSeed, mood);
    const score = scoreProgression({
      voiced: candidate.result.chords,
      planned: candidate.planned,
      voiceLeadingCosts: candidate.result.debug?.voiceLeadingCosts ?? [],
      tensionCurve: candidate.tensionCurve,
      tonic,
      mood,
      scalePitchClasses: candidate.scalePitchClasses,
      brightnessTargets: candidate.brightnessTargets,
    });
    scored.push({ candidate, total: score.total });
  }

  return pickAmongBest(scored, baseSeed).result;
}

/**
 * How close to the best score a candidate may be and still be considered a tie.
 *
 * A strict argmax is the wrong selector here. Scores cluster tightly, so taking
 * the single maximum makes the same few progressions win over and over —
 * measured, it cut the distinct-output count from 24 to 15, which sharpens the
 * very sameness this rubric exists to relieve. Treating near-equal candidates
 * as tied keeps the quality gain (the losing tail is still discarded) while
 * letting the seed choose between progressions that are, musically, equally
 * good.
 */
const SCORE_TIE_BAND = 0.06;

function pickAmongBest(
  scored: { candidate: Candidate; total: number }[],
  baseSeed: number
): Candidate {
  if (scored.length === 1) return scored[0].candidate;

  const best = Math.max(...scored.map((entry) => entry.total));
  const threshold = best - Math.abs(best) * SCORE_TIE_BAND;
  const contenders = scored.filter((entry) => entry.total >= threshold);

  // Deterministic in the seed, so a given seed still reproduces exactly.
  const pick = Math.floor(createSeededRandom(baseSeed ^ 0x5bf03635)() * contenders.length);
  return contenders[Math.min(pick, contenders.length - 1)].candidate;
}
