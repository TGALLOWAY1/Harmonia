import { Midi } from "@tonejs/midi";
import { Note } from "@tonaljs/tonal";

export type ProgressionChord = {
  symbol: string;
  notesWithOctave: string[];
};

/**
 * Export a chord progression to a MIDI file.
 * Each chord gets one bar (4 beats) in 4/4 time.
 */
export function progressionToMidi(
  chords: ProgressionChord[],
  bpm: number
): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);

  const track = midi.addTrack();
  const beatsPerBar = 4;

  chords.forEach((chord, index) => {
    const startBeat = index * beatsPerBar;

    chord.notesWithOctave.forEach((noteName) => {
      const midiNumber = Note.midi(noteName);
      if (typeof midiNumber !== "number") return;

      track.addNote({
        midi: midiNumber,
        time: startBeat,
        duration: beatsPerBar,
      });
    });
  });

  const bytes = midi.toArray();
  return new Blob([bytes as BlobPart], { type: "audio/midi" });
}
