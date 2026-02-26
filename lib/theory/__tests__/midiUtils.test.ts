/**
 * MIDI utilities tests. Basic golden tests for core conversions.
 */
import { describe, it, expect } from "vitest";
import {
  midiToNoteName,
  midiToPitchClass,
  midiToOctave,
  isBlackKey,
  isWhiteKey,
  generateMidiRange,
  pitchClassToMidi,
} from "../midiUtils";

describe("midiUtils", () => {
  describe("pitchClassToMidi single octave mapping", () => {
    it("converts C at octave 3 to 48", () => expect(pitchClassToMidi("C", 3)).toBe(48));
    it("converts C# at octave 3 to 49", () => expect(pitchClassToMidi("C#", 3)).toBe(49));
    it("converts B at octave 3 to 59", () => expect(pitchClassToMidi("B", 3)).toBe(59));
  });

  describe("midiToNoteName", () => {
    it("converts 60 to C4", () => {
      expect(midiToNoteName(60)).toBe("C4");
    });
    it("converts 61 to C#4", () => {
      expect(midiToNoteName(61)).toBe("C#4");
    });
    it("converts 48 to C3", () => {
      expect(midiToNoteName(48)).toBe("C3");
    });
  });

  describe("midiToPitchClass", () => {
    it("converts 60 to C", () => expect(midiToPitchClass(60)).toBe("C"));
    it("converts 61 to C#", () => expect(midiToPitchClass(61)).toBe("C#"));
  });

  describe("midiToOctave", () => {
    it("converts 60 to 4", () => expect(midiToOctave(60)).toBe(4));
    it("converts 48 to 3", () => expect(midiToOctave(48)).toBe(3));
  });

  describe("isBlackKey / isWhiteKey", () => {
    it("61 (C#) is black key", () => expect(isBlackKey(61)).toBe(true));
    it("60 (C) is white key", () => expect(isWhiteKey(60)).toBe(true));
    it("60 (C) is not black key", () => expect(isBlackKey(60)).toBe(false));
  });

  describe("generateMidiRange", () => {
    it("generates inclusive range 48-52", () => {
      expect(generateMidiRange(48, 52)).toEqual([48, 49, 50, 51, 52]);
    });
    it("single note returns single element", () => {
      expect(generateMidiRange(60, 60)).toEqual([60]);
    });
  });
});
