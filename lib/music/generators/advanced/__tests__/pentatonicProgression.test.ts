import { describe, it, expect } from "vitest";
import { generateAdvancedProgression } from "../generateAdvancedProgression";
import type { AdvancedComplexity, AdvancedProgressionOptions } from "../types";
import { toPitchClass } from "@/lib/theory/chordSymbol";
import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import { getMajorPentatonicScale } from "@/lib/theory/scale";

const COMPLEXITIES: AdvancedComplexity[] = [1, 2, 3, 4];
const LENGTHS = [3, 4, 5, 6, 8];

/**
 * Every chromatic toggle is switched ON here on purpose: in major pentatonic
 * they must have no effect, because each of them would otherwise introduce a
 * note the five-note scale does not contain.
 */
function pentatonicOptions(
  rootKey: PitchClass,
  complexity: AdvancedComplexity,
  seed: number,
  numChords = 4,
): AdvancedProgressionOptions {
  return {
    rootKey,
    mode: "major_pentatonic",
    numChords,
    complexity,
    voicingStyle: "auto",
    voiceCount: 4,
    rangeLow: 48,
    rangeHigh: 84,
    usePassingChords: true,
    useSuspensions: true,
    useSecondaryDominants: true,
    useTritoneSubstitution: true,
    useFunctionalSubstitutions: true,
    seed,
  };
}

describe("major pentatonic progressions", () => {
  // The headline guarantee: nothing a listener hears falls outside the scale.
  it("voices no note outside the scale, in any key, complexity, or seed", () => {
    for (const root of PITCH_CLASSES) {
      const scaleNotes = new Set<PitchClass>(getMajorPentatonicScale(root).pitchClasses);

      for (const complexity of COMPLEXITIES) {
        for (let seed = 0; seed < 25; seed++) {
          const result = generateAdvancedProgression(pentatonicOptions(root, complexity, seed, 6));

          for (const chord of result.chords) {
            const outside = chord.midi.map(toPitchClass).filter((pc) => !scaleNotes.has(pc));
            expect(
              outside,
              `${root} pentatonic seed ${seed}: ${chord.symbol} voiced ${outside.join(",")}`
            ).toEqual([]);
          }
        }
      }
    }
  });

  it("roots every chord on a scale degree that can carry one", () => {
    for (const root of PITCH_CLASSES) {
      const scale = getMajorPentatonicScale(root);
      // The 3rd degree is never a chord root — it has no scale-safe chord.
      const validRoots = new Set([0, 1, 3, 4].map((i) => scale.pitchClasses[i]));

      for (let seed = 0; seed < 25; seed++) {
        const result = generateAdvancedProgression(pentatonicOptions(root, 2, seed, 6));
        for (const chord of result.chords) {
          const chordRoot = chord.symbol.match(/^[A-G]#?/)?.[0] as PitchClass;
          expect(validRoots.has(chordRoot), `${chord.symbol} in ${root} pentatonic`).toBe(true);
        }
      }
    }
  });

  it("resolves to the tonic and uses only pentatonic roman numerals", () => {
    const allowedNumerals = new Set(["I", "II", "V", "vi"]);

    for (const numChords of LENGTHS) {
      for (let seed = 0; seed < 20; seed++) {
        const result = generateAdvancedProgression(pentatonicOptions("C", 2, seed, numChords));

        expect(result.chords).toHaveLength(numChords);
        for (const chord of result.chords) {
          expect(allowedNumerals.has(chord.degreeLabel), chord.degreeLabel).toBe(true);
        }

        const last = result.chords[result.chords.length - 1];
        expect(last.degreeLabel).toBe("I");
      }
    }
  });

  it("never repeats a chord back to back", () => {
    // A repeated chord reads as one long chord, wasting a slot the user asked
    // for — including the doubled tonic a naive cadence rule would produce.
    for (const numChords of LENGTHS) {
      for (let seed = 0; seed < 40; seed++) {
        const symbols = generateAdvancedProgression(
          pentatonicOptions("C", 2, seed, numChords)
        ).chords.map((c) => c.symbol);

        for (let i = 1; i < symbols.length; i++) {
          expect(symbols[i], `seed ${seed}: ${symbols.join(" ")}`).not.toBe(symbols[i - 1]);
        }
      }
    }
  });

  it("adds colour with complexity without leaving the scale", () => {
    // Complexity 1 is plain triads and sus chords; 4 brings in 6ths, 9ths and
    // sus 7ths — all of which are scale tones here.
    const plain = generateAdvancedProgression(pentatonicOptions("C", 1, 7, 4));
    const rich = generateAdvancedProgression(pentatonicOptions("C", 4, 7, 4));

    const plainTones = new Set(plain.chords.flatMap((c) => c.midi.map(toPitchClass)));
    const richTones = new Set(rich.chords.flatMap((c) => c.midi.map(toPitchClass)));

    expect(richTones.size).toBeGreaterThanOrEqual(plainTones.size);
    expect(plain.chords.map((c) => c.symbol)).not.toEqual(rich.chords.map((c) => c.symbol));
  });

  it("never emits a dominant seventh, tritone sub, or passing diminished", () => {
    // There is no tritone and no leading tone in the scale, so these chords
    // cannot exist here however the substitution toggles are set.
    for (const complexity of COMPLEXITIES) {
      for (let seed = 0; seed < 40; seed++) {
        const result = generateAdvancedProgression(pentatonicOptions("C", complexity, seed, 8));
        for (const chord of result.chords) {
          // A dominant 7th ("D7") is out; a sus 7th ("D7sus4") is fine — it has
          // no third, so it carries no tritone.
          expect(chord.symbol, chord.symbol).not.toMatch(/^[A-G]#?7(?!sus)/);
          expect(chord.symbol, chord.symbol).not.toMatch(/°|dim/);
        }
        for (const planned of result.debug?.planned ?? []) {
          expect(planned.isDominant ?? false, planned.symbol).toBe(false);
          expect(planned.kind, planned.symbol).toBe("diatonic");
        }
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generateAdvancedProgression(pentatonicOptions("D", 3, 99, 6));
    const b = generateAdvancedProgression(pentatonicOptions("D", 3, 99, 6));
    expect(a.chords.map((c) => c.symbol)).toEqual(b.chords.map((c) => c.symbol));
    expect(a.chords.map((c) => c.midi)).toEqual(b.chords.map((c) => c.midi));
  });
});
