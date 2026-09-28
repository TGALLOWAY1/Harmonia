import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import type { MelodyNote } from "./music/generators/melody/types";
import {
  abletonProjectToMidi,
  buildAbletonMidiFilename,
  createAbletonExportReceipt,
  type AbletonMidiExportOptions,
} from "./progressionMidiExport";

async function parseMidi(options: AbletonMidiExportOptions): Promise<{
  bytes: Uint8Array;
  midi: Midi;
}> {
  const bytes = new Uint8Array(await abletonProjectToMidi(options).arrayBuffer());
  return { bytes, midi: new Midi(bytes) };
}

const melody: MelodyNote[] = [
  {
    id: "melody-1",
    midi: 72,
    noteWithOctave: "C5",
    pitchClass: "C",
    durationBeats: 1,
    startBeat: 1,
    chordIndex: 0,
    isChordTone: true,
    source: "generated",
  },
];

describe("Ableton MIDI export", () => {
  it("builds a type-1 file with DAW metadata and separate chord/melody tracks", async () => {
    const { bytes, midi } = await parseMidi({
      chords: [
        {
          symbol: "Fm7",
          romanNumeral: "i7",
          midiNotes: [53, 56, 60, 63],
          notesWithOctave: ["F3", "Ab3", "C4", "Eb4"],
          durationClass: "half",
        },
        {
          symbol: "Bb7",
          romanNumeral: "IV7",
          midiNotes: [58, 62, 65, 68],
          durationClass: "quarter",
        },
      ],
      melody,
      bpm: 128,
      rootKey: "F",
      mode: "aeolian",
      seed: 4242,
    });

    // Standard MIDI header format field: 1 means a synchronous multi-track file.
    expect([...bytes.slice(8, 10)]).toEqual([0, 1]);
    expect(midi.header.name).toBe("Harmonia Ableton Export");
    expect(midi.header.tempos[0]?.bpm).toBeCloseTo(128, 2);
    expect(midi.header.timeSignatures[0]?.timeSignature).toEqual([4, 4]);
    // @tonejs/midi represents F minor's four-flat signature by its relative
    // major key (Ab) plus the MIDI minor flag.
    expect(midi.header.keySignatures[0]).toMatchObject({ key: "Ab", scale: "minor" });
    expect(midi.tracks.map((track) => track.name)).toEqual([
      "Harmonia Chords",
      "Harmonia Melody",
    ]);

    expect(midi.header.meta).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "Harmonia | F Minor | 128 BPM | Seed 4242" }),
      expect.objectContaining({ type: "marker", ticks: 0, text: "1. Fm7 (i7)" }),
      expect.objectContaining({ type: "marker", ticks: 960, text: "2. Bb7 (IV7)" }),
    ]));
    expect(midi.tracks[1]?.notes[0]).toMatchObject({ midi: 72, ticks: 480, durationTicks: 479 });
  });

  it("prefers canonical MIDI pitches and preserves chord boundaries to one tick", async () => {
    const { midi } = await parseMidi({
      chords: [
        {
          symbol: "C",
          midiNotes: [60, 64, 67],
          notesWithOctave: ["F9"],
          durationClass: "half",
        },
        {
          symbol: "G",
          midiNotes: [55, 59, 62],
          durationClass: "quarter",
        },
      ],
      bpm: 120,
      rootKey: "C",
      mode: "ionian",
    });

    const chordTrack = midi.tracks[0];
    expect(chordTrack?.notes.slice(0, 3).map((note) => note.midi)).toEqual([60, 64, 67]);
    expect(chordTrack?.notes.slice(0, 3).map((note) => note.durationTicks)).toEqual([959, 959, 959]);
    expect(chordTrack?.notes.slice(3).map((note) => note.ticks)).toEqual([960, 960, 960]);
  });

  it("keeps modal identity in text metadata without writing a false major/minor signature", async () => {
    const { midi } = await parseMidi({
      chords: [{ symbol: "Dm7", midiNotes: [50, 53, 57, 60] }],
      bpm: 110,
      rootKey: "D",
      mode: "dorian",
      seed: 7,
    });

    expect(midi.header.keySignatures).toEqual([]);
    expect(midi.header.meta).toContainEqual(expect.objectContaining({
      type: "text",
      text: "Harmonia | D Dorian | 110 BPM | Seed 7",
    }));
  });

  it("uses predictable filenames and reports exactly what was exported", () => {
    expect(buildAbletonMidiFilename("F#", "mixolydian", 127.6, 99)).toBe(
      "harmonia-f-sharp-mixolydian-128bpm-seed-99.mid",
    );

    expect(createAbletonExportReceipt({
      chords: [
        { symbol: "C", midiNotes: [60, 64, 67], durationClass: "full" },
        { symbol: "G", midiNotes: [55, 59, 62], durationClass: "half" },
      ],
      melody,
      bpm: 120,
      rootKey: "C",
      mode: "ionian",
      seed: 1,
    })).toEqual({
      filename: "harmonia-c-major-120bpm-seed-1.mid",
      rootKey: "C",
      modeLabel: "Major",
      bpm: 120,
      seed: 1,
      chordCount: 2,
      totalBeats: 6,
      tracks: ["Harmonia Chords", "Harmonia Melody"],
    });
  });
});
