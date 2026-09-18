import { describe, it, expect } from "vitest";
import { metricWeight, snapToGrid, syncopationOf, GRID } from "../meter";

describe("metric weight", () => {
  it("ranks the downbeat above beat three, beat three above beats two and four, and those above off-beats", () => {
    expect(metricWeight(0)).toBe(4);
    expect(metricWeight(2)).toBe(3);
    expect(metricWeight(1)).toBe(2);
    expect(metricWeight(3)).toBe(2);
    expect(metricWeight(0.5)).toBe(1);
    expect(metricWeight(3.5)).toBe(1);
  });

  it("repeats every bar", () => {
    for (const beat of [0, 1, 2, 3, 0.5, 1.5]) {
      expect(metricWeight(beat + 4)).toBe(metricWeight(beat));
      expect(metricWeight(beat + 16)).toBe(metricWeight(beat));
    }
  });

  it("snaps to the half-beat grid", () => {
    expect(snapToGrid(0.4)).toBe(0.5);
    expect(snapToGrid(1.2)).toBe(1);
    expect(snapToGrid(2.75)).toBe(3);
    expect(snapToGrid(GRID)).toBe(GRID);
  });
});

describe("syncopation", () => {
  it("is zero when every onset sits on a beat it does not undercut", () => {
    expect(syncopationOf([0, 1, 2, 3], 4)).toBe(0);
    expect(syncopationOf([0, 2], 4)).toBe(0);
    expect(syncopationOf([0], 4)).toBe(0);
  });

  it("charges an off-beat onset that swallows the stronger position after it", () => {
    // An onset on the "and of one" holding through beat two (weight 2).
    expect(syncopationOf([0, 1.5], 4)).toBeGreaterThan(0);
    // Tresillo: onsets at 0, 1.5 and 3 skip beats two and three.
    expect(syncopationOf([0, 1.5, 3], 4)).toBeGreaterThan(syncopationOf([0, 1, 2, 3], 4));
  });

  it("grows with the strength of the position that is passed over", () => {
    // Skipping the next downbeat costs more than skipping beat two.
    const overDownbeat = syncopationOf([3.5, 4.5], 8);
    const overBeatTwo = syncopationOf([0.5, 1.5], 8);
    expect(overDownbeat).toBeGreaterThan(overBeatTwo);
  });
});
