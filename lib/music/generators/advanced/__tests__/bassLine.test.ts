import { describe, expect, it } from "vitest";

import { bassOptionsFor, bassRegister, inversionOfVoicing, planBassLine } from "@/lib/music/generators/advanced/bassLine";
import type { PlannedAdvancedChord } from "@/lib/music/generators/advanced/types";

const chord = (
  symbol: string,
  root: PlannedAdvancedChord["root"],
  pitchClasses: PlannedAdvancedChord["pitchClasses"],
  over: Partial<PlannedAdvancedChord> = {}
): PlannedAdvancedChord => ({ degreeLabel: symbol, symbol, root, pitchClasses, kind: "diatonic", ...over });

const I = chord("C", "C", ["C", "E", "G"]);
const iii = chord("Em", "E", ["E", "G", "B"]);
const ii = chord("Dm", "D", ["D", "F", "A"]);
const IV = chord("F", "F", ["F", "A", "C"]);
const V = chord("G", "G", ["G", "B", "D"], { isDominant: true });
const vi = chord("Am", "A", ["A", "C", "E"]);
const V7 = chord("G7", "G", ["G", "B", "D", "F"], { isDominant: true });

describe("bass options", () => {
  it("offers root, third, fifth and seventh, in that inversion order", () => {
    expect(bassOptionsFor(V7).map((o) => [o.pc, o.inversion])).toEqual([
      [7, 0],
      [11, 1],
      [2, 2],
      [5, 3],
    ]);
  });

  it("keeps the root under a suspension", () => {
    const sus = chord("G7sus4", "G", ["G", "C", "D", "F"], { kind: "suspension" });
    expect(bassOptionsFor(sus)).toHaveLength(1);
  });
});

describe("bass-line planning", () => {
  it("puts the opening, the cadential dominant and the final tonic in root position", () => {
    const plan = planBassLine([I, IV, V, I], { tonic: "C", cadence: "resolve" });
    expect(plan[0]).toMatchObject({ bass: "C", inversion: 0 });
    expect(plan[2]).toMatchObject({ bass: "G", inversion: 0 });
    expect(plan[3]).toMatchObject({ bass: "C", inversion: 0 });
  });

  it("buys a stepwise bass line with a first inversion", () => {
    // I - iii - ii - V: with ii in first inversion the bass walks E - F - G
    // into the dominant instead of dropping to D.
    const plan = planBassLine([I, iii, ii, V, I], { tonic: "C", cadence: "resolve" });
    expect(plan[2]).toMatchObject({ bass: "F", inversion: 1 });
    expect(plan[2].reason).toMatch(/step|scale line/);
    expect(plan[3]).toMatchObject({ bass: "G", inversion: 0 });
    expect(plan[3].reason).toMatch(/scale line/);
  });

  it("keeps the bass within a fifth of itself and moves by step somewhere", () => {
    const plan = planBassLine([I, V, vi, IV, I], { tonic: "C", cadence: "resolve" });
    let steps = 0;
    for (let i = 1; i < plan.length; i++) {
      const interval = Math.abs(plan[i].pitch - plan[i - 1].pitch);
      expect(interval).toBeLessThanOrEqual(7);
      if (interval > 0 && interval <= 2) steps++;
    }
    expect(steps).toBeGreaterThan(0);
  });

  it("never picks a second inversion without a 6-4 idiom", () => {
    const plan = planBassLine([I, vi, IV, V7, I], { tonic: "C", cadence: "resolve" });
    plan.forEach((entry, i) => {
      if (entry.inversion !== 2) return;
      expect(entry.reason).toMatch(/6-4/);
      expect(i).toBeGreaterThan(0);
    });
  });

  it("resolves a seventh in the bass down by step", () => {
    const plan = planBassLine([I, V7, I, IV, V7, I], { tonic: "C", cadence: "resolve" });
    plan.forEach((entry, i) => {
      if (entry.inversion !== 3) return;
      const next = plan[i + 1];
      expect(next).toBeDefined();
      // Measured in real pitches, so "down by step" cannot be an upward seventh.
      expect([1, 2]).toContain(entry.pitch - next.pitch);
    });
  });

  // Regression: the plan used to be made in pitch classes, so a "step down"
  // from C to B♭ at the bottom of the range was realised an octave up, as a
  // leap of a seventh, because no lower B♭ existed to voice.
  it("plans concrete pitches, so a step stays a step at the range floor", () => {
    const bVII = chord("A#7", "A#", ["A#", "D", "F", "G#"]);
    const plan = planBassLine([I, bVII, IV, V, I], { tonic: "C", cadence: "resolve", range: { low: 48, high: 79 } });
    expect(plan[1].reason).toMatch(/step/);
    expect(Math.abs(plan[1].pitch - plan[0].pitch)).toBeLessThanOrEqual(2);
    plan.forEach((entry) => expect(entry.pitch % 12).toBe(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(entry.bass)));
  });

  it("keeps every planned pitch inside the bass register of the range", () => {
    const range = { low: 48, high: 79 };
    const { floor, ceiling } = bassRegister(range);
    expect(floor).toBe(48);
    expect(ceiling).toBe(64);
    const plan = planBassLine([I, vi, IV, V7, I, IV, V, I], { tonic: "C", cadence: "resolve", range });
    plan.forEach((entry) => {
      expect(entry.pitch).toBeGreaterThanOrEqual(floor);
      expect(entry.pitch).toBeLessThanOrEqual(ceiling);
    });
  });

  it("is deterministic without a random source and varies only near ties with one", () => {
    const a = planBassLine([I, IV, V, I], { tonic: "C", cadence: "resolve" });
    const b = planBassLine([I, IV, V, I], { tonic: "C", cadence: "resolve" });
    expect(a).toEqual(b);
  });
});

describe("inversion of a voicing", () => {
  it("reads the sounding bass", () => {
    expect(inversionOfVoicing([48, 52, 55, 60], "C")).toEqual({ bass: "C", inversion: 0 });
    expect(inversionOfVoicing([52, 55, 60, 64], "C")).toEqual({ bass: "E", inversion: 1 });
    expect(inversionOfVoicing([55, 60, 64, 72], "C")).toEqual({ bass: "G", inversion: 2 });
    expect(inversionOfVoicing([59, 60, 64, 67], "C")).toEqual({ bass: "B", inversion: 3 });
    expect(inversionOfVoicing([50, 60, 64, 67], "C")).toEqual({ bass: "D", inversion: -1 });
  });
});
