import { beforeEach, describe, expect, it } from "vitest";

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
