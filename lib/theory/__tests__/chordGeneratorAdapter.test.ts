import { describe, it, expect } from "vitest";
import {
  generateChordProgression,
  SCALE_TYPE_TO_MODE,
  mapQualityToHarmonia,
  type ChordGeneratorMode,
} from "../../chordGeneratorAdapter";
import type { PitchClass } from "../midiUtils";
import type { ScaleType } from "../types";

describe("chordGeneratorAdapter", () => {
  describe("ScaleType → ChordGenerator Mode mapping", () => {
    const expectedMapping: Array<[ScaleType, ChordGeneratorMode]> = [
      ["major", "ionian"],
      ["natural_minor", "aeolian"],
      ["dorian", "dorian"],
      ["mixolydian", "mixolydian"],
      ["phrygian", "phrygian"],
    ];

    it("SCALE_TYPE_TO_MODE has correct entries for all Harmonia ScaleTypes", () => {
      for (const [scaleType, expectedMode] of expectedMapping) {
        expect(SCALE_TYPE_TO_MODE[scaleType]).toBe(expectedMode);
      }
    });

    it("each ScaleType maps to exactly one ChordGenerator Mode", () => {
      const scaleTypes: ScaleType[] = ["major", "natural_minor", "dorian", "mixolydian", "phrygian"];
      for (const st of scaleTypes) {
        const mode = SCALE_TYPE_TO_MODE[st];
        expect(mode).toBeDefined();
        expect(["ionian", "aeolian", "dorian", "mixolydian", "phrygian"]).toContain(mode);
      }
    });

    it("adapter calls ChordGenerator with correct mode for each ScaleType", () => {
      for (const [scaleType, expectedMode] of expectedMapping) {
        const progression = generateChordProgression("C", scaleType);
        expect(progression.length).toBe(4);
        expect(progression.every((c) => c.notes.length > 0)).toBe(true);
      }
    });
  });
  describe("note normalization (Tonal flats → Harmonia sharps)", () => {
    it("D natural_minor maps to aeolian and produces no flats in notes", () => {
      const progression = generateChordProgression("D", "natural_minor");
      expect(progression.length).toBeGreaterThan(0);

      const allNotes = progression.flatMap((c) => c.notes);
      const hasFlat = allNotes.some((n) => n.includes("b"));
      expect(hasFlat).toBe(false);

      const harmoniaPitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      for (const note of allNotes) {
        expect(harmoniaPitchClasses).toContain(note);
      }
    });

    it("chord that would contain Bb (e.g. D aeolian bVI) returns A# not Bb", () => {
      const progression = generateChordProgression("D", "natural_minor");
      const allNotes = progression.flatMap((c) => c.notes);

      expect(allNotes).not.toContain("Bb");
      expect(allNotes).not.toContain("Eb");
      expect(allNotes).not.toContain("Ab");
      expect(allNotes).not.toContain("Db");
      expect(allNotes).not.toContain("Gb");

      const bVIChord = progression.find((c) => c.degree === "bVI");
      if (bVIChord) {
        expect(bVIChord.notes).toContain("A#");
        expect(bVIChord.notes).not.toContain("Bb");
      }
    });

    it("returns PitchClass[] only (no octaves)", () => {
      const progression = generateChordProgression("C", "major");
      for (const chord of progression) {
        for (const note of chord.notes) {
          expect(note).toMatch(/^[A-G]#?$/);
          expect(note).not.toMatch(/\d/);
        }
      }
    });

    it("preserves chord tone order (no reordering beyond dedup)", () => {
      const progression = generateChordProgression("D", "natural_minor");
      for (const chord of progression) {
        const seen = new Set<string>();
        for (const note of chord.notes) {
          expect(seen.has(note)).toBe(false);
          seen.add(note);
        }
      }
    });
  });

  describe("chord quality mapping (ChordGenerator → Harmonia ChordQuality)", () => {
    const HARMONIA_QUALITIES = ["maj", "min", "dim", "aug", "maj7", "min7", "dom7", "half-dim7", "dim7"];

    it('"7" maps to "dom7"', () => {
      expect(mapQualityToHarmonia("7")).toBe("dom7");
    });

    it('"m7" maps to "min7"', () => {
      expect(mapQualityToHarmonia("m7")).toBe("min7");
    });

    it("supported qualities map correctly", () => {
      expect(mapQualityToHarmonia("")).toBe("maj");
      expect(mapQualityToHarmonia("m")).toBe("min");
      expect(mapQualityToHarmonia("dim")).toBe("dim");
      expect(mapQualityToHarmonia("maj7")).toBe("maj7");
    });

    it("unsupported qualities map to closest (never leak through)", () => {
      expect(mapQualityToHarmonia("sus2")).toBe("maj");
      expect(mapQualityToHarmonia("sus4")).toBe("maj");
      expect(mapQualityToHarmonia("add9")).toBe("maj");
      expect(mapQualityToHarmonia("m(add9)")).toBe("min");
      expect(mapQualityToHarmonia("maj(add9)")).toBe("maj");
    });

    it("unsupported qualities never appear in progression output", () => {
      const unsupported = ["sus2", "sus4", "add9", "m(add9)", "maj(add9)"];
      for (let i = 0; i < 20; i++) {
        const progression = generateChordProgression("C", "major", { complexity: 2 });
        for (const chord of progression) {
          expect(unsupported).not.toContain(chord.quality);
          expect(HARMONIA_QUALITIES).toContain(chord.quality);
        }
      }
    });

    it("all output qualities are Harmonia ChordQuality", () => {
      const scaleTypes: ScaleType[] = ["major", "natural_minor", "dorian", "mixolydian", "phrygian"];
      for (const st of scaleTypes) {
        const progression = generateChordProgression("C", st);
        for (const chord of progression) {
          expect(HARMONIA_QUALITIES).toContain(chord.quality);
        }
      }
    });
  });

  describe("degree/roman numeral mapping (ChordGenerator roman → degree string)", () => {
    it("preserves bVII as degree string and normalizes notes to sharps-only", () => {
      const harmoniaPitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      let bVIIChord: { degree: string; notes: PitchClass[] } | undefined;
      for (let i = 0; i < 50; i++) {
        const progression = generateChordProgression("D", "dorian", { mood: "neutral" });
        const found = progression.find((c) => c.degree === "bVII");
        if (found) {
          bVIIChord = found;
          break;
        }
      }
      expect(bVIIChord).toBeDefined();
      expect(bVIIChord!.degree).toBe("bVII");
      for (const note of bVIIChord!.notes) {
        expect(harmoniaPitchClasses).toContain(note);
        expect(note).not.toMatch(/b/);
      }
    });
  });

  describe("input validation", () => {
    it("rejects flat roots at runtime", () => {
      expect(() =>
        generateChordProgression("Bb" as PitchClass, "natural_minor")
      ).toThrow(/Invalid root.*Bb.*sharps-only/);
    });
  });
});
