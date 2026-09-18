import { describe, it, expect } from "vitest";
import { buildPhrasePlan, phraseAtBeat, planTargetAt } from "../phrasePlan";
import { buildHarmonicContext, mod12, pcIndex } from "../harmonicContext";
import { MOOD_PROFILES } from "../moods";
import { createRng } from "../rng";
import type { MelodyGenerationOptions } from "../types";
import type { PitchClass } from "@/lib/theory/midiUtils";

const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];

const POOL: [PitchClass, PitchClass[]][] = [
  ["C", ["C", "E", "G"]],
  ["A", ["A", "C", "E"]],
  ["F", ["F", "A", "C"]],
  ["G", ["G", "B", "D"]],
];

function chords(n: number): MelodyGenerationOptions["chords"] {
  return Array.from({ length: n }, (_, i) => {
    const [root, pitchClasses] = POOL[i % POOL.length];
    return { midiNotes: [], pitchClasses, root, durationClass: "full" as const };
  });
}

function plan(n: number, seed: number, mood: keyof typeof MOOD_PROFILES = "emotional") {
  const cs = chords(n);
  return buildPhrasePlan(cs, MOOD_PROFILES[mood], createRng(seed), {
    octave: 5,
    harmony: buildHarmonicContext(cs, C_MAJOR),
  });
}

describe("form planning", () => {
  it("covers the progression exactly, phrase by phrase", () => {
    for (const n of [1, 2, 4, 8, 16]) {
      for (let seed = 0; seed < 8; seed++) {
        const p = plan(n, seed);
        expect(p.totalBeats).toBe(n * 4);
        expect(p.phrases[0].startBeat).toBe(0);
        for (let i = 1; i < p.phrases.length; i++) {
          expect(p.phrases[i].startBeat).toBe(p.phrases[i - 1].endBeat);
        }
        expect(p.phrases[p.phrases.length - 1].endBeat).toBe(p.totalBeats);
        expect(p.phrases[p.phrases.length - 1].isFinal).toBe(true);
      }
    }
  });

  it("splits longer progressions into more phrases", () => {
    expect(plan(2, 1).phrases.length).toBe(1);
    expect(plan(4, 1).phrases.length).toBe(2);
    expect(plan(8, 1).phrases.length).toBeGreaterThanOrEqual(3);
    expect(plan(16, 1).phrases.length).toBeGreaterThanOrEqual(6);
  });

  it("honours an explicit form request", () => {
    const cs = chords(8);
    const single = buildPhrasePlan(cs, MOOD_PROFILES.emotional, createRng(1), { octave: 5, form: "single" });
    expect(single.phrases.length).toBe(1);
    const period = buildPhrasePlan(cs, MOOD_PROFILES.emotional, createRng(1), { octave: 5, form: "period" });
    expect(period.phrases.length).toBe(2);
  });

  it("restates the opening idea, and returns it to its own register when the chords return", () => {
    const p = plan(8, 4);
    const restating = p.phrases.filter((x) => x.restates !== null);
    expect(restating.length).toBeGreaterThan(0);
    // A phrase over the same chords replays the hook where it first sounded.
    const replaying = restating.filter((x) => x.replaysPitches);
    expect(replaying.length).toBeGreaterThan(0);
    for (const phrase of replaying) {
      // The closing phrase brings the idea back but settles into its cadence,
      // and the climax lifts its high point out of the returning hook.
      if (phrase.isFinal || phrase.isClimax) continue;
      expect(phrase.anchor).toBe(p.phrases[phrase.restates!].anchor);
      expect(phrase.peakBeat - phrase.startBeat).toBe(
        p.phrases[phrase.restates!].peakBeat - p.phrases[phrase.restates!].startBeat,
      );
    }
    // A phrase that reuses the rhythm over new chords is free to sit elsewhere.
    for (const phrase of restating.filter((x) => !x.replaysPitches)) {
      expect(p.harmony.chords[phrase.endChordIndex]).toBeDefined();
    }
  });

  it("ends non-final phrases away from the tonic and the final phrase on it", () => {
    const tonic = pcIndex("C");
    for (let seed = 0; seed < 12; seed++) {
      const p = plan(8, seed);
      const last = p.phrases[p.phrases.length - 1];
      expect(last.cadence).toBe("authentic");
      // The final cadence lands on a stable tone of the key.
      expect([mod12(tonic), mod12(tonic + 4), mod12(tonic + 7)]).toContain(last.endPc);
      for (const phrase of p.phrases.slice(0, -1)) {
        expect(phrase.cadence === "half" || phrase.cadence === "imperfect").toBe(true);
        // A question never answers itself on the tonic.
        if (phrase.cadence === "half") expect(phrase.endPc).not.toBe(mod12(tonic));
      }
    }
  });

  it("ends a phrase over the dominant on 2̂, 7̂ or 5̂", () => {
    const tonic = pcIndex("C");
    const allowed = [mod12(tonic + 2), mod12(tonic + 11), mod12(tonic + 7)];
    let seen = 0;
    for (let seed = 0; seed < 20; seed++) {
      const p = plan(8, seed);
      for (const phrase of p.phrases) {
        if (phrase.isFinal) continue;
        const chord = p.harmony.chords[phrase.endChordIndex];
        if (!chord.isDominantFunction) continue;
        seen++;
        expect(allowed).toContain(phrase.endPc);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("names exactly one climax phrase, and places it where the harmony is tense", () => {
    for (let seed = 0; seed < 12; seed++) {
      const p = plan(8, seed);
      const climaxes = p.phrases.filter((x) => x.isClimax);
      expect(climaxes).toHaveLength(1);
      // Only the climax phrase may reach the top of the register.
      for (const phrase of p.phrases) {
        if (phrase.isClimax) continue;
        expect(phrase.ceiling).toBeLessThan(climaxes[0].ceiling);
      }
      expect(p.climaxBeat).toBe(climaxes[0].peakBeat);
    }
  });

  it("puts every phrase's peak inside the phrase, before its final note", () => {
    for (let seed = 0; seed < 12; seed++) {
      for (const n of [4, 8, 16]) {
        const p = plan(n, seed);
        for (const phrase of p.phrases) {
          expect(phrase.peakBeat).toBeGreaterThanOrEqual(phrase.startBeat);
          expect(phrase.peakBeat).toBeLessThanOrEqual(phrase.endBeat - 2);
        }
      }
    }
  });

  it("reads the register target as a rise into the peak and a settle after it", () => {
    const p = plan(8, 2);
    const phrase = p.phrases[0];
    const atStart = planTargetAt(p, phrase.startBeat);
    const atPeak = planTargetAt(p, phrase.peakBeat);
    // Sample inside the phrase: the beats right before the next one belong to
    // its pickup, and read that phrase's register instead.
    const atEnd = planTargetAt(p, Math.min(phrase.endBeat - 1.5, phrase.peakBeat + 2));
    expect(atPeak).toBeGreaterThan(atStart);
    expect(atPeak).toBeGreaterThan(atEnd);
  });

  it("assigns pickups to the phrase they lead into", () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = plan(16, seed);
      for (const phrase of p.phrases) {
        if (phrase.pickupBeats <= 0) continue;
        const found = phraseAtBeat(p, phrase.startBeat - phrase.pickupBeats);
        expect(found.index).toBe(phrase.index);
      }
    }
  });

  it("takes tension from the caller's curve when one is supplied", () => {
    const cs = chords(4);
    const supplied = [0.1, 0.9, 0.2, 0];
    const p = buildPhrasePlan(cs, MOOD_PROFILES.emotional, createRng(1), {
      octave: 5,
      harmony: buildHarmonicContext(cs, C_MAJOR, { tensionCurve: supplied }),
    });
    expect(p.tensionCurve[1]).toBeGreaterThan(p.tensionCurve[2]);
    expect(p.tensionCurve[3]).toBe(0);
  });
});
