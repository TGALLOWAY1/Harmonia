// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import {
  compositionToMidi,
  gmProgramForInstrument,
  melodyToMidi,
  progressionToMidi,
  GM_PROGRAM_BY_INSTRUMENT,
  type ProgressionChord,
} from "../progressionMidiExport";
import type { Melody, MelodyNote } from "../music/generators/melody/types";
import { useAudioSettingsStore } from "../state/audioSettingsStore";
import { usePlaybackSettingsStore } from "../state/playbackSettingsStore";
import { INSTRUMENT_CATALOG } from "../audio/instrumentCatalog";

async function parseBlob(blob: Blob): Promise<Midi> {
  const buffer = await blob.arrayBuffer();
  return new Midi(new Uint8Array(buffer));
}

const CHORDS: ProgressionChord[] = [
  { symbol: "C", notesWithOctave: ["C3", "E3", "G3", "C5"], durationClass: "quarter" },
  { symbol: "F", notesWithOctave: ["F3", "A3", "C4"], durationClass: "quarter" },
  { symbol: "G", notesWithOctave: ["G3", "B3", "D4"], durationClass: "quarter" },
  { symbol: "C", notesWithOctave: ["C3", "E3", "G3"], durationClass: "quarter" },
];

function melodyNote(overrides: Partial<MelodyNote>): MelodyNote {
  return {
    id: "n",
    midi: 60,
    noteWithOctave: "C5",
    pitchClass: "C",
    durationBeats: 1,
    startBeat: 0,
    chordIndex: 0,
    isChordTone: true,
    source: "generated",
    ...overrides,
  };
}

// A single phrase with its peak in the middle: note m3 sits exactly at the
// peak beat, m1/m2 lead into it and m4 trails away from it.
const MELODY: Melody = {
  octave: 5,
  phrases: [{ startBeat: 0, endBeat: 4, peakBeat: 2, isClimax: false, cadence: "half", material: "A" }],
  notes: [
    melodyNote({ id: "m1", midi: 60, startBeat: 0, durationBeats: 1 }),
    melodyNote({ id: "m2", midi: 64, startBeat: 1, durationBeats: 1.5 }),
    melodyNote({ id: "m3", midi: 67, startBeat: 2, durationBeats: 1 }),
    melodyNote({ id: "m4", midi: 62, startBeat: 3.5, durationBeats: 0.5 }),
  ],
};

const BPM = 120;

describe("progressionMidiExport", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioSettingsStore.setState({ instrumentId: "piano", quality: "high" });
    usePlaybackSettingsStore.setState({
      chordVelocity: 0.7,
      humanize: 0.5,
      sustainMode: "natural",
      playbackStyle: "block",
      melodyLevel: 1.15,
    });
  });

  describe("gmProgramForInstrument", () => {
    it("maps every known instrument id", () => {
      expect(gmProgramForInstrument("piano")).toBe(0);
      expect(gmProgramForInstrument("electric-piano")).toBe(4);
      expect(gmProgramForInstrument("soft-keys")).toBe(5);
      expect(gmProgramForInstrument("filtered-saw")).toBe(90);
      expect(gmProgramForInstrument("organ")).toBe(16);
      expect(gmProgramForInstrument("warm-strings")).toBe(48);
      expect(gmProgramForInstrument("vibraphone")).toBe(11);
      expect(gmProgramForInstrument("pluck")).toBe(46);
    });

    it("falls back to 0 for an unknown or missing id", () => {
      expect(gmProgramForInstrument(undefined)).toBe(0);
      // @ts-expect-error - exercising the runtime fallback for a future/unknown id
      expect(gmProgramForInstrument("some-future-instrument")).toBe(0);
    });

    it("covers every instrument in the catalog with its own explicit entry", () => {
      // A missing entry would silently fall back to 0 (Acoustic Grand) rather
      // than fail loudly, so assert the map key exists rather than just
      // comparing the resolved number.
      for (const entry of INSTRUMENT_CATALOG) {
        expect(Object.prototype.hasOwnProperty.call(GM_PROGRAM_BY_INSTRUMENT, entry.id)).toBe(true);
        expect(typeof GM_PROGRAM_BY_INSTRUMENT[entry.id]).toBe("number");
      }
    });
  });

  describe("progressionToMidi", () => {
    it("writes one note per chord tone, tempo and track name", async () => {
      const blob = progressionToMidi(CHORDS, BPM, { chordVelocity: 0.7 });
      const midi = await parseBlob(blob);
      expect(midi.tracks).toHaveLength(1);
      expect(midi.tracks[0].notes).toHaveLength(4 + 3 + 3 + 3);
      expect(Math.round(midi.header.tempos[0].bpm)).toBe(BPM);
    });

    it("makes the top voice of a chord louder than an inner voice", async () => {
      const blob = progressionToMidi(CHORDS, BPM, { chordVelocity: 0.7 });
      const midi = await parseBlob(blob);
      const firstChordNotes = midi.tracks[0].notes.filter((n) => n.time < 0.01);
      const top = firstChordNotes.find((n) => n.midi === 72); // C5, the top voice
      const inner = firstChordNotes.find((n) => n.midi === 52); // E3, an inner voice
      expect(top).toBeDefined();
      expect(inner).toBeDefined();
      expect(top!.velocity).toBeGreaterThan(inner!.velocity);
    });

    it("reads the GM program from the live instrument setting by default", async () => {
      useAudioSettingsStore.getState().setInstrument("organ");
      const blob = progressionToMidi(CHORDS, BPM);
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].instrument.number).toBe(16);
    });

    it("lets an explicit instrumentProgram override the live setting", async () => {
      useAudioSettingsStore.getState().setInstrument("organ");
      const blob = progressionToMidi(CHORDS, BPM, { instrumentProgram: 90 });
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].instrument.number).toBe(90);
    });
  });

  describe("melodyToMidi", () => {
    it("gives a 1.5-beat note the right duration in seconds", async () => {
      const blob = melodyToMidi(MELODY.notes, BPM, { chordVelocity: 0.7, melodyLevel: 1 });
      const midi = await parseBlob(blob);
      const note = midi.tracks[0].notes.find((n) => n.midi === 64); // m2, 1.5 beats
      expect(note).toBeDefined();
      // 1.5 beats * (60/120)s/beat * 0.95 gap factor
      expect(note!.duration).toBeCloseTo(1.5 * (60 / BPM) * 0.95, 2);
    });

    it("makes a phrase's peak note louder than the notes around it", async () => {
      const blob = melodyToMidi(MELODY.notes, BPM, {
        chordVelocity: 0.7,
        melodyLevel: 1,
        phrases: MELODY.phrases,
      });
      const midi = await parseBlob(blob);
      const notes = midi.tracks[0].notes;
      const before = notes.find((n) => n.midi === 64)!.velocity; // m2
      const peak = notes.find((n) => n.midi === 67)!.velocity; // m3, at peakBeat
      const after = notes.find((n) => n.midi === 62)!.velocity; // m4
      expect(peak).toBeGreaterThan(before);
      expect(peak).toBeGreaterThan(after);
    });

    it("without phrases, still produces a valid, in-range velocity curve", async () => {
      const blob = melodyToMidi(MELODY.notes, BPM, { chordVelocity: 0.7, melodyLevel: 1 });
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].notes).toHaveLength(MELODY.notes.length);
      for (const n of midi.tracks[0].notes) {
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(1);
      }
    });

    it("uses an explicit melodyProgram over instrumentProgram", async () => {
      const blob = melodyToMidi(MELODY.notes, BPM, { instrumentProgram: 0, melodyProgram: 11 });
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].instrument.number).toBe(11);
    });

    it("defaults the melody's own program to the chord program when melodyProgram is omitted", async () => {
      const blob = melodyToMidi(MELODY.notes, BPM, { instrumentProgram: 5 });
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].instrument.number).toBe(5);
    });
  });

  describe("compositionToMidi", () => {
    it("produces one file with two named tracks sharing one tempo", async () => {
      const blob = compositionToMidi(CHORDS, MELODY, BPM);
      const midi = await parseBlob(blob);
      expect(midi.tracks).toHaveLength(2);
      expect(midi.tracks[0].name).toBe("Chords");
      expect(midi.tracks[1].name).toBe("Melody");
      expect(midi.header.tempos).toHaveLength(1);
      expect(Math.round(midi.header.tempos[0].bpm)).toBe(BPM);
    });

    it("carries the correct note counts on each track", async () => {
      const blob = compositionToMidi(CHORDS, MELODY, BPM);
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].notes).toHaveLength(4 + 3 + 3 + 3);
      expect(midi.tracks[1].notes).toHaveLength(MELODY.notes.length);
    });

    it("sets the same GM program on both tracks from the current instrument", async () => {
      const blob = compositionToMidi(CHORDS, MELODY, BPM, { instrumentProgram: 5 });
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].instrument.number).toBe(5);
      expect(midi.tracks[1].instrument.number).toBe(5);
    });

    it("gives the melody track its own resolved program when a separate melody voice is chosen", async () => {
      const blob = compositionToMidi(CHORDS, MELODY, BPM, { instrumentProgram: 0, melodyProgram: 46 });
      const midi = await parseBlob(blob);
      expect(midi.tracks[0].instrument.number).toBe(0);
      expect(midi.tracks[1].instrument.number).toBe(46);
    });

    it("uses chordVelocity x melodyLevel x melodyDynamics for melody notes", async () => {
      const quiet = await parseBlob(
        compositionToMidi(CHORDS, MELODY, BPM, { chordVelocity: 0.7, melodyLevel: 0.5 }),
      );
      const loud = await parseBlob(
        compositionToMidi(CHORDS, MELODY, BPM, { chordVelocity: 0.7, melodyLevel: 1.5 }),
      );
      const quietVelocity = quiet.tracks[1].notes.find((n) => n.midi === 67)!.velocity;
      const loudVelocity = loud.tracks[1].notes.find((n) => n.midi === 67)!.velocity;
      expect(loudVelocity).toBeGreaterThan(quietVelocity);
    });
  });
});
