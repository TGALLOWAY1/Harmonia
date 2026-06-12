import { describe, it, expect } from "vitest";
import { generateMotif, varyMotif, truncateMotif, layoutMotifs } from "../motif";
import { buildPhrasePlan } from "../phrasePlan";
import { MOOD_PROFILES } from "../moods";
import { createRng } from "../rng";
import type { MelodyGenerationOptions } from "../types";

const GRID = 0.5;

function chords(n: number): MelodyGenerationOptions["chords"] {
  return Array.from({ length: n }, () => ({
    midiNotes: [],
    pitchClasses: ["C", "E", "G"] as MelodyGenerationOptions["chords"][number]["pitchClasses"],
    root: "C" as const,
    durationClass: "full" as const,
  }));
}

describe("motif generation", () => {
  it("produces grid-aligned events that fit the cell exactly", () => {
    for (const mood of Object.values(MOOD_PROFILES)) {
      for (let seed = 0; seed < 20; seed++) {
        const motif = generateMotif(mood, 4, createRng(seed), "A");
        expect(motif.events.length).toBeGreaterThan(0);
        expect(motif.events[0].offsetBeats).toBe(0);
        expect(motif.degreeOffsets).toHaveLength(motif.events.length);
        for (let i = 0; i < motif.events.length; i++) {
          const ev = motif.events[i];
          expect(ev.offsetBeats % GRID).toBe(0);
          expect(ev.durationBeats % GRID).toBe(0);
          expect(ev.durationBeats).toBeGreaterThanOrEqual(GRID);
          expect(ev.offsetBeats + ev.durationBeats).toBeLessThanOrEqual(motif.lengthBeats);
          if (i > 0) {
            expect(ev.offsetBeats).toBeGreaterThanOrEqual(
              motif.events[i - 1].offsetBeats + GRID,
            );
          }
        }
      }
    }
  });

  it("invert mirrors the degree contour", () => {
    const motif = generateMotif(MOOD_PROFILES.emotional, 4, createRng(7), "A");
    const inverted = varyMotif(motif, "invert", createRng(8));
    expect(inverted.degreeOffsets).toEqual(motif.degreeOffsets.map((d) => -d));
    expect(inverted.events).toEqual(motif.events);
  });

  it("transpose shifts every degree while preserving the rhythm", () => {
    const motif = generateMotif(MOOD_PROFILES.emotional, 4, createRng(7), "A");
    const transposed = varyMotif(motif, "transpose", createRng(9));
    const shift = transposed.degreeOffsets[0] - motif.degreeOffsets[0];
    expect(shift).not.toBe(0);
    expect(transposed.degreeOffsets).toEqual(motif.degreeOffsets.map((d) => d + shift));
    expect(transposed.events).toEqual(motif.events);
  });

  it("truncate fits a shorter window exactly", () => {
    const motif = generateMotif(MOOD_PROFILES.energetic, 4, createRng(11), "A");
    const cut = truncateMotif(motif, 2);
    expect(cut.lengthBeats).toBe(2);
    for (const ev of cut.events) {
      expect(ev.offsetBeats + ev.durationBeats).toBeLessThanOrEqual(2);
    }
    expect(cut.degreeOffsets).toHaveLength(cut.events.length);
  });
});

describe("motif layout", () => {
  it("fills the plan with grid-aligned, non-overlapping events ending in a long cadence note", () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = createRng(seed);
      const plan = buildPhrasePlan(chords(4), MOOD_PROFILES.emotional, rng);
      const motifA = generateMotif(MOOD_PROFILES.emotional, 4, rng, "A");
      const events = layoutMotifs(plan, motifA, MOOD_PROFILES.emotional, rng);

      expect(events.length).toBeGreaterThan(0);
      for (let i = 0; i < events.length; i++) {
        expect(events[i].startBeat % GRID).toBe(0);
        expect(events[i].durationBeats % GRID).toBe(0);
        expect(events[i].durationBeats).toBeGreaterThanOrEqual(GRID);
        if (i > 0) {
          expect(events[i].startBeat).toBeGreaterThanOrEqual(
            events[i - 1].startBeat + events[i - 1].durationBeats,
          );
        }
      }

      const last = events[events.length - 1];
      expect(last.isCadenceFinal).toBe(true);
      expect(last.durationBeats).toBeGreaterThanOrEqual(2);
      expect(last.startBeat + last.durationBeats).toBe(plan.totalBeats);
    }
  });

  it("repeats motif material (shared pattern keys across instances)", () => {
    let sawRepeat = false;
    for (let seed = 0; seed < 20 && !sawRepeat; seed++) {
      const rng = createRng(seed);
      const plan = buildPhrasePlan(chords(8), MOOD_PROFILES.energetic, rng);
      const motifA = generateMotif(MOOD_PROFILES.energetic, 4, rng, "A");
      const events = layoutMotifs(plan, motifA, MOOD_PROFILES.energetic, rng);
      const instancesByPattern = new Map<string, Set<number>>();
      for (const ev of events) {
        if (ev.patternKey === "pickup" || ev.isCadenceFinal) continue;
        const set = instancesByPattern.get(ev.patternKey) ?? new Set();
        set.add(ev.instanceId);
        instancesByPattern.set(ev.patternKey, set);
      }
      sawRepeat = Array.from(instancesByPattern.values()).some((s) => s.size >= 2);
    }
    expect(sawRepeat).toBe(true);
  });
});
