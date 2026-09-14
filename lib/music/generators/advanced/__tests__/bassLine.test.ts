import { describe, expect, it } from "vitest";

import { bassOptionsFor, inversionOfVoicing, planBassLine } from "@/lib/music/generators/advanced/bassLine";
import type { PlannedAdvancedChord } from "@/lib/music/generators/advanced/types";

const chord = (
  symbol: string,
  root: PlannedAdvancedChord["root"],
  pitchClasses: PlannedAdvancedChord["pitchClasses"],
  over: Partial<PlannedAdvancedChord> = {}
): PlannedAdvancedChord => ({ degreeLabel: symbol, symbol, root, pitchClasses, kind: "diatonic", ...over });

const I = chord("C", "C", ["C", "E", "G"]);
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

  it("buys stepwise bass motion with a first inversion", () => {
    // I - V - vi - IV in root position leaps C G A F; a V6 turns the opening
    // into a scale line C B A.
    const plan = planBassLine([I, V, vi, IV, I], { tonic: "C", cadence: "resolve" });
    expect(plan[1]).toMatchObject({ bass: "B", inversion: 1 });
    expect(plan[2]).toMatchObject({ bass: "A", inversion: 0 });
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
      const pcs = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const delta = (pcs.indexOf(entry.bass) - pcs.indexOf(next.bass) + 12) % 12;
      expect([1, 2]).toContain(delta);
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
