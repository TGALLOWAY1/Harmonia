/**
 * Key-aware enharmonic spelling
 *
 * The core theory engine is intentionally sharp-only (Bb is stored as A#,
 * Eb as D#) so that pitch-class identity, MIDI conversion, and voicing logic
 * stay simple and unambiguous. That is correct for *playback* but wrong for
 * *notation*: the IV chord of F major is "Bb", never "A#", and Eb major should
 * never display an "A#".
 *
 * This module is a thin, display-only layer that re-spells sharp pitch classes
 * with the accidentals appropriate to a given key. It never changes pitch:
 * "A#" and "Bb" are the same MIDI note, so audio, the piano roll grid, and
 * saved progressions are unaffected — only the human-readable labels change.
 *
 * Spelling rule: a key is written with flats when it sits on the flat side of
 * the circle of fifths; otherwise sharps. C major / A minor (no accidentals)
 * default to sharps. This produces the conventional spelling for every common
 * major, minor, and modal key (F → Bb, Eb → Ab/Bb, Bb minor → Db, F# minor →
 * C#, D minor → Bb, etc.).
 */

import { PITCH_CLASSES, midiToOctave, type PitchClass } from "./midiUtils";

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/**
 * Semitones to add to a modal tonic to reach the tonic of its relative Ionian
 * (major) scale, whose key signature determines the accidentals used.
 * e.g. D dorian shares C major's signature, so dorian → +10 (≡ −2).
 */
const MODE_TO_IONIAN_OFFSET: Record<string, number> = {
  ionian: 0,
  major: 0,
  lydian: 7, // −5
  mixolydian: 5, // −7
  dorian: 10, // −2
  aeolian: 3, // −9
  natural_minor: 3,
  minor: 3,
  phrygian: 8, // −4
  locrian: 1, // −11
};

function semitoneOf(pc: PitchClass): number {
  return PITCH_CLASSES.indexOf(pc);
}

const LETTER_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parse a note letter + optional accidental into a 0-11 semitone class. */
function nameToSemitone(letter: string, accidental: string | undefined): number | null {
  const base = LETTER_BASE[letter.toUpperCase()];
  if (base === undefined) return null;
  let s = base;
  if (accidental === "#") s += 1;
  else if (accidental === "b") s -= 1;
  return ((s % 12) + 12) % 12;
}

const ROOT_RE = /^([A-Ga-g])(#|b)?/;

/**
 * True when the key signature for `tonic` + `mode` is conventionally written
 * with flats rather than sharps.
 */
export function keyPrefersFlats(tonic: PitchClass, mode: string): boolean {
  const offset = MODE_TO_IONIAN_OFFSET[mode] ?? 0;
  const majorRoot = (((semitoneOf(tonic) + offset) % 12) + 12) % 12;
  // Position on the circle of fifths measured in fifths up from C.
  const fifths = (majorRoot * 7) % 12;
  // 0 = C (no accidentals → sharps by convention); 1-6 = sharp keys;
  // 7-11 = flat keys (Db, Ab, Eb, Bb, F).
  return fifths >= 7;
}

/** Spell a 0-11 semitone class as a note letter, choosing sharps or flats. */
export function spellSemitone(semitone: number, useFlats: boolean): string {
  const table = useFlats ? FLAT_NAMES : SHARP_NAMES;
  return table[(((semitone % 12) + 12) % 12)];
}

/** Spell a MIDI note's pitch class (no octave) using sharps or flats. */
export function spellMidiPc(midi: number, useFlats: boolean): string {
  return spellSemitone(midi % 12, useFlats);
}

/** Spell a MIDI note with octave, e.g. "Bb4", using sharps or flats. */
export function spellMidiNote(midi: number, useFlats: boolean): string {
  return `${spellMidiPc(midi, useFlats)}${midiToOctave(midi)}`;
}

export interface Speller {
  /** Whether this key is spelled with flats. */
  readonly useFlats: boolean;
  /** Spell a 0-11 semitone class as a note letter. */
  semitone(semitone: number): string;
  /** Spell a (sharp-canonical) pitch class. */
  pc(pc: PitchClass): string;
  /** Spell a MIDI note's pitch class (no octave). */
  midiPc(midi: number): string;
  /** Spell a MIDI note with octave, e.g. "Bb4". */
  midiNote(midi: number): string;
  /** Re-spell an existing note name like "A#4" → "Bb4" (octave preserved). */
  noteName(name: string): string;
  /** Re-spell the root (and any "/bass") of a chord symbol; quality untouched. */
  symbol(symbol: string): string;
}

/**
 * Build a `Speller` for the given key. Spelling is fixed by the key, so callers
 * should create one speller per (root, mode) and reuse it across chords.
 */
export function makeSpeller(tonic: PitchClass, mode: string): Speller {
  const useFlats = keyPrefersFlats(tonic, mode);
  const table = useFlats ? FLAT_NAMES : SHARP_NAMES;

  const semitone = (s: number) => table[(((s % 12) + 12) % 12)];
  const pc = (p: PitchClass) => semitone(semitoneOf(p));
  const midiPc = (m: number) => semitone(m % 12);
  const midiNote = (m: number) => `${midiPc(m)}${midiToOctave(m)}`;

  const noteName = (name: string): string => {
    const m = name.match(/^([A-Ga-g])(#|b)?(-?\d+)?$/);
    if (!m) return name;
    const s = nameToSemitone(m[1], m[2]);
    if (s === null) return name;
    return `${semitone(s)}${m[3] ?? ""}`;
  };

  const respellLeadingRoot = (str: string): string => {
    const m = str.match(ROOT_RE);
    if (!m) return str;
    const s = nameToSemitone(m[1], m[2]);
    if (s === null) return str;
    return semitone(s) + str.slice(m[0].length);
  };

  const symbol = (sym: string): string => {
    if (!sym) return sym;
    const slashIdx = sym.indexOf("/");
    if (slashIdx === -1) return respellLeadingRoot(sym);
    const head = respellLeadingRoot(sym.slice(0, slashIdx));
    const bass = respellLeadingRoot(sym.slice(slashIdx + 1));
    return `${head}/${bass}`;
  };

  return { useFlats, semitone, pc, midiPc, midiNote, noteName, symbol };
}
