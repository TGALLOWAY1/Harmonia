import { describe, it, expect } from "vitest";
import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import {
  PENTATONIC_CHORD_DEGREES,
  getAllMajorPentatonicChords,
  getMajorPentatonicChords,
  getPentatonicChord,
  getPentatonicChordVariants,
  isPentatonicChordDegree,
  MAJOR_PENTATONIC_TEMPLATES,
  type PentatonicComplexity,
} from "../pentatonic";
import { getMajorPentatonicScale } from "../scale";

const COMPLEXITIES: PentatonicComplexity[] = [1, 2, 3, 4];

describe("major pentatonic chord vocabulary", () => {
  it("only offers chords on degrees that can carry one", () => {
    // The 3rd degree (index 2) has no scale-mate a 3rd or 7th above it.
    expect([...PENTATONIC_CHORD_DEGREES]).toEqual([0, 1, 3, 4]);
    expect(isPentatonicChordDegree(2)).toBe(false);
    expect(isPentatonicChordDegree(4)).toBe(true);
  });

  it("names the C major pentatonic palette as expected", () => {
    const palette = getMajorPentatonicChords("C", 2);
    expect(palette.map((c) => c.symbol)).toEqual(["C6", "D7sus4", "Gsus2", "Am7"]);
    expect(palette.map((c) => c.degreeLabel)).toEqual(["I", "II", "V", "vi"]);
  });

  it("gives every chord's notes from its own symbol", () => {
    const scale = getMajorPentatonicScale("C");
    expect(getPentatonicChord(scale, 0, 1).pitchClasses).toEqual(["C", "E", "G"]);
    expect(getPentatonicChord(scale, 0, 4).pitchClasses).toEqual(["C", "E", "G", "A", "D"]);
    expect(getPentatonicChord(scale, 1, 2).pitchClasses).toEqual(["D", "G", "A", "C"]);
    expect(getPentatonicChord(scale, 3, 2).pitchClasses).toEqual(["G", "A", "D"]);
    expect(getPentatonicChord(scale, 4, 2).pitchClasses).toEqual(["A", "C", "E", "G"]);
  });

  // This is the guarantee the whole module exists to make.
  it("never uses a note from outside the scale, in any key", () => {
    for (const root of PITCH_CLASSES) {
      const scaleNotes = new Set<PitchClass>(getMajorPentatonicScale(root).pitchClasses);

      for (const chord of getAllMajorPentatonicChords(root)) {
        expect(chord.pitchClasses.length, `${chord.symbol} did not parse`).toBeGreaterThan(0);

        const outside = chord.pitchClasses.filter((pc) => !scaleNotes.has(pc));
        expect(
          outside,
          `${chord.symbol} in ${root} major pentatonic uses ${outside.join(",")}, scale is ${[...scaleNotes].join(",")}`
        ).toEqual([]);
      }
    }
  });

  it("keeps every complexity level inside the scale, in any key", () => {
    for (const root of PITCH_CLASSES) {
      const scale = getMajorPentatonicScale(root);
      const scaleNotes = new Set<PitchClass>(scale.pitchClasses);

      for (const degree of PENTATONIC_CHORD_DEGREES) {
        for (const complexity of COMPLEXITIES) {
          const chord = getPentatonicChord(scale, degree, complexity);
          const outside = chord.pitchClasses.filter((pc) => !scaleNotes.has(pc));
          expect(outside, `${chord.symbol} (complexity ${complexity})`).toEqual([]);
        }
      }
    }
  });

  it("roots every chord on its own scale degree", () => {
    for (const root of PITCH_CLASSES) {
      const scale = getMajorPentatonicScale(root);
      for (const degree of PENTATONIC_CHORD_DEGREES) {
        for (const chord of getPentatonicChordVariants(scale, degree)) {
          expect(chord.root).toBe(scale.pitchClasses[degree]);
        }
      }
    }
  });

  it("builds progression templates only from chord-bearing degrees", () => {
    for (const template of MAJOR_PENTATONIC_TEMPLATES) {
      for (const degree of template) {
        expect(isPentatonicChordDegree(degree), `degree ${degree} in ${template}`).toBe(true);
      }
    }
  });

  it("opens or closes every template on a tonic-family chord", () => {
    for (const template of MAJOR_PENTATONIC_TEMPLATES) {
      // 0 = I, 4 = vi — the scale's two complete triads.
      const tonicFamily = [0, 4];
      const anchored =
        tonicFamily.includes(template[0]) || tonicFamily.includes(template[template.length - 1]);
      expect(anchored, `template ${template} has no tonic-family anchor`).toBe(true);
    }
  });
});
