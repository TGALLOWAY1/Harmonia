import type { Prisma } from "@prisma/client";
import {
  buildTriadFromRoot,
  buildSeventhFromRoot,
  formatChordSymbol,
  type PitchClass,
} from "../theory";
import { PITCH_CLASSES } from "../theory/midiUtils";

type TriadQuality = "maj" | "min" | "dim" | "aug";
type SeventhQuality = "maj7" | "min7" | "dom7";
type ChordQuality = TriadQuality | SeventhQuality;

type FormulaConfig = {
  degrees: string[];
  formula: string;
  nameSuffix: string;
  chordType: "triad" | "seventh";
};

const TRIAD_QUALITIES: TriadQuality[] = ["maj", "min", "dim", "aug"];
const SEVENTH_QUALITIES: SeventhQuality[] = ["maj7", "min7", "dom7"];
const ROOTS: PitchClass[] = [...PITCH_CLASSES];

const FORMULAS: Record<ChordQuality, FormulaConfig> = {
  maj: {
    degrees: ["1", "3", "5"],
    formula: "1 - 3 - 5",
    nameSuffix: "Major",
    chordType: "triad",
  },
  min: {
    degrees: ["1", "b3", "5"],
    formula: "1 - b3 - 5",
    nameSuffix: "Minor",
    chordType: "triad",
  },
  dim: {
    degrees: ["1", "b3", "b5"],
    formula: "1 - b3 - b5",
    nameSuffix: "Diminished",
    chordType: "triad",
  },
  aug: {
    degrees: ["1", "3", "#5"],
    formula: "1 - 3 - #5",
    nameSuffix: "Augmented",
    chordType: "triad",
  },
  maj7: {
    degrees: ["1", "3", "5", "7"],
    formula: "1 - 3 - 5 - 7",
    nameSuffix: "Major 7th",
    chordType: "seventh",
  },
  min7: {
    degrees: ["1", "b3", "5", "b7"],
    formula: "1 - b3 - 5 - b7",
    nameSuffix: "Minor 7th",
    chordType: "seventh",
  },
  dom7: {
    degrees: ["1", "3", "5", "b7"],
    formula: "1 - 3 - 5 - b7",
    nameSuffix: "Dominant 7th",
    chordType: "seventh",
  },
};

const FLAT_ENHARMONIC: Partial<Record<PitchClass, string>> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
};

function getSemitoneUp(root: PitchClass, semitones: number): PitchClass {
  const start = ROOTS.indexOf(root);
  return ROOTS[(start + semitones + ROOTS.length) % ROOTS.length];
}

function buildNotes(root: PitchClass, quality: ChordQuality): PitchClass[] {
  if (FORMULAS[quality].chordType === "triad") {
    return buildTriadFromRoot(root, quality).pitchClasses;
  }
  return buildSeventhFromRoot(root, quality as SeventhQuality).pitchClasses;
}

function rootSlug(root: PitchClass): string {
  return root.toLowerCase().replace("#", "-sharp");
}

function noteString(notes: PitchClass[]): string {
  return notes.join(" – ");
}

function chordName(root: PitchClass, quality: ChordQuality): string {
  return `${root} ${FORMULAS[quality].nameSuffix}`;
}

function chordLabel(root: PitchClass, quality: ChordQuality): string {
  const name = chordName(root, quality);
  const symbol = formatChordSymbol(root, quality);
  return `${name} (${symbol})`;
}

function uniqueOptions(correct: string, distractors: string[], fallbackPool: string[]): string[] {
  const options: string[] = [correct];
  for (const candidate of distractors) {
    if (!options.includes(candidate)) {
      options.push(candidate);
    }
    if (options.length === 4) break;
  }
  if (options.length < 4) {
    for (const candidate of fallbackPool) {
      if (!options.includes(candidate)) {
        options.push(candidate);
      }
      if (options.length === 4) break;
    }
  }
  return options.slice(0, 4);
}

function mutateOneNote(notes: PitchClass[]): PitchClass[] {
  const targetIndex = notes.length === 4 ? 3 : 1;
  const firstAttempt = [...notes];
  firstAttempt[targetIndex] = getSemitoneUp(notes[targetIndex], 1);
  if (new Set(firstAttempt).size === firstAttempt.length) return firstAttempt;

  const secondAttempt = [...notes];
  secondAttempt[targetIndex] = getSemitoneUp(notes[targetIndex], -1);
  return secondAttempt;
}

function qualityFallbacks(quality: ChordQuality): ChordQuality[] {
  const pool = FORMULAS[quality].chordType === "triad" ? TRIAD_QUALITIES : SEVENTH_QUALITIES;
  return pool.filter((q) => q !== quality);
}

function displayLabelWithFlatEnharmonic(root: PitchClass, quality: ChordQuality): string | null {
  const flatRoot = FLAT_ENHARMONIC[root];
  if (!flatRoot) return null;
  const suffix = FORMULAS[quality].nameSuffix;
  const name = `${flatRoot} ${suffix}`;
  const symbol = formatChordSymbol(root, quality)
    .replace(root, flatRoot)
    .replace("C#m", "Dbm")
    .replace("D#m", "Ebm")
    .replace("F#m", "Gbm")
    .replace("G#m", "Abm")
    .replace("A#m", "Bbm");
  return `${name} (${symbol})`;
}

function makeMeta(root: PitchClass, quality: ChordQuality, notes: PitchClass[]): Prisma.InputJsonValue {
  const formula = FORMULAS[quality];
  return {
    dataset: "chords_v1",
    root,
    quality,
    notes,
    degrees: formula.degrees,
    formula: formula.formula,
    chordType: formula.chordType,
    display: {
      name: chordName(root, quality),
      symbol: formatChordSymbol(root, quality),
    },
  } as Prisma.InputJsonValue;
}

function generateTypeA(root: PitchClass, quality: ChordQuality): Prisma.CardTemplateCreateInput {
  const notes = buildNotes(root, quality);
  const fallbackNotePool = ROOTS.flatMap((candidateRoot) =>
    qualityFallbacks(quality).map((candidateQuality) => noteString(buildNotes(candidateRoot, candidateQuality)))
  );

  const sameRootDifferentQuality = noteString(buildNotes(root, qualityFallbacks(quality)[0]));
  const semitoneUpSameQuality = noteString(buildNotes(getSemitoneUp(root, 1), quality));
  const oneNoteWrong = noteString(mutateOneNote(notes));
  const options = uniqueOptions(noteString(notes), [sameRootDifferentQuality, semitoneUpSameQuality, oneNoteWrong], fallbackNotePool);

  return {
    slug: `chords-v1-typeA-${rootSlug(root)}-${quality}`,
    kind: "notes_from_chord",
    question: `What are the notes in ${chordLabel(root, quality)}?`,
    optionA: options[0],
    optionB: options[1],
    optionC: options[2],
    optionD: options[3],
    correctIndex: 0,
    milestoneKey: FORMULAS[quality].chordType === "triad" ? "TRIADS" : "SEVENTH_CHORDS",
    meta: makeMeta(root, quality, notes),
  };
}

function generateTypeB(root: PitchClass, quality: ChordQuality): Prisma.CardTemplateCreateInput {
  const notes = buildNotes(root, quality);
  const sameRootDifferentQuality = chordLabel(root, qualityFallbacks(quality)[0]);
  const twoSemitonesQualityMatch = chordLabel(getSemitoneUp(root, 2), quality);
  const enharmonicTrap =
    displayLabelWithFlatEnharmonic(root, quality) ??
    chordLabel(getSemitoneUp(root, -2), qualityFallbacks(quality)[1] ?? qualityFallbacks(quality)[0]);

  const fallbackChordPool = ROOTS.flatMap((candidateRoot) =>
    qualityFallbacks(quality).map((candidateQuality) => chordLabel(candidateRoot, candidateQuality))
  );
  const correct = chordLabel(root, quality);
  const options = uniqueOptions(correct, [sameRootDifferentQuality, twoSemitonesQualityMatch, enharmonicTrap], fallbackChordPool);

  return {
    slug: `chords-v1-typeB-${rootSlug(root)}-${quality}`,
    kind: "chord_from_notes",
    question: `Which chord matches these notes: ${noteString(notes)}?`,
    optionA: options[0],
    optionB: options[1],
    optionC: options[2],
    optionD: options[3],
    correctIndex: 0,
    milestoneKey: FORMULAS[quality].chordType === "triad" ? "TRIADS" : "SEVENTH_CHORDS",
    meta: makeMeta(root, quality, notes),
  };
}

export function generateChordCardTemplates(): Prisma.CardTemplateCreateInput[] {
  const templates: Prisma.CardTemplateCreateInput[] = [];

  for (const root of ROOTS) {
    for (const quality of TRIAD_QUALITIES) {
      templates.push(generateTypeA(root, quality));
      templates.push(generateTypeB(root, quality));
    }
  }

  for (const root of ROOTS) {
    for (const quality of SEVENTH_QUALITIES) {
      templates.push(generateTypeA(root, quality));
      templates.push(generateTypeB(root, quality));
    }
  }

  return templates;
}
