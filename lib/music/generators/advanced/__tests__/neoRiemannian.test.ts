import { describe, expect, it } from "vitest";

import {
  TRANSFORM_INFO,
  TRANSFORMS,
  applyTransform,
  commonTones,
  parsimoniousVoicing,
  transformBetween,
  triadPitchClasses,
  type NeoRiemannianTriad,
} from "@/lib/music/generators/advanced/neoRiemannian";

const C = { root: 0, quality: "maj" as const };

describe("transforms", () => {
  it("matches the reference table from C major", () => {
    expect(applyTransform(C, "P")).toEqual({ root: 0, quality: "min" }); // Cm
    expect(applyTransform(C, "L")).toEqual({ root: 4, quality: "min" }); // Em
    expect(applyTransform(C, "R")).toEqual({ root: 9, quality: "min" }); // Am
    expect(applyTransform(C, "S")).toEqual({ root: 1, quality: "min" }); // C#m
    expect(applyTransform(C, "N")).toEqual({ root: 5, quality: "min" }); // Fm
    expect(applyTransform(C, "H")).toEqual({ root: 8, quality: "min" }); // G#m
    expect(applyTransform(C, "LP")).toEqual({ root: 4, quality: "maj" }); // E
    expect(applyTransform(C, "PL")).toEqual({ root: 8, quality: "maj" }); // G#
  });

  it.each(["P", "L", "R", "S", "N", "H"] as const)("%s is an involution", (transform) => {
    for (let root = 0; root < 12; root++) {
      for (const quality of ["maj", "min"] as const) {
        const triad = { root, quality };
        expect(applyTransform(applyTransform(triad, transform), transform)).toEqual(triad);
      }
    }
  });

  it.each(TRANSFORMS)("%s keeps the number of common tones the theory says", (transform) => {
    const result = applyTransform(C, transform);
    expect(commonTones(C, result)).toBe(TRANSFORM_INFO[transform].commonTones);
  });

  it("LP and PL invert each other and walk the major-third cycle", () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of ["maj", "min"] as const) {
        const triad = { root, quality };
        expect(applyTransform(applyTransform(triad, "LP"), "PL")).toEqual(triad);
        expect(applyTransform(applyTransform(triad, "PL"), "LP")).toEqual(triad);
      }
    }
    // C → E → G# → C
    let triad: NeoRiemannianTriad = C;
    for (let i = 0; i < 3; i++) triad = applyTransform(triad, "LP");
    expect(triad).toEqual(C);
  });

  it("composes: S = LPR, N = RLP, H = LPL", () => {
    const chain = (start: NeoRiemannianTriad, steps: ("L" | "P" | "R")[]) =>
      steps.reduce<NeoRiemannianTriad>((triad, step) => applyTransform(triad, step), start);
    expect(chain(C, ["R", "P", "L"])).toEqual(applyTransform(C, "S"));
    expect(chain(C, ["P", "L", "R"])).toEqual(applyTransform(C, "N"));
    expect(chain(C, ["L", "P", "L"])).toEqual(applyTransform(C, "H"));
  });

  it("finds the transform between two triads", () => {
    expect(transformBetween(C, { root: 8, quality: "maj" })).toBe("PL");
    // The way back is the inverse transform.
    expect(transformBetween({ root: 8, quality: "maj" }, C)).toBe("LP");
    expect(transformBetween(C, { root: 2, quality: "maj" })).toBeNull();
  });
});

describe("parsimonious voice leading", () => {
  it("moves one voice by a semitone for P and holds the rest", () => {
    // C-E-G-C → C-Eb-G-C
    expect(parsimoniousVoicing([48, 52, 55, 60], triadPitchClasses(applyTransform(C, "P")))).toEqual([48, 51, 55, 60]);
  });

  it("moves every voice by a semitone for the hexatonic pole", () => {
    const before = [48, 52, 55];
    const after = parsimoniousVoicing(before, triadPitchClasses(applyTransform(C, "H")))!;
    expect(after).not.toBeNull();
    after.forEach((note, i) => expect(Math.abs(note - before[i])).toBe(1));
  });

  it("covers every chord tone or refuses", () => {
    // Two voices cannot cover a triad.
    expect(parsimoniousVoicing([48, 55], [0, 4, 7])).toBeNull();
  });

  it("respects the range", () => {
    expect(parsimoniousVoicing([48, 52, 55], [1, 5, 8], { low: 50, high: 80 })).toBeNull();
  });
});
