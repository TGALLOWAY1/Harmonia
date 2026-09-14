import { describe, expect, it } from "vitest";

import { voicingRoughness } from "@/lib/music/generators/advanced/roughness";
import { searchVoicings } from "@/lib/music/generators/advanced/voicingSearch";

describe("beam voicing search", () => {
  it("finds the path a greedy choice misses", () => {
    // Chord 1 has two candidates: A is cheaper on its own, but every move out
    // of A is expensive; B costs a little more now and connects cheaply.
    const A = [60, 64, 67];
    const B = [55, 60, 64];
    const next = [57, 60, 65];
    const emission = (index: number, voicing: number[]) => (index === 0 && voicing === A ? 0 : index === 0 ? 1 : 0);
    const transition = (previous: number[]) => (previous === A ? 10 : 1);

    const result = searchVoicings({ candidates: [[A, B], [next]], emission, transition });

    expect(result.voicings[0]).toBe(B);
    expect(result.costs).toEqual([1, 1]);
  });

  it("treats an infinite transition as forbidden", () => {
    const first = [60, 64, 67];
    const bad = [72, 76, 79];
    const good = [59, 62, 67];
    const result = searchVoicings({
      candidates: [[first], [bad, good]],
      emission: () => 0,
      transition: (_previous, voicing) => (voicing === bad ? Number.POSITIVE_INFINITY : 2),
    });
    expect(result.voicings[1]).toBe(good);
  });

  it("charges dependent candidates their bonus", () => {
    const first = [60, 64, 67];
    const plain = [59, 62, 67];
    const parsimonious = [60, 63, 67];
    const result = searchVoicings({
      candidates: [[first], [plain]],
      emission: () => 0,
      transition: () => 3,
      dependentCandidates: (index) => (index === 1 ? [{ voicing: parsimonious, bonus: 2 }] : []),
    });
    expect(result.voicings[1]).toBe(parsimonious);
    expect(result.costs[1]).toBe(1);
  });

  it("is deterministic", () => {
    const candidates = [[[48, 52, 55], [60, 64, 67]], [[53, 57, 60], [65, 69, 72]], [[55, 59, 62]]];
    const run = () =>
      searchVoicings({
        candidates,
        emission: (_i, v) => Math.abs(v[0] - 55) * 0.1,
        transition: (a, b) => Math.abs(a[0] - b[0]),
      });
    expect(run()).toEqual(run());
  });
});

describe("sensory roughness", () => {
  it("hears the same chord as rougher low on the keyboard", () => {
    expect(voicingRoughness([36, 40, 43])).toBeGreaterThan(voicingRoughness([48, 52, 55]));
    expect(voicingRoughness([48, 52, 55])).toBeGreaterThan(voicingRoughness([60, 64, 67]));
  });

  it("hears a close cluster as rougher than an open voicing", () => {
    expect(voicingRoughness([48, 49, 52, 55])).toBeGreaterThan(voicingRoughness([48, 55, 64, 71]));
  });

  it("is zero for a single note", () => {
    expect(voicingRoughness([60])).toBe(0);
  });
});
