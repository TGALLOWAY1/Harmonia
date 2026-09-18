import { describe, it, expect } from "vitest";
import { buildPhrasePlan } from "../phrasePlan";
import { pickVocabulary, planPhraseRhythm, syncopationPerBar } from "../rhythm";
import { MOOD_PROFILES } from "../moods";
import { createRng } from "../rng";
import { GRID } from "../meter";
import type { MelodyGenerationOptions } from "../types";
import type { PitchClass } from "@/lib/theory/midiUtils";

const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];

function chords(n: number): MelodyGenerationOptions["chords"] {
  const pool: [PitchClass, PitchClass[]][] = [
    ["C", ["C", "E", "G"]],
    ["A", ["A", "C", "E"]],
    ["F", ["F", "A", "C"]],
    ["G", ["G", "B", "D"]],
  ];
  return Array.from({ length: n }, (_, i) => {
    const [root, pitchClasses] = pool[i % pool.length];
    return { midiNotes: [], pitchClasses, root, durationClass: "full" as const };
  });
}

function planFor(n: number, seed: number, mood: keyof typeof MOOD_PROFILES = "emotional") {
  const rng = createRng(seed);
  const plan = buildPhrasePlan(chords(n), MOOD_PROFILES[mood], rng, { octave: 5 });
  return { plan, rng };
}

describe("phrase rhythm", () => {
  it("fills each phrase on the grid without overlaps and ends on a long note", () => {
    for (let seed = 0; seed < 15; seed++) {
      const { plan, rng } = planFor(8, seed);
      const vocab = pickVocabulary(MOOD_PROFILES.emotional, "lyrical", null, rng);
      for (const phrase of plan.phrases) {
        const events = planPhraseRhythm(phrase, plan, MOOD_PROFILES.emotional, "lyrical", vocab, rng, null);
        expect(events.length).toBeGreaterThan(0);
        for (let i = 0; i < events.length; i++) {
          expect(events[i].startBeat % GRID).toBe(0);
          expect(events[i].durationBeats % GRID).toBe(0);
          expect(events[i].durationBeats).toBeGreaterThanOrEqual(GRID);
          if (i > 0) {
            const prev = events[i - 1];
            expect(events[i].startBeat).toBeGreaterThanOrEqual(prev.startBeat + prev.durationBeats);
          }
        }
        const body = events.filter((e) => !e.isPickup);
        const final = body[body.length - 1];
        expect(final.isFinal).toBe(true);
        expect(final.durationBeats).toBeGreaterThanOrEqual(1);
        // Nothing sounds past the phrase, and a planned breath stays silent.
        expect(final.startBeat + final.durationBeats).toBeLessThanOrEqual(phrase.endBeat - phrase.breathBeats + 1e-9);
      }
    }
  });

  it("gives the phrase's planned peak an onset of its own", () => {
    for (let seed = 0; seed < 15; seed++) {
      const { plan, rng } = planFor(8, seed);
      const vocab = pickVocabulary(MOOD_PROFILES.emotional, "lyrical", null, rng);
      for (const phrase of plan.phrases) {
        const events = planPhraseRhythm(phrase, plan, MOOD_PROFILES.emotional, "lyrical", vocab, rng, null);
        const peaks = events.filter((e) => e.isPeak);
        if (phrase.peakBeat > phrase.startBeat) expect(peaks.length).toBeGreaterThan(0);
      }
    }
  });

  it("copies a restated phrase's rhythm note for note", () => {
    const { plan, rng } = planFor(8, 3);
    const vocab = pickVocabulary(MOOD_PROFILES.emotional, "lyrical", null, rng);
    const first = plan.phrases[0];
    const model = planPhraseRhythm(first, plan, MOOD_PROFILES.emotional, "lyrical", vocab, rng, null);
    const template = model.filter((e) => !e.isPickup && !e.isFinal).map((e) => e.startBeat - first.startBeat);
    const second = plan.phrases[1];
    const copy = planPhraseRhythm(second, plan, MOOD_PROFILES.emotional, "lyrical", vocab, rng, template);
    const copied = copy.filter((e) => !e.isPickup && !e.isFinal).map((e) => e.startBeat - second.startBeat);
    for (const onset of template) expect(copied).toContain(onset);
  });

  it("makes denser moods denser and more syncopated", () => {
    const measure = (mood: keyof typeof MOOD_PROFILES) => {
      let notes = 0;
      let sync = 0;
      for (let seed = 0; seed < 10; seed++) {
        const { plan, rng } = planFor(8, seed, mood);
        const vocab = pickVocabulary(MOOD_PROFILES[mood], "lyrical", null, rng);
        const all = plan.phrases.flatMap((p) =>
          planPhraseRhythm(p, plan, MOOD_PROFILES[mood], "lyrical", vocab, rng, null),
        );
        notes += all.length;
        sync += syncopationPerBar(all, plan.totalBeats);
      }
      return { notes: notes / 10, sync: sync / 10 };
    };
    const energetic = measure("energetic");
    const dreamy = measure("dreamy");
    expect(energetic.notes).toBeGreaterThan(dreamy.notes);
    expect(energetic.sync).toBeGreaterThan(dreamy.sync);
  });
});
