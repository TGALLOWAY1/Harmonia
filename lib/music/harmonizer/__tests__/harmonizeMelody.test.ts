import { describe, it, expect } from "vitest";
import {
  harmonizeMelody,
  buildDiatonicCandidates,
  splitMelodyIntoRegions,
  noteImportanceWeight,
  scoreChordForRegion,
  isScalePitchClass,
  snapMidiToScale,
} from "../harmonizeMelody";
import { getScalePitchClasses } from "@/lib/state/progressionStore";
import { getScaleDefinition } from "@/lib/theory/scale";
import { makeSpeller } from "@/lib/theory/spelling";
import {
  pitchClassToMidi,
  midiToNoteName,
  midiToPitchClass,
  type PitchClass,
} from "@/lib/theory/midiUtils";
import type { MelodyNote } from "@/lib/music/generators/melody/types";

// D natural-minor scale pitch classes (sharp-canonical: A# == Bb).
const D_MINOR_PCS = getScaleDefinition("D", "natural_minor").pitchClasses;

/** Build a melody note for tests. octave-aware via pitch class + octave. */
function note(
  pc: PitchClass,
  octave: number,
  startBeat: number,
  durationBeats: number
): MelodyNote {
  const midi = pitchClassToMidi(pc, octave);
  return {
    id: `${pc}${octave}-${startBeat}`,
    midi,
    noteWithOctave: midiToNoteName(midi),
    pitchClass: pc,
    durationBeats,
    startBeat,
    chordIndex: 0,
    isChordTone: false,
    source: "drawn",
  };
}

describe("scale note detection", () => {
  it("recognises the D natural-minor pitch classes", () => {
    // D E F G A Bb(=A#) C
    expect(D_MINOR_PCS).toEqual(["D", "E", "F", "G", "A", "A#", "C"]);
    for (const pc of ["D", "E", "F", "G", "A", "A#", "C"] as PitchClass[]) {
      expect(isScalePitchClass(pc, D_MINOR_PCS)).toBe(true);
    }
  });

  it("rejects out-of-scale pitch classes", () => {
    for (const pc of ["C#", "D#", "F#", "G#", "B"] as PitchClass[]) {
      expect(isScalePitchClass(pc, D_MINOR_PCS)).toBe(false);
    }
  });

  it("exposes the same scale via the store helper (aeolian → natural minor)", () => {
    expect(getScalePitchClasses("D", "aeolian")).toEqual(D_MINOR_PCS);
  });
});

describe("scale snapping", () => {
  it("leaves in-scale notes untouched", () => {
    const dMidi = pitchClassToMidi("D", 4);
    expect(snapMidiToScale(dMidi, D_MINOR_PCS)).toBe(dMidi);
  });

  it("snaps an out-of-scale note to the nearest scale tone", () => {
    // F# (out of D minor) should snap to F or G (one semitone away).
    const fSharp = pitchClassToMidi("F#", 4);
    const snapped = snapMidiToScale(fSharp, D_MINOR_PCS);
    expect(isScalePitchClass(midiToPitchClass(snapped), D_MINOR_PCS)).toBe(true);
    expect(Math.abs(snapped - fSharp)).toBe(1);
  });

  it("snaps C# down to C (ties prefer the lower pitch)", () => {
    const cSharp = pitchClassToMidi("C#", 4);
    expect(midiToPitchClass(snapMidiToScale(cSharp, D_MINOR_PCS))).toBe("C");
  });
});

describe("diatonic chord generation (D minor)", () => {
  const candidates = buildDiatonicCandidates("D", "natural_minor");

  it("produces the seven expected D-minor triads", () => {
    const byRoot = candidates.map((c) => ({ root: c.root, quality: c.quality }));
    expect(byRoot).toEqual([
      { root: "D", quality: "min" }, // i   Dm
      { root: "E", quality: "dim" }, // ii° Edim
      { root: "F", quality: "maj" }, // III F
      { root: "G", quality: "min" }, // iv  Gm
      { root: "A", quality: "min" }, // v   Am
      { root: "A#", quality: "maj" }, // VI  Bb (A# sharp-canonical)
      { root: "C", quality: "maj" }, // VII C
    ]);
  });

  it("assigns correct roman numerals", () => {
    expect(candidates.map((c) => c.romanNumeral)).toEqual([
      "i",
      "ii°",
      "III",
      "iv",
      "v",
      "VI",
      "VII",
    ]);
  });

  it("spells VI as Bb in D minor via the speller", () => {
    const speller = makeSpeller("D", "aeolian");
    expect(speller.symbol(candidates[5].symbol)).toBe("Bb");
  });

  it("adds seventh chords when requested", () => {
    const withSevenths = buildDiatonicCandidates("D", "natural_minor", true);
    expect(withSevenths).toHaveLength(14);
    expect(withSevenths.some((c) => c.isSeventh && c.root === "D")).toBe(true);
  });
});

describe("melody-region splitting", () => {
  it("splits a 4-bar melody into 4 regions of 4 beats", () => {
    const melody = [
      note("D", 4, 0, 1),
      note("F", 4, 4, 1),
      note("A", 4, 8, 1),
      note("D", 5, 12, 1),
    ];
    const regions = splitMelodyIntoRegions(melody, 4);
    expect(regions).toHaveLength(4);
    expect(regions.map((r) => r.melodyNotes.length)).toEqual([1, 1, 1, 1]);
    expect(regions[1].startBeat).toBe(4);
    expect(regions[1].endBeat).toBe(8);
  });

  it("always yields at least one region for an empty melody", () => {
    expect(splitMelodyIntoRegions([], 4)).toHaveLength(1);
  });

  it("groups multiple notes within the same bar", () => {
    const melody = [note("D", 4, 0, 1), note("F", 4, 1, 1), note("A", 4, 2, 2)];
    const regions = splitMelodyIntoRegions(melody, 4);
    expect(regions).toHaveLength(1);
    expect(regions[0].melodyNotes).toHaveLength(3);
  });
});

describe("note importance weighting", () => {
  it("weights a long downbeat note above a short off-beat note", () => {
    const downbeatLong = noteImportanceWeight(note("D", 4, 0, 2), 0, 4);
    const offbeatShort = noteImportanceWeight(note("E", 4, 0.5, 0.25), 0, 4);
    expect(downbeatLong).toBeGreaterThan(offbeatShort);
  });

  it("adds a phrase-end bonus", () => {
    const base = noteImportanceWeight(note("A", 4, 2, 1), 0, 4);
    const withEnd = noteImportanceWeight(note("A", 4, 2, 1), 0, 4, { isPhraseEnd: true });
    expect(withEnd).toBeGreaterThan(base);
  });
});

describe("chord scoring", () => {
  it("scores the chord containing the strong-beat melody note highest", () => {
    // A bar emphasising D, F, A — Dm should beat the C (VII) chord.
    const region = [note("D", 4, 0, 1), note("F", 4, 1, 1), note("A", 4, 2, 2)];
    const weighted = region.map((n) => ({
      note: n,
      weight: noteImportanceWeight(n, 0, 4),
      onBeat: true,
      isLong: n.durationBeats >= 1,
    }));
    const candidates = buildDiatonicCandidates("D", "natural_minor");
    const dm = candidates[0];
    const c = candidates[6];
    expect(scoreChordForRegion(dm, weighted)).toBeGreaterThan(
      scoreChordForRegion(c, weighted)
    );
  });

  it("penalises a chord that clashes with strong melody notes", () => {
    const region = [note("E", 4, 0, 2)]; // E on a strong, long beat
    const weighted = region.map((n) => ({
      note: n,
      weight: noteImportanceWeight(n, 0, 4),
      onBeat: true,
      isLong: true,
    }));
    const candidates = buildDiatonicCandidates("D", "natural_minor");
    const f = candidates[2]; // F major (F A C) — E clashes a semitone with F
    const am = candidates[4]; // A minor (A C E) — contains E
    expect(scoreChordForRegion(am, weighted)).toBeGreaterThan(
      scoreChordForRegion(f, weighted)
    );
  });
});

describe("progression generation (D minor)", () => {
  // A 4-bar melody where each bar unambiguously outlines one diatonic triad:
  //   bar 1: D F A      → Dm  (i)
  //   bar 2: Bb D F     → Bb  (VI)
  //   bar 3: C E G      → C   (VII)
  //   bar 4: D F A      → Dm  (i)
  const melody: MelodyNote[] = [
    note("D", 4, 0, 1),
    note("F", 4, 1, 1),
    note("A", 4, 2, 2),
    note("A#", 4, 4, 2),
    note("D", 5, 6, 1),
    note("F", 5, 7, 1),
    note("C", 5, 8, 2),
    note("E", 5, 10, 1),
    note("G", 5, 11, 1),
    note("D", 5, 12, 2),
    note("F", 5, 14, 1),
    note("A", 5, 15, 1),
  ];

  it("produces a reasonable diatonic progression (Dm – Bb – C – Dm)", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
    });
    expect(result.chords).toHaveLength(4);
    expect(result.chords.map((c) => c.root)).toEqual(["D", "A#", "C", "D"]);
    expect(result.chords.map((c) => c.quality)).toEqual(["min", "maj", "maj", "min"]);
  });

  it("spells the progression for the key when a speller is supplied", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
      speller: makeSpeller("D", "aeolian"),
    });
    expect(result.chords.map((c) => c.symbol)).toEqual(["Dm", "Bb", "C", "Dm"]);
  });

  it("keeps every generated chord diatonic to the key", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
    });
    for (const chord of result.chords) {
      for (const pc of chord.notes) {
        expect(isScalePitchClass(pc as PitchClass, D_MINOR_PCS)).toBe(true);
      }
    }
  });

  it("voices each chord with playable midi notes and a full-bar duration", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
    });
    for (const chord of result.chords) {
      expect(chord.midiNotes && chord.midiNotes.length).toBeGreaterThanOrEqual(3);
      expect(chord.notesWithOctave && chord.notesWithOctave.length).toBe(
        chord.midiNotes!.length
      );
      // Ascending close voicing.
      const m = chord.midiNotes!;
      for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThan(m[i - 1]);
      expect(chord.durationClass).toBe("full");
    }
  });

  it("produces an explanation per chord that names the chord", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
      speller: makeSpeller("D", "aeolian"),
    });
    expect(result.explanations).toHaveLength(4);
    expect(result.explanations[0]).toContain("Dm");
    expect(result.explanations[0].toLowerCase()).toContain("emphasizes");
  });

  it("is deterministic — same input yields the same output", () => {
    const opts = { melodyNotes: melody, root: "D" as PitchClass, scaleType: "natural_minor" as const };
    const a = harmonizeMelody(opts);
    const b = harmonizeMelody(opts);
    expect(a.chords.map((c) => c.symbol)).toEqual(b.chords.map((c) => c.symbol));
  });

  it("opens and closes on the tonic for resolution", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
    });
    expect(result.chords[0].root).toBe("D");
    expect(result.chords[result.chords.length - 1].root).toBe("D");
  });
});

describe("harmonization styles", () => {
  const melody: MelodyNote[] = [
    note("D", 4, 0, 2),
    note("F", 4, 2, 2),
    note("A", 4, 4, 2),
    note("C", 5, 6, 2),
  ];

  it("supports all five styles and always returns diatonic chords", () => {
    for (const style of ["bestFit", "darker", "brighter", "tense", "simple"] as const) {
      const result = harmonizeMelody({
        melodyNotes: melody,
        root: "D",
        scaleType: "natural_minor",
        style,
      });
      expect(result.style).toBe(style);
      expect(result.chords.length).toBeGreaterThan(0);
      for (const chord of result.chords) {
        for (const pc of chord.notes) {
          expect(isScalePitchClass(pc as PitchClass, D_MINOR_PCS)).toBe(true);
        }
      }
    }
  });

  it("'simple' avoids seventh chords even when sevenths are allowed", () => {
    const result = harmonizeMelody({
      melodyNotes: melody,
      root: "D",
      scaleType: "natural_minor",
      includeSevenths: true,
      style: "simple",
    });
    expect(result.regions.every((r) => !r.candidate.isSeventh)).toBe(true);
  });
});
