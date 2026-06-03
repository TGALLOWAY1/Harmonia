import { describe, it, expect } from "vitest";
import { generateMelody } from "../generateMelody";
import type { MelodyGenerationOptions } from "../types";
import { midiToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";

// C major scale — note that F# (the third of a D7) is NOT diatonic here, which
// is exactly the case the melody generator used to mishandle.
const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];

// A C-major context containing a D7 secondary dominant (D F# A C). The F# and C
// are the harmonically critical tones; F natural is the diatonic clash a
// semitone below F#.
function options(
  overrides: Partial<MelodyGenerationOptions> = {},
): MelodyGenerationOptions {
  return {
    scalePitchClasses: C_MAJOR,
    chords: [
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["D", "F#", "A", "C"], root: "D", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["G", "B", "D"], root: "G", durationClass: "full" },
    ],
    style: "arpeggiated",
    octave: 5,
    seed: 12345,
    ...overrides,
  };
}

function isChordTone(midi: number, pcs: PitchClass[]): boolean {
  return pcs.includes(midiToPitchClass(midi));
}

function isSemitoneClash(midi: number, pcs: PitchClass[]): boolean {
  if (isChordTone(midi, pcs)) return false;
  return isChordTone(midi - 1, pcs) || isChordTone(midi + 1, pcs);
}

describe("melody harmony — chord-tone awareness", () => {
  it("is deterministic for a fixed seed", () => {
    const a = generateMelody(options());
    const b = generateMelody(options());
    expect(a.notes.map((n) => n.midi)).toEqual(b.notes.map((n) => n.midi));
  });

  it("can reach a chromatic chord tone (F# over D7 in C major)", () => {
    // Search several seeds so we don't depend on one RNG draw — the point is
    // that F# is *reachable* at all, which it never was when candidates came
    // only from the diatonic scale.
    let sawFSharp = false;
    for (let seed = 0; seed < 40 && !sawFSharp; seed++) {
      const melody = generateMelody(options({ seed }));
      sawFSharp = melody.notes.some(
        (n) => n.chordIndex === 1 && midiToPitchClass(n.midi) === "F#",
      );
    }
    expect(sawFSharp).toBe(true);
  });

  it("never plays a strong-beat semitone clash against the chord (expressive)", () => {
    for (let seed = 0; seed < 40; seed++) {
      const melody = generateMelody(options({ seed, harmony: "expressive" }));
      for (const note of melody.notes) {
        const chordPCs = options().chords[note.chordIndex].pitchClasses;
        const strongBeat = note.startBeat % 2 === 0;
        if (strongBeat) {
          expect(isSemitoneClash(note.midi, chordPCs)).toBe(false);
        }
      }
    }
  });

  it("strict mode pins every strong-beat note to a chord tone", () => {
    for (let seed = 0; seed < 40; seed++) {
      const melody = generateMelody(options({ seed, harmony: "strict" }));
      for (const note of melody.notes) {
        const chordPCs = options().chords[note.chordIndex].pitchClasses;
        const strongBeat = note.startBeat % 2 === 0;
        if (strongBeat) {
          expect(isChordTone(note.midi, chordPCs)).toBe(true);
        }
      }
    }
  });
});
