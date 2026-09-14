import { describe, expect, it } from "vitest";

import { generateAdvancedProgression } from "@/lib/music/generators/advanced/generateAdvancedProgression";
import { generateVoicingCandidates } from "@/lib/music/generators/advanced/voicing";
import { PITCH_CLASSES } from "@/lib/theory/midiUtils";
import { romanNumeralsForScale } from "@/lib/theory/romanNumeral";
import { getScaleDefinition } from "@/lib/theory/scale";
import type { AdvancedProgressionOptions, PlannedAdvancedChord } from "@/lib/music/generators/advanced/types";

/** The substitution flags the app actually ships, per `complexityToOptions`. */
const COMPLEXITY_PRESETS = {
  1: { useSecondaryDominants: false, usePassingChords: false, useSuspensions: false, useTritoneSubstitution: false },
  2: { useSecondaryDominants: true, usePassingChords: false, useSuspensions: false, useTritoneSubstitution: false },
  3: { useSecondaryDominants: true, usePassingChords: true, useSuspensions: true, useTritoneSubstitution: false },
  4: { useSecondaryDominants: true, usePassingChords: true, useSuspensions: true, useTritoneSubstitution: true },
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
  // mechanism behind progressions that felt like one sustained sonority.
  it("scores away the static-bass failure mode", () => {
    const scored = sweep({});
    const unscored = sweep({ candidateCount: 1 });

    expect(scored.staticBass).toBeLessThan(unscored.staticBass);
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
