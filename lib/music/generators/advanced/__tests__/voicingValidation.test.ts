import { describe, it, expect } from "vitest";
import { generateAdvancedProgression } from "../generateAdvancedProgression";
import type { AdvancedComplexity, AdvancedProgressionOptions } from "../types";
import { getChordPitchClasses, toPitchClass } from "@/lib/theory/chordSymbol";
import type { PitchClass } from "@/lib/theory/midiUtils";
import type { Mode } from "@/lib/theory/harmonyEngine";

// All 12 sharp-only roots and the 5 modes the generator supports.
const ROOTS: PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
const MODES: Mode[] = ["ionian", "aeolian", "dorian", "mixolydian", "phrygian"];
const COMPLEXITIES: AdvancedComplexity[] = [1, 2, 3, 4];

function baseOptions(
  rootKey: PitchClass,
  mode: Mode,
  complexity: AdvancedComplexity,
  seed: number,
): AdvancedProgressionOptions {
  return {
    rootKey,
    mode,
    numChords: 6,
    complexity,
    voicingStyle: "auto",
    voiceCount: 4,
    rangeLow: 48,
    rangeHigh: 84,
    // Exercise every substitution path.
    usePassingChords: true,
    useSuspensions: true,
    useSecondaryDominants: true,
    useTritoneSubstitution: true,
    useFunctionalSubstitutions: true,
    seed,
  };
}

describe("advanced generator — voiced pitch classes ⊆ chord symbol", () => {
  for (const mode of MODES) {
    for (const root of ROOTS) {
      it(`${root} ${mode}: every chord's notes are valid for its symbol (all complexities/seeds)`, () => {
        for (const complexity of COMPLEXITIES) {
          for (let seed = 0; seed < 12; seed++) {
            const result = generateAdvancedProgression(baseOptions(root, mode, complexity, seed));
            for (const chord of result.chords) {
              const allowed = getChordPitchClasses(chord.symbol);
              if (allowed.length === 0) continue; // unparseable -> skip (sentinel)
              const got = chord.midi.map(toPitchClass);
              const offending = got.filter((pc) => !allowed.includes(pc));
              expect(
                offending,
                `${chord.symbol} produced ${got.join(",")} (allowed ${allowed.join(",")})`,
              ).toEqual([]);
            }
          }
        }
      });
    }
  }
});

describe("regression — E natural minor D7 (original bug)", () => {
  it("getChordPitchClasses('D7') is exactly D F# A C", () => {
    expect(getChordPitchClasses("D7")).toEqual(["D", "F#", "A", "C"]);
  });

  it("never voices C# inside a D7 in E aeolian, across seeds and complexities", () => {
    let sawD7 = false;
    for (const complexity of COMPLEXITIES) {
      for (let seed = 0; seed < 200; seed++) {
        const result = generateAdvancedProgression(baseOptions("E", "aeolian", complexity, seed));
        for (const chord of result.chords) {
          if (chord.symbol !== "D7") continue;
          sawD7 = true;
          const got = chord.midi.map(toPitchClass);
          // Subset of D7's tones, and crucially never the spurious C#.
          expect(got.every((pc) => ["D", "F#", "A", "C"].includes(pc))).toBe(true);
          expect(got).not.toContain("C#");
        }
      }
    }
    // Sanity: the ♭VII7 (D7) actually occurs in E aeolian generation.
    expect(sawD7).toBe(true);
  });
});
