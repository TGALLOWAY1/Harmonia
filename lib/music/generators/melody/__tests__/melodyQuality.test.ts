import { describe, it, expect } from "vitest";
import { generateMelody } from "../generateMelody";
import { motifRepetitionCoverage } from "../scoring";
import { contourTargetAt } from "../contour";
import { MOOD_PROFILES } from "../moods";
import { midiToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";
import type { Melody, MelodyGenerationOptions, MelodyMood } from "../types";
import type { DurationClass } from "../../advanced/types";

const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];

// I–vi–IV–V in C: a typical pop progression for quality checks.
const POP_CHORDS: MelodyGenerationOptions["chords"] = [
  { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["A", "C", "E"], root: "A", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
  { midiNotes: [], pitchClasses: ["G", "B", "D"], root: "G", durationClass: "full" },
];

function options(overrides: Partial<MelodyGenerationOptions> = {}): MelodyGenerationOptions {
  return {
    scalePitchClasses: C_MAJOR,
    chords: POP_CHORDS,
    style: "lyrical",
    octave: 5,
    seed: 1,
    ...overrides,
  };
}

function isChordTone(midi: number, pcs: PitchClass[]): boolean {
  return pcs.includes(midiToPitchClass(midi));
}

function meanMidi(melody: Melody): number {
  return melody.notes.reduce((s, n) => s + n.midi, 0) / melody.notes.length;
}

function meanDuration(melody: Melody): number {
  return melody.notes.reduce((s, n) => s + n.durationBeats, 0) / melody.notes.length;
}

describe("melody quality constraints", () => {
  it("contains repeated motif material (hummable hook)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      if (melody.notes.length >= 8) {
        expect(motifRepetitionCoverage(melody.notes)).toBeGreaterThan(0);
      }
    }
  });

  it("ends every melody with a long resolving note on a chord tone", () => {
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      const last = melody.notes[melody.notes.length - 1];
      expect(last.durationBeats).toBeGreaterThanOrEqual(2);
      expect(isChordTone(last.midi, POP_CHORDS[POP_CHORDS.length - 1].pitchClasses)).toBe(true);
      expect(last.startBeat + last.durationBeats).toBe(16);
    }
  });

  it("plans contours with the peak where it belongs", () => {
    const profile = MOOD_PROFILES.emotional;
    // Arch: peak at the climax beat, low at the edges.
    const peak = contourTargetAt("arch", 10, 16, 10, profile, 5);
    expect(peak).toBeGreaterThan(contourTargetAt("arch", 0, 16, 10, profile, 5));
    expect(peak).toBeGreaterThan(contourTargetAt("arch", 16, 16, 10, profile, 5));
    // Rising/falling are monotone end-to-end.
    expect(contourTargetAt("rising", 16, 16, 10, profile, 5)).toBeGreaterThan(
      contourTargetAt("rising", 0, 16, 10, profile, 5),
    );
    expect(contourTargetAt("falling", 16, 16, 10, profile, 5)).toBeLessThan(
      contourTargetAt("falling", 0, 16, 10, profile, 5),
    );
  });

  it("makes moods audibly different (register, density, sustain)", () => {
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const stats = (mood: MelodyMood) => {
      let midiSum = 0;
      let durSum = 0;
      let noteCount = 0;
      for (const seed of seeds) {
        const m = generateMelody(options({ seed, mood }));
        midiSum += meanMidi(m);
        durSum += meanDuration(m);
        noteCount += m.notes.length;
      }
      return {
        meanMidi: midiSum / seeds.length,
        meanDur: durSum / seeds.length,
        notesPerBeat: noteCount / seeds.length / 16,
      };
    };

    const dark = stats("dark");
    const energetic = stats("energetic");
    const dreamy = stats("dreamy");

    expect(dark.meanMidi).toBeLessThan(energetic.meanMidi);
    expect(energetic.notesPerBeat).toBeGreaterThan(dark.notesPerBeat);
    expect(dreamy.meanDur).toBeGreaterThan(energetic.meanDur);
  });

  it("respects mood leap limits (with snap tolerance)", () => {
    for (const mood of ["dark", "emotional", "dreamy", "energetic"] as MelodyMood[]) {
      const limit = MOOD_PROFILES[mood].maxLeap + 4;
      for (let seed = 0; seed < 10; seed++) {
        const melody = generateMelody(options({ seed, mood }));
        for (let i = 1; i < melody.notes.length; i++) {
          const interval = Math.abs(melody.notes[i].midi - melody.notes[i - 1].midi);
          expect(interval).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("resolves every non-chord tone by step", () => {
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed, mood: "emotional" }));
      for (let i = 0; i < melody.notes.length; i++) {
        const n = melody.notes[i];
        if (n.isChordTone) continue;
        const next = melody.notes[i + 1];
        expect(next).toBeDefined();
        expect(Math.abs(next.midi - n.midi)).toBeLessThanOrEqual(2);
        expect(next.startBeat - (n.startBeat + n.durationBeats)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is fully deterministic with the candidate-selection loop", () => {
    const a = generateMelody(options({ seed: 7, candidateCount: 8 }));
    const b = generateMelody(options({ seed: 7, candidateCount: 8 }));
    expect(a.notes.map((n) => [n.midi, n.startBeat, n.durationBeats])).toEqual(
      b.notes.map((n) => [n.midi, n.startBeat, n.durationBeats]),
    );
  });

  it("stays on the half-beat grid and inside the display register", () => {
    for (const mood of ["dark", "emotional", "dreamy", "energetic"] as MelodyMood[]) {
      for (let seed = 0; seed < 10; seed++) {
        const melody = generateMelody(options({ seed, mood }));
        expect(melody.notes.length).toBeGreaterThan(0);
        for (const n of melody.notes) {
          expect(n.startBeat % 0.5).toBe(0);
          expect(n.durationBeats % 0.5).toBe(0);
          expect(n.durationBeats).toBeGreaterThanOrEqual(0.5);
          expect(n.midi).toBeGreaterThanOrEqual(60);
          expect(n.midi).toBeLessThanOrEqual(84);
        }
      }
    }
  });

  it("handles degenerate progressions without breaking", () => {
    const cases: { chords: MelodyGenerationOptions["chords"] }[] = [
      { chords: POP_CHORDS.slice(0, 1) },
      { chords: POP_CHORDS.slice(0, 2) },
      {
        chords: POP_CHORDS.map((c) => ({ ...c, durationClass: "eighth" as DurationClass })),
      },
    ];
    for (const { chords } of cases) {
      for (let seed = 0; seed < 5; seed++) {
        const melody = generateMelody(options({ chords, seed }));
        expect(melody.notes.length).toBeGreaterThan(0);
        const last = melody.notes[melody.notes.length - 1];
        expect(isChordTone(last.midi, chords[last.chordIndex].pitchClasses)).toBe(true);
      }
    }
  });
});
