import type { PitchClass } from "../theory/midiUtils";
import type { Mode } from "../theory/harmonyEngine";
import { buildTriadFromRoot, formatChordSymbol, buildTriadFromScale, buildSeventhFromScale } from "../theory/chord";
import { getMajorPentatonicChords } from "../theory/pentatonic";
import { getScaleDefinition } from "../theory/scale";
import { pitchClassToMidi } from "../theory/midiUtils";
import type { ScaleType } from "../theory/types";
import type { HarmonicEvent } from "./types";

const NOTES: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function modeToScaleType(mode: Mode): ScaleType {
  switch (mode) {
    case "ionian": return "major";
    case "aeolian": return "natural_minor";
    case "dorian": return "dorian";
    case "mixolydian": return "mixolydian";
    case "phrygian": return "phrygian";
    case "major_pentatonic": return "major_pentatonic";
    default: return "major";
  }
}

interface DiatonicChordInfo {
  root: PitchClass;
  quality: string;
  symbol: string;
  romanNumeral: string;
  pitchClasses: PitchClass[];
}

const MAJOR_NUMERALS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const MINOR_NUMERALS = ["i", "ii°", "III", "iv", "v", "VI", "VII"];
const DORIAN_NUMERALS = ["i", "ii", "III", "IV", "v", "vi°", "VII"];
const MIXOLYDIAN_NUMERALS = ["I", "ii", "iii°", "IV", "v", "vi", "VII"];
const PHRYGIAN_NUMERALS = ["i", "II", "III", "iv", "v°", "VI", "vii"];

function getNumerals(mode: Mode): string[] {
  switch (mode) {
    case "ionian": return MAJOR_NUMERALS;
    case "aeolian": return MINOR_NUMERALS;
    case "dorian": return DORIAN_NUMERALS;
    case "mixolydian": return MIXOLYDIAN_NUMERALS;
    case "phrygian": return PHRYGIAN_NUMERALS;
    default: return MAJOR_NUMERALS;
  }
}

export function getDiatonicChordsForKey(keyRoot: PitchClass, mode: Mode): DiatonicChordInfo[] {
  // Major pentatonic has five degrees and no stack-of-thirds harmony, so its
  // palette comes from the curated scale-safe vocabulary instead.
  if (mode === "major_pentatonic") {
    return getMajorPentatonicChords(keyRoot).map((chord) => ({
      root: chord.root,
      quality: chord.quality,
      symbol: chord.symbol,
      romanNumeral: chord.degreeLabel,
      pitchClasses: chord.pitchClasses,
    }));
  }

  const scaleType = modeToScaleType(mode);
  const scale = getScaleDefinition(keyRoot, scaleType);
  const numerals = getNumerals(mode);
  const chords: DiatonicChordInfo[] = [];

  for (let i = 0; i < 7; i++) {
    const triad = buildTriadFromScale(scale, i);
    const symbol = formatChordSymbol(triad.root, triad.quality);
    chords.push({
      root: triad.root,
      quality: triad.quality,
      symbol,
      romanNumeral: numerals[i],
      pitchClasses: triad.pitchClasses,
    });
  }

  return chords;
}

export function chordInfoToEvent(
  chord: DiatonicChordInfo,
  variantId: string,
  order: number,
  durationBeats: number = 4
): Omit<HarmonicEvent, "id" | "variantId" | "order"> {
  const octave = 3;
  const notesWithOctave = chord.pitchClasses.map((pc) => `${pc}${octave}`);
  const midiNotes = chord.pitchClasses.map((pc) => pitchClassToMidi(pc, octave));
  // Ensure ascending order - shift notes up an octave if needed
  for (let i = 1; i < midiNotes.length; i++) {
    while (midiNotes[i] <= midiNotes[i - 1]) {
      midiNotes[i] += 12;
      const match = notesWithOctave[i].match(/^([A-G]#?)(\d+)$/);
      if (match) {
        notesWithOctave[i] = `${match[1]}${Number(match[2]) + 1}`;
      }
    }
  }

  return {
    chordSymbol: chord.symbol,
    chordRoot: chord.root,
    chordQuality: chord.quality,
    romanNumeral: chord.romanNumeral,
    durationBeats,
    inversion: 0,
    notes: chord.pitchClasses,
    notesWithOctave,
    midiNotes,
  };
}

export function getRomanNumeralForChord(
  chordRoot: PitchClass,
  chordQuality: string,
  keyRoot: PitchClass,
  mode: Mode
): string {
  const diatonics = getDiatonicChordsForKey(keyRoot, mode);
  const match = diatonics.find((d) => d.root === chordRoot && d.quality === chordQuality);
  if (match) return match.romanNumeral;
  // Fallback: find by root only
  const rootMatch = diatonics.find((d) => d.root === chordRoot);
  if (rootMatch) return rootMatch.romanNumeral;
  return "?";
}

export function parseChordSymbol(input: string): { root: PitchClass; quality: string } | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  // Try to match root (note name + optional accidental)
  const rootMatch = cleaned.match(/^([A-Ga-g])(#|b)?/);
  if (!rootMatch) return null;

  let rootStr = rootMatch[1].toUpperCase();
  if (rootMatch[2] === "#") rootStr += "#";
  else if (rootMatch[2] === "b") {
    // Convert flats to sharps
    const flatMap: Record<string, string> = {
      Db: "C#", Eb: "D#", Fb: "E", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B",
    };
    rootStr = flatMap[rootStr + "b"] || rootStr;
  }

  if (!NOTES.includes(rootStr as PitchClass)) return null;
  const root = rootStr as PitchClass;

  // Get quality from remainder
  const remainder = cleaned.slice(rootMatch[0].length).trim();
  let quality = "maj";
  if (!remainder || remainder === "M" || remainder === "maj") quality = "maj";
  else if (remainder === "m" || remainder === "min" || remainder === "-") quality = "min";
  else if (remainder === "dim" || remainder === "°" || remainder === "o") quality = "dim";
  else if (remainder === "aug" || remainder === "+") quality = "aug";
  else if (remainder === "7" || remainder === "dom7") quality = "dom7";
  else if (remainder === "maj7" || remainder === "M7") quality = "maj7";
  else if (remainder === "m7" || remainder === "min7" || remainder === "-7") quality = "min7";
  else if (remainder === "sus2") quality = "sus2";
  else if (remainder === "sus4" || remainder === "sus") quality = "sus4";
  else quality = remainder;

  return { root, quality };
}

export function buildChordFromParsed(
  root: PitchClass,
  quality: string,
  keyRoot: PitchClass,
  mode: Mode,
  durationBeats: number = 4
): Omit<HarmonicEvent, "id" | "variantId" | "order"> {
  const chord = buildTriadFromRoot(root, quality);
  const symbol = formatChordSymbol(root, quality);
  const romanNumeral = getRomanNumeralForChord(root, chord.quality, keyRoot, mode);
  const octave = 3;
  const notesWithOctave = chord.pitchClasses.map((pc: PitchClass) => `${pc}${octave}`);
  const midiNotes = chord.pitchClasses.map((pc: PitchClass) => pitchClassToMidi(pc, octave));
  // Ensure ascending
  for (let i = 1; i < midiNotes.length; i++) {
    while (midiNotes[i] <= midiNotes[i - 1]) {
      midiNotes[i] += 12;
      const match = notesWithOctave[i].match(/^([A-G]#?)(\d+)$/);
      if (match) {
        notesWithOctave[i] = `${match[1]}${Number(match[2]) + 1}`;
      }
    }
  }

  return {
    chordSymbol: symbol,
    chordRoot: root,
    chordQuality: chord.quality,
    romanNumeral,
    durationBeats,
    inversion: 0,
    notes: chord.pitchClasses,
    notesWithOctave,
    midiNotes,
  };
}
