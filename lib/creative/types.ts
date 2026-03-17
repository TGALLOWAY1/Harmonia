/**
 * Creative Iteration Types
 *
 * Data models for chord substitution, mutation, and interactive editing.
 */

import type { PitchClass } from "../theory/midiUtils";
import type { ChordQuality } from "../theory/chord";
import type { DurationClass } from "../music/generators/advanced/types";

// ─── Source Tracking ───

export type ChordSourceType = "generated" | "substituted" | "mutated" | "manual";
export type NoteSourceType = "generated" | "user_added" | "user_moved";

// ─── Progression Chord (extended) ───

export interface ProgressionChord {
  id: string;
  symbol: string;
  root: PitchClass;
  quality: ChordQuality;
  notes: string[];               // pitch classes
  midiNotes: number[];
  notesWithOctave: string[];
  romanNumeral: string;
  startBeat: number;
  durationBeats: number;
  durationClass?: DurationClass;
  sourceType: ChordSourceType;
  isLocked: boolean;
  derivedFromChordId?: string;
  explanation?: string;
  customLabel?: string;
}

// ─── Substitution Option ───

export type SubstitutionCategory =
  | "diatonic"
  | "relative"
  | "dominant-function"
  | "tritone"
  | "modal-mixture"
  | "inversion";

export interface SubstitutionOption {
  id: string;
  sourceChordId: string;
  candidateSymbol: string;
  candidateRoot: PitchClass;
  candidateQuality: string;
  candidateNotes: PitchClass[];
  candidateMidiNotes: number[];
  candidateNotesWithOctave: string[];
  candidateRomanNumeral: string;
  category: SubstitutionCategory;
  reason: string;
  confidenceScore: number;       // 0-1
}

// ─── Mutation Record ───

export interface MutationChange {
  chordIndex: number;
  changeType: "inversion" | "voicing" | "register" | "extension" | "substitution" | "color";
  description: string;
  before: string;
  after: string;
}

export interface MutationRecord {
  id: string;
  progressionId: string;
  mutationIntensity: number;    // 0-100
  changes: MutationChange[];
  createdAt: number;
}

// ─── Note Event ───

export interface NoteEvent {
  id: string;
  progressionChordId: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
  sourceType: NoteSourceType;
}

// ─── Chord Interpretation Result ───

export interface ChordInterpretation {
  symbol: string;
  root: PitchClass;
  quality: string;
  inversion: number;
  confidence: number;           // 0-1
  alternates: Array<{
    symbol: string;
    confidence: number;
  }>;
  isCustomVoicing: boolean;
  customLabel?: string;
}
