/**
 * Mutation Engine
 *
 * Applies controlled, intensity-based mutations to an existing progression.
 * Produces near-neighbor variations while preserving the overall identity.
 */

import { PITCH_CLASSES, type PitchClass, pitchClassToMidi, midiToPitchClass, midiToNoteName } from "../theory/midiUtils";
import { buildTriadFromRoot, formatChordSymbol, getDiatonicChords } from "../theory/chord";
import type { ScaleType } from "../theory/types";
import type { Mode } from "../theory/harmonyEngine";
import type { Chord } from "../theory/progressionTypes";
import type { MutationChange, MutationRecord } from "./types";

function transposePitchClass(root: PitchClass, semitones: number): PitchClass {
  const index = PITCH_CLASSES.indexOf(root);
  return PITCH_CLASSES[(index + semitones + 120) % 12];
}

function modeToScaleType(mode: Mode): ScaleType {
  switch (mode) {
    case "ionian": return "major";
    case "aeolian": return "natural_minor";
    case "dorian": return "dorian";
    case "mixolydian": return "mixolydian";
    case "phrygian": return "phrygian";
    default: return "major";
  }
}

// ─── Mutation operations ───

type MutationOp = (
  chord: Chord,
  index: number,
  allChords: Chord[],
  keyRoot: PitchClass,
  mode: Mode,
) => { chord: Chord; change: MutationChange } | null;

/** Change the inversion by moving the lowest note up an octave. */
const invertChord: MutationOp = (chord, index) => {
  if (!chord.midiNotes || chord.midiNotes.length < 3) return null;

  const sorted = [...chord.midiNotes].sort((a, b) => a - b);
  const lowest = sorted[0];
  const newMidi = sorted.slice(1).concat([lowest + 12]).sort((a, b) => a - b);
  const newNotesWithOctave = newMidi.map(m => midiToNoteName(m));

  return {
    chord: { ...chord, midiNotes: newMidi, notesWithOctave: newNotesWithOctave },
    change: {
      chordIndex: index,
      changeType: "inversion",
      description: `Chord ${index + 1} inversion changed`,
      before: chord.notesWithOctave?.join(", ") ?? chord.notes.join(", "),
      after: newNotesWithOctave.join(", "),
    },
  };
};

/** Shift all notes up or down by an octave (register change). */
const shiftRegister: MutationOp = (chord, index) => {
  if (!chord.midiNotes || chord.midiNotes.length === 0) return null;

  const avgMidi = chord.midiNotes.reduce((s, n) => s + n, 0) / chord.midiNotes.length;
  const direction = avgMidi > 66 ? -12 : 12; // Shift down if high, up if low

  const newMidi = chord.midiNotes.map(m => m + direction);
  // Clamp to reasonable range
  if (newMidi.some(m => m < 36 || m > 96)) return null;

  const newNotesWithOctave = newMidi.map(m => midiToNoteName(m));

  return {
    chord: { ...chord, midiNotes: newMidi, notesWithOctave: newNotesWithOctave },
    change: {
      chordIndex: index,
      changeType: "register",
      description: `Chord ${index + 1} moved ${direction > 0 ? "up" : "down"} one octave`,
      before: chord.notesWithOctave?.join(", ") ?? "",
      after: newNotesWithOctave.join(", "),
    },
  };
};

/** Add or remove a 7th from the chord. */
const toggleExtension: MutationOp = (chord, index, _all, keyRoot, mode) => {
  if (!chord.midiNotes || chord.midiNotes.length === 0) return null;
  const root = (chord.root ?? chord.notes[0]) as PitchClass;

  if (chord.midiNotes.length <= 3) {
    // Add a 7th
    const scaleType = modeToScaleType(mode);
    const diatonic = getDiatonicChords(keyRoot, scaleType);
    const degreeIdx = diatonic.triads.findIndex(t => t.triad.root === root);

    let seventhInterval: number;
    if (degreeIdx >= 0) {
      const seventh = diatonic.sevenths[degreeIdx].seventh;
      const rootSemitone = PITCH_CLASSES.indexOf(seventh.root);
      const seventhSemitone = PITCH_CLASSES.indexOf(seventh.pitchClasses[3]);
      seventhInterval = (seventhSemitone - rootSemitone + 12) % 12;
    } else {
      seventhInterval = 10; // Default to dominant 7th
    }

    const highestMidi = Math.max(...chord.midiNotes);
    const rootMidi = pitchClassToMidi(root, Math.floor(highestMidi / 12) - 1);
    let seventhMidi = rootMidi + seventhInterval;
    // Place near the top of the voicing
    while (seventhMidi < highestMidi - 6) seventhMidi += 12;
    while (seventhMidi > highestMidi + 12) seventhMidi -= 12;

    const newMidi = [...chord.midiNotes, seventhMidi].sort((a, b) => a - b);
    const newNotesWithOctave = newMidi.map(m => midiToNoteName(m));
    const seventhPc = midiToPitchClass(seventhMidi);
    const newNotes = [...new Set([...chord.notes, seventhPc])];

    const newQuality = seventhInterval === 11 ? "maj7" : seventhInterval === 10 ? "dom7" : "min7";
    const newSymbol = formatChordSymbol(root, newQuality);

    return {
      chord: {
        ...chord,
        midiNotes: newMidi,
        notesWithOctave: newNotesWithOctave,
        notes: newNotes,
        symbol: newSymbol,
        quality: newQuality as Chord["quality"],
      },
      change: {
        chordIndex: index,
        changeType: "extension",
        description: `Chord ${index + 1} gained a 7th`,
        before: chord.symbol,
        after: newSymbol,
      },
    };
  } else {
    // Remove the 7th (reduce to triad)
    const triad = buildTriadFromRoot(root, chord.quality === "maj7" || chord.quality === "dom7" || chord.quality === "7" ? "maj" : "min");
    const triadPcs = new Set(triad.pitchClasses as PitchClass[]);

    // Keep only MIDI notes whose pitch class is in the triad
    const newMidi = chord.midiNotes.filter(m => triadPcs.has(midiToPitchClass(m)));
    if (newMidi.length < 3) return null;

    const newNotesWithOctave = newMidi.map(m => midiToNoteName(m));
    const newSymbol = formatChordSymbol(root, triad.quality);

    return {
      chord: {
        ...chord,
        midiNotes: newMidi,
        notesWithOctave: newNotesWithOctave,
        notes: triad.pitchClasses,
        symbol: newSymbol,
        quality: triad.quality as Chord["quality"],
      },
      change: {
        chordIndex: index,
        changeType: "extension",
        description: `Chord ${index + 1} simplified to triad`,
        before: chord.symbol,
        after: newSymbol,
      },
    };
  }
};

/** Replace one chord with a diatonic neighbor that shares notes. */
const diatonicSubstitution: MutationOp = (chord, index, _all, keyRoot, mode) => {
  const root = (chord.root ?? chord.notes[0]) as PitchClass;
  const scaleType = modeToScaleType(mode);
  const diatonic = getDiatonicChords(keyRoot, scaleType);
  const chordPcs = new Set(chord.notes.map(n => n as PitchClass));

  // Find diatonic chords sharing notes
  const candidates = diatonic.triads
    .filter(t => t.triad.root !== root)
    .map(t => ({
      triad: t,
      shared: t.triad.pitchClasses.filter(pc => chordPcs.has(pc)).length,
    }))
    .filter(c => c.shared >= 2)
    .sort((a, b) => b.shared - a.shared);

  if (candidates.length === 0) return null;

  const pick = candidates[0];
  const newRoot = pick.triad.triad.root;
  const newSymbol = formatChordSymbol(newRoot, pick.triad.triad.quality);
  const sourceMidi = chord.midiNotes ?? [];

  // Voice near original register
  let newMidi: number[];
  if (sourceMidi.length > 0) {
    const avgMidi = sourceMidi.reduce((s, n) => s + n, 0) / sourceMidi.length;
    const octave = Math.round(avgMidi / 12) - 1;
    newMidi = pick.triad.triad.pitchClasses.map(pc => {
      const base = pitchClassToMidi(pc, octave);
      if (base < avgMidi - 12) return base + 12;
      if (base > avgMidi + 12) return base - 12;
      return base;
    }).sort((a, b) => a - b);
  } else {
    newMidi = pick.triad.triad.pitchClasses.map(pc => pitchClassToMidi(pc, 3));
  }

  return {
    chord: {
      ...chord,
      symbol: newSymbol,
      root: newRoot,
      quality: pick.triad.triad.quality as Chord["quality"],
      notes: pick.triad.triad.pitchClasses,
      romanNumeral: pick.triad.degree,
      midiNotes: newMidi,
      notesWithOctave: newMidi.map(m => midiToNoteName(m)),
    },
    change: {
      chordIndex: index,
      changeType: "substitution",
      description: `Chord ${index + 1} replaced with ${pick.triad.degree} (${newSymbol})`,
      before: chord.symbol,
      after: newSymbol,
    },
  };
};

/** Change voicing by spreading or closing intervals. */
const changeVoicing: MutationOp = (chord, index) => {
  if (!chord.midiNotes || chord.midiNotes.length < 3) return null;

  const sorted = [...chord.midiNotes].sort((a, b) => a - b);
  const spread = sorted[sorted.length - 1] - sorted[0];

  let newMidi: number[];
  let desc: string;

  if (spread > 14) {
    // Close voicing: move highest note down
    newMidi = [...sorted];
    newMidi[newMidi.length - 1] -= 12;
    if (newMidi[newMidi.length - 1] < 36) return null;
    newMidi.sort((a, b) => a - b);
    desc = "closed voicing";
  } else {
    // Open voicing: move second note up
    newMidi = [...sorted];
    if (newMidi.length >= 3) {
      newMidi[1] += 12;
      if (newMidi[1] > 96) return null;
    }
    newMidi.sort((a, b) => a - b);
    desc = "open voicing";
  }

  return {
    chord: {
      ...chord,
      midiNotes: newMidi,
      notesWithOctave: newMidi.map(m => midiToNoteName(m)),
    },
    change: {
      chordIndex: index,
      changeType: "voicing",
      description: `Chord ${index + 1} changed to ${desc}`,
      before: sorted.map(m => midiToNoteName(m)).join(", "),
      after: newMidi.map(m => midiToNoteName(m)).join(", "),
    },
  };
};

// ─── Mutation intensity mapping ───

interface IntensityConfig {
  maxChanges: number;
  operations: MutationOp[];
}

function getIntensityConfig(intensity: number): IntensityConfig {
  if (intensity <= 20) {
    return {
      maxChanges: 1,
      operations: [invertChord, shiftRegister, changeVoicing],
    };
  }
  if (intensity <= 50) {
    return {
      maxChanges: 1,
      operations: [invertChord, changeVoicing, toggleExtension, shiftRegister],
    };
  }
  if (intensity <= 80) {
    return {
      maxChanges: 2,
      operations: [diatonicSubstitution, toggleExtension, changeVoicing, invertChord],
    };
  }
  // 81-100: Adventurous
  return {
    maxChanges: 2,
    operations: [diatonicSubstitution, toggleExtension, changeVoicing, invertChord, shiftRegister],
  };
}

/**
 * Mutate a progression with the given intensity (0-100).
 * Returns the mutated chords and a record of changes.
 */
export function mutateProgression(
  chords: Chord[],
  intensity: number,
  keyRoot: PitchClass,
  mode: Mode,
  lockedIndices?: Set<number>,
): { chords: Chord[]; record: MutationRecord } {
  const config = getIntensityConfig(intensity);
  const mutatedChords = [...chords];
  const changes: MutationChange[] = [];

  // Build list of mutable chord indices
  const mutableIndices = chords
    .map((_, i) => i)
    .filter(i => !chords[i].isLocked && !(lockedIndices?.has(i)));

  if (mutableIndices.length === 0) {
    return {
      chords: mutatedChords,
      record: {
        id: `mut-${Date.now()}`,
        progressionId: "",
        mutationIntensity: intensity,
        changes: [],
        createdAt: Date.now(),
      },
    };
  }

  // Shuffle mutable indices for variety
  const shuffled = [...mutableIndices].sort(() => Math.random() - 0.5);

  let applied = 0;
  for (const chordIdx of shuffled) {
    if (applied >= config.maxChanges) break;

    // Try each operation until one succeeds
    for (const op of config.operations) {
      const result = op(mutatedChords[chordIdx], chordIdx, mutatedChords, keyRoot, mode);
      if (result) {
        mutatedChords[chordIdx] = result.chord;
        changes.push(result.change);
        applied++;
        break;
      }
    }
  }

  return {
    chords: mutatedChords,
    record: {
      id: `mut-${Date.now()}`,
      progressionId: "",
      mutationIntensity: intensity,
      changes,
      createdAt: Date.now(),
    },
  };
}
