import { describe, it, expect } from "vitest";
import { getSubstitutions } from "../substitutionEngine";
import { generateAdvancedProgression } from "@/lib/music/generators/advanced/generateAdvancedProgression";
import { getChordPitchClasses, normalizeRoot, toPitchClass } from "@/lib/theory/chordSymbol";
import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import { getMajorPentatonicScale } from "@/lib/theory/scale";
import type { Chord } from "@/lib/theory/progressionTypes";

/** Generate a real pentatonic progression and hand its chords to the engine. */
function progressionChords(root: PitchClass, seed: number): Chord[] {
  const result = generateAdvancedProgression({
    rootKey: root,
    mode: "major_pentatonic",
    numChords: 4,
    complexity: 2,
    voicingStyle: "auto",
    voiceCount: 4,
    rangeLow: 48,
    rangeHigh: 79,
    usePassingChords: true,
    useSuspensions: true,
    useSecondaryDominants: true,
    useTritoneSubstitution: true,
    useFunctionalSubstitutions: true,
    seed,
  });

  return result.chords.map((voiced) => ({
    symbol: voiced.symbol,
    notes: voiced.midi.map(toPitchClass),
    romanNumeral: voiced.degreeLabel,
    midiNotes: voiced.midi,
    root: normalizeRoot(voiced.symbol) ?? "C",
    durationClass: voiced.durationClass,
  }));
}

describe("substitutions in major pentatonic", () => {
  it("suggests only chords whose notes are in the scale", () => {
    for (const root of PITCH_CLASSES) {
      const scaleNotes = new Set<PitchClass>(getMajorPentatonicScale(root).pitchClasses);
      const chords = progressionChords(root, 3);

      for (let i = 0; i < chords.length; i++) {
        const options = getSubstitutions(chords[i], i, chords, root, "major_pentatonic");
        expect(options.length, `${root}: no substitutions offered for ${chords[i].symbol}`).toBeGreaterThan(0);

        for (const option of options) {
          // Inversions re-voice the source chord, which is already in scale.
          const notes =
            option.category === "inversion"
              ? option.candidateMidiNotes.map(toPitchClass)
              : getChordPitchClasses(option.candidateSymbol);

          const outside = notes.filter((pc) => !scaleNotes.has(pc));
          expect(
            outside,
            `${root} pentatonic: ${option.candidateSymbol} (${option.category}) uses ${outside.join(",")}`
          ).toEqual([]);
        }
      }
    }
  });

  it("offers no chromatic categories — the scale has nothing to build them from", () => {
    const chords = progressionChords("C", 3);

    for (let i = 0; i < chords.length; i++) {
      for (const option of getSubstitutions(chords[i], i, chords, "C", "major_pentatonic")) {
        expect(["diatonic", "relative", "inversion"]).toContain(option.category);
      }
    }
  });

  it("pairs I and vi as the relative substitution", () => {
    const chords = progressionChords("C", 3);
    const tonicIndex = chords.findIndex((c) => c.root === "C");
    expect(tonicIndex).toBeGreaterThanOrEqual(0);

    const relatives = getSubstitutions(
      chords[tonicIndex],
      tonicIndex,
      chords,
      "C",
      "major_pentatonic"
    ).filter((o) => o.category === "relative");

    expect(relatives.length).toBeGreaterThan(0);
    for (const option of relatives) {
      expect(option.candidateRoot).toBe("A");
    }
  });
});
