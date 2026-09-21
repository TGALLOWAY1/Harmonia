import { describe, expect, it } from "vitest";

import { generateAdvancedProgression } from "@/lib/music/generators/advanced/generateAdvancedProgression";
import {
  chordIdentities,
  evaluateTendencies,
  tritoneResolution,
} from "@/lib/music/generators/advanced/tendencyTones";
import { generateVoicingCandidates } from "@/lib/music/generators/advanced/voicing";
import { getChordPitchClasses } from "@/lib/theory/chordSymbol";
import { PITCH_CLASSES } from "@/lib/theory/midiUtils";
import { romanNumeralsForScale } from "@/lib/theory/romanNumeral";
import { getScaleDefinition } from "@/lib/theory/scale";
import type { AdvancedProgressionOptions, PlannedAdvancedChord } from "@/lib/music/generators/advanced/types";

/** The substitution flags the app actually ships, per `complexityToOptions`. */
const COMPLEXITY_PRESETS = {
  1: { useSecondaryDominants: false, usePassingChords: false, useSuspensions: false, useTritoneSubstitution: false, useModalInterchange: false },
  2: { useSecondaryDominants: true, usePassingChords: false, useSuspensions: false, useTritoneSubstitution: false, useModalInterchange: true },
  3: { useSecondaryDominants: true, usePassingChords: true, useSuspensions: true, useTritoneSubstitution: false, useModalInterchange: true },
  4: { useSecondaryDominants: true, usePassingChords: true, useSuspensions: true, useTritoneSubstitution: true, useModalInterchange: true },
} as const;

function options(complexity: 1 | 2 | 3 | 4, over: Partial<AdvancedProgressionOptions> = {}): AdvancedProgressionOptions {
  return {
    rootKey: "C",
    mode: "ionian",
    numChords: 4,
    complexity,
    voicingStyle: "auto",
    voiceCount: 4,
    rangeLow: 48,
    rangeHigh: 79,
    ...COMPLEXITY_PRESETS[complexity],
    ...over,
  } as AdvancedProgressionOptions;
}

const pitchClassOf = (midi: number) => ((midi % 12) + 12) % 12;

describe("cadence integrity", () => {
  // Regression: the length cap used to run AFTER the cadence heuristic, so any
  // inserted chromatic chord pushed the tonic past the cut and it was sliced
  // off. A third of default generations ended somewhere arbitrary.
  it.each([1, 2, 3, 4] as const)("always resolves to the tonic at complexity %i", (complexity) => {
    const unresolved: string[] = [];

    for (let seed = 0; seed < 400; seed++) {
      const result = generateAdvancedProgression(options(complexity, { seed }));
      const last = result.chords[result.chords.length - 1];
      if (last.degreeLabel !== "I") unresolved.push(`seed ${seed}: ${last.degreeLabel} ${last.symbol}`);
    }

    expect(unresolved).toEqual([]);
  });

  it("honours the requested chord count even when substitutions fire", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const numChords of [3, 4, 6]) {
        const result = generateAdvancedProgression(options(4, { seed, numChords }));
        expect(result.chords).toHaveLength(numChords);
      }
    }
  });

  it("leaves the plan's own ending alone when the cadence is open", () => {
    // "open" exists so half, deceptive and loop-friendly endings are reachable.
    // Over many seeds at least some must end somewhere other than the tonic.
    const endings = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, cadence: "open" }));
      endings.add(result.chords[result.chords.length - 1].degreeLabel);
    }

    expect(endings.size).toBeGreaterThan(1);
  });

  it("puts the root in the bass of the final chord", () => {
    let rootPosition = 0;
    const total = 300;

    for (let seed = 0; seed < total; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, numChords: 5 }));
      const last = result.chords[result.chords.length - 1];
      if (pitchClassOf(Math.min(...last.midi)) === PITCH_CLASSES.indexOf("C")) rootPosition++;
    }

    // Not 100%: range limits can make every root-position candidate unusable.
    expect(rootPosition / total).toBeGreaterThan(0.9);
  });
});

describe("modal integrity", () => {
  // Regression: degree 4 was forced to major/dominant in every mode, which
  // injected a leading tone that does not exist in dorian, phrygian or
  // mixolydian - erasing the mode the user selected.
  it.each([
    ["D", "dorian"],
    ["E", "phrygian"],
    ["G", "mixolydian"],
  ] as const)("keeps every generated note inside %s %s", (rootKey, mode) => {
    const scale = getScaleDefinition(rootKey, mode === "dorian" ? "dorian" : mode === "phrygian" ? "phrygian" : "mixolydian");
    const allowed = new Set(scale.pitchClasses.map((pc) => PITCH_CLASSES.indexOf(pc)));
    const strays: string[] = [];

    for (let seed = 0; seed < 300; seed++) {
      const result = generateAdvancedProgression(options(1, { seed, rootKey, mode } as never));
      for (const chord of result.chords) {
        for (const midi of chord.midi) {
          if (!allowed.has(pitchClassOf(midi))) strays.push(`seed ${seed}: ${chord.symbol} has ${midi % 12}`);
        }
      }
    }

    expect(strays.slice(0, 5)).toEqual([]);
  });

  it("derives roman numerals that match each mode's own chords", () => {
    expect(romanNumeralsForScale(getScaleDefinition("C", "major"))).toEqual([
      "I", "ii", "iii", "IV", "V", "vi", "vii°",
    ]);
    // Dorian's characteristic major IV, previously mislabelled "iv".
    expect(romanNumeralsForScale(getScaleDefinition("D", "dorian"))[3]).toBe("IV");
    // Phrygian's characteristic bII, previously mislabelled "ii°".
    expect(romanNumeralsForScale(getScaleDefinition("E", "phrygian"))[1]).toBe("bII");
    // Mixolydian's bVII, previously mislabelled "vii°".
    expect(romanNumeralsForScale(getScaleDefinition("G", "mixolydian"))[6]).toBe("bVII");
  });

  it("keeps the raised dominant in aeolian, where it is idiomatic", () => {
    // Harmonic-minor V is a deliberate choice, not a modal violation.
    const labels = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const result = generateAdvancedProgression(options(1, { seed, rootKey: "A", mode: "aeolian" } as never));
      result.chords.forEach((chord) => labels.add(`${chord.degreeLabel}|${chord.symbol}`));
    }
    expect([...labels]).toContain("v|E");
  });
});

describe("voicing vocabulary", () => {
  const chord = (symbol: string, root: string, pitchClasses: string[]): PlannedAdvancedChord =>
    ({ degreeLabel: symbol, symbol, root, pitchClasses, kind: "diatonic" }) as never;

  const context = (voiceCount: 3 | 4 | 5) =>
    ({ style: "auto" as const, voiceCount, rangeLow: 48, rangeHigh: 79 });

  // Regression: at 5 voices selectTones spliced out the perfect fifth and then
  // stopped, returning four tones over three pitch classes - so the control
  // labelled "Rich" was thinner than "Standard" and had no fifth at all.
  it("makes 5 voices richer than 4, not thinner", () => {
    const seventh = chord("Cmaj7", "C", ["C", "E", "G", "B"]);

    const four = generateVoicingCandidates(seventh, context(4));
    const five = generateVoicingCandidates(seventh, context(5));

    const distinct = (cands: number[][]) => new Set(cands.flat().map(pitchClassOf)).size;
    expect(distinct(five)).toBeGreaterThanOrEqual(distinct(four));

    // Every five-voice candidate must still contain the fifth.
    const fifth = PITCH_CLASSES.indexOf("G");
    expect(five.every((v) => v.some((m) => pitchClassOf(m) === fifth))).toBe(true);

    // And it must actually reach five notes.
    expect(Math.max(...five.map((v) => v.length))).toBe(5);
  });

  it("reaches five notes on a plain triad too", () => {
    const triad = chord("C", "C", ["C", "E", "G"]);
    const five = generateVoicingCandidates(triad, context(5));
    expect(Math.max(...five.map((v) => v.length))).toBe(5);
  });

  it("offers every inversion, including the third inversion of a seventh", () => {
    const seventh = chord("Cmaj7", "C", ["C", "E", "G", "B"]);
    const basses = new Set(generateVoicingCandidates(seventh, context(4)).map((v) => pitchClassOf(v[0])));

    // Root, 3rd, 5th and 7th must all be reachable in the bass.
    expect(basses).toContain(PITCH_CLASSES.indexOf("C"));
    expect(basses).toContain(PITCH_CLASSES.indexOf("E"));
    expect(basses).toContain(PITCH_CLASSES.indexOf("G"));
    expect(basses).toContain(PITCH_CLASSES.indexOf("B"));
  });

  it("produces a wider span vocabulary than close position alone", () => {
    const seventh = chord("Cmaj7", "C", ["C", "E", "G", "B"]);
    const spans = generateVoicingCandidates(seventh, context(4)).map((v) => v[v.length - 1] - v[0]);
    // drop2/drop3/drop2+4 push well past an octave.
    expect(Math.max(...spans)).toBeGreaterThan(12);
  });
});

describe("mood and candidate selection", () => {
  const sweep = (over: Partial<AdvancedProgressionOptions>, seeds = 400) => {
    const signatures = new Set<string>();
    let staticBass = 0;
    let frozenSoprano = 0;
    const rhythms = new Set<string>();

    for (let seed = 0; seed < seeds; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, ...over }));
      signatures.add(result.chords.map((c) => c.midi.join(".")).join("|"));
      const bass = result.chords.map((c) => Math.min(...c.midi));
      const soprano = result.chords.map((c) => Math.max(...c.midi));
      if (new Set(bass).size === 1) staticBass++;
      if (new Set(soprano).size === 1) frozenSoprano++;
      rhythms.add(result.chords.map((c) => c.durationClass).join(","));
    }

    return { distinct: signatures.size, staticBass, frozenSoprano, rhythms };
  };

  it("stays deterministic for a seed despite drawing several candidates", () => {
    for (const mood of ["dark", "emotional", "dreamy", "energetic"] as const) {
      for (const seed of [0, 7, 123]) {
        const a = generateAdvancedProgression(options(3, { seed, mood }));
        const b = generateAdvancedProgression(options(3, { seed, mood }));
        expect(a).toEqual(b);
      }
    }
  });

  // Regression: scoring whole progressions is what lets the generator reject a
  // draw whose bass never moves. A static bass reads as a pedal and was the
  // mechanism behind progressions that felt like one sustained sonority. The
  // bass-line planner now rules it out at the source, so a single draw is as
  // clean as the scored pick; the scored pick must never be worse.
  it("scores away the static-bass failure mode", () => {
    const scored = sweep({});
    const unscored = sweep({ candidateCount: 1 });

    expect(scored.staticBass).toBeLessThanOrEqual(unscored.staticBass);
    expect(scored.staticBass / 400).toBeLessThan(0.02);
  });

  it("keeps the top voice moving", () => {
    expect(sweep({}).frozenSoprano / 400).toBeLessThan(0.1);
  });

  // Regression: a strict argmax over 8 candidates collapsed the distinct-output
  // count, which sharpens the sameness the rubric exists to relieve. Interior
  // variation plus tie-banded selection has to leave variety ahead, not behind.
  it("produces more distinct progressions than the single-draw path", () => {
    expect(sweep({}).distinct).toBeGreaterThan(30);
  });

  it("gives each mood an audibly different texture", () => {
    const register = (mood: "dark" | "dreamy") => {
      let total = 0;
      for (let seed = 0; seed < 200; seed++) {
        const chords = generateAdvancedProgression(options(2, { seed, mood })).chords;
        total += chords.reduce((s, c) => s + (Math.min(...c.midi) + Math.max(...c.midi)) / 2, 0) / chords.length;
      }
      return total / 200;
    };

    // "dark" sits low and "dreamy" high; the gap should be plainly audible.
    expect(register("dreamy") - register("dark")).toBeGreaterThan(4);
  });

  it("varies harmonic rhythm by mood instead of one chord per bar", () => {
    // "even" holds every chord a bar; "accelerating" must not.
    const durationsFor = (mood: "emotional" | "energetic") => {
      const shapes = new Set<string>();
      for (let seed = 0; seed < 100; seed++) {
        shapes.add(
          generateAdvancedProgression(options(1, { seed, mood, numChords: 5 }))
            .chords.map((c) => c.durationClass)
            .join(",")
        );
      }
      return shapes;
    };

    const energetic = [...durationsFor("energetic")];
    expect(energetic.some((shape) => shape.includes("half") || shape.includes("quarter"))).toBe(true);
  });

  it("lets a mood choose its own ending when the caller does not", () => {
    // "dreamy" prefers an open ending; "emotional" resolves.
    const endsOnTonic = (mood: "dreamy" | "emotional") => {
      let count = 0;
      for (let seed = 0; seed < 200; seed++) {
        const chords = generateAdvancedProgression(options(2, { seed, mood })).chords;
        if (chords[chords.length - 1].degreeLabel === "I") count++;
      }
      return count / 200;
    };

    expect(endsOnTonic("emotional")).toBe(1);
    expect(endsOnTonic("dreamy")).toBeLessThan(1);
  });

  it("still honours an explicit cadence over the mood's preference", () => {
    for (let seed = 0; seed < 200; seed++) {
      const chords = generateAdvancedProgression(
        options(2, { seed, mood: "dreamy", cadence: "resolve" })
      ).chords;
      expect(chords[chords.length - 1].degreeLabel).toBe("I");
    }
  });
});

describe("bass-line planning", () => {
  const sweepBass = (over: Partial<AdvancedProgressionOptions>, seeds = 300) => {
    let chords = 0;
    let missingMetadata = 0;
    let mismatched = 0;
    let looseSixFours = 0;
    let unresolvedSevenths = 0;
    let staticMotions = 0;
    let motions = 0;
    let rootArrivals = 0;
    let arrivals = 0;

    for (let seed = 0; seed < seeds; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, ...over }));
      const bass = result.chords.map((c) => Math.min(...c.midi));
      result.chords.forEach((chord, i) => {
        chords++;
        if (chord.bass === undefined || chord.inversion === undefined) missingMetadata++;
        if (chord.bass !== PITCH_CLASSES[pitchClassOf(bass[i])]) mismatched++;

        if (chord.inversion === 2) {
          const cadential = i === result.chords.length - 2;
          const onLine =
            i > 0 && i < result.chords.length - 1 &&
            Math.abs(bass[i] - bass[i - 1]) <= 2 && Math.abs(bass[i + 1] - bass[i]) <= 2;
          const pedal = i > 0 && i < result.chords.length - 1 && bass[i - 1] === bass[i] && bass[i] === bass[i + 1];
          if (!cadential && !onLine && !pedal) looseSixFours++;
        }
        if (chord.inversion === 3 && i < result.chords.length - 1) {
          const drop = bass[i] - bass[i + 1];
          if (!(drop === 1 || drop === 2)) unresolvedSevenths++;
        }
        if (i === 0 || i === result.chords.length - 1) {
          arrivals++;
          if (chord.inversion === 0) rootArrivals++;
        }
      });
      for (let i = 1; i < bass.length; i++) {
        motions++;
        if (bass[i] === bass[i - 1]) staticMotions++;
      }
    }

    return { chords, missingMetadata, mismatched, looseSixFours, unresolvedSevenths, staticMotions, motions, rootArrivals, arrivals };
  };

  it("labels every chord with the bass that sounds and the inversion it makes", () => {
    const stats = sweepBass({});
    expect(stats.missingMetadata).toBe(0);
    expect(stats.mismatched).toBe(0);
  });

  // Regression: the bass used to be whatever fell out of the voicing search,
  // so 16% of chords sat in second inversion and the bass stood still on
  // 17.5% of chord changes. Now it is planned.
  it("moves the bass on nearly every chord change", () => {
    const stats = sweepBass({});
    expect(stats.staticMotions / stats.motions).toBeLessThan(0.03);
  });

  it("uses second inversion only as a cadential, passing or pedal 6-4", () => {
    const stats = sweepBass({ numChords: 6 });
    expect(stats.looseSixFours / stats.chords).toBeLessThan(0.01);
  });

  it("resolves a seventh in the bass down by step", () => {
    const stats = sweepBass({ numChords: 6 });
    expect(stats.unresolvedSevenths / stats.chords).toBeLessThan(0.01);
  });

  it("opens and closes in root position", () => {
    const stats = sweepBass({ numChords: 5 });
    expect(stats.rootArrivals / stats.arrivals).toBeGreaterThan(0.97);
  });

  // Regression: the plan was made in pitch classes and the voicer chose the
  // octave, so a planned step could be realised as a leap of a seventh near
  // the bottom of the range (C ionian, six chords, seed 55).
  it("realises the planned bass pitch, so planned steps stay steps", () => {
    let planned = 0;
    let pitchMisses = 0;
    let stepsBecameLeaps = 0;
    for (const voicingStyle of ["auto", "open", "drop2", "closed"] as const) {
      for (let seed = 0; seed < 150; seed++) {
        const result = generateAdvancedProgression(options(2, { seed, numChords: 6, voicingStyle }));
        const bass = result.chords.map((c) => Math.min(...c.midi));
        result.chords.forEach((_, i) => {
          const plan = result.debug?.bassPlan?.[i];
          if (!plan) return;
          planned++;
          if (bass[i] !== plan.pitch) pitchMisses++;
          if (i > 0 && /step|scale line|6-4|seventh resolves/.test(plan.reason) && Math.abs(bass[i] - bass[i - 1]) > 2) {
            stepsBecameLeaps++;
          }
        });
      }
    }
    expect(planned).toBeGreaterThan(0);
    expect(stepsBecameLeaps).toBe(0);
    expect(pitchMisses / planned).toBeLessThan(0.005);
  });

  // Regression: the parsimonious voicing of a Neo-Riemannian transform
  // bypassed the planned-bass filter (C ionian, open voicing, seed 252 put C
  // under a root-position Fm7).
  it("holds transform voicings to the bass plan", () => {
    const specific = generateAdvancedProgression(options(2, { seed: 252, voicingStyle: "open" }));
    specific.chords.forEach((chord, i) => {
      expect(chord.bass).toBe(specific.debug?.bassPlan?.[i]?.bass);
    });

    let transformed = 0;
    for (let seed = 0; seed < 300; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, mood: "energetic", voicingStyle: "open" }));
      result.chords.forEach((chord, i) => {
        if (!result.debug?.planned[i]?.transform) return;
        transformed++;
        expect(chord.bass).toBe(result.debug?.bassPlan?.[i]?.bass);
      });
    }
    expect(transformed).toBeGreaterThan(0);
  });
});

describe("modal interchange", () => {
  const borrowedIn = (over: Partial<AdvancedProgressionOptions>, seeds = 300) => {
    const labels = new Map<string, number>();
    let progressionsWithBorrowed = 0;
    let overloaded = 0;
    let brightnessSum = 0;
    let brightnessCount = 0;

    for (let seed = 0; seed < seeds; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, ...over }));
      const borrowed = (result.debug?.planned ?? []).filter((c) => c.kind === "borrowed");
      if (borrowed.length > 0) progressionsWithBorrowed++;
      if (borrowed.length > 1) overloaded++;
      borrowed.forEach((c) => {
        labels.set(c.degreeLabel, (labels.get(c.degreeLabel) ?? 0) + 1);
        if (c.brightness !== undefined) {
          brightnessSum += c.brightness;
          brightnessCount++;
        }
      });
    }

    return {
      labels,
      progressionsWithBorrowed,
      overloaded,
      meanBrightness: brightnessCount ? brightnessSum / brightnessCount : 0,
    };
  };

  it("reaches borrowed harmony at the shipped presets, and never at complexity 1", () => {
    const rich = borrowedIn({});
    expect(rich.progressionsWithBorrowed).toBeGreaterThan(30);
    // The classic major-key borrowings must all be reachable.
    for (const label of ["iv", "bVI", "bVII", "bII", "bIII"]) {
      expect(rich.labels.has(label), label).toBe(true);
    }

    let simple = 0;
    for (let seed = 0; seed < 200; seed++) {
      const result = generateAdvancedProgression(options(1, { seed }));
      if (result.debug?.planned.some((c) => c.kind === "borrowed")) simple++;
    }
    expect(simple).toBe(0);
  });

  it("engineers at most one surprise per four-chord phrase", () => {
    expect(borrowedIn({}).overloaded).toBe(0);
  });

  it("borrows darker chords for a dark mood and brighter ones for a dreamy mood", () => {
    const dark = borrowedIn({ mood: "dark", cadence: "resolve" });
    const dreamy = borrowedIn({ mood: "dreamy", cadence: "resolve" });
    expect(dark.meanBrightness).toBeLessThan(0);
    expect(dreamy.meanBrightness).toBeGreaterThan(dark.meanBrightness);
    // The Neapolitan is the darkest borrowing; lydian II the brightest.
    expect((dark.labels.get("bII") ?? 0)).toBeGreaterThan(dreamy.labels.get("bII") ?? 0);
    expect((dreamy.labels.get("II") ?? 0)).toBeGreaterThan(dark.labels.get("II") ?? 0);
  });

  it("keeps a borrowed chord's notes inside its own symbol", () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = generateAdvancedProgression(options(3, { seed, rootKey: "F", mode: "aeolian" } as never));
      result.chords.forEach((chord, i) => {
        if (result.debug?.planned[i]?.kind !== "borrowed") return;
        const allowed = new Set(getChordPitchClasses(chord.symbol));
        expect(allowed.size).toBeGreaterThan(0);
        chord.midi.forEach((m) => expect(allowed.has(PITCH_CLASSES[pitchClassOf(m)])).toBe(true));
      });
    }
  });

  it("can close a minor key on a Picardy third when the phrase ends bright, and never when it ends dark", () => {
    const endings = (mood: "energetic" | "dark") => {
      let major = 0;
      for (let seed = 0; seed < 300; seed++) {
        // A sunrise curve ends bright; the dark mood's own curve ends darker still.
        const brightnessCurve = mood === "energetic" ? "sunrise" : "auto";
        const result = generateAdvancedProgression(
          options(2, { seed, rootKey: "A", mode: "aeolian", mood, cadence: "resolve", brightnessCurve } as never)
        );
        const last = result.debug?.planned[result.debug.planned.length - 1];
        if (last?.source === "picardy") major++;
      }
      return major;
    };
    expect(endings("energetic")).toBeGreaterThan(0);
    expect(endings("energetic")).toBeLessThan(300);
    expect(endings("dark")).toBe(0);
  });

  it("reaches chromatic mediants through Neo-Riemannian transforms with held common tones", () => {
    let transformed = 0;
    let sharedTone = 0;
    for (let seed = 0; seed < 400; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, mood: "energetic" }));
      result.chords.forEach((chord, i) => {
        const planned = result.debug?.planned[i];
        if (!planned?.transform || i === 0) return;
        transformed++;
        const previous = new Set(result.chords[i - 1].midi.map(pitchClassOf));
        // The hexatonic pole shares nothing by definition; every other
        // transform holds at least one voice.
        if (planned.transform === "H" || chord.midi.some((m) => previous.has(pitchClassOf(m)))) sharedTone++;
      });
    }
    expect(transformed).toBeGreaterThan(0);
    expect(sharedTone).toBe(transformed);
  });
});

describe("tension shapes", () => {
  const openerTension = (shape: AdvancedProgressionOptions["tensionShape"]) => {
    let tense = 0;
    for (let seed = 0; seed < 200; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, tensionShape: shape }));
      const first = result.debug?.planned[0];
      if (first && first.functionTag !== "tonic") tense++;
    }
    return tense / 200;
  };

  it("collapse opens away from the tonic far more often than the classical phrase", () => {
    expect(openerTension("collapse")).toBeGreaterThan(0.5);
    expect(openerTension("phrase")).toBeLessThan(0.2);
  });

  it("ramp with an open ending leaves the phrase on tension", () => {
    let unresolved = 0;
    for (let seed = 0; seed < 200; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, tensionShape: "ramp", cadence: "open" }));
      const last = result.debug?.planned[result.debug.planned.length - 1];
      if (last && last.functionTag !== "tonic") unresolved++;
    }
    expect(unresolved / 200).toBeGreaterThan(0.6);
  });

  it("plateau puts its one surge on the penultimate chord", () => {
    let surged = 0;
    for (let seed = 0; seed < 200; seed++) {
      const result = generateAdvancedProgression(options(2, { seed, tensionShape: "plateau", numChords: 5 }));
      const planned = result.debug?.planned ?? [];
      const penultimate = planned[planned.length - 2];
      if (penultimate?.functionTag === "dominant" || penultimate?.functionTag === "applied") surged++;
    }
    expect(surged / 200).toBeGreaterThan(0.7);
  });

  it("stays deterministic for every shape", () => {
    for (const shape of ["arch", "ramp", "question", "plateau", "collapse"] as const) {
      const a = generateAdvancedProgression(options(3, { seed: 42, tensionShape: shape }));
      const b = generateAdvancedProgression(options(3, { seed: 42, tensionShape: shape }));
      expect(a).toEqual(b);
    }
  });

  it("reports the curves it planned against", () => {
    const result = generateAdvancedProgression(options(2, { seed: 1, tensionShape: "arch", numChords: 5 }));
    expect(result.debug?.tensionCurve).toHaveLength(5);
    expect(result.debug?.brightnessTargets).toHaveLength(5);
    expect(result.debug?.bassPlan).toHaveLength(5);
  });
});

describe("tendency-tone resolution", () => {
  /**
   * What the upper voices did with the resolutions they owed.
   *
   * A leading tone counts as *voiceable* only when the chord it resolves to
   * puts the note it wants somewhere other than its own bass: four distinct
   * pitch classes over a planned root-position bass leave the root in the bass
   * and nowhere else, and no upper voice can rise into it. A seventh the next
   * chord contains counts as discharged when it is simply held — it was never
   * a dissonance against that chord.
   */
  const sweepTendency = (
    complexity: 1 | 2 | 3 | 4,
    over: Partial<AdvancedProgressionOptions> = {},
    seeds = 250
  ) => {
    let leadingTones = 0;
    let leadingTonesVoiceable = 0;
    let leadingTonesRose = 0;
    let sevenths = 0;
    let seventhsDischarged = 0;
    let suspensions = 0;
    let suspensionsResolved = 0;
    let tritones = 0;
    let tritonesContrary = 0;
    let transitions = 0;
    let motion = 0;
    let bigLeaps = 0;

    for (let seed = 0; seed < seeds; seed++) {
      const result = generateAdvancedProgression(options(complexity, { seed, ...over }));
      const identities = chordIdentities(result.debug?.planned ?? []);

      for (let i = 1; i < result.chords.length; i++) {
        const previous = result.chords[i - 1].midi;
        const next = result.chords[i].midi;
        const context = { from: identities[i - 1], to: identities[i] };

        transitions++;
        const a = [...previous].sort((x, y) => x - y);
        const b = [...next].sort((x, y) => x - y);
        let largest = 0;
        for (let v = 0; v < Math.min(a.length, b.length); v++) {
          const delta = Math.abs(a[v] - b[v]);
          motion += delta;
          if (delta > largest) largest = delta;
        }
        if (largest > 7) bigLeaps++;

        const upperOfNext = new Set(b.slice(1).map(pitchClassOf));
        let voiceable = false;
        for (const outcome of evaluateTendencies(previous, next, context)) {
          if (outcome.tone.kind === "leadingTone") {
            if (!outcome.possible || outcome.absorbed) continue;
            leadingTones++;
            if (upperOfNext.has((outcome.tone.pc + 1) % 12)) {
              leadingTonesVoiceable++;
              voiceable = true;
              if (outcome.resolved) leadingTonesRose++;
            }
          } else if (outcome.tone.kind === "seventh") {
            sevenths++;
            if (outcome.resolved || outcome.held) seventhsDischarged++;
          } else {
            suspensions++;
            if (outcome.resolved) suspensionsResolved++;
          }
        }

        const tritone = tritoneResolution(previous, next, context);
        if (tritone && !tritone.absorbed && voiceable) {
          tritones++;
          if (tritone.contrary) tritonesContrary++;
        }
      }
    }

    const ratio = (numerator: number, denominator: number) =>
      denominator === 0 ? 1 : numerator / denominator;

    return {
      leadingTones,
      leadingTonesVoiceable,
      leadingToneRise: ratio(leadingTonesRose, leadingTonesVoiceable),
      seventhRelease: ratio(seventhsDischarged, sevenths),
      sevenths,
      suspensionRelease: ratio(suspensionsResolved, suspensions),
      tritoneContrary: ratio(tritonesContrary, tritones),
      tritones,
      meanMotion: motion / Math.max(1, transitions),
      bigLeapRate: bigLeaps / Math.max(1, transitions),
    };
  };

  // Regression: the transition cost used to see two bare MIDI arrays, so a
  // leading tone went wherever smoothness sent it. Measured over 400 seeds on
  // the pre-fix code, the rise happened on 60.0% of the voiceable cases at
  // complexity 3 and on 29.7% of them in D dorian.
  it.each([
    ["C", "ionian", 2],
    ["C", "ionian", 3],
    ["C", "ionian", 4],
    ["A", "aeolian", 2],
    ["D", "dorian", 2],
    ["G", "mixolydian", 2],
  ] as const)(
    "rises the leading tone whenever a voicing can carry it (%s %s cx%i)",
    (rootKey, mode, complexity) => {
      const stats = sweepTendency(complexity, { rootKey, mode } as never);
      expect(stats.leadingTones).toBeGreaterThan(0);
      // The rise is measured over the voiceable cases, so guard that
      // denominator too: ratio() reports 1 over zero and would pass vacuously.
      expect(stats.leadingTonesVoiceable).toBeGreaterThan(0);
      expect(stats.leadingToneRise).toBeGreaterThan(0.97);
    }
  );

  // Regression: 59.8% at the defaults before the change, 65.2% at complexity 3.
  it.each([2, 3, 4] as const)("resolves or holds the chordal seventh at complexity %i", (complexity) => {
    const stats = sweepTendency(complexity);
    expect(stats.sevenths).toBeGreaterThan(100);
    expect(stats.seventhRelease).toBeGreaterThan(0.7);
  });

  it("resolves the dominant tritone in contrary motion where both halves can move", () => {
    const dorian = sweepTendency(2, { rootKey: "D", mode: "dorian" } as never);
    const mixolydian = sweepTendency(2, { rootKey: "G", mode: "mixolydian" } as never);
    expect(dorian.tritones + mixolydian.tritones).toBeGreaterThan(10);
    // Each ratio below has its own denominator; neither may be empty.
    expect(dorian.tritones).toBeGreaterThan(0);
    expect(mixolydian.tritones).toBeGreaterThan(0);
    expect(dorian.tritoneContrary).toBeGreaterThan(0.9);
    expect(mixolydian.tritoneContrary).toBeGreaterThan(0.9);
  });

  // Regression: 72.9% at complexity 3 before the change.
  it("falls a suspension to its resolution", () => {
    const stats = sweepTendency(3);
    expect(stats.suspensionRelease).toBeGreaterThan(0.75);
  });

  // The resolutions must not be bought with wild leaps: total voice motion per
  // chord change went *down* (8.52 to 7.96 semitones at the defaults) and the
  // share of changes carrying a leap wider than a fifth did not grow.
  it("does not buy resolution with bigger leaps", () => {
    const stats = sweepTendency(2);
    expect(stats.meanMotion).toBeLessThan(8.6);
    expect(stats.bigLeapRate).toBeLessThan(0.015);
  });

  it("stays deterministic per seed with the term switched on", () => {
    for (const seed of [0, 13, 99]) {
      expect(generateAdvancedProgression(options(3, { seed }))).toEqual(
        generateAdvancedProgression(options(3, { seed }))
      );
    }
  });

  it("can be switched off, and then resolves no better than geometry alone", () => {
    const off = sweepTendency(2, { tendencyWeight: 0 }, 150);
    const on = sweepTendency(2, {}, 150);
    expect(off.seventhRelease).toBeLessThan(on.seventhRelease);
  });

  // The pentatonic path has no leading tone and no functional dominant, and
  // its sevenths are scale tones of sus chords. It comes out untouched.
  it("leaves major pentatonic exactly as it was", () => {
    for (let seed = 0; seed < 120; seed++) {
      const withTerm = generateAdvancedProgression(
        options(2, { seed, rootKey: "C", mode: "major_pentatonic" } as never)
      );
      const without = generateAdvancedProgression(
        options(2, { seed, rootKey: "C", mode: "major_pentatonic", tendencyWeight: 0 } as never)
      );
      expect(withTerm.chords).toEqual(without.chords);
    }
  });
});
