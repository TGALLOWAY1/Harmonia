import { describe, it, expect } from "vitest";
import {
  getMajorScale,
  getNaturalMinorScale,
  getDorianScale,
  getMajorPentatonicScale,
} from "../scale";

describe("scale golden tests", () => {
  describe("C major", () => {
    it("returns C D E F G A B", () => {
      const scale = getMajorScale("C");
      expect(scale.root).toBe("C");
      expect(scale.type).toBe("major");
      expect(scale.pitchClasses).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
    });
  });

  describe("A natural minor", () => {
    it("returns A B C D E F G", () => {
      const scale = getNaturalMinorScale("A");
      expect(scale.root).toBe("A");
      expect(scale.type).toBe("natural_minor");
      expect(scale.pitchClasses).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    });
  });

  describe("C major pentatonic", () => {
    it("returns C D E G A — the major scale without its 4th and 7th", () => {
      const scale = getMajorPentatonicScale("C");
      expect(scale.root).toBe("C");
      expect(scale.type).toBe("major_pentatonic");
      expect(scale.pitchClasses).toEqual(["C", "D", "E", "G", "A"]);
    });
  });

  describe("F# major pentatonic", () => {
    it("returns F# G# A# C# D#", () => {
      const scale = getMajorPentatonicScale("F#");
      expect(scale.pitchClasses).toEqual(["F#", "G#", "A#", "C#", "D#"]);
    });
  });

  describe("D dorian", () => {
    it("returns D E F G A B C", () => {
      const scale = getDorianScale("D");
      expect(scale.root).toBe("D");
      expect(scale.type).toBe("dorian");
      expect(scale.pitchClasses).toEqual(["D", "E", "F", "G", "A", "B", "C"]);
    });
  });
});
