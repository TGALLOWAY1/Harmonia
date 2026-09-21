import { Midi } from "@tonejs/midi";
import type { Track } from "@tonejs/midi";
import { Note } from "@tonaljs/tonal";
import type { DurationClass } from "./music/generators/advanced/types";
import type { Melody, MelodyNote } from "./music/generators/melody/types";
import {
  applyDynamics,
  chordVoiceWeights,
  melodyDynamics,
  metricAccent,
  progressionDynamics,
} from "./audio/dynamics";
import { usePlaybackSettingsStore } from "./state/playbackSettingsStore";
import { useAudioSettingsStore } from "./state/audioSettingsStore";
import type { SoundPresetId } from "./audio/instrumentCatalog";

export type ProgressionChord = {
  symbol: string;
  notesWithOctave: string[];
  durationClass?: DurationClass;
  /**
   * Realised tension for this chord (0–1), when known — e.g. the chord
   * engine's own curve. Feeds the dynamics model's tension swell; omit it
   * and the chord just gets the first/last-chord shaping.
   */
  tension?: number;
};

/** Convert a DurationClass to beat count. */
function durationToBeats(dc: DurationClass | undefined): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

/**
 * GM program number per instrument id. Unknown/future ids fall back to
 * Acoustic Grand Piano (0) — extend this as new instruments are added to
 * `instrumentCatalog.ts`.
 */
export const GM_PROGRAM_BY_INSTRUMENT: Partial<Record<SoundPresetId, number>> = {
  "piano": 0,
  "electric-piano": 4,
  "soft-keys": 5,
  "filtered-saw": 90,
  "organ": 16,
  "warm-strings": 48, // String Ensemble 1
  "vibraphone": 11, // Vibraphone
  "pluck": 46, // Orchestral Harp
};

/** Resolve the GM program number for an instrument id, defaulting to 0. */
export function gmProgramForInstrument(instrumentId: SoundPresetId | undefined): number {
  if (!instrumentId) return 0;
  return GM_PROGRAM_BY_INSTRUMENT[instrumentId] ?? 0;
}

/** The base chord velocity to export at, when the caller doesn't pin one explicitly. */
function resolveChordVelocity(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  try {
    return usePlaybackSettingsStore.getState().chordVelocity ?? 0.7;
  } catch {
    return 0.7;
  }
}

/** The melody-above-chords level to export at, when the caller doesn't pin one explicitly. */
function resolveMelodyLevel(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  try {
    return usePlaybackSettingsStore.getState().melodyLevel ?? 1.15;
  } catch {
    return 1.15;
  }
}

/** The GM program to export at, when the caller doesn't pin one explicitly. */
function resolveInstrumentProgram(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  try {
    return gmProgramForInstrument(useAudioSettingsStore.getState().instrumentId);
  } catch {
    return 0;
  }
}

/**
 * Write a progression's chords onto a track using the dynamics model: a
 * per-chord multiplier (first-chord lift / last-chord settle / tension
 * swell) times the chord's position in the bar (metric accent) times each
 * note's role in the voicing (bass/top/inner voice weights). Shared by
 * `progressionToMidi` and `compositionToMidi` so a chord sounds identical in
 * either export.
 */
function writeChordTrack(track: Track, chords: ProgressionChord[], bpm: number, chordVelocity: number): void {
  const secondsPerBeat = 60 / bpm;
  const dynamics = progressionDynamics(
    chords.map((c) => ({ durationClass: c.durationClass, tension: c.tension })),
  );

  let currentBeat = 0;
  chords.forEach((chord, index) => {
    const beats = durationToBeats(chord.durationClass);
    const startTime = currentBeat * secondsPerBeat;
    const duration = beats * secondsPerBeat;

    const beatInBar = ((currentBeat % 4) + 4) % 4;
    const accent = metricAccent(beatInBar);
    const baseVelocity = applyDynamics(chordVelocity, dynamics[index] ?? 1, accent);

    // Resolve MIDI numbers once so voice weights can be computed from the
    // notes that actually parse, then re-align back onto the original note
    // list (a chord with an unparsable note name simply skips that note, as
    // before).
    const midiNumbers = chord.notesWithOctave.map((n) => Note.midi(n));
    const validMidis = midiNumbers.filter((m): m is number => typeof m === "number");
    const voiceWeights = chordVoiceWeights(validMidis);

    let validIndex = 0;
    chord.notesWithOctave.forEach((noteName, noteIdx) => {
      const midiNumber = midiNumbers[noteIdx];
      if (typeof midiNumber !== "number") return;
      const weight = voiceWeights[validIndex] ?? 1;
      validIndex++;

      track.addNote({
        midi: midiNumber,
        time: startTime,
        duration: duration * 0.95, // slight gap between chords
        velocity: applyDynamics(baseVelocity, weight),
      });
    });

    currentBeat += beats;
  });
}

export interface ProgressionMidiOptions {
  /** GM program number (0–127). Defaults to the live instrument setting, or 0. */
  instrumentProgram?: number;
  /** Base chord velocity (0–1). Defaults to the live playback settings, or 0.7. */
  chordVelocity?: number;
}

/**
 * Export a chord progression to a MIDI file.
 * Supports variable durations per chord via durationClass.
 * Includes tempo, track name, and the shared dynamics model's velocity curve.
 */
export function progressionToMidi(
  chords: ProgressionChord[],
  bpm: number,
  opts: ProgressionMidiOptions = {},
): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = "Harmonia Progression";

  const track = midi.addTrack();
  track.name = "Harmonia Progression";
  track.instrument.number = resolveInstrumentProgram(opts.instrumentProgram);

  writeChordTrack(track, chords, bpm, resolveChordVelocity(opts.chordVelocity));

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}

export interface MelodyMidiOptions {
  /** GM program number (0–127). Defaults to the live instrument setting, or 0. */
  instrumentProgram?: number;
  /**
   * GM program number (0–127) for the melody's own voice, when it differs
   * from the chord instrument (a separate melody voice was chosen, not
   * "follow chords"). Resolved by the caller from
   * `resolveMelodyInstrument(instrumentId, melodyInstrumentId)`. Defaults to
   * `instrumentProgram` — i.e. the chord program — when omitted.
   */
  melodyProgram?: number;
  /** Base chord velocity (0–1), the melody's own dynamics multiply over it. Defaults to the live playback settings, or 0.7. */
  chordVelocity?: number;
  /** Melody-above-chords level. Defaults to the live playback settings, or 1.15. */
  melodyLevel?: number;
  /**
   * Phrase plan for phrase-aware dynamics (arc, climax, cadence taper,
   * pickups). Omit for a drawn melody with no phrase plan — the dynamics
   * model degrades to metric accent + chord-tone weighting.
   */
  phrases?: Melody["phrases"];
}

/**
 * Write melody notes onto a track using the dynamics model. Shared by
 * `melodyToMidi` and `compositionToMidi`.
 */
function writeMelodyTrack(
  track: Track,
  notes: MelodyNote[],
  bpm: number,
  chordVelocity: number,
  melodyLevel: number,
  phrases?: Melody["phrases"],
): void {
  const secondsPerBeat = 60 / bpm;
  const dynamics = melodyDynamics({ notes, octave: 0, phrases });

  notes.forEach((note, i) => {
    track.addNote({
      midi: note.midi,
      time: note.startBeat * secondsPerBeat,
      duration: note.durationBeats * secondsPerBeat * 0.95,
      velocity: applyDynamics(chordVelocity, melodyLevel, dynamics[i] ?? 1),
    });
  });
}

/**
 * Export melody notes to a MIDI file.
 * Each melody note is placed at its exact beat position with proper duration.
 */
export function melodyToMidi(notes: MelodyNote[], bpm: number, opts: MelodyMidiOptions = {}): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = "Harmonia Melody";

  const track = midi.addTrack();
  track.name = "Harmonia Melody";
  track.instrument.number = opts.melodyProgram ?? resolveInstrumentProgram(opts.instrumentProgram);

  writeMelodyTrack(
    track,
    notes,
    bpm,
    resolveChordVelocity(opts.chordVelocity),
    resolveMelodyLevel(opts.melodyLevel),
    opts.phrases,
  );

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}

export interface CompositionMidiOptions {
  /** GM program number (0–127), applied to the chord track (and the melody track, absent `melodyProgram`). Defaults to the live instrument setting, or 0. */
  instrumentProgram?: number;
  /**
   * GM program number (0–127) for the melody track, when a separate melody
   * voice is chosen (not "follow chords"). Resolved by the caller from
   * `resolveMelodyInstrument(instrumentId, melodyInstrumentId)`. Defaults to
   * `instrumentProgram` — i.e. the chord program — when omitted.
   */
  melodyProgram?: number;
  /** Base chord velocity (0–1). Defaults to the live playback settings, or 0.7. */
  chordVelocity?: number;
  /** Melody-above-chords level. Defaults to the live playback settings, or 1.15. */
  melodyLevel?: number;
}

/**
 * Export a full composition — chords and melody together — as a single MIDI
 * file with two named tracks ("Chords", "Melody") sharing one tempo, so a DAW
 * opens both parts already in sync. The melody track plays its own resolved
 * instrument when one was chosen, and the chord program otherwise.
 */
export function compositionToMidi(
  chords: ProgressionChord[],
  melody: Melody,
  bpm: number,
  opts: CompositionMidiOptions = {},
): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = "Harmonia Composition";

  const chordVelocity = resolveChordVelocity(opts.chordVelocity);
  const melodyLevel = resolveMelodyLevel(opts.melodyLevel);
  const program = resolveInstrumentProgram(opts.instrumentProgram);
  const melodyProgram = opts.melodyProgram ?? program;

  // Each part on its own channel: a shared channel would make the two
  // program changes collide, and a DAW or MIDI-through keyed on channel would
  // hear one part.
  const chordTrack = midi.addTrack();
  chordTrack.name = "Chords";
  chordTrack.channel = 0;
  chordTrack.instrument.number = program;
  writeChordTrack(chordTrack, chords, bpm, chordVelocity);

  const melodyTrack = midi.addTrack();
  melodyTrack.name = "Melody";
  melodyTrack.channel = 1;
  melodyTrack.instrument.number = melodyProgram;
  writeMelodyTrack(melodyTrack, melody.notes, bpm, chordVelocity, melodyLevel, melody.phrases);

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}
