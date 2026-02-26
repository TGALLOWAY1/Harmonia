/**
 * ChordGenerator Adapter
 *
 * This is the ONLY public entrypoint to ChordGenerator.
 * Never import from ChordGenerator/** outside this file.
 * See docs/chordgenerator-adapter-policy.md
 *
 * It bridges Harmonia canonical pitch classes to the internal harmonyEngine logic,
 * completely bypassing Tonal.js logic and legacy wrappers.
 */

import type { PitchClass } from "./theory/midiUtils";
import { PITCH_CLASSES } from "./theory/midiUtils";
import type { ScaleType } from "./theory/types";
import type { ChordQuality } from "./theory/chord";
import { buildTriadFromRoot, buildSeventhFromRoot, formatChordSymbol } from "./theory/chord";
import { mapTriadToMidi, mapSeventhToMidi } from "./theory/mapping";
import { midiToNoteName } from "./theory/midiUtils";

import {
  generateProgression as generateHarmonyProgression,
  type Mode as HarmonyMode,
  type Mood as HarmonyMood,
  type Depth as HarmonyDepth,
  type Degree,
} from "./theory/harmonyEngine";

// Re-export specific UI properties
export type Mood = "happy" | "sad" | "dark" | "hopeful" | "neutral";
export type ComplexityLevel = 0 | 1 | 2 | 3;

/**
 * Harmonia-shaped chord in a progression.
 * degree: ChordGenerator roman numeral passed through as string (preserves bVI, bVII, etc.).
 * quality conforms to ChordQuality. notes are sharps-only PitchClass[].
 * notesWithOctave: canonical C3-B3 octaves for MIDI export/playback.
 */
export type ChordProgressionItem = {
  degree: string;
  symbol: string;
  quality: ChordQuality;
  notes: PitchClass[];
  notesWithOctave: string[];
};

/** Validate root is a Harmonia PitchClass. */
function assertValidPitchClass(root: PitchClass): asserts root is PitchClass {
  if (!PITCH_CLASSES.includes(root)) {
    throw new Error(
      `Invalid root: "${root}". Harmonia uses sharps-only (C, C#, D, ..., A#, B). Use A# not Bb.`
    );
  }
}

/**
 * Map ChordGenerator quality to Harmonia ChordQuality.
 */
export function mapQualityToHarmonia(cgQuality: string): ChordQuality {
  const supported: Record<string, ChordQuality> = {
    "": "maj",
    m: "min",
    dim: "dim",
    maj7: "maj7",
    m7: "min7",
    "7": "dom7",
    "half-dim7": "half-dim7",
    "dim7": "dim7",
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

export type ChordGeneratorMode = "ionian" | "aeolian" | "dorian" | "mixolydian" | "phrygian";

export const SCALE_TYPE_TO_MODE: Record<ScaleType, ChordGeneratorMode> = {
  major: "ionian",
  natural_minor: "aeolian",
  dorian: "dorian",
  mixolydian: "mixolydian",
  phrygian: "phrygian",
};

/**
 * Generate a chord progression using ChordGenerator, returning Harmonia-shaped data.
 */
export function generateChordProgression(
  root: PitchClass,
  scaleType: ScaleType,
  options?: { mood?: Mood; complexity?: ComplexityLevel }
): ChordProgressionItem[] {
  assertValidPitchClass(root);
  const mode = SCALE_TYPE_TO_MODE[scaleType] as HarmonyMode;

  // Mood / Complexity mappings (from former theory wrapper)
  const MOOD_TO_ENGINE_MOOD: Record<Mood, HarmonyMood> = {
    happy: "happy",
    sad: "melancholic",
    dark: "dark",
    hopeful: "optimistic",
    neutral: "moody",
  };
  const mood = options?.mood ?? "neutral";
  const harmonyMood = MOOD_TO_ENGINE_MOOD[mood] ?? "moody";

  const complexity = options?.complexity ?? 1;
  const depth = (complexity <= 0 ? 0 : complexity === 1 ? 1 : 2) as HarmonyDepth;

  const rawChords = generateHarmonyProgression({
    rootKey: root,
    mode,
    mood: harmonyMood,
    depth,
    numChords: 4,
  });

  return rawChords.map((chord) => {
    const cgQuality = chord.quality;
    const harmoniaQuality = mapQualityToHarmonia(cgQuality);
    const chordRoot = getDegreeRootPitchClass(root, mode, chord.degree);

    // Build the canonical chord (Triad or Seventh)
    const isSeventh = harmoniaQuality.includes("7");

    let pitchClasses: PitchClass[];
    let notesWithOctave: string[];

    if (isSeventh) {
      // NOTE: For 'half-dim7' or 'dim7' we would need to map properly.
      // But mapQualityToHarmonia currently resolves complex CG qualities usually to maj, min, maj7, min7, dom7, or dim triad.
      // If we did return half-dim7, we handle it if our builder supports it.
      // buildSeventhFromRoot currently only supports maj7, min7, dom7. 
      // If we got 'dim7' or 'half-dim7' we would need to fallback to 'min7' or extend builder.
      const safeSeventhQuality = (harmoniaQuality === "maj7" || harmoniaQuality === "min7" || harmoniaQuality === "dom7") ? harmoniaQuality : "min7";
      const seventhChord = buildSeventhFromRoot(chordRoot, safeSeventhQuality);
      pitchClasses = seventhChord.pitchClasses;
      const mapped = mapSeventhToMidi(seventhChord, 3);
      notesWithOctave = mapped.midiNotes.map(midiToNoteName);
    } else {
      const triadChord = buildTriadFromRoot(chordRoot, harmoniaQuality as any);
      pitchClasses = triadChord.pitchClasses;
      const mapped = mapTriadToMidi(triadChord, 3);
      notesWithOctave = mapped.midiNotes.map(midiToNoteName);
    }

    const symbol = formatChordSymbol(chordRoot, harmoniaQuality);

    return {
      degree: chord.degree,
      symbol,
      quality: harmoniaQuality,
      notes: pitchClasses,
      notesWithOctave,
    };
  });
}

// Geometric computation of degree root based on interval offsets
function getDegreeRootPitchClass(keyRoot: PitchClass, mode: HarmonyMode, degree: Degree): PitchClass {
  const MODE_DEGREE_OFFSETS: Record<HarmonyMode, number[]> = {
    ionian: [0, 2, 4, 5, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };

  const ROMAN_INDEX: Record<string, number> = {
    I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6,
  };

  const flats = (degree.match(/b/g) ?? []).length;
  const sharps = (degree.match(/#/g) ?? []).length;
  const normalizedNumeral = degree.replace(/[b#°]/g, "").toUpperCase();
  const index = ROMAN_INDEX[normalizedNumeral] ?? 0;
  const offsets = MODE_DEGREE_OFFSETS[mode] ?? MODE_DEGREE_OFFSETS.ionian;
  const base = offsets[index] ?? 0;

  let offset = (base - flats + sharps) % 12;
  if (offset < 0) offset += 12;

  const rootIndex = PITCH_CLASSES.indexOf(keyRoot);
  const chordRootIndex = (rootIndex + offset) % 12;
  return PITCH_CLASSES[chordRootIndex];
}
