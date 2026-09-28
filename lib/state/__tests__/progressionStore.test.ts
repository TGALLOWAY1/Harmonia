import { beforeEach, describe, expect, it } from "vitest";
import { useProgressionStore } from "../progressionStore";

describe("progressionStore deterministic generation", () => {
  beforeEach(() => {
    useProgressionStore.setState({
      currentProgression: null,
      history: [],
      rootKey: "F",
      mode: "aeolian",
      complexity: 3,
      numChords: 6,
      seed: 2026,
      voicingStyle: "spread",
      voiceCount: 4,
      chordSourceTypes: [],
      originalChords: new Map(),
      melody: null,
      melodyEnabled: false,
    });
  });

  it("reproduces the same chord symbols and canonical MIDI from the same seed", () => {
    const store = useProgressionStore.getState();
    store.generateNew();
    const first = useProgressionStore.getState().currentProgression;

    useProgressionStore.getState().generateNew();
    const second = useProgressionStore.getState().currentProgression;

    expect(first?.seed).toBe(2026);
    expect(second?.seed).toBe(2026);
    expect(second?.chords.map(({ symbol, romanNumeral, midiNotes }) => ({
      symbol,
      romanNumeral,
      midiNotes,
    }))).toEqual(first?.chords.map(({ symbol, romanNumeral, midiNotes }) => ({
      symbol,
      romanNumeral,
      midiNotes,
    })));
  });
});
