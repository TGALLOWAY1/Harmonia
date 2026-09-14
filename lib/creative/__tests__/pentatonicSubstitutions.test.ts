import { describe, it, expect } from "vitest";
import { getSubstitutions } from "../substitutionEngine";
import { makeSpeller } from "@/lib/theory/spelling";
import { pitchClassToMidi } from "@/lib/theory/midiUtils";
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

  // Regression: display symbols are respelled per key (A#6 prints as Bb6 in
  // flat keys) while roots stay sharp-canonical. Comparing display symbols
  // missed the source chord and offered it back as its own substitution,
  // burning one of the 12 result slots on a no-op.
  it("never offers the source chord back under a different spelling", () => {
    for (const root of PITCH_CLASSES) {
      const speller = makeSpeller(root, "major_pentatonic");
      const scale = getMajorPentatonicScale(root);

      for (const degree of [0, 1, 3, 4] as const) {
        for (const suffix of ["", "6", "add9", "sus4", "sus2", "m", "m7"]) {
          const symbol = `${scale.pitchClasses[degree]}${suffix}`;
          const pcs = getChordPitchClasses(symbol);
          if (pcs.length === 0) continue;
          if (pcs.some((pc) => !scale.pitchClasses.includes(pc))) continue;

          const chord: Chord = {
            symbol: speller.symbol(symbol), // what the store actually holds
            notes: pcs.map((pc) => speller.pc(pc)),
            romanNumeral: "I",
            midiNotes: pcs.map((pc) => pitchClassToMidi(pc, 4)),
            root: normalizeRoot(symbol) ?? "C",
          };

          const options = getSubstitutions(chord, 0, [chord], root, "major_pentatonic");
          const sourcePcs = [...pcs].sort().join(",");

          for (const option of options) {
            if (option.category === "inversion") continue;
            const candidatePcs = getChordPitchClasses(option.candidateSymbol);
            const isSameChord =
              option.candidateRoot === chord.root &&
              [...candidatePcs].sort().join(",") === sourcePcs;
            expect(
              isSameChord,
              `${root}: ${chord.symbol} was offered ${option.candidateSymbol} — the same chord respelled`
            ).toBe(false);
          }
        }
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
