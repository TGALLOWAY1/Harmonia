/**
 * ChordGenerator Adapter
 *
 * This is the ONLY public entrypoint to ChordGenerator.
 * Never import from ChordGenerator/** outside this file.
 * See docs/chordgenerator-adapter-policy.md
 *
 * Imports: Uses relative paths into ChordGenerator/... (no Harmonia @/ aliases).
 * ChordGenerator modules used by the adapter (theory.ts, harmonyEngine, voicing)
 * use relative imports so they compile within Harmonia's tsconfig.
 *
 * Note normalization: Tonal note strings (e.g. "C4", "Bb3") are converted to MIDI,
 * then to Harmonia PitchClass (sharps-only) via midiToPitchClass. Octaves are stripped.
 */

import type { PitchClass } from "./theory/midiUtils";
import type { ScaleType } from "./theory/types";
import type { ChordQuality } from "./theory/chord";
import { midiToPitchClass } from "./theory/midiUtils";
import { Note } from "@tonaljs/tonal";
import {
  generateProgressionWithMode,
  type Mood,
  type ComplexityLevel,
} from "../ChordGenerator/Harmonia Chord Progression Generator/src/lib/theory";

export type { Mood, ComplexityLevel };

/** Harmonia canonical pitch classes (sharps-only). Reject flats (Bb, Eb, etc.) at runtime. */
const HARMONIA_PITCH_CLASSES: readonly PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

const VALID_PITCH_CLASS_SET = new Set<string>(HARMONIA_PITCH_CLASSES);

/**
 * Harmonia-shaped chord in a progression.
 * degree: ChordGenerator roman numeral passed through as string (preserves bVI, bVII, etc.).
 * quality conforms to ChordQuality. notes are sharps-only PitchClass[].
 * notesWithOctave: Tonal format (e.g. "C3", "D3") for playback and MIDI export.
 */
export type ChordProgressionItem = {
  degree: string;
  symbol: string;
  quality: ChordQuality;
  notes: PitchClass[];
  notesWithOctave: string[];
};

/** Validate root is a Harmonia PitchClass. Rejects "Bb", "Eb", etc. */
function assertValidPitchClass(root: PitchClass): asserts root is PitchClass {
  if (!VALID_PITCH_CLASS_SET.has(root)) {
    throw new Error(
      `Invalid root: "${root}". Harmonia uses sharps-only (C, C#, D, ..., A#, B). Use A# not Bb.`
    );
  }
}

/**
 * Normalize Tonal note strings to Harmonia PitchClass[] (sharps-only, no octaves).
 * Preserves chord tone order (root → third → fifth → seventh). Deduplicates by pitch class.
 */
function normalizeNotesToPitchClasses(tonalNotes: string[]): PitchClass[] {
  const seen = new Set<number>();
  const result: PitchClass[] = [];
  for (const noteName of tonalNotes) {
    const midi = Note.midi(noteName);
    if (typeof midi !== "number") continue;
    const pcIndex = midi % 12;
    if (seen.has(pcIndex)) continue;
    seen.add(pcIndex);
    result.push(midiToPitchClass(midi));
  }
  return result;
}

/**
 * Map ChordGenerator quality to Harmonia ChordQuality.
 * Supported: ""→maj, m→min, dim→dim, maj7→maj7, m7→min7, 7→dom7.
 * Unsupported (sus2, sus4, add9, m(add9), maj(add9)) map to closest: maj or min.
 */
export function mapQualityToHarmonia(cgQuality: string): ChordQuality {
  const supported: Record<string, ChordQuality> = {
    "": "maj",
    m: "min",
    dim: "dim",
    maj7: "maj7",
    m7: "min7",
    "7": "dom7",
  };
  const unsupportedToClosest: Record<string, ChordQuality> = {
    sus2: "maj",
    sus4: "maj",
    add9: "maj",
    "m(add9)": "min",
    "maj(add9)": "maj",
  };
  if (supported[cgQuality]) return supported[cgQuality];
  if (unsupportedToClosest[cgQuality]) return unsupportedToClosest[cgQuality];
  return "maj";
}

/** ChordGenerator Mode (harmonyEngine.ts) */
export type ChordGeneratorMode = "ionian" | "aeolian" | "dorian" | "mixolydian" | "phrygian";

/**
 * Harmonia ScaleType → ChordGenerator Mode mapping.
 * Used when calling harmonyEngine / theory.ts generateProgressionWithMode.
 */
export const SCALE_TYPE_TO_MODE: Record<ScaleType, ChordGeneratorMode> = {
  major: "ionian",
  natural_minor: "aeolian",
  dorian: "dorian",
  mixolydian: "mixolydian",
  phrygian: "phrygian",
};

/** Map Harmonia ScaleType to ChordGenerator Mode for harmonyEngine calls */
function scaleTypeToMode(scaleType: ScaleType): ChordGeneratorMode {
  return SCALE_TYPE_TO_MODE[scaleType];
}

/**
 * Generate a chord progression using ChordGenerator, returning Harmonia-shaped data.
 *
 * @param root - Pitch class (Harmonia sharps-only)
 * @param scaleType - Harmonia ScaleType
 * @param options - Optional mood and complexity (ChordGenerator-specific)
 */
export function generateChordProgression(
  root: PitchClass,
  scaleType: ScaleType,
  options?: { mood?: Mood; complexity?: ComplexityLevel }
): ChordProgressionItem[] {
  assertValidPitchClass(root);
  const mode = scaleTypeToMode(scaleType);
  const mood = options?.mood ?? "neutral";
  const complexity = options?.complexity ?? 1;

  const raw = generateProgressionWithMode(root, mode, mood, complexity);

  return raw.map((chord) => ({
    degree: chord.roman, // Preserve flat degrees (bVI, bVII, etc.) as string
    symbol: chord.symbol,
    quality: mapQualityToHarmonia(inferQualityFromSymbol(chord.symbol)),
    notes: normalizeNotesToPitchClasses(chord.notes),
    notesWithOctave: chord.notes,
  }));
}

/** Extract suffix from chord symbol (e.g. "Cm7" -> "m7") and return CG quality for mapping */
function inferQualityFromSymbol(symbol: string): string {
  const m = symbol.match(/^[A-G][#b]?(.*)$/);
  const suffix = m?.[1] ?? "";
  const suffixToCgQuality: Record<string, string> = {
    "": "",
    m: "m",
    dim: "dim",
    maj7: "maj7",
    m7: "m7",
    "7": "7",
    sus2: "sus2",
    sus4: "sus4",
    add9: "add9",
    madd9: "m(add9)",
    maj9: "maj(add9)",
  };
  return suffixToCgQuality[suffix] ?? suffix;
}
