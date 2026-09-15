import { describe, expect, it } from "vitest";

import {
  borrowedChordCatalogue,
  brightnessTargetsFor,
  buildBorrowedChordPlan,
  describeChromaticTriad,
  picardyTonic,
  romanForOffset,
} from "@/lib/music/generators/advanced/modalInterchange";
import { getChordPitchClasses } from "@/lib/theory/chordSymbol";

const byLabel = (mode: Parameters<typeof borrowedChordCatalogue>[0], raised: boolean) =>
  Object.fromEntries(borrowedChordCatalogue(mode, raised).map((spec) => [spec.label, spec]));

describe("borrowed chord catalogue", () => {
  it("offers the classic major-key borrowings, each tagged with its source", () => {
    const major = byLabel("ionian", true);

    expect(major["iv"]).toMatchObject({ sourceMode: "aeolian", brightness: -1, function: "predominant" });
    expect(major["bVI"]).toMatchObject({ sourceMode: "aeolian", function: "predominant" });
    expect(major["bVII"]).toMatchObject({ sourceMode: "mixolydian", brightness: 1, function: "dominant" });
    expect(major["bII"]).toMatchObject({ sourceMode: "phrygian", brightness: -2 });
    expect(major["II"]).toMatchObject({ sourceMode: "lydian", brightness: 3 });
    expect(major["#iv°"]).toMatchObject({ sourceMode: "lydian" });

    // Relative brightness is on the mood's −1..1 scale, signed sensibly.
    expect(major["iv"].relativeBrightness).toBeLessThan(0);
    expect(major["II"].relativeBrightness).toBeGreaterThan(0);
  });

  it("never lists a chord that is already diatonic to the home mode", () => {
    const labels = Object.keys(byLabel("ionian", true));
    for (const diatonic of ["I", "ii", "iii", "IV", "V", "vi", "vii°"]) {
      expect(labels).not.toContain(diatonic);
    }
  });

  it("gives minor keys the dorian IV, the Neapolitan, and the leading-tone chords", () => {
    const minor = byLabel("aeolian", true);
    expect(minor["IV"]).toMatchObject({ sourceMode: "dorian", function: "predominant" });
    expect(minor["bII"]).toMatchObject({ sourceMode: "phrygian" });
    expect(minor["vii°"]).toMatchObject({ sourceMode: "harmonic-minor", seventhQuality: "dim7" });
    // The generator already raises V in aeolian, so it is not a borrowing there.
    expect(minor["V"]).toBeUndefined();
    // The Picardy third is final-only and not part of the general pool.
    expect(minor["I"]).toMatchObject({ finalOnly: true });
  });

  it("lets modal keys borrow a real dominant", () => {
    expect(byLabel("mixolydian", false)["V"]).toMatchObject({ sourceMode: "ionian" });
    expect(byLabel("dorian", false)["V"]).toMatchObject({ sourceMode: "harmonic-minor" });
  });

  it("has nothing to offer the pentatonic path", () => {
    expect(borrowedChordCatalogue("major_pentatonic", false)).toEqual([]);
  });
});

describe("labelling", () => {
  it("names chords by their distance from the tonic on the major-reference convention", () => {
    expect(romanForOffset(8, "maj")).toBe("bVI");
    expect(romanForOffset(5, "min")).toBe("iv");
    expect(romanForOffset(6, "dim")).toBe("#iv°");
    expect(romanForOffset(1, "maj")).toBe("bII");
    expect(romanForOffset(4, "maj")).toBe("III");
  });

  it("describes transform results in the catalogue's terms, or as chromatic mediants", () => {
    // Ab major in C: bVI, from the catalogue.
    expect(describeChromaticTriad(8, "maj", "ionian", true)?.affect).toContain("bVI");
    // E major in C: a chromatic mediant the catalogue does not list.
    expect(describeChromaticTriad(4, "maj", "ionian", true)).toMatchObject({ label: "III", function: "chromatic" });
    // Diatonic chords are not chromatic at all.
    expect(describeChromaticTriad(9, "min", "ionian", true)).toBeNull();
    // Remote roots that are not mediants are refused.
    expect(describeChromaticTriad(6, "maj", "ionian", true)).toBeNull();
  });
});

describe("building borrowed chords", () => {
  it("produces symbols the validator can parse, whose notes match", () => {
    for (const mode of ["ionian", "aeolian", "dorian", "mixolydian", "phrygian"] as const) {
      for (const spec of borrowedChordCatalogue(mode, mode === "ionian" || mode === "aeolian")) {
        for (const complexity of [1, 2, 3, 4] as const) {
          const plan = buildBorrowedChordPlan({ spec, tonic: "D", complexity, tensionLevel: 0.5 });
          const allowed = getChordPitchClasses(plan.symbol);
          expect(allowed.length, plan.symbol).toBeGreaterThan(0);
          expect([...plan.pitchClasses].sort()).toEqual([...allowed].sort());
          expect(plan.kind).toBe("borrowed");
        }
      }
    }
  });

  it("uses the seventh from complexity 2 upward", () => {
    const iv = borrowedChordCatalogue("ionian", true).find((spec) => spec.label === "iv")!;
    expect(buildBorrowedChordPlan({ spec: iv, tonic: "C", complexity: 1, tensionLevel: 0 }).symbol).toBe("Fm");
    expect(buildBorrowedChordPlan({ spec: iv, tonic: "C", complexity: 2, tensionLevel: 0 }).symbol).toBe("Fm7");
  });

  it("closes a minor key on a major tonic for the Picardy third", () => {
    const picardy = picardyTonic({ tonic: "A", complexity: 1, mode: "aeolian" });
    expect(picardy.symbol).toBe("A");
    expect(picardy.pitchClasses).toEqual(["A", "C#", "E"]);
    expect(picardy.degreeLabel).toBe("I");
    expect(picardy.brightness).toBeGreaterThan(0);
  });
});

describe("brightness curves", () => {
  it("darkening falls, sunrise rises, steady holds", () => {
    const darkening = brightnessTargetsFor("darkening", 0, 5);
    const sunrise = brightnessTargetsFor("sunrise", 0, 5);
    const steady = brightnessTargetsFor("steady", 0.3, 5);
    expect(darkening[4]).toBeLessThan(darkening[0]);
    expect(sunrise[4]).toBeGreaterThan(sunrise[0]);
    expect(new Set(steady).size).toBe(1);
    [...darkening, ...sunrise].forEach((b) => {
      expect(b).toBeGreaterThanOrEqual(-1);
      expect(b).toBeLessThanOrEqual(1);
    });
  });
});
