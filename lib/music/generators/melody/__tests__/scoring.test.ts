import { describe, it, expect } from "vitest";
import { motifRepetitionCoverage, scoreMelody } from "../scoring";
import { buildPhrasePlan } from "../phrasePlan";
import { MOOD_PROFILES } from "../moods";
import { createRng } from "../rng";
import { midiToNoteName, midiToPitchClass } from "@/lib/theory/midiUtils";
import type { MelodyGenerationOptions, MelodyNote } from "../types";

const C_CHORDS: MelodyGenerationOptions["chords"] = Array.from({ length: 4 }, () => ({
  midiNotes: [],
  pitchClasses: ["C", "E", "G"],
  root: "C",
  durationClass: "full",
}));

function note(midi: number, startBeat: number, durationBeats: number, chordIndex: number): MelodyNote {
  return {
    id: `t-${startBeat}`,
    midi,
    noteWithOctave: midiToNoteName(midi),
    pitchClass: midiToPitchClass(midi),
    durationBeats,
    startBeat,
    chordIndex,
    isChordTone: ["C", "E", "G"].includes(midiToPitchClass(midi)),
    source: "generated",
  };
}

/** A composed line: a repeated motif, smooth motion, long chord-tone ending. */
function goodMelody(): MelodyNote[] {
  const motif = [
    { midi: 72, dur: 1 },
    { midi: 74, dur: 0.5 },
    { midi: 76, dur: 0.5 },
    { midi: 72, dur: 2 },
  ];
  const notes: MelodyNote[] = [];
  let beat = 0;
  for (let rep = 0; rep < 3; rep++) {
    for (const m of motif) {
      notes.push(note(m.midi, beat, m.dur, Math.min(3, Math.floor(beat / 4))));
      beat += m.dur;
    }
  }
  notes.push(note(76, beat, 2, 3));
  notes.push(note(72, beat + 2, 2, 3));
  return notes;
}

/** A random zig-zag: leaps everywhere, constant direction changes, abrupt end.
 * Interval magnitudes are all distinct enough that no 3-gram repeats even
 * with the scorer's ±1 fuzz. */
function zigZagMelody(): MelodyNote[] {
  const intervals = [3, -5, 8, -11, 6, -9, 12, -4, 10, -7, 5, -13, 9, -6, 11];
  const pitches = [72];
  for (const iv of intervals) pitches.push(pitches[pitches.length - 1] + iv);
  return pitches.map((midi, i) => note(midi, i, 1, Math.min(3, Math.floor(i / 4))));
}

describe("melody scoring", () => {
  it("detects repeated motifs and gives zero coverage to non-repeating lines", () => {
    expect(motifRepetitionCoverage(goodMelody())).toBeGreaterThan(0.3);
    expect(motifRepetitionCoverage(zigZagMelody())).toBe(0);
  });

  it("scores a composed melody far above a random zig-zag", () => {
    const plan = buildPhrasePlan(C_CHORDS, MOOD_PROFILES.emotional, createRng(0));
    const good = scoreMelody(goodMelody(), plan, C_CHORDS, MOOD_PROFILES.emotional, 5);
    const bad = scoreMelody(zigZagMelody(), plan, C_CHORDS, MOOD_PROFILES.emotional, 5);
    expect(good.total).toBeGreaterThan(bad.total + 20);
  });

  it("penalizes oversized leaps, zig-zag motion, and missing repetition", () => {
    const plan = buildPhrasePlan(C_CHORDS, MOOD_PROFILES.emotional, createRng(0));
    const bad = scoreMelody(zigZagMelody(), plan, C_CHORDS, MOOD_PROFILES.emotional, 5);
    expect(bad.breakdown.penalties).toBeLessThan(-15);
  });

  it("rewards phrase endings that resolve long onto a chord tone", () => {
    const plan = buildPhrasePlan(C_CHORDS, MOOD_PROFILES.emotional, createRng(0));
    const good = scoreMelody(goodMelody(), plan, C_CHORDS, MOOD_PROFILES.emotional, 5);
    expect(good.breakdown.phraseEnding).toBeGreaterThanOrEqual(12);

    const abrupt = goodMelody();
    const last = abrupt[abrupt.length - 1];
    abrupt[abrupt.length - 1] = { ...last, midi: 73, durationBeats: 0.5, isChordTone: false };
    const weak = scoreMelody(abrupt, plan, C_CHORDS, MOOD_PROFILES.emotional, 5);
    expect(weak.breakdown.phraseEnding).toBeLessThan(good.breakdown.phraseEnding);
  });
});
