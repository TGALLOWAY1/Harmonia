import { describe, it, expect } from "vitest";
import {
  buildHarmonicContext,
  classifyQuality,
  guideToneLine,
  pcIndex,
} from "../harmonicContext";
import type { MelodyGenerationOptions } from "../types";
import type { PitchClass } from "@/lib/theory/midiUtils";

const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];
const A_MINOR: PitchClass[] = ["A", "B", "C", "D", "E", "F", "G"];
const C_PENTA: PitchClass[] = ["C", "D", "E", "G", "A"];

type ChordIn = MelodyGenerationOptions["chords"][number];
const chord = (root: PitchClass, pcs: PitchClass[], extra: Partial<ChordIn> = {}): ChordIn => ({
  midiNotes: [],
  pitchClasses: pcs,
  root,
  durationClass: "full",
  ...extra,
});

const pc = (name: PitchClass) => pcIndex(name);

describe("chord quality classification", () => {
  it("recognises the common qualities from intervals", () => {
    expect(classifyQuality([0, 4, 7])).toBe("maj");
    expect(classifyQuality([0, 4, 7, 11])).toBe("maj7");
    expect(classifyQuality([0, 4, 7, 10])).toBe("dom7");
    expect(classifyQuality([0, 3, 7])).toBe("min");
    expect(classifyQuality([0, 3, 7, 10])).toBe("min7");
    expect(classifyQuality([0, 3, 6])).toBe("dim");
    expect(classifyQuality([0, 3, 6, 9])).toBe("dim7");
    expect(classifyQuality([0, 3, 6, 10])).toBe("m7b5");
    expect(classifyQuality([0, 5, 7])).toBe("sus4");
    expect(classifyQuality([0, 5, 7, 10])).toBe("7sus4");
    expect(classifyQuality([0, 2, 7])).toBe("sus2");
    expect(classifyQuality([0, 4, 8])).toBe("aug");
    expect(classifyQuality([0, 4, 7, 9])).toBe("6");
    expect(classifyQuality([0, 4, 7, 2])).toBe("add9");
  });
});

describe("harmonic context in C major (I vi IV V)", () => {
  const ctx = buildHarmonicContext(
    [chord("C", ["C", "E", "G"]), chord("A", ["A", "C", "E"]), chord("F", ["F", "A", "C"]), chord("G", ["G", "B", "D"])],
    C_MAJOR,
  );

  it("tags functions and orders tension the way the chord engine does", () => {
    expect(ctx.chords.map((c) => c.functionTag)).toEqual(["tonic", "mediant", "predominant", "dominant"]);
    expect(ctx.chords[3].isDominantFunction).toBe(true);
    expect(ctx.chords[0].isDominantFunction).toBe(false);
    const t = ctx.tensionCurve;
    expect(t[3]).toBeGreaterThan(t[2]);
    expect(t[2]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[0]);
    expect(t[0]).toBe(0);
  });

  it("classifies notes over the tonic: chord, colour, avoid, chromatic", () => {
    const I = ctx.chords[0];
    expect(I.categories[pc("E")]).toBe("chord");
    expect(I.categories[pc("D")]).toBe("color"); // the 9th
    expect(I.categories[pc("A")]).toBe("color"); // the 6th
    expect(I.categories[pc("B")]).toBe("color"); // the major 7th
    expect(I.categories[pc("F")]).toBe("avoid"); // a semitone above the third
    expect(I.categories[pc("C#")]).toBe("chromatic");
  });

  it("marks the tonic as an avoid tone over V and keeps fa as a colour", () => {
    const V = ctx.chords[3];
    expect(V.categories[pc("C")]).toBe("avoid"); // the 4th over a major chord
    expect(V.categories[pc("F")]).toBe("color"); // the 7th
    expect(V.categories[pc("A")]).toBe("color"); // the 9th
  });

  it("gives the dominant a leading-tone tendency toward the tonic", () => {
    const V = ctx.chords[3];
    const lt = V.tendencies.find((t) => t.kind === "leading-tone");
    expect(lt).toBeDefined();
    expect(lt!.pc).toBe(pc("B"));
    expect(lt!.to).toEqual([pc("C")]);
  });

  it("ranks the third first when targeting a chord change", () => {
    expect(ctx.chords[0].priority[0]).toBe(pc("E"));
    expect(ctx.chords[1].priority[0]).toBe(pc("C"));
    expect(ctx.chords[3].guideTones).toEqual([pc("B"), pc("G")]);
  });
});

describe("chromatic chords", () => {
  it("treats D7 in C as an applied dominant and demotes F below F#", () => {
    const ctx = buildHarmonicContext(
      [chord("C", ["C", "E", "G"]), chord("D", ["D", "F#", "A", "C"]), chord("G", ["G", "B", "D"])],
      C_MAJOR,
    );
    const D7 = ctx.chords[1];
    expect(D7.kind).toBe("secondary-dominant");
    expect(D7.functionTag).toBe("applied");
    expect(D7.appliedTarget).toBe(pc("G"));
    expect(D7.categories[pc("F#")]).toBe("chord");
    expect(D7.categories[pc("F")]).toBe("avoid");
    expect(D7.tension).toBeGreaterThan(ctx.chords[2].tension);
    const applied = D7.tendencies.find((t) => t.kind === "applied-leading-tone");
    expect(applied?.pc).toBe(pc("F#"));
    expect(applied?.to).toEqual([pc("G")]);
    const seventh = D7.tendencies.find((t) => t.kind === "seventh");
    expect(seventh?.pc).toBe(pc("C"));
    expect(seventh?.to).toContain(pc("B"));
  });

  it("treats a borrowed iv as chromatic colour and demotes the natural sixth", () => {
    const ctx = buildHarmonicContext(
      [chord("C", ["C", "E", "G"]), chord("F", ["F", "G#", "C"]), chord("C", ["C", "E", "G"])],
      C_MAJOR,
    );
    const iv = ctx.chords[1];
    expect(iv.kind).toBe("borrowed");
    // A borrowed chord on a diatonic root keeps its function; only a chromatic
    // root (bII, bVI) is tagged "chromatic".
    expect(iv.functionTag).toBe("predominant");
    expect(iv.tension).toBeGreaterThan(ctx.chords[0].tension);
    expect(iv.categories[pc("G#")]).toBe("chord");
    expect(iv.categories[pc("A")]).toBe("avoid");
    expect(iv.tendencies.find((t) => t.kind === "le-sol")?.to).toEqual([pc("G")]);
  });

  it("honours the chord engine's own tags when supplied", () => {
    const ctx = buildHarmonicContext(
      [chord("D", ["D", "F#", "A", "C"], { kind: "secondary-dominant", functionTag: "applied", isDominant: true, tension: 0.9 })],
      C_MAJOR,
    );
    expect(ctx.chords[0].kind).toBe("secondary-dominant");
    expect(ctx.chords[0].tension).toBe(0.9);
  });
});

describe("minor keys and pentatonic", () => {
  it("raises the leading tone over V in natural minor and offers the melodic-minor sixth", () => {
    const ctx = buildHarmonicContext(
      [chord("A", ["A", "C", "E"]), chord("E", ["E", "G#", "B", "D"]), chord("A", ["A", "C", "E"])],
      A_MINOR,
    );
    expect(ctx.isMinorKey).toBe(true);
    const V7 = ctx.chords[1];
    expect(V7.isDominantFunction).toBe(true);
    expect(V7.categories[pc("G#")]).toBe("chord");
    expect(V7.categories[pc("G")]).toBe("avoid");
    expect(V7.categories[pc("F#")]).toBe("color"); // the 9th of E7 = raised 6̂
    expect(V7.categories[pc("F")]).toBe("avoid"); // b9, a semitone above the root
    const lt = V7.tendencies.find((t) => t.kind === "leading-tone");
    expect(lt?.pc).toBe(pc("G#"));
    expect(lt?.to).toEqual([pc("A")]);
    expect(lt?.strength).toBe(1);
  });

  it("handles the five-note major pentatonic and its sus chords", () => {
    const ctx = buildHarmonicContext(
      [chord("C", ["C", "E", "G"]), chord("D", ["D", "G", "A"]), chord("G", ["G", "A", "D"]), chord("C", ["C", "E", "G"])],
      C_PENTA,
    );
    expect(ctx.isPentatonic).toBe(true);
    expect(ctx.chords.map((c) => c.functionTag)).toEqual(["tonic", "predominant", "dominant", "tonic"]);
    expect(ctx.chords[1].quality).toBe("sus4");
    for (const c of ctx.chords) expect(c.universe.every((p) => ctx.scalePcs.includes(p))).toBe(true);
  });
});

describe("guide-tone line", () => {
  it("connects one characteristic tone per chord by small motion inside the register", () => {
    const ctx = buildHarmonicContext(
      [chord("C", ["C", "E", "G"]), chord("A", ["A", "C", "E"]), chord("F", ["F", "A", "C"]), chord("G", ["G", "B", "D"])],
      C_MAJOR,
    );
    const line = guideToneLine(ctx, 60, 84);
    expect(line).toHaveLength(4);
    for (let i = 0; i < line.length; i++) {
      expect(line[i]).toBeGreaterThanOrEqual(60);
      expect(line[i]).toBeLessThanOrEqual(84);
      expect(ctx.chords[i].pcs).toContain(line[i] % 12);
      if (i > 0) expect(Math.abs(line[i] - line[i - 1])).toBeLessThanOrEqual(5);
    }
  });
});
