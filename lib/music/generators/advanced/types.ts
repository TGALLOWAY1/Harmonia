import type { Mode } from "@/lib/theory/harmonyEngine";
import type { PitchClass } from "@/lib/theory/midiUtils";

export type AdvancedComplexity = 1 | 2 | 3 | 4;

export type VoicingStyle =
  | "auto"
  | "closed"
  | "open"
  | "drop2"
  | "drop3"
  | "spread";

export type VoiceCount = 3 | 4 | 5;

export type ChordKind =
  | "diatonic"
  | "functional-substitution"
  | "secondary-dominant"
  | "tritone-substitution"
  | "passing"
  | "suspension";

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

export type PhraseRole =
  | "opening"
  | "continuation"
  | "pre-dominant"
  | "dominant"
  | "cadence";

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
  seed?: number;
};

export type VoicedChord = {
  degreeLabel: string;
  symbol: string;
  midi: number[];
  notes: string[];
  durationClass?: DurationClass;
};

export type AdvancedProgressionResult = {
  chords: VoicedChord[];
  labels?: string[];
  debug?: {
    seed: number;
    planned: PlannedAdvancedChord[];
    voiceLeadingCosts: number[];
  };
};

export type VoicingCandidateContext = {
  style: VoicingStyle;
  voiceCount: VoiceCount;
  rangeLow: number;
  rangeHigh: number;
};
