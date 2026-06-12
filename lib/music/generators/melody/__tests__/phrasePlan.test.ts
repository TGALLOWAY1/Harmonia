import { describe, it, expect } from "vitest";
import { buildPhrasePlan } from "../phrasePlan";
import { MOOD_PROFILES } from "../moods";
import { createRng } from "../rng";
import type { MelodyGenerationOptions } from "../types";
import type { DurationClass } from "../../advanced/types";

function chord(durationClass: DurationClass = "full"): MelodyGenerationOptions["chords"][number] {
  return { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass };
}

describe("phrase plan", () => {
  it("segments cover the progression exactly with no gaps or overlaps", () => {
    for (const numChords of [1, 2, 3, 4, 6, 8]) {
      for (let seed = 0; seed < 10; seed++) {
        const chords = Array.from({ length: numChords }, () => chord());
        const plan = buildPhrasePlan(chords, MOOD_PROFILES.emotional, createRng(seed));
        expect(plan.totalBeats).toBe(numChords * 4);
        expect(plan.segments[0].startBeat).toBe(0);
        for (let i = 1; i < plan.segments.length; i++) {
          expect(plan.segments[i].startBeat).toBe(plan.segments[i - 1].endBeat);
        }
        expect(plan.segments[plan.segments.length - 1].endBeat).toBe(plan.totalBeats);
      }
    }
  });

  it("segment boundaries never split a chord", () => {
    const chords = [chord("full"), chord("half"), chord("half"), chord("full"), chord("full")];
    for (let seed = 0; seed < 10; seed++) {
      const plan = buildPhrasePlan(chords, MOOD_PROFILES.dark, createRng(seed));
      for (const seg of plan.segments) {
        if (seg.endBeat === plan.totalBeats) continue;
        expect(plan.chordStartBeats).toContain(seg.endBeat);
      }
    }
  });

  it("always ends with a resolution segment", () => {
    for (const numChords of [1, 2, 4, 8]) {
      const chords = Array.from({ length: numChords }, () => chord());
      const plan = buildPhrasePlan(chords, MOOD_PROFILES.dreamy, createRng(3));
      const last = plan.segments[plan.segments.length - 1];
      expect(last.role).toBe("resolution");
      expect(last.motifSlot).toBe("cadence");
      expect(last.isPhraseEnd).toBe(true);
    }
  });

  it("plans a full intro/development/climax/resolution arc for long forms", () => {
    const chords = Array.from({ length: 8 }, () => chord());
    const plan = buildPhrasePlan(chords, MOOD_PROFILES.emotional, createRng(1));
    const roles = plan.segments.map((s) => s.role);
    expect(roles).toEqual(["intro", "development", "climax", "resolution"]);
    expect(plan.climaxBeat).toBeGreaterThan(0);
    expect(plan.climaxBeat).toBeLessThanOrEqual(plan.totalBeats);
  });

  it("degenerates gracefully for tiny progressions", () => {
    const single = buildPhrasePlan([chord()], MOOD_PROFILES.energetic, createRng(0));
    expect(single.segments).toHaveLength(1);
    expect(single.segments[0].role).toBe("resolution");

    const eighths = buildPhrasePlan(
      [chord("eighth"), chord("eighth"), chord("eighth"), chord("eighth")],
      MOOD_PROFILES.energetic,
      createRng(0),
    );
    expect(eighths.totalBeats).toBe(2);
    expect(eighths.segments[eighths.segments.length - 1].role).toBe("resolution");
  });
});
