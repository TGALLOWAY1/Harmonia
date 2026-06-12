import { describe, it, expect } from "vitest";
import { generateAdvancedProgression } from "../generateAdvancedProgression";
import type { AdvancedComplexity } from "../types";
import { getChordPitchClasses, normalizeRoot } from "@/lib/theory/chordSymbol";
import { midiToPitchClass, PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import { getDiatonicChords } from "@/lib/theory/chord";
import { makeSpeller } from "@/lib/theory/spelling";
import type { Mode } from "@/lib/theory/harmonyEngine";

/**
 * Cross-key correctness: the chord label, the displayed note names, the voiced
 * MIDI notes, and (via the spelling layer) the user-facing spelling must all
 * describe the same pitches in every supported key — not just C/E minor.
 *
 * The generator is sharp-only internally; the store applies a key-aware
 * spelling layer for display. These tests exercise both: the raw generator
 * output AND the spelling round-trip, so a regression in either is caught.
 */

// engineRoot is the sharp-canonical root the engine/UI uses; `display` is what
// a musician expects to see once spelling is applied.
const KEYS: { name: string; engineRoot: PitchClass; mode: Mode; display: string }[] = [
  { name: "C major", engineRoot: "C", mode: "ionian", display: "C" },
  { name: "G major", engineRoot: "G", mode: "ionian", display: "G" },
  { name: "F major", engineRoot: "F", mode: "ionian", display: "F" },
  { name: "E minor", engineRoot: "E", mode: "aeolian", display: "E" },
  { name: "A minor", engineRoot: "A", mode: "aeolian", display: "A" },
  { name: "D minor", engineRoot: "D", mode: "aeolian", display: "D" },
  { name: "B minor", engineRoot: "B", mode: "aeolian", display: "B" },
  { name: "Eb major", engineRoot: "D#", mode: "ionian", display: "Eb" },
  { name: "Bb minor", engineRoot: "A#", mode: "aeolian", display: "Bb" },
  { name: "F# minor", engineRoot: "F#", mode: "aeolian", display: "F#" },
];

const COMPLEXITIES: AdvancedComplexity[] = [1, 2, 3, 4];
const SEEDS = [1, 7, 42, 99, 1234];

function pcSet(pcs: string[]): Set<string> {
  return new Set(pcs);
}

describe("cross-key generator correctness", () => {
  for (const key of KEYS) {
    describe(key.name, () => {
      for (const complexity of COMPLEXITIES) {
        for (const seed of SEEDS) {
          it(`label, notes, and MIDI agree (complexity ${complexity}, seed ${seed})`, () => {
            const result = generateAdvancedProgression({
              rootKey: key.engineRoot,
              mode: key.mode,
              numChords: 6,
              complexity,
              voicingStyle: "auto",
              voiceCount: 4,
              rangeLow: 48,
              rangeHigh: 79,
              usePassingChords: true,
              useSuspensions: true,
              useSecondaryDominants: true,
              useTritoneSubstitution: true,
              seed,
            });

            for (const chord of result.chords) {
              const expected = getChordPitchClasses(chord.symbol);
              // Every symbol the generator emits must be parseable.
              expect(expected.length, `unparseable symbol ${chord.symbol}`).toBeGreaterThan(0);

              const allowed = pcSet(expected);

              // 1. Every voiced MIDI note belongs to the chord the symbol names.
              for (const midi of chord.midi) {
                const pc = midiToPitchClass(midi);
                expect(
                  allowed.has(pc),
                  `${chord.symbol}: voiced ${pc} not in ${expected.join(",")}`,
                ).toBe(true);
              }

              // 2. The displayed note names match the voiced MIDI notes exactly.
              const fromNotes = pcSet(
                chord.notes.map((n) => n.replace(/-?\d+$/, "")),
              );
              const fromMidi = pcSet(chord.midi.map((m) => midiToPitchClass(m)));
              expect(fromNotes).toEqual(fromMidi);
            }
          });
        }
      }
    });
  }
});

describe("cross-key spelling layer is lossless and key-correct", () => {
  for (const key of KEYS) {
    it(`${key.name}: re-spelling preserves pitch content`, () => {
      const speller = makeSpeller(key.engineRoot, key.mode);
      const result = generateAdvancedProgression({
        rootKey: key.engineRoot,
        mode: key.mode,
        numChords: 6,
        complexity: 3,
        voicingStyle: "auto",
        voiceCount: 4,
        rangeLow: 48,
        rangeHigh: 79,
        usePassingChords: true,
        useSuspensions: true,
        useSecondaryDominants: true,
        useTritoneSubstitution: true,
        seed: 2024,
      });

      for (const chord of result.chords) {
        const spelledSymbol = speller.symbol(chord.symbol);

        // Re-spelling the root must not change which pitches the symbol implies.
        const before = getChordPitchClasses(chord.symbol).slice().sort();
        const after = getChordPitchClasses(spelledSymbol).slice().sort();
        expect(after).toEqual(before);

        // Each re-spelled note name maps back to the same semitone class.
        for (const n of chord.notes) {
          const sharp = n.replace(/-?\d+$/, "");
          const spelled = speller.noteName(n).replace(/-?\d+$/, "");
          const sharpSemi = PITCH_CLASSES.indexOf(sharp as PitchClass);
          const spelledSemi = normalizeRoot(spelled);
          expect(spelledSemi).not.toBeNull();
          expect(PITCH_CLASSES.indexOf(spelledSemi!)).toBe(sharpSemi);
        }
      }
    });
  }
});

describe("diatonic spelling matches the key signature", () => {
  it("F major IV is spelled Bb, not A#", () => {
    const speller = makeSpeller("F", "ionian");
    const dia = getDiatonicChords("F", "major");
    const iv = dia.triads[3].triad; // IV
    expect(iv.root).toBe("A#"); // engine spelling (sharp-only)
    expect(speller.pc(iv.root)).toBe("Bb"); // displayed spelling
  });

  it("Eb major tonic spells Eb / Ab / Bb across its triad", () => {
    const speller = makeSpeller("D#", "ionian"); // Eb major
    const dia = getDiatonicChords("D#", "major");
    const i = dia.triads[0].triad.pitchClasses.map((pc) => speller.pc(pc));
    expect(i).toEqual(["Eb", "G", "Bb"]);
    const iv = dia.triads[3].triad.pitchClasses.map((pc) => speller.pc(pc));
    expect(iv).toEqual(["Ab", "C", "Eb"]);
  });

  it("Bb minor tonic spells Bb / Db / F", () => {
    const speller = makeSpeller("A#", "aeolian"); // Bb minor
    const dia = getDiatonicChords("A#", "natural_minor");
    const i = dia.triads[0].triad.pitchClasses.map((pc) => speller.pc(pc));
    expect(i).toEqual(["Bb", "Db", "F"]);
  });

  it("F# minor keeps sharps (F# / A / C#)", () => {
    const speller = makeSpeller("F#", "aeolian");
    const dia = getDiatonicChords("F#", "natural_minor");
    const i = dia.triads[0].triad.pitchClasses.map((pc) => speller.pc(pc));
    expect(i).toEqual(["F#", "A", "C#"]);
  });
});
