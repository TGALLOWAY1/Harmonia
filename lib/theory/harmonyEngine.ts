export type Mode =
  | "ionian"
  | "aeolian"
  | "dorian"
  | "mixolydian"
  | "phrygian"
  // Five-note scale rather than a mode of the major scale. Its harmony is
  // built from a separate vocabulary — see lib/theory/pentatonic.ts.
  | "major_pentatonic";

export type Depth = 0 | 1 | 2;

export type Degree =
  | "I"
  | "ii"
  | "iii"
  | "IV"
  | "V"
  | "vi"
  | "vii°"
  | "i"
  | "ii°"
  | "III"
  | "iv"
  | "v"
  | "bVI"
  | "bVII";

export type ChordQuality =
  | ""
  | "m"
  | "dim"
  | "maj7"
  | "m7"
  | "7"
  | "sus2"
  | "sus4"
  | "add9"
  | "m(add9)"
  | "maj(add9)";

export type GeneratedChord = {
  degree: Degree;
  quality: ChordQuality;
};

const MODE_TONICS: Record<Mode, Degree> = {
  ionian: "I",
  aeolian: "i",
  dorian: "i",
  mixolydian: "I",
  phrygian: "i",
  major_pentatonic: "I",
};

const ROMAN_NUMERALS_MAJOR: Degree[] = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const ROMAN_NUMERALS_MINOR: Degree[] = ["i", "ii°", "III", "iv", "v", "bVI", "bVII"];

type DegreeFlavor = "major" | "minor" | "diminished";

const QUALITY_BY_FLAVOR: Record<DegreeFlavor, Record<Depth, ChordQuality>> = {
  major: {
    0: "",
    1: "maj7",
    2: "maj(add9)",
  },
  minor: {
    0: "m",
    1: "m7",
    2: "m(add9)",
  },
  diminished: {
    0: "dim",
    1: "dim",
    2: "dim",
  },
};

export function generateProgression(params: {
  rootKey: string;
  mode: Mode;
  depth: Depth;
  numChords: number;
}): GeneratedChord[] {
  const { mode, depth, numChords } = params;

  if (numChords <= 0) {
    return [];
  }

  if (mode === "major_pentatonic") {
    return generatePentatonicProgression(numChords);
  }

  const isMinorKey = mode !== "ionian";
  const scaleNumerals = isMinorKey ? ROMAN_NUMERALS_MINOR : ROMAN_NUMERALS_MAJOR;
  const tonic = getTonicForMode(mode);

  const chords: GeneratedChord[] = [];

  // Start with the tonic almost always for coherence
  chords.push({
    degree: tonic,
    quality: pickQuality(tonic, depth)
  });

  // Pick random diatonic degrees for the rest
  for (let i = 1; i < numChords; i++) {
    const randomDegreeIndex = Math.floor(Math.random() * 7);
    const degree = scaleNumerals[randomDegreeIndex];

    chords.push({
      degree,
      quality: pickQuality(degree, depth)
    });
  }

  return chords;
}

/**
 * Major pentatonic has no 4th or 7th degree, so the usual triads on ii, iii, IV
 * and V don't exist. Only four degrees can carry a chord, and two of them are
 * necessarily sus chords. See lib/theory/pentatonic.ts for the derivation.
 */
const PENTATONIC_CHORDS: GeneratedChord[] = [
  { degree: "I", quality: "" },       // major triad
  { degree: "ii", quality: "sus4" },  // no 3rd available
  { degree: "V", quality: "sus4" },   // no 3rd available
  { degree: "vi", quality: "m" },     // minor triad
];

function generatePentatonicProgression(numChords: number): GeneratedChord[] {
  // Open on the tonic, then draw from the scale-safe chords.
  const chords: GeneratedChord[] = [PENTATONIC_CHORDS[0]];
  for (let i = 1; i < numChords; i++) {
    const pick = Math.floor(Math.random() * PENTATONIC_CHORDS.length);
    chords.push(PENTATONIC_CHORDS[pick]);
  }
  return chords;
}

function getTonicForMode(mode: Mode): Degree {
  return MODE_TONICS[mode] ?? "I";
}

function pickQuality(
  degree: Degree,
  depth: Depth
): ChordQuality {
  const flavor = getDegreeFlavor(degree);
  return QUALITY_BY_FLAVOR[flavor][depth] ?? QUALITY_BY_FLAVOR[flavor][0];
}

function getDegreeFlavor(degree: Degree): DegreeFlavor {
  if (degree.includes("°")) return "diminished";
  const stripped = degree.replace(/^b/, "");
  return stripped === stripped.toUpperCase() ? "major" : "minor";
}

