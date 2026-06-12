import { describe, it, expect } from "vitest";
import { keyPrefersFlats, makeSpeller } from "../spelling";

describe("keyPrefersFlats", () => {
  it("uses sharps for C major / A minor (no accidentals)", () => {
    expect(keyPrefersFlats("C", "ionian")).toBe(false);
    expect(keyPrefersFlats("A", "aeolian")).toBe(false);
  });

  it("uses sharps for sharp-side major keys", () => {
    for (const root of ["G", "D", "A", "E", "B", "F#"] as const) {
      expect(keyPrefersFlats(root, "ionian")).toBe(false);
    }
  });

  it("uses flats for flat-side major keys", () => {
    // F (1b), Bb→A# (2b), Eb→D# (3b), Ab→G# (4b), Db→C# (5b)
    for (const root of ["F", "A#", "D#", "G#", "C#"] as const) {
      expect(keyPrefersFlats(root, "ionian")).toBe(true);
    }
  });

  it("derives the signature from the relative major for minor keys", () => {
    expect(keyPrefersFlats("D", "aeolian")).toBe(true); // D minor → F major (1b)
    expect(keyPrefersFlats("A#", "aeolian")).toBe(true); // Bb minor → Db major (5b)
    expect(keyPrefersFlats("E", "aeolian")).toBe(false); // E minor → G major (1#)
    expect(keyPrefersFlats("F#", "aeolian")).toBe(false); // F# minor → A major (3#)
    expect(keyPrefersFlats("B", "aeolian")).toBe(false); // B minor → D major (2#)
  });

  it("derives the signature from the relative major for modes", () => {
    expect(keyPrefersFlats("D", "dorian")).toBe(false); // D dorian → C major
    expect(keyPrefersFlats("G", "mixolydian")).toBe(false); // G mixo → C major
    expect(keyPrefersFlats("D", "mixolydian")).toBe(false); // D mixo → G major (1#)
    expect(keyPrefersFlats("F", "dorian")).toBe(true); // F dorian → Eb major (3b)
  });
});

describe("makeSpeller — pitch classes", () => {
  it("spells flat keys with flats", () => {
    const f = makeSpeller("F", "ionian");
    expect(f.useFlats).toBe(true);
    expect(f.pc("A#")).toBe("Bb");
    expect(f.pc("D#")).toBe("Eb");
    expect(f.pc("G#")).toBe("Ab");
    expect(f.pc("C")).toBe("C");
    expect(f.pc("E")).toBe("E");
  });

  it("spells sharp keys with sharps", () => {
    const g = makeSpeller("G", "ionian");
    expect(g.useFlats).toBe(false);
    expect(g.pc("F#")).toBe("F#");
    expect(g.pc("A#")).toBe("A#");
  });
});

describe("makeSpeller — note names with octave", () => {
  it("re-spells sharp note names to flats, preserving octave", () => {
    const eb = makeSpeller("D#", "ionian"); // Eb major
    expect(eb.noteName("A#4")).toBe("Bb4");
    expect(eb.noteName("D#3")).toBe("Eb3");
    expect(eb.noteName("G#5")).toBe("Ab5");
    expect(eb.noteName("C4")).toBe("C4");
  });

  it("derives spelled note names directly from MIDI", () => {
    const f = makeSpeller("F", "ionian");
    expect(f.midiNote(70)).toBe("Bb4"); // 70 = A#4/Bb4
    expect(f.midiPc(70)).toBe("Bb");
    const g = makeSpeller("G", "ionian");
    expect(g.midiNote(70)).toBe("A#4");
  });
});

describe("makeSpeller — chord symbols", () => {
  it("re-spells the root but leaves the quality untouched", () => {
    const bbm = makeSpeller("A#", "aeolian"); // Bb minor
    expect(bbm.symbol("A#m7")).toBe("Bbm7");
    expect(bbm.symbol("D#maj7")).toBe("Ebmaj7");
    expect(bbm.symbol("G#7b9")).toBe("Ab7b9"); // the b9 alteration is preserved
  });

  it("re-spells slash-chord bass notes too", () => {
    const f = makeSpeller("F", "ionian");
    expect(f.symbol("D#m7/A#")).toBe("Ebm7/Bb");
  });

  it("leaves symbols in sharp keys unchanged", () => {
    const g = makeSpeller("G", "ionian");
    expect(g.symbol("F#m7")).toBe("F#m7");
    expect(g.symbol("A#dim7")).toBe("A#dim7");
  });
});
