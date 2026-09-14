import { describe, it, expect } from "vitest";
import { generateProgression, type Depth, type GeneratedChord } from "../harmonyEngine";
import { buildTriadFromRoot } from "../chord";
import { PITCH_CLASSES, type PitchClass } from "../midiUtils";
import { getMajorPentatonicScale } from "../scale";

const DEPTHS: Depth[] = [0, 1, 2];

/** Scale-degree index each pentatonic roman numeral sits on. */
const DEGREE_INDEX: Record<string, number> = { I: 0, II: 1, V: 3, vi: 4 };

function qualitiesByDegree(chords: GeneratedChord[]): Map<string, Set<string>> {
  const byDegree = new Map<string, Set<string>>();
  for (const chord of chords) {
    const set = byDegree.get(chord.degree) ?? new Set<string>();
    set.add(chord.quality);
    byDegree.set(chord.degree, set);
  }
  return byDegree;
}

/** Sample enough progressions that every degree in the vocabulary shows up. */
function sampleChords(depth: Depth): GeneratedChord[] {
  const chords: GeneratedChord[] = [];
  for (let i = 0; i < 60; i++) {
    chords.push(
      ...generateProgression({ rootKey: "C", mode: "major_pentatonic", depth, numChords: 8 })
    );
  }
  return chords;
}

describe("simple generator — major pentatonic", () => {
  it("uses only degrees that can carry a chord", () => {
    for (const depth of DEPTHS) {
      for (const chord of sampleChords(depth)) {
        expect(Object.keys(DEGREE_INDEX)).toContain(chord.degree);
      }
    }
  });

  it("opens on the tonic", () => {
    for (const depth of DEPTHS) {
      for (let i = 0; i < 20; i++) {
        const chords = generateProgression({
          rootKey: "C",
          mode: "major_pentatonic",
          depth,
          numChords: 4,
        });
        expect(chords[0].degree).toBe("I");
      }
    }
  });

  // Regression: the pentatonic path used to ignore `depth`, so depths 0, 1 and
  // 2 all produced the same basic chords while every other mode used it.
  it("honours depth — richer qualities at higher depths", () => {
    const [plain, sevenths, ninths] = DEPTHS.map((d) => qualitiesByDegree(sampleChords(d)));

    // vi gains its 7th at depth 1 and keeps it at depth 2.
    expect(plain.get("vi")).toEqual(new Set(["m"]));
    expect(sevenths.get("vi")).toEqual(new Set(["m7"]));
    expect(ninths.get("vi")).toEqual(new Set(["m7"]));

    // The tonic gains its 9th only at depth 2.
    expect(plain.get("I")).toEqual(new Set([""]));
    expect(ninths.get("I")).toEqual(new Set(["add9"]));

    // V moves from sus4 to the more open sus2.
    expect(plain.get("V")).toEqual(new Set(["sus4"]));
    expect(sevenths.get("V")).toEqual(new Set(["sus2"]));
  });

  it("keeps every depth's chords inside the scale, in any key", () => {
    for (const root of PITCH_CLASSES) {
      const scaleNotes = new Set<PitchClass>(getMajorPentatonicScale(root).pitchClasses);

      for (const depth of DEPTHS) {
        for (const chord of sampleChords(depth)) {
          const degreeRoot = getMajorPentatonicScale(root).pitchClasses[
            DEGREE_INDEX[chord.degree]
          ];
          const built = buildTriadFromRoot(degreeRoot, chord.quality);
          const outside = built.pitchClasses.filter((pc: PitchClass) => !scaleNotes.has(pc));

          expect(
            outside,
            `${root} pentatonic depth ${depth}: ${degreeRoot}${chord.quality} uses ${outside.join(",")}`
          ).toEqual([]);
        }
      }
    }
  });
});
