import { describe, it, expect } from "vitest";
import {
  applyDynamics,
  chordVoiceWeights,
  melodyDynamics,
  metricAccent,
  progressionDynamics,
} from "../dynamics";
import type { Melody, MelodyNote, MelodyPhrase } from "../../music/generators/melody/types";

function note(overrides: Partial<MelodyNote>): MelodyNote {
  return {
    id: overrides.id ?? `n-${overrides.startBeat ?? 0}`,
    midi: 60,
    noteWithOctave: "C5",
    pitchClass: "C",
    durationBeats: 1,
    startBeat: 0,
    chordIndex: 0,
    isChordTone: true,
    source: "generated",
    ...overrides,
  };
}

function phrase(overrides: Partial<MelodyPhrase>): MelodyPhrase {
  return {
    startBeat: 0,
    endBeat: 4,
    material: "A",
    cadence: "half",
    isClimax: false,
    peakBeat: 2,
    ...overrides,
  };
}

describe("chordVoiceWeights", () => {
  it("gives a single note no weighting", () => {
    expect(chordVoiceWeights([60])).toEqual([1]);
  });

  it("returns an empty array for no notes", () => {
    expect(chordVoiceWeights([])).toEqual([]);
  });

  it("weights the top voice strongest, the bass a little strong, and inner voices softer", () => {
    const [bass, inner1, inner2, top] = chordVoiceWeights([48, 52, 55, 72]);
    expect(top).toBeGreaterThan(bass);
    expect(bass).toBeGreaterThan(inner1);
    expect(inner1).toBeCloseTo(inner2, 6);
  });

  it("finds bass/top by pitch, not array position", () => {
    // Same four pitches as above, reshuffled: top first, bass second.
    const weights = chordVoiceWeights([72, 48, 55, 52]);
    expect(weights[0]).toBeGreaterThan(weights[1]); // top > bass
    expect(weights[1]).toBeGreaterThan(weights[2]); // bass > inner
  });

  it("softens a very low bass a touch further than a moderate one", () => {
    const veryLow = chordVoiceWeights([24, 55, 60])[0];
    const moderate = chordVoiceWeights([48, 55, 60])[0];
    expect(veryLow).toBeLessThan(moderate);
  });

  it("assigns both roles in a two-note chord", () => {
    const [bass, top] = chordVoiceWeights([48, 60]);
    expect(top).toBeGreaterThan(bass);
    expect(bass).toBeGreaterThan(1); // still a little stronger than neutral
  });
});

describe("metricAccent", () => {
  it("orders downbeat > beat three > beats two/four > off-beat", () => {
    const downbeat = metricAccent(0);
    const beatThree = metricAccent(2);
    const beatTwo = metricAccent(1);
    const beatFour = metricAccent(3);
    const offbeat = metricAccent(0.5);
    expect(downbeat).toBeGreaterThan(beatThree);
    expect(beatThree).toBeGreaterThan(beatTwo);
    expect(beatTwo).toBeCloseTo(beatFour, 6);
    expect(beatFour).toBeGreaterThan(offbeat);
  });

  it("stays within roughly +/-10%", () => {
    for (const beat of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      const accent = metricAccent(beat);
      expect(accent).toBeGreaterThanOrEqual(0.9);
      expect(accent).toBeLessThanOrEqual(1.1);
    }
  });

  it("wraps beats beyond the bar back onto the same shape", () => {
    expect(metricAccent(4)).toBeCloseTo(metricAccent(0), 6);
    expect(metricAccent(6)).toBeCloseTo(metricAccent(2), 6);
  });
});

describe("progressionDynamics", () => {
  it("returns an empty array for no chords", () => {
    expect(progressionDynamics([])).toEqual([]);
  });

  it("returns neutral for a single chord", () => {
    expect(progressionDynamics([{}])).toEqual([1]);
  });

  it("lifts the first chord and settles the last", () => {
    const [first, middle, last] = progressionDynamics([{}, {}, {}]);
    expect(first).toBeGreaterThan(middle);
    expect(middle).toBeCloseTo(1, 6);
    expect(last).toBeLessThan(middle);
  });

  it("swells toward the tensest chord", () => {
    const dynamics = progressionDynamics([
      { tension: 0.1 },
      { tension: 0.9 },
      { tension: 0.5 },
      { tension: 0.1 },
    ]);
    // Compare two interior chords (neither gets the first/last edge effect)
    // so the difference is purely the tension swell.
    expect(dynamics[1]).toBeGreaterThan(dynamics[2]);
  });

  it("stays within about +/-8% even for an extreme combination", () => {
    const dynamics = progressionDynamics([{ tension: 1 }, {}, { tension: 1 }]);
    for (const d of dynamics) {
      expect(d).toBeGreaterThanOrEqual(0.92 - 1e-9);
      expect(d).toBeLessThanOrEqual(1.08 + 1e-9);
    }
  });
});

describe("applyDynamics", () => {
  it("returns the (clamped) base with no multipliers", () => {
    expect(applyDynamics(0.7)).toBe(0.7);
  });

  it("multiplies every factor together", () => {
    expect(applyDynamics(0.5, 1.1, 1.1)).toBeCloseTo(0.5 * 1.1 * 1.1, 6);
  });

  it("clamps to a ceiling of 1", () => {
    expect(applyDynamics(0.9, 1.5, 1.5)).toBe(1);
  });

  it("clamps to a floor of 0.15", () => {
    expect(applyDynamics(0.7, 0.01)).toBe(0.15);
  });
});

describe("melodyDynamics — without phrases (drawn melodies)", () => {
  it("falls back to metric accent + chord-tone weighting, within range", () => {
    const melody: Melody = {
      octave: 5,
      notes: [
        note({ startBeat: 0, isChordTone: true }),
        note({ startBeat: 0.5, isChordTone: false }),
      ],
    };
    const dynamics = melodyDynamics(melody);
    expect(dynamics).toHaveLength(2);
    for (const d of dynamics) {
      expect(d).toBeGreaterThanOrEqual(0.75);
      expect(d).toBeLessThanOrEqual(1.2);
    }
    // Same beat position aside from chord-tone-ness would be the clean test,
    // but even across positions a downbeat chord tone should outweigh an
    // off-beat non-chord tone.
    expect(dynamics[0]).toBeGreaterThan(dynamics[1]);
  });

  it("prefers chord tones over non-chord tones at the same metric position", () => {
    const melody: Melody = {
      octave: 5,
      notes: [
        note({ id: "a", startBeat: 0, isChordTone: true }),
        note({ id: "b", startBeat: 0, isChordTone: false }),
      ],
    };
    const [chordTone, colorTone] = melodyDynamics(melody);
    expect(chordTone).toBeGreaterThan(colorTone);
  });
});

describe("melodyDynamics — with phrases", () => {
  it("crescendos toward the peak and decrescendos after it", () => {
    const melody: Melody = {
      octave: 5,
      phrases: [phrase({ startBeat: 0, endBeat: 8, peakBeat: 4, cadence: "half" })],
      notes: [
        note({ id: "start", startBeat: 0 }),
        note({ id: "peak", startBeat: 4 }),
        note({ id: "end", startBeat: 8 }),
      ],
    };
    const [start, peak, end] = melodyDynamics(melody);
    expect(peak).toBeGreaterThan(start);
    expect(peak).toBeGreaterThan(end);
  });

  it("makes the climax phrase louder overall than an otherwise identical phrase", () => {
    // Both notes sit at the same off-peak position within an otherwise
    // identical (shifted) phrase, well below the velocity ceiling, so the
    // only thing that can move the ratio is the climax flag.
    const base: Melody = {
      octave: 5,
      phrases: [
        phrase({ startBeat: 0, endBeat: 8, peakBeat: 4, isClimax: false, cadence: "half" }),
        phrase({ startBeat: 8, endBeat: 16, peakBeat: 12, isClimax: true, cadence: "half" }),
      ],
      notes: [note({ id: "a", startBeat: 0.5 }), note({ id: "b", startBeat: 8.5 })],
    };
    const [nonClimax, climax] = melodyDynamics(base);
    expect(climax).toBeLessThan(1.2); // headroom check: not saturating the ceiling
    expect(climax).toBeGreaterThan(nonClimax);
    expect(climax / nonClimax).toBeCloseTo(1.05, 2);
  });

  it("tapers only the last note of a final cadence", () => {
    const notes = [
      note({ id: "a", startBeat: 0 }),
      note({ id: "b", startBeat: 1 }),
      note({ id: "c", startBeat: 2 }),
      note({ id: "d", startBeat: 3 }),
    ];
    const authentic: Melody = {
      octave: 5,
      phrases: [phrase({ startBeat: 0, endBeat: 4, peakBeat: 2, cadence: "authentic" })],
      notes,
    };
    const final: Melody = {
      octave: 5,
      phrases: [phrase({ startBeat: 0, endBeat: 4, peakBeat: 2, cadence: "final" })],
      notes,
    };
    const authenticDynamics = melodyDynamics(authentic);
    const finalDynamics = melodyDynamics(final);

    // Every note but the last is unaffected by the cadence type…
    expect(finalDynamics[0]).toBeCloseTo(authenticDynamics[0], 6);
    expect(finalDynamics[1]).toBeCloseTo(authenticDynamics[1], 6);
    expect(finalDynamics[2]).toBeCloseTo(authenticDynamics[2], 6);
    // …but the final cadence's last note is tapered down.
    expect(finalDynamics[3]).toBeLessThan(authenticDynamics[3]);
    expect(finalDynamics[3] / authenticDynamics[3]).toBeCloseTo(0.85, 2);
  });

  it("lifts a note that pickups into the next phrase", () => {
    const phrases = [
      phrase({ startBeat: 0, endBeat: 4, peakBeat: 0, cadence: "half" }),
      phrase({ startBeat: 4, endBeat: 8, peakBeat: 4, cadence: "half" }),
    ];
    const pickup: Melody = { octave: 5, phrases, notes: [note({ startBeat: 3.5 })] };
    const farPhrases = [
      phrase({ startBeat: 0, endBeat: 4, peakBeat: 0, cadence: "half" }),
      phrase({ startBeat: 20, endBeat: 24, peakBeat: 20, cadence: "half" }),
    ];
    const noPickup: Melody = { octave: 5, phrases: farPhrases, notes: [note({ startBeat: 3.5 })] };

    const [withPickup] = melodyDynamics(pickup);
    const [without] = melodyDynamics(noPickup);
    expect(withPickup).toBeGreaterThan(without);
    expect(withPickup / without).toBeCloseTo(1.05, 2);
  });

  it("gives longer notes a small boost over short ones at the same position", () => {
    // An off-peak, moderate-weight beat leaves headroom below the ceiling so
    // the duration boost isn't masked by clamping.
    const melody: Melody = {
      octave: 5,
      phrases: [phrase({ startBeat: 0, endBeat: 8, peakBeat: 0, cadence: "half" })],
      notes: [
        note({ id: "short", startBeat: 7, durationBeats: 0.5 }),
        note({ id: "long", startBeat: 7, durationBeats: 3 }),
      ],
    };
    const [short, long] = melodyDynamics(melody);
    expect(long).toBeLessThan(1.2); // headroom check: not saturating the ceiling
    expect(long).toBeGreaterThan(short);
  });

  it("keeps the overall range within about 0.75-1.2 under an extreme stack", () => {
    const phrases = [phrase({ startBeat: 0, endBeat: 4, peakBeat: 0, cadence: "final", isClimax: true })];
    const melody: Melody = {
      octave: 5,
      phrases,
      notes: [note({ startBeat: 0, durationBeats: 4, isChordTone: true })],
    };
    const [d] = melodyDynamics(melody);
    expect(d).toBeGreaterThanOrEqual(0.75);
    expect(d).toBeLessThanOrEqual(1.2);
  });
});

describe("progressionDynamics — chord length", () => {
  it("sets short passing chords a little lighter than full-bar chords", () => {
    const full = progressionDynamics([
      { durationClass: "full" },
      { durationClass: "full" },
      { durationClass: "full" },
    ]);
    const eighth = progressionDynamics([
      { durationClass: "full" },
      { durationClass: "eighth" },
      { durationClass: "full" },
    ]);
    const quarter = progressionDynamics([
      { durationClass: "full" },
      { durationClass: "quarter" },
      { durationClass: "full" },
    ]);
    expect(eighth[1]).toBeLessThan(full[1]);
    expect(quarter[1]).toBeLessThan(full[1]);
    expect(quarter[1]).toBeGreaterThan(eighth[1]);
    expect(eighth[1]).toBeGreaterThanOrEqual(0.92);
    // Outer chords are untouched by a short chord in the middle.
    expect(eighth[0]).toBe(full[0]);
    expect(eighth[2]).toBe(full[2]);
  });
});
