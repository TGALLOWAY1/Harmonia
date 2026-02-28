import { describe, expect, it } from "vitest";
import { generateChordCardTemplates } from "../chordCardGenerator";
import { buildSeventhFromRoot, buildTriadFromRoot, type PitchClass } from "../../theory";

type ChordMeta = {
  dataset: string;
  root: PitchClass;
  quality: "maj" | "min" | "dim" | "aug" | "maj7" | "min7" | "dom7";
  notes: PitchClass[];
  degrees: string[];
  formula: string;
  chordType: "triad" | "seventh";
  display: {
    name: string;
    symbol: string;
  };
};

describe("chordCardGenerator", () => {
  it("generates deterministic card templates", () => {
    const a = generateChordCardTemplates();
    const b = generateChordCardTemplates();
    expect(a).toEqual(b);
  });

  it("creates 168 cards with expected milestone split", () => {
    const cards = generateChordCardTemplates();
    expect(cards).toHaveLength(168);
    const triads = cards.filter((c) => c.milestoneKey === "TRIADS");
    const sevenths = cards.filter((c) => c.milestoneKey === "SEVENTH_CHORDS");
    expect(triads).toHaveLength(96);
    expect(sevenths).toHaveLength(72);
  });

  it("ensures options are valid MCQ sets with unique slugs", () => {
    const cards = generateChordCardTemplates();
    const slugs = new Set<string>();

    for (const card of cards) {
      const options = [card.optionA, card.optionB, card.optionC, card.optionD];
      expect(card.correctIndex).toBeGreaterThanOrEqual(0);
      expect(card.correctIndex).toBeLessThan(4);
      expect(new Set(options).size).toBe(4);
      expect(typeof card.slug).toBe("string");
      slugs.add(card.slug as string);
    }

    expect(slugs.size).toBe(cards.length);
  });

  it("uses theory engine as source-of-truth for the correct option", () => {
    const cards = generateChordCardTemplates();

    for (const card of cards) {
      const meta = card.meta as ChordMeta;
      const options = [card.optionA, card.optionB, card.optionC, card.optionD];
      const correct = options[card.correctIndex];

      if (card.kind === "notes_from_chord") {
        const expectedNotes =
          meta.chordType === "triad"
            ? buildTriadFromRoot(meta.root, meta.quality).pitchClasses
            : buildSeventhFromRoot(meta.root, meta.quality as "maj7" | "min7" | "dom7").pitchClasses;
        expect(correct).toBe(expectedNotes.join(" – "));
      } else if (card.kind === "chord_from_notes") {
        expect(correct).toBe(`${meta.display.name} (${meta.display.symbol})`);
      }
    }
  });

  it("stores sharps-only pitch classes in card meta", () => {
    const cards = generateChordCardTemplates();
    for (const card of cards) {
      const meta = card.meta as ChordMeta;
      expect(meta.dataset).toBe("chords_v1");
      for (const note of meta.notes) {
        expect(note.includes("b")).toBe(false);
      }
    }
  });
});
