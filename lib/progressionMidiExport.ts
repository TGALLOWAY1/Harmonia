import { Midi } from "@tonejs/midi";
import { Note } from "@tonaljs/tonal";
import type { DurationClass } from "./music/generators/advanced/types";

export type ProgressionChord = {
  symbol: string;
  notesWithOctave: string[];
  durationClass?: DurationClass;
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
 * Export a chord progression to a MIDI file.
 * Supports variable durations per chord via durationClass.
 * Includes tempo, track name, and a subtle velocity curve.
 */
export function progressionToMidi(
  chords: ProgressionChord[],
  bpm: number
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

    // Subtle velocity curve: first beat slightly louder, inner notes slightly softer
    // Passing/short chords get reduced velocity
    const isShort = beats <= 1;
    const baseVelocity = isShort ? 0.62 : 0.72;
    const accentBoost = index === 0 ? 0.08 : 0;

    chord.notesWithOctave.forEach((noteName, noteIdx) => {
      const midiNumber = Note.midi(noteName);
      if (typeof midiNumber !== "number") return;

      // Root note (first) gets a slight accent, upper voices slightly softer
      const velocity = Math.min(
        1,
        baseVelocity + accentBoost + (noteIdx === 0 ? 0.05 : -0.03 * Math.min(noteIdx, 3))
      );

      track.addNote({
        midi: midiNumber,
        time: startTime,
        duration: duration * 0.95, // slight gap between chords
        velocity,
      });
    });

    currentBeat += beats;
  });

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}
