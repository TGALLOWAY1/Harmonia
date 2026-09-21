// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Midi } from "@tonejs/midi";

import { useProgressionStore } from "@/lib/state/progressionStore";
import type { Progression } from "@/lib/theory/progressionTypes";

const cMajor: Progression = {
  id: "test",
  timestamp: 0,
  chords: [
    {
      symbol: "C",
      notes: ["C", "E", "G"],
      romanNumeral: "I",
      notesWithOctave: ["C3", "E3", "G3"],
      midiNotes: [48, 52, 55],
      root: "C",
      bass: "C",
      inversion: 0,
    },
  ],
};

describe("progression store keeps bass and inversion in step with edits", () => {
  beforeEach(() => {
    useProgressionStore.setState({ rootKey: "C", mode: "ionian", melodyEnabled: false });
    useProgressionStore.getState().loadProgression(cMajor);
  });

  // Regression: an edit that changes the chord's identity used to read the
  // inversion against the old root, so C3 → C#3 in a C major triad was stored
  // as C# diminished with bass C# "in no inversion of C" and rendered C#°/C#.
  it("re-derives the root and inversion when a note move changes the chord", () => {
    useProgressionStore.getState().moveNote(0, 48, 49);
    const chord = useProgressionStore.getState().currentProgression!.chords[0];
    expect(chord.midiNotes).toEqual([49, 52, 55]);
    expect(chord.root).toBe("C#");
    expect(chord.bass).toBe("C#");
    expect(chord.inversion).toBe(0);
  });

  it("labels an inversion after a note is shifted an octave", () => {
    useProgressionStore.getState().shiftNote(0, 48, "up");
    const chord = useProgressionStore.getState().currentProgression!.chords[0];
    expect(chord.root).toBe("C");
    expect(chord.bass).toBe("E");
    expect(chord.inversion).toBe(1);
  });

  it("keeps root position when a note is added above", () => {
    useProgressionStore.getState().addNote(0, 59);
    const chord = useProgressionStore.getState().currentProgression!.chords[0];
    expect(chord.root).toBe("C");
    expect(chord.bass).toBe("C");
    expect(chord.inversion).toBe(0);
  });

  it("follows the bass when the lowest note is removed", () => {
    useProgressionStore.getState().removeNote(0, 48);
    const chord = useProgressionStore.getState().currentProgression!.chords[0];
    expect(chord.midiNotes).toEqual([52, 55]);
    expect(chord.bass).toBe("E");
  });
});

/**
 * The melody engine puts its climax where the chord engine says the harmony is
 * tense, reading a per-chord tension curve the generator produced. That curve
 * describes the chords it was generated for, so an edit that changes what a
 * chord *is* has to invalidate it — otherwise the melody peaks according to
 * harmony that is no longer in the progression.
 */
describe("progression store invalidates the chord tension curve when the harmony changes", () => {
  const twoChords: Progression = {
    id: "tension-test",
    timestamp: 0,
    chords: [
      {
        symbol: "C", notes: ["C", "E", "G"], romanNumeral: "I",
        notesWithOctave: ["C3", "E3", "G3"], midiNotes: [48, 52, 55],
        root: "C", bass: "C", inversion: 0,
      },
      {
        symbol: "G", notes: ["G", "B", "D"], romanNumeral: "V",
        notesWithOctave: ["G3", "B3", "D4"], midiNotes: [55, 59, 62],
        root: "G", bass: "G", inversion: 0,
      },
    ],
  };

  beforeEach(() => {
    useProgressionStore.setState({ rootKey: "C", mode: "ionian", melodyEnabled: false });
    useProgressionStore.getState().loadProgression(twoChords);
  });

  it("drops a curve loaded with a saved progression, which carries none", () => {
    expect(useProgressionStore.getState().chordTensionCurve).toBeNull();
  });

  it("keeps a curve whose chord symbols still match", () => {
    useProgressionStore.setState({
      chordTensionCurve: { signature: "C|G", curve: [0.1, 0.8] },
    });
    // Re-voicing the G an octave up leaves the chord's identity alone: still a
    // root-position G, so the curve still describes this harmony. (Moving a
    // note into the bass would read as G/D, a different symbol and a different
    // tension, and would correctly invalidate it.)
    useProgressionStore.getState().moveNote(1, 59, 71);
    const chords = useProgressionStore.getState().currentProgression!.chords;
    expect(chords.map((c) => c.symbol).join("|")).toBe("C|G");
    expect(useProgressionStore.getState().chordTensionCurve).toEqual({
      signature: "C|G",
      curve: [0.1, 0.8],
    });

    useProgressionStore.getState().setMelodyEnabled(true);
    expect(useProgressionStore.getState().melody).not.toBeNull();
  });

  it("stops using a curve once an edit changes a chord's identity", () => {
    useProgressionStore.setState({
      chordTensionCurve: { signature: "C|G", curve: [0.1, 0.8] },
    });
    // C major becomes something else, so the stored curve no longer describes
    // this progression's harmony.
    useProgressionStore.getState().moveNote(0, 48, 49);
    const chords = useProgressionStore.getState().currentProgression!.chords;
    expect(chords.map((c) => c.symbol).join("|")).not.toBe("C|G");

    // The melody still generates; it derives tension from the chords instead.
    useProgressionStore.getState().setMelodyEnabled(true);
    const melody = useProgressionStore.getState().melody;
    expect(melody).not.toBeNull();
    expect(melody!.notes.length).toBeGreaterThan(0);
  });

  it("stops using a curve when the chord count changes", () => {
    useProgressionStore.setState({
      chordTensionCurve: { signature: "C|G", curve: [0.1, 0.8] },
    });
    useProgressionStore.getState().deleteChord(1);
    useProgressionStore.getState().setMelodyEnabled(true);
    const melody = useProgressionStore.getState().melody;
    expect(melody).not.toBeNull();
    expect(melody!.notes.length).toBeGreaterThan(0);
  });
});

/**
 * `exportCompositionMidi` combines the current progression and its generated
 * melody into one downloadable MIDI file. These tests exercise the store
 * wiring (guards, and driving the shared MIDI pipeline) — the dynamics model
 * and MIDI byte content itself are covered in `progressionMidiExport.test.ts`.
 */
describe("progression store composition MIDI export", () => {
  const progression: Progression = {
    id: "composition-test",
    timestamp: 0,
    chords: [
      {
        symbol: "C", notes: ["C", "E", "G"], romanNumeral: "I",
        notesWithOctave: ["C3", "E3", "G3"], midiNotes: [48, 52, 55],
        root: "C", bass: "C", inversion: 0,
      },
      {
        symbol: "G", notes: ["G", "B", "D"], romanNumeral: "V",
        notesWithOctave: ["G3", "B3", "D4"], midiNotes: [55, 59, 62],
        root: "G", bass: "G", inversion: 0,
      },
    ],
  };

  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useProgressionStore.setState({ rootKey: "C", mode: "ionian", melodyEnabled: false });
    useProgressionStore.getState().loadProgression(progression);
    createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing without a current progression", () => {
    useProgressionStore.setState({ currentProgression: null, melody: null });
    useProgressionStore.getState().exportCompositionMidi();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("does nothing without a generated melody", () => {
    useProgressionStore.setState({ melody: null, melodyEnabled: false });
    useProgressionStore.getState().exportCompositionMidi();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("exports a single MIDI file with a Chords track and a Melody track", async () => {
    useProgressionStore.getState().setMelodyEnabled(true);
    expect(useProgressionStore.getState().melody).not.toBeNull();

    useProgressionStore.getState().exportCompositionMidi();

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/midi");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const midi = new Midi(bytes);
    expect(midi.tracks).toHaveLength(2);
    expect(midi.tracks[0].name).toBe("Chords");
    expect(midi.tracks[1].name).toBe("Melody");
    expect(midi.tracks[0].notes.length).toBeGreaterThan(0);
    expect(midi.tracks[1].notes.length).toBeGreaterThan(0);
  });
});
