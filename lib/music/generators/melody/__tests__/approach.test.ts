import { describe, it, expect } from "vitest";
import { generateMelody } from "../generateMelody";
import {
  chordStartBeatsOf,
  countSurprises,
  observeApproaches,
  planApproaches,
  straddles,
  SURPRISE_BUDGET,
} from "../approach";
import { buildHarmonicContext, midiPc } from "../harmonicContext";
import { buildPhrasePlan } from "../phrasePlan";
import { generateMotif, layoutMotifs } from "../motif";
import { applyStyleToMood, MOOD_PROFILES } from "../moods";
import { createRng } from "../rng";
import { durationClassToBeats } from "../helpers";
import type { MelodyGenerationOptions, MelodyMood, MelodyStyle } from "../types";
import type { PitchClass } from "@/lib/theory/midiUtils";

const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];
const F_MAJOR: PitchClass[] = ["F", "G", "A", "A#", "C", "D", "E"];
const MOODS: MelodyMood[] = ["dark", "emotional", "dreamy", "energetic"];

/** I–vi–IV–V in C, repeated to the requested length. */
function pop(bars: number): MelodyGenerationOptions["chords"] {
  const pool: [PitchClass, PitchClass[]][] = [
    ["C", ["C", "E", "G"]],
    ["A", ["A", "C", "E"]],
    ["F", ["F", "A", "C"]],
    ["G", ["G", "B", "D"]],
  ];
  return Array.from({ length: bars }, (_, i) => {
    const [root, pitchClasses] = pool[i % pool.length];
    return { midiNotes: [], pitchClasses, root, durationClass: "full" as const };
  });
}

/** C–D7–G–C: a secondary dominant, whose own leading tone is its approach. */
const APPLIED: MelodyGenerationOptions["chords"] = [
  { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["D", "F#", "A", "C"], root: "D", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["G", "B", "D"], root: "G", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
];

/** A long form with a faster harmonic rhythm, so changes fall inside phrases. */
const LONG_FORM: MelodyGenerationOptions["chords"] = [
  { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["D", "F", "A"], root: "D", durationClass: "half" },
  { midiNotes: [], pitchClasses: ["A#", "D", "F"], root: "A#", durationClass: "half" },
  { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["G", "A#", "D"], root: "G", durationClass: "half" },
  { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "half" },
  { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
];

const startsOf = (chords: MelodyGenerationOptions["chords"]) =>
  chordStartBeatsOf(chords.map((c) => durationClassToBeats(c.durationClass)));

/** The analysis script's sample, so the tests and the numbers in §9 agree. */
const SAMPLE: readonly (readonly [PitchClass[], MelodyGenerationOptions["chords"]])[] = [
  [C_MAJOR, pop(4)],
  [C_MAJOR, APPLIED],
  [C_MAJOR, pop(8)],
  [F_MAJOR, LONG_FORM],
] as const;

/* ─── The figure itself ─── */

describe("approach figures", () => {
  it("walks into a chord change by step far more often than the line used to", () => {
    let approachable = 0;
    let approached = 0;
    const kinds = { diatonic: 0, chromatic: 0, enclosure: 0 };
    for (const [scale, chords] of SAMPLE) {
      const hc = buildHarmonicContext(chords, scale);
      const starts = startsOf(chords);
      for (const mood of MOODS) {
        for (let seed = 0; seed < 12; seed++) {
          const melody = generateMelody({ scalePitchClasses: scale, chords, style: "lyrical", mood, octave: 5, seed });
          for (const observation of observeApproaches(melody.notes, hc, starts)) {
            approachable++;
            if (observation.kind !== "none") {
              approached++;
              kinds[observation.kind]++;
            }
          }
        }
      }
    }
    expect(approachable).toBeGreaterThan(100);
    // Measured 37 % before this work and 48 % after, over the analysis
    // script's sample. The band is wide on purpose: an approach is a
    // preference the harmony may outvote, never a rule.
    const rate = approached / approachable;
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.85);
    // All three devices are in use, the plain step by far the commonest.
    expect(kinds.diatonic).toBeGreaterThan(kinds.chromatic + kinds.enclosure);
    expect(kinds.enclosure).toBeGreaterThan(0);
  });

  it("uses chromatic approaches, and every chromatic tone resolves by semitone on the next onset", () => {
    let chromatic = 0;
    for (const [scale, chords] of SAMPLE) {
      const hc = buildHarmonicContext(chords, scale);
      const starts = startsOf(chords);
      for (const mood of MOODS) {
        for (const style of ["lyrical", "rhythmic"] as MelodyStyle[]) {
          for (let seed = 0; seed < 12; seed++) {
            const melody = generateMelody({ scalePitchClasses: scale, chords, style, mood, octave: 5, seed });
            const notes = melody.notes;
            for (let i = 0; i < notes.length; i++) {
              const note = notes[i];
              const chord = hc.chords[note.chordIndex];
              if (chord.categories[midiPc(note.midi)] !== "chromatic") continue;
              chromatic++;
              const next = notes[i + 1];
              // A tone outside the chord's own scale exists only as motion:
              // it must be gone by the next onset, a semitone away, with no
              // rest in between.
              expect(next).toBeDefined();
              expect(Math.abs(next.midi - note.midi)).toBe(1);
              expect(next.startBeat).toBe(note.startBeat + note.durationBeats);
              expect(note.durationBeats).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
    expect(chromatic).toBeGreaterThan(0);
  });

  it("keeps the chromatic approach out of strict harmony", () => {
    const hc = buildHarmonicContext(LONG_FORM, F_MAJOR);
    for (const mood of MOODS) {
      for (let seed = 0; seed < 8; seed++) {
        const melody = generateMelody({
          scalePitchClasses: F_MAJOR, chords: LONG_FORM, style: "lyrical", mood, octave: 5, seed, harmony: "strict",
        });
        for (const note of melody.notes) {
          expect(hc.chords[note.chordIndex].categories[midiPc(note.midi)]).not.toBe("chromatic");
        }
      }
    }
  });

  it("plans approaches at the mood's rate, and never into a peak or a cadence", () => {
    const hc = buildHarmonicContext(pop(8), C_MAJOR);
    let planned = 0;
    let phrasesWorth = 0;
    for (const mood of MOODS) {
      const profile = applyStyleToMood(MOOD_PROFILES[mood], "lyrical");
      for (let seed = 0; seed < 12; seed++) {
        const rng = createRng(seed);
        const plan = buildPhrasePlan(pop(8), profile, rng, { octave: 5, harmony: hc });
        const motif = generateMotif(profile, 4, rng, "A");
        const events = layoutMotifs(plan, motif, profile, rng, "lyrical");
        const approaches = planApproaches(events, plan.chordStartBeats, profile, "expressive", rng, hc);
        planned += approaches.size;
        phrasesWorth += plan.chordStartBeats.length - 1;
        for (const [arrival] of approaches) {
          expect(arrival.isPeak).toBe(false);
          expect(arrival.isPhraseFinal).toBe(false);
          // Every planned arrival sits exactly on a chord change.
          expect(plan.chordStartBeats).toContain(arrival.startBeat);
        }
      }
    }
    expect(planned).toBeGreaterThan(0);
    // Not every change is approachable — something has to sound in the beat
    // before it — so the share of all changes stays well under the rate.
    expect(planned / phrasesWorth).toBeLessThan(0.6);
  });

  it("is deterministic: the same seed plans the same figures", () => {
    const hc = buildHarmonicContext(pop(8), C_MAJOR);
    const profile = applyStyleToMood(MOOD_PROFILES.emotional, "lyrical");
    const build = () => {
      const rng = createRng(42);
      const plan = buildPhrasePlan(pop(8), profile, rng, { octave: 5, harmony: hc });
      const motif = generateMotif(profile, 4, rng, "A");
      const events = layoutMotifs(plan, motif, profile, rng, "lyrical");
      return [...planApproaches(events, plan.chordStartBeats, profile, "expressive", rng, hc)]
        .map(([arrival, kind]) => `${arrival.startBeat}:${kind}`);
    };
    expect(build()).toEqual(build());
  });
});

/* ─── Classification, as the analysis and the tests read it ─── */

describe("approach classification", () => {
  const chords: MelodyGenerationOptions["chords"] = [
    { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
    { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
  ];
  const hc = buildHarmonicContext(chords, C_MAJOR);
  const starts = [0, 4];
  const line = (...notes: [number, number, number][]) =>
    notes.map(([midi, startBeat, durationBeats]) => ({ midi, startBeat, durationBeats }));

  it("reads a step into the new chord as a diatonic approach", () => {
    // E5 on the last beat of the C bar, stepping up to F5 on the change.
    const observed = observeApproaches(line([72, 0, 3], [76, 3, 1], [77, 4, 4]), hc, starts);
    expect(observed).toHaveLength(1);
    expect(observed[0].kind).toBe("diatonic");
  });

  it("reads the semitone below as a chromatic approach", () => {
    // G#4 — outside C major — a half-beat before the F chord's A.
    const observed = observeApproaches(line([72, 0, 3.5], [68, 3.5, 0.5], [69, 4, 4]), hc, starts);
    expect(observed).toHaveLength(1);
    expect(observed[0].kind).toBe("chromatic");
  });

  it("reads both neighbours, in either order, as an enclosure", () => {
    const above = observeApproaches(line([74, 3, 0.5], [71, 3.5, 0.5], [72, 4, 4]), hc, starts);
    expect(above[0].kind).toBe("enclosure");
    const below = observeApproaches(line([71, 3, 0.5], [74, 3.5, 0.5], [72, 4, 4]), hc, starts);
    expect(below[0].kind).toBe("enclosure");
    expect(straddles(74, 71, 72)).toBe(true);
    expect(straddles(74, 76, 72)).toBe(false);
    expect(straddles(72, 71, 72)).toBe(false);
  });

  it("reads a leap into the change, or a note held across it, as no approach", () => {
    const leapt = observeApproaches(line([72, 0, 3], [65, 3, 1], [72, 4, 4]), hc, starts);
    expect(leapt[0].kind).toBe("none");
    // Held across the change: there is no approach slot at all.
    const held = observeApproaches(line([72, 0, 5], [69, 5, 3]), hc, starts);
    expect(held).toHaveLength(0);
  });
});

/* ─── The surprise budget ─── */

describe("surprise budget", () => {
  it("spends at most one surprise per phrase, almost always", () => {
    let phrases = 0;
    let surprises = 0;
    let overBudget = 0;
    for (const [scale, chords] of SAMPLE) {
      const hc = buildHarmonicContext(chords, scale);
      const starts = startsOf(chords);
      for (const mood of MOODS) {
        for (let seed = 0; seed < 12; seed++) {
          const melody = generateMelody({ scalePitchClasses: scale, chords, style: "lyrical", mood, octave: 5, seed });
          const counted = countSurprises(melody.notes, hc, starts, melody.phrases!);
          phrases += counted.perPhrase.length;
          surprises += counted.total;
          overBudget += counted.overBudget;
        }
      }
    }
    expect(phrases).toBeGreaterThan(100);
    // Measured 0.41 surprises per phrase before this work, with 11.5 % of
    // phrases over budget; 0.25 and 0.9 % after.
    expect(surprises / phrases).toBeLessThan(0.45);
    expect(overBudget / phrases).toBeLessThan(0.05);
  });

  it("gives the budget to the climax, not to a random leap", () => {
    // The melody's one high point is reached by a leap that may be a sixth or
    // more; where a phrase spends a surprise at all, it is usually that.
    let phrasesWithSurprise = 0;
    let atThePeak = 0;
    for (const mood of MOODS) {
      for (let seed = 0; seed < 16; seed++) {
        const melody = generateMelody({ scalePitchClasses: C_MAJOR, chords: pop(8), style: "lyrical", mood, octave: 5, seed });
        const notes = melody.notes;
        for (const phrase of melody.phrases!) {
          const inPhrase = notes.filter((n) => n.startBeat >= phrase.startBeat && n.startBeat < phrase.endBeat);
          if (inPhrase.length < 2) continue;
          const peak = Math.max(...inPhrase.map((n) => n.midi));
          let surprised = false;
          let onPeak = false;
          for (let i = 1; i < inPhrase.length; i++) {
            if (Math.abs(inPhrase[i].midi - inPhrase[i - 1].midi) < 8) continue;
            surprised = true;
            if (inPhrase[i].midi === peak || inPhrase[i - 1].midi === peak) onPeak = true;
          }
          if (!surprised) continue;
          phrasesWithSurprise++;
          if (onPeak) atThePeak++;
        }
      }
    }
    if (phrasesWithSurprise > 0) {
      expect(atThePeak / phrasesWithSurprise).toBeGreaterThan(0.6);
    }
    expect(SURPRISE_BUDGET).toBe(1);
  });

  it("keeps the interval mix inside the corpora's shape", () => {
    let intervals = 0;
    let wide = 0;
    let sixths = 0;
    let sum = 0;
    for (const [scale, chords] of SAMPLE) {
      for (const mood of MOODS) {
        for (let seed = 0; seed < 12; seed++) {
          const melody = generateMelody({ scalePitchClasses: scale, chords, style: "lyrical", mood, octave: 5, seed });
          for (let i = 1; i < melody.notes.length; i++) {
            const iv = Math.abs(melody.notes[i].midi - melody.notes[i - 1].midi);
            intervals++;
            sum += iv;
            if (iv >= 5) wide++;
            if (iv >= 8) sixths++;
          }
        }
      }
    }
    // Essen: mean 2.15, 12 % of intervals a fourth or wider, 2.5 % a sixth or
    // wider. Measured over this sample: 2.91 / 21.2 % / 7.4 % before this
    // work, 2.73 / 18.6 % / 5.1 % after.
    expect(sum / intervals).toBeLessThan(2.85);
    expect(wide / intervals).toBeLessThan(0.2);
    expect(sixths / intervals).toBeLessThan(0.065);
  });
});
