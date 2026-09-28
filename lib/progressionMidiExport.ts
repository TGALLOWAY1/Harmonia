import { Midi } from "@tonejs/midi";
import { Note } from "@tonaljs/tonal";
import type { DurationClass } from "./music/generators/advanced/types";
import type { MelodyNote } from "./music/generators/melody/types";
import type { Mode } from "./theory/harmonyEngine";

export type ProgressionChord = {
  symbol: string;
  romanNumeral?: string;
  /** Canonical pitch data. Preferred over display spellings when present. */
  midiNotes?: number[];
  /** Human-readable fallback for older saved progressions. */
  notesWithOctave?: string[];
  durationClass?: DurationClass;
};

export type AbletonMidiExportOptions = {
  chords: ProgressionChord[];
  melody?: MelodyNote[];
  bpm: number;
  rootKey: string;
  mode: Mode;
  seed?: number;
};

export type AbletonExportReceipt = {
  filename: string;
  rootKey: string;
  modeLabel: string;
  bpm: number;
  seed?: number;
  chordCount: number;
  totalBeats: number;
  tracks: string[];
};

const MODE_LABELS: Record<Mode, string> = {
  ionian: "Major",
  aeolian: "Minor",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
  phrygian: "Phrygian",
};

/** Major-key labels used by @tonejs/midi to encode the -7…+7 signature field. */
const MIDI_MAJOR_KEY_SIGNATURES: Record<string, string> = {
  "D#": "Eb",
  "G#": "Ab",
  "A#": "Bb",
};

/** Relative-major signature labels for each canonical sharp-spelled minor tonic. */
const MIDI_MINOR_KEY_SIGNATURES: Record<string, string> = {
  C: "Eb",
  "C#": "E",
  D: "F",
  "D#": "F#",
  E: "G",
  F: "Ab",
  "F#": "A",
  G: "Bb",
  "G#": "B",
  A: "C",
  "A#": "C#",
  B: "D",
};

const MIDI_KEY_SIGNATURE_LABELS = [
  "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#",
];

/** Convert a DurationClass to beat count. */
export function durationToBeats(dc: DurationClass | undefined): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

export function totalProgressionBeats(chords: ProgressionChord[]): number {
  return chords.reduce((total, chord) => total + durationToBeats(chord.durationClass), 0);
}

function midiNotesForChord(chord: ProgressionChord): number[] {
  if (chord.midiNotes && chord.midiNotes.length > 0) {
    return chord.midiNotes;
  }

  return (chord.notesWithOctave ?? []).flatMap((noteName) => {
    const midiNumber = Note.midi(noteName);
    return typeof midiNumber === "number" ? [midiNumber] : [];
  });
}

/**
 * @tonejs/midi 2.0.28 writes the key-signature index (0…14) where Standard
 * MIDI expects a signed accidental count (-7…7). Correct that one metadata
 * byte after encoding so DAWs and independent MIDI parsers receive the proper
 * signature. The surrounding FF 59 02 sequence uniquely identifies this event.
 */
function fixToneJsKeySignatureEncoding(bytes: Uint8Array, keySignature?: string): Uint8Array {
  if (!keySignature) return bytes;
  const keyIndex = MIDI_KEY_SIGNATURE_LABELS.indexOf(keySignature);
  if (keyIndex === -1) return bytes;

  const toneJsValue = keyIndex + 7;
  const standardMidiValue = (keyIndex - 7 + 256) % 256;
  const corrected = bytes.slice();
  for (let index = 0; index <= corrected.length - 5; index += 1) {
    if (
      corrected[index] === 0xff
      && corrected[index + 1] === 0x59
      && corrected[index + 2] === 0x02
      && corrected[index + 3] === toneJsValue
    ) {
      corrected[index + 3] = standardMidiValue;
      index += 4;
    }
  }
  return corrected;
}

function slugifyKey(rootKey: string): string {
  return rootKey
    .replace(/#/g, "-sharp")
    .replace(/b/g, "-flat")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function buildAbletonMidiFilename(
  rootKey: string,
  mode: Mode,
  bpm: number,
  seed?: number,
): string {
  const seedSuffix = seed === undefined ? "" : `-seed-${seed}`;
  return `harmonia-${slugifyKey(rootKey)}-${MODE_LABELS[mode].toLowerCase()}-${Math.round(bpm)}bpm${seedSuffix}.mid`;
}

export function createAbletonExportReceipt(
  options: AbletonMidiExportOptions,
): AbletonExportReceipt {
  const hasMelody = Boolean(options.melody?.length);
  return {
    filename: buildAbletonMidiFilename(options.rootKey, options.mode, options.bpm, options.seed),
    rootKey: options.rootKey,
    modeLabel: MODE_LABELS[options.mode],
    bpm: options.bpm,
    seed: options.seed,
    chordCount: options.chords.length,
    totalBeats: totalProgressionBeats(options.chords),
    tracks: hasMelody ? ["Harmonia Chords", "Harmonia Melody"] : ["Harmonia Chords"],
  };
}

/**
 * Build a DAW-ready type-1 MIDI file for Ableton Live.
 *
 * The file uses tick positions so notes stay exactly on the musical grid at any
 * tempo. It includes a tempo map, 4/4 time signature, compatible key signature,
 * chord markers, a canonical-MIDI chord track, and an optional melody track.
 */
export function abletonProjectToMidi(options: AbletonMidiExportOptions): Blob {
  const { chords, melody, bpm, rootKey, mode, seed } = options;
  const midi = new Midi();
  const ppq = midi.header.ppq;
  const modeLabel = MODE_LABELS[mode];

  midi.header.name = "Harmonia Ableton Export";
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  midi.header.meta.push({
    ticks: 0,
    type: "text",
    text: `Harmonia | ${rootKey} ${modeLabel} | ${bpm} BPM${seed === undefined ? "" : ` | Seed ${seed}`}`,
  });

  // Standard MIDI key signatures only encode major/minor. Modal identity still
  // travels in the text metadata for Dorian, Mixolydian, and Phrygian exports.
  let midiKeySignature: string | undefined;
  if (mode === "ionian" || mode === "aeolian") {
    midiKeySignature = mode === "aeolian"
      ? MIDI_MINOR_KEY_SIGNATURES[rootKey] ?? rootKey
      : MIDI_MAJOR_KEY_SIGNATURES[rootKey] ?? rootKey;
    midi.header.keySignatures.push({
      ticks: 0,
      key: midiKeySignature,
      scale: mode === "ionian" ? "major" : "minor",
    });
  }

  const chordTrack = midi.addTrack();
  chordTrack.name = "Harmonia Chords";

  let currentBeat = 0;
  chords.forEach((chord, index) => {
    const beats = durationToBeats(chord.durationClass);
    const startTicks = Math.round(currentBeat * ppq);
    const durationTicks = Math.max(1, Math.round(beats * ppq) - 1);
    const markerSuffix = chord.romanNumeral ? ` (${chord.romanNumeral})` : "";

    midi.header.meta.push({
      ticks: startTicks,
      type: "marker",
      text: `${index + 1}. ${chord.symbol}${markerSuffix}`,
    });

    const isShort = beats <= 1;
    const baseVelocity = isShort ? 0.62 : 0.72;
    const accentBoost = index === 0 ? 0.08 : 0;

    midiNotesForChord(chord).forEach((midiNumber, noteIndex) => {
      const velocity = Math.min(
        1,
        baseVelocity + accentBoost + (noteIndex === 0 ? 0.05 : -0.03 * Math.min(noteIndex, 3)),
      );
      chordTrack.addNote({
        midi: midiNumber,
        ticks: startTicks,
        durationTicks,
        velocity,
      });
    });

    currentBeat += beats;
  });

  if (melody && melody.length > 0) {
    const melodyTrack = midi.addTrack();
    melodyTrack.name = "Harmonia Melody";
    for (const note of melody) {
      melodyTrack.addNote({
        midi: note.midi,
        ticks: Math.round(note.startBeat * ppq),
        durationTicks: Math.max(1, Math.round(note.durationBeats * ppq) - 1),
        velocity: note.isChordTone ? 0.75 : 0.68,
      });
    }
  }

  const bytes = fixToneJsKeySignatureEncoding(midi.toArray(), midiKeySignature);
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}

/**
 * Export a chord progression to a MIDI file.
 * Supports variable durations per chord via durationClass.
 * Includes tempo, track name, and a subtle velocity curve.
 */
export function progressionToMidi(
  chords: ProgressionChord[],
  bpm: number,
): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = "Harmonia Progression";

  const track = midi.addTrack();
  track.name = "Harmonia Progression";
  const secondsPerBeat = 60 / bpm;

  let currentBeat = 0;

  chords.forEach((chord, index) => {
    const beats = durationToBeats(chord.durationClass);
    const startTime = currentBeat * secondsPerBeat;
    const duration = beats * secondsPerBeat;
    const isShort = beats <= 1;
    const baseVelocity = isShort ? 0.62 : 0.72;
    const accentBoost = index === 0 ? 0.08 : 0;

    midiNotesForChord(chord).forEach((midiNumber, noteIndex) => {
      const velocity = Math.min(
        1,
        baseVelocity + accentBoost + (noteIndex === 0 ? 0.05 : -0.03 * Math.min(noteIndex, 3)),
      );

      track.addNote({
        midi: midiNumber,
        time: startTime,
        duration: duration * 0.95,
        velocity,
      });
    });

    currentBeat += beats;
  });

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}

/**
 * Export melody notes to a MIDI file.
 * Each melody note is placed at its exact beat position with proper duration.
 */
export function melodyToMidi(notes: MelodyNote[], bpm: number): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = "Harmonia Melody";

  const track = midi.addTrack();
  track.name = "Harmonia Melody";
  const secondsPerBeat = 60 / bpm;

  for (const note of notes) {
    track.addNote({
      midi: note.midi,
      time: note.startBeat * secondsPerBeat,
      duration: note.durationBeats * secondsPerBeat * 0.95,
      velocity: note.isChordTone ? 0.75 : 0.68,
    });
  }

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}
