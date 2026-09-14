import type { ChordMood } from "./chordMoods";
import type { Mode } from "@/lib/theory/harmonyEngine";
import type { PitchClass } from "@/lib/theory/midiUtils";

export type AdvancedComplexity = 1 | 2 | 3 | 4;

export type VoicingStyle =
  | "auto"
  | "closed"
  | "open"
  | "drop2"
  | "drop3"
  | "drop24"
  | "spread";

export type VoiceCount = 3 | 4 | 5;

export type ChordKind =
  | "diatonic"
  | "functional-substitution"
  | "secondary-dominant"
  | "tritone-substitution"
  | "passing"
  | "suspension"
  /**
   * A chord borrowed from a parallel mode, reached by a Neo-Riemannian
   * transform, or a Picardy third. Structural (it occupies a slot the user
   * asked for) but chromatic (it carries a note outside the home scale).
   */
  | "borrowed";

/**
 * Harmonic function, on the scale the tension model uses (Herremans & Chew):
 * tonic 0.00, mediant/submediant 0.25, pre-dominant 0.50, dominant 0.85,
 * applied dominant 0.95, remote chromatic harmony (Neapolitan, hexatonic pole) 1.00.
 */
export type HarmonicFunction =
  | "tonic"
  | "mediant"
  | "predominant"
  | "dominant"
  | "applied"
  | "chromatic";

/**
 * Named target-tension curves. "phrase" is the classical, length-keyed arch
 * that peaks on the dominant slot; the rest are the explicit shapes from the
 * MorpheuS-style target-tension literature.
 */
export type TensionShape =
  | "phrase"
  | "arch"
  | "ramp"
  | "question"
  | "plateau"
  | "collapse";

/**
 * How brightness should travel across the phrase. Drives which borrowed
 * chords are chosen (each is tagged with its source mode's brightness).
 * "auto" lets the mood choose.
 */
export type BrightnessCurve =
  | "auto"
  | "steady"
  | "darkening"
  | "sunrise"
  | "arch"
  | "collapse";

/** Which search connects the per-chord voicing candidates. */
export type VoicingSearch = "beam" | "greedy";

export type ChordRole =
  | "structural"
  | "passing"
  | "approach"
  | "suspension"
  | "embellishment"
  | "cadential";

export type DurationClass =
  | "full"      // 4 beats (1 measure)
  | "half"      // 2 beats
  | "quarter"   // 1 beat
  | "eighth";   // half beat

/**
 * How the progression ends.
 * - "resolve": rewrite the final chord to the tonic (a full stop).
 * - "open": keep the plan's own ending, so half, deceptive and loop-friendly
 *   endings survive instead of every progression landing on I.
 */
export type CadenceMode = "resolve" | "open";

export type PhraseRole =
  | "opening"
  | "continuation"
  | "pre-dominant"
  | "dominant"
  | "cadence";

/**
 * The harmonic role of an individual note within (or against) a chord. Used to
 * keep sustained chord tones separate from non-chord tones (melody, passing
 * tones, etc.) so they are never silently mixed into the chord voicing.
 */
export type NoteRole =
  | "chordTone"
  | "extension"
  | "alteration"
  | "passingTone"
  | "melody"
  | "approachTone"
  | "bass";

export type PlannedAdvancedChord = {
  degreeLabel: string;
  symbol: string;
  root: PitchClass;
  pitchClasses: PitchClass[];
  kind: ChordKind;
  isDominant?: boolean;
  role?: ChordRole;
  durationClass?: DurationClass;
  tensionLevel?: number;
  phraseRole?: PhraseRole;
  isProtected?: boolean;
  /** 0-based scale degree, when the chord is built on one. */
  degreeIndex?: number;
  /** Harmonic function, used by the tension model. */
  functionTag?: HarmonicFunction;
  /** −1..1 brightness relative to the home mode (see modalInterchange.ts). */
  brightness?: number;
  /** Where a borrowed chord came from, e.g. "borrowed:aeolian", "neo-riemannian:PL". */
  source?: string;
  /** The Neo-Riemannian transform that reached this chord from the previous one. */
  transform?: string;
  /** Bass pitch class chosen by the bass-line planner. */
  plannedBass?: PitchClass;
  /** The exact MIDI pitch the planner wants in the bass. */
  plannedBassMidi?: number;
  /** Inversion the bass-line planner asked for (0 = root position). */
  plannedInversion?: number;
};

export type AdvancedProgressionOptions = {
  rootKey: PitchClass;
  mode: Mode;
  numChords?: number;
  complexity: AdvancedComplexity;
  voicingStyle: VoicingStyle;
  voiceCount: VoiceCount;
  rangeLow: number;
  rangeHigh: number;
  usePassingChords: boolean;
  useSuspensions: boolean;
  useSecondaryDominants: boolean;
  useTritoneSubstitution: boolean;
  useFunctionalSubstitutions?: boolean;
  /** How the progression ends. Defaults to the mood's preference. */
  cadence?: CadenceMode;
  /** Emotional character. Drives tension, register, density and rhythm. */
  mood?: ChordMood;
  /** Target-tension curve the chords are chosen against. Defaults to "phrase". */
  tensionShape?: TensionShape;
  /** How brightness travels across the phrase. Defaults to the mood's choice. */
  brightnessCurve?: BrightnessCurve;
  /**
   * Allow one borrowed chord per phrase (modal interchange, Neo-Riemannian
   * mediants, Picardy third). Off at complexity 1 in the app's presets.
   */
  useModalInterchange?: boolean;
  /** Voicing search. "beam" connects whole progressions; "greedy" is chord by chord. */
  voicingSearch?: VoicingSearch;
  /** How many candidates to draw and score. Defaults to 8. */
  candidateCount?: number;
  seed?: number;
};

export type VoicedChord = {
  degreeLabel: string;
  symbol: string;
  midi: number[];
  notes: string[];
  /** Per-note harmonic role, parallel to `midi`/`notes`. */
  roles: NoteRole[];
  durationClass?: DurationClass;
  /** Pitch class actually sounding in the bass. */
  bass?: PitchClass;
  /** 0 root position, 1/2/3 inversions, −1 when the bass is not a chord tone. */
  inversion?: number;
};

export type AdvancedProgressionResult = {
  chords: VoicedChord[];
  labels?: string[];
  debug?: {
    seed: number;
    planned: PlannedAdvancedChord[];
    voiceLeadingCosts: number[];
    /** Target tension per slot, after mood scaling. */
    tensionCurve?: number[];
    /** Brightness target per slot. */
    brightnessTargets?: number[];
    /** The bass-line planner's choice and reason for each chord. */
    bassPlan?: { bass: PitchClass; pitch: number; inversion: number; reason: string }[];
  };
};

export type VoicingCandidateContext = {
  style: VoicingStyle;
  voiceCount: VoiceCount;
  rangeLow: number;
  rangeHigh: number;
};
