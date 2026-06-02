import { describe, it, expect } from "vitest";
import { getChordPitchClasses, normalizeRoot } from "../chordSymbol";
import { PITCH_CLASSES, type PitchClass } from "../midiUtils";

// The engine uses sharp-only, enharmonically-correct pitch classes
// (Bb -> A#, Eb -> D#). These tests assert pitch-class identity, not spelling.

/** Build expected pitch classes from a root and interval set (chord order, deduped). */
function expectedFrom(root: PitchClass, intervals: number[]): PitchClass[] {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  const seen = new Set<number>();
  const out: PitchClass[] = [];
  for (const raw of intervals) {
    const i = ((raw % 12) + 12) % 12;
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(PITCH_CLASSES[(rootIndex + i) % 12]);
  }
  return out;
}

describe("getChordPitchClasses — spec examples", () => {
  it("D7 = D F# A C", () => {
    expect(getChordPitchClasses("D7")).toEqual(["D", "F#", "A", "C"]);
  });

  it("Cmaj7 = C E G B", () => {
    expect(getChordPitchClasses("Cmaj7")).toEqual(["C", "E", "G", "B"]);
  });

  it("Bbmin7 = A# C# F G# (sharp-only spelling of Bb Db F Ab)", () => {
    expect(getChordPitchClasses("Bbmin7")).toEqual(["A#", "C#", "F", "G#"]);
  });

  it("F#dim7 = F# A C D# (sharp-only spelling of F# A C Eb)", () => {
    expect(getChordPitchClasses("F#dim7")).toEqual(["F#", "A", "C", "D#"]);
  });

  it("G7b9 = G B D F G# (sharp-only spelling of G B D F Ab)", () => {
    expect(getChordPitchClasses("G7b9")).toEqual(["G", "B", "D", "F", "G#"]);
  });
});

describe("getChordPitchClasses — flat / accidental normalization", () => {
  it("normalizeRoot maps flats to sharps", () => {
    expect(normalizeRoot("Bb")).toBe("A#");
    expect(normalizeRoot("Eb")).toBe("D#");
    expect(normalizeRoot("Cb")).toBe("B");
    expect(normalizeRoot("F#")).toBe("F#");
    expect(normalizeRoot("x")).toBeNull();
  });

  it("accepts synonym notations", () => {
    expect(getChordPitchClasses("Cm7")).toEqual(getChordPitchClasses("Cmin7"));
    expect(getChordPitchClasses("C-7")).toEqual(getChordPitchClasses("Cmin7"));
    expect(getChordPitchClasses("CM7")).toEqual(getChordPitchClasses("Cmaj7"));
    expect(getChordPitchClasses("Cdom7")).toEqual(getChordPitchClasses("C7"));
    expect(getChordPitchClasses("C°7")).toEqual(getChordPitchClasses("Cdim7"));
    expect(getChordPitchClasses("C+")).toEqual(getChordPitchClasses("Caug"));
  });
});

describe("getChordPitchClasses — internal generator symbol forms", () => {
  it("parses trailing (9) / (13) annotations", () => {
    expect(getChordPitchClasses("C7(9)")).toEqual(expectedFrom("C", [0, 4, 7, 10, 2]));
    expect(getChordPitchClasses("Cmaj7(13)")).toEqual(expectedFrom("C", [0, 4, 7, 11, 9]));
  });

  it("7alt returns a superset of altered dominant tones (excludes maj7)", () => {
    const alt = getChordPitchClasses("D7alt");
    // Any single altered dominant must be a subset of 7alt.
    for (const q of ["D7b9", "D7#9", "D7b5", "D7#5", "D7"]) {
      const sub = getChordPitchClasses(q);
      expect(sub.every((pc) => alt.includes(pc))).toBe(true);
    }
    // A major 7th (C#) must NOT be accepted by 7alt — so stray maj7 is caught.
    expect(alt).not.toContain("C#");
  });

  it("unparseable symbol returns empty array (skip-validation sentinel)", () => {
    expect(getChordPitchClasses("")).toEqual([]);
    expect(getChordPitchClasses("H9")).toEqual([]);
    expect(getChordPitchClasses("Cwobble")).toEqual([]);
  });
});

// --- Full matrix: all 12 roots × all spec chord qualities ---

const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Quality suffix -> interval set (semitones from root).
const QUALITY_MATRIX: Record<string, number[]> = {
  "": [0, 4, 7], // maj
  m: [0, 3, 7], // min
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  "9": [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  m9: [0, 3, 7, 10, 2],
  "7b9": [0, 4, 7, 10, 1],
  "7#9": [0, 4, 7, 10, 3],
  "7b5": [0, 4, 6, 10],
  "7#5": [0, 4, 8, 10],
};

describe("getChordPitchClasses — full 12-root × quality matrix", () => {
  for (const [suffix, intervals] of Object.entries(QUALITY_MATRIX)) {
    for (const root of ROOTS) {
      const symbol = `${root}${suffix}`;
      it(`${symbol} matches its interval set`, () => {
        const normalized = normalizeRoot(root)!;
        expect(getChordPitchClasses(symbol)).toEqual(expectedFrom(normalized, intervals));
      });
    }
  }
});
