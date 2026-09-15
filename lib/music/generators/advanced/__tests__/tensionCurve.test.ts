import { describe, expect, it } from "vitest";

import {
  TENSION_SHAPES,
  chordTension,
  chromaticism,
  dissonance,
  inversionInstability,
  planningTension,
  tensionCurveFor,
} from "@/lib/music/generators/advanced/tensionCurve";
import type { PlannedAdvancedChord } from "@/lib/music/generators/advanced/types";
import { getScaleDefinition } from "@/lib/theory/scale";

const C_MAJOR = getScaleDefinition("C", "major").pitchClasses;

const chord = (over: Partial<PlannedAdvancedChord>): PlannedAdvancedChord => ({
  degreeLabel: "I",
  symbol: "C",
  root: "C",
  pitchClasses: ["C", "E", "G"],
  kind: "diatonic",
  ...over,
});

describe("tension shapes", () => {
  it.each(TENSION_SHAPES)("%s has one target per slot for every length", (shape) => {
    for (let n = 1; n <= 12; n++) {
      const curve = tensionCurveFor(shape, n);
      expect(curve).toHaveLength(n);
      curve.forEach((t) => {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      });
    }
  });

  it("arch departs, peaks in the middle and returns", () => {
    const arch = tensionCurveFor("arch", 5);
    expect(arch[0]).toBe(0);
    expect(arch[4]).toBeCloseTo(0, 6);
    expect(arch[2]).toBeGreaterThan(arch[1]);
    expect(arch[2]).toBeGreaterThan(arch[3]);
  });

  it("ramp never stops building", () => {
    const ramp = tensionCurveFor("ramp", 6);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
  });

  it("question rises to a half cadence, then answers with a full close", () => {
    const question = tensionCurveFor("question", 8);
    expect(question[3]).toBeCloseTo(0.6, 6); // half cadence ends the antecedent
    expect(question[4]).toBeLessThan(question[3]); // consequent re-departs
    expect(question[6]).toBeGreaterThan(question[3]); // and builds harder
    expect(question[7]).toBe(0);
  });

  it("plateau is still until one surge before the close", () => {
    expect(tensionCurveFor("plateau", 5)).toEqual([0.2, 0.2, 0.2, 0.9, 0]);
  });

  it("collapse opens at maximum tension and decays", () => {
    const collapse = tensionCurveFor("collapse", 4);
    expect(collapse[0]).toBeCloseTo(0.9, 6);
    expect(collapse[3]).toBe(0);
    for (let i = 1; i < collapse.length; i++) expect(collapse[i]).toBeLessThan(collapse[i - 1]);
  });

  it("phrase reproduces the classical length-keyed curve", () => {
    expect(tensionCurveFor("phrase", 4)).toEqual([0.1, 0.3, 0.8, 0.0]);
  });
});

describe("per-chord tension", () => {
  it("orders functions tonic < mediant < pre-dominant < dominant < applied", () => {
    const tonic = planningTension(chord({ degreeIndex: 0 }), C_MAJOR);
    const mediant = planningTension(chord({ degreeIndex: 5, root: "A", pitchClasses: ["A", "C", "E"] }), C_MAJOR);
    const predominant = planningTension(chord({ degreeIndex: 3, root: "F", pitchClasses: ["F", "A", "C"] }), C_MAJOR);
    const dominant = planningTension(
      chord({ degreeIndex: 4, root: "G", pitchClasses: ["G", "B", "D"], isDominant: true }),
      C_MAJOR
    );
    const applied = planningTension(
      chord({ kind: "secondary-dominant", root: "D", pitchClasses: ["D", "F#", "A", "C"], isDominant: true }),
      C_MAJOR
    );
    expect(tonic).toBeLessThan(mediant);
    expect(mediant).toBeLessThan(predominant);
    expect(predominant).toBeLessThan(dominant);
    expect(dominant).toBeLessThan(applied);
  });

  it("measures chromaticism as the fraction of notes outside the scale", () => {
    expect(chromaticism(chord({ root: "F", pitchClasses: ["F", "G#", "C"] }), C_MAJOR)).toBeCloseTo(1 / 3, 6);
    expect(chromaticism(chord({}), C_MAJOR)).toBe(0);
  });

  it("hears a dominant seventh as more dissonant than a triad", () => {
    expect(dissonance(chord({ root: "G", pitchClasses: ["G", "B", "D", "F"] }))).toBeGreaterThan(
      dissonance(chord({ root: "G", pitchClasses: ["G", "B", "D"] }))
    );
  });

  it("treats the second inversion as the least stable", () => {
    expect(inversionInstability(2)).toBeGreaterThan(inversionInstability(1));
    expect(inversionInstability(2)).toBeGreaterThan(inversionInstability(3));
    expect(inversionInstability(0)).toBe(0);
  });

  it("adds inversion and voice-leading distance on top of the planning terms", () => {
    const planned = planningTension(chord({}), C_MAJOR);
    const realised = chordTension({
      chord: chord({}),
      scalePitchClasses: C_MAJOR,
      inversion: 2,
      previousVoicing: [48, 55, 64, 71],
      voicing: [55, 60, 64, 72],
    });
    expect(realised).toBeGreaterThan(planned);
  });
});
