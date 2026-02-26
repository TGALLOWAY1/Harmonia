export type Mode =
  | "ionian"
  | "aeolian"
  | "dorian"
  | "mixolydian"
  | "phrygian";

export type Mood =
  | "melancholic"
  | "moody"
  | "dark"
  | "bright"
  | "happy"
  | "optimistic";

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
  | "bVII"
  | "bII"
  | "bIII"
  | "II";

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

export type MoodProfile = {
  id: Mood;
  description: string;
  defaultMode: Mode;
  depthMapping: Record<Depth, ChordQuality[]>;
  transitions: Record<Degree, Record<Degree, number>>;
};

export type GeneratedChord = {
  degree: Degree;
  quality: ChordQuality;
};

const ALL_DEGREES: Degree[] = [
  "I",
  "ii",
  "iii",
  "IV",
  "V",
  "vi",
  "vii°",
  "i",
  "ii°",
  "III",
  "iv",
  "v",
  "bVI",
  "bVII",
  "bII",
  "bIII",
  "II",
];

const DEPTH_MAPPING: Record<Depth, ChordQuality[]> = {
  0: ["", "m", "dim"],
  1: ["maj7", "m7", "7"],
  2: ["sus2", "sus4", "add9", "m(add9)", "maj(add9)"],
};

const MODE_TONICS: Record<Mode, Degree> = {
  ionian: "I",
  aeolian: "i",
  dorian: "i",
  mixolydian: "I",
  phrygian: "i",
};

const MOOD_PROFILES: Record<Mood, MoodProfile> = {
  melancholic: {
    id: "melancholic",
    description: "Minor tonic focus with wistful cadences",
    defaultMode: "aeolian",
    depthMapping: DEPTH_MAPPING,
    transitions: buildTransitions({
      i: { i: 0.25, iv: 0.25, bVI: 0.3, v: 0.2 },
      iv: { i: 0.4, bVI: 0.25, v: 0.2, iv: 0.15 },
      bVI: { iv: 0.35, v: 0.25, i: 0.4 },
      v: { i: 0.65, bVI: 0.15, iv: 0.2 },
    }),
  },
  dark: {
    id: "dark",
    description: "Tense modal mixture with chromatic pull",
    defaultMode: "phrygian",
    depthMapping: DEPTH_MAPPING,
    transitions: buildTransitions({
      i: { i: 0.3, bII: 0.25, bVI: 0.25, v: 0.2 },
      bII: { i: 0.5, bVI: 0.2, v: 0.3 },
      bVI: { i: 0.45, v: 0.3, bII: 0.25 },
      v: { i: 0.6, bII: 0.25, bVI: 0.15 },
    }),
  },
  moody: {
    id: "moody",
    description: "Hybrid major/minor tension with modal shifts",
    defaultMode: "dorian",
    depthMapping: DEPTH_MAPPING,
    transitions: buildTransitions({
      i: { i: 0.3, IV: 0.25, v: 0.25, bVII: 0.2 },
      IV: { i: 0.45, v: 0.2, bVII: 0.2, IV: 0.15 },
      v: { i: 0.55, bVII: 0.25, IV: 0.2 },
      bVII: { i: 0.4, IV: 0.3, v: 0.3 },
    }),
  },
  bright: {
    id: "bright",
    description: "Open, jangly progressions with dominant motion",
    defaultMode: "mixolydian",
    depthMapping: DEPTH_MAPPING,
    transitions: buildTransitions({
      I: { I: 0.25, IV: 0.3, V: 0.3, bVII: 0.15 },
      IV: { I: 0.4, V: 0.35, bVII: 0.15, IV: 0.1 },
      V: { I: 0.55, IV: 0.25, bVII: 0.2 },
      bVII: { I: 0.35, IV: 0.35, V: 0.3 },
    }),
  },
  happy: {
    id: "happy",
    description: "Classic diatonic pop cadences",
    defaultMode: "ionian",
    depthMapping: DEPTH_MAPPING,
    transitions: buildTransitions({
      I: { I: 0.2, ii: 0.2, IV: 0.3, V: 0.2, vi: 0.1 },
      ii: { V: 0.45, IV: 0.25, I: 0.3 },
      IV: { I: 0.4, V: 0.35, vi: 0.25 },
      V: { I: 0.65, vi: 0.2, IV: 0.15 },
      vi: { ii: 0.25, IV: 0.35, V: 0.3, I: 0.1 },
    }),
  },
  optimistic: {
    id: "optimistic",
    description: "Forward-driving major progressions",
    defaultMode: "ionian",
    depthMapping: DEPTH_MAPPING,
    transitions: buildTransitions({
      I: { I: 0.2, II: 0.25, IV: 0.25, vi: 0.3 },
      II: { V: 0.5, IV: 0.3, I: 0.2 },
      IV: { I: 0.45, II: 0.2, vi: 0.35 },
      vi: { II: 0.3, IV: 0.3, I: 0.4 },
    }),
  },
};

Object.values(MOOD_PROFILES).forEach(validateTransitions);

export function getMoodProfile(mood: Mood): MoodProfile {
  const profile = MOOD_PROFILES[mood];
  if (!profile) {
    throw new Error(`Unknown mood profile: ${mood}`);
  }
  return profile;
}

export function sampleNextDegree(
  current: Degree,
  profile: MoodProfile,
  options?: { temperature?: number }
): Degree {
  const row = profile.transitions[current];
  const fallbackDegree =
    row && hasPositiveTransitions(row)
      ? current
      : MODE_TONICS[profile.defaultMode] ??
        (Object.keys(profile.transitions)[0] as Degree | undefined);

  const distribution = row
    ? (Object.entries(row).filter(([, probability]) => probability > 0) as [
        Degree,
        number
      ][])
    : [];

  if (distribution.length === 0) {
    return fallbackDegree ?? current;
  }

  const rand = Math.random(); // TODO: incorporate temperature to skew distribution
  let cumulative = 0;
  for (const [degree, probability] of distribution) {
    cumulative += probability;
    if (rand <= cumulative) {
      return degree;
    }
  }

  return distribution[distribution.length - 1][0];
}

function validateTransitions(profile: MoodProfile): void {
  Object.entries(profile.transitions).forEach(([degree, transitions]) => {
    const sum = Object.values(transitions).reduce((acc, value) => acc + value, 0);
    if (sum === 0) {
      return;
    }
    if (Math.abs(sum - 1) > 0.001) {
      console.warn(`[harmonyEngine] Transition probabilities for ${profile.id} (${degree}) sum to ${sum.toFixed(3)}`);
    }
  });
}

function hasPositiveTransitions(row: Record<Degree, number>): boolean {
  return Object.values(row).some((value) => value > 0);
}

function buildTransitions(
  rows: Partial<Record<Degree, Partial<Record<Degree, number>>>>
): Record<Degree, Record<Degree, number>> {
  const transitions = {} as Record<Degree, Record<Degree, number>>;
  ALL_DEGREES.forEach((degree) => {
    transitions[degree] = buildRow(rows[degree] ?? {});
  });
  return transitions;
}

function buildRow(row: Partial<Record<Degree, number>>): Record<Degree, number> {
  const fullRow = {} as Record<Degree, number>;
  ALL_DEGREES.forEach((degree) => {
    fullRow[degree] = row[degree] ?? 0;
  });
  return fullRow;
}

if (process.env.NODE_ENV === "development") {
  const profile = getMoodProfile("melancholic");
  let current = MODE_TONICS[profile.defaultMode];
  const counts: Partial<Record<Degree, number>> = {};

  for (let i = 0; i < 100; i++) {
    const next = sampleNextDegree(current, profile);
    counts[next] = (counts[next] || 0) + 1;
    current = next;
  }

  console.debug("[harmonyEngine] Sampled transitions:", counts);
}

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
  mood: Mood;
  depth: Depth;
  numChords: number;
}): GeneratedChord[] {
  const { mode, mood, depth, numChords } = params;

  if (numChords <= 0) {
    return [];
  }

  const profile = getMoodProfile(mood);
  const applicableDepth =
    profile.depthMapping[depth]?.length && profile.depthMapping[depth]!.length > 0
      ? depth
      : 0;

  const tonic = getTonicForMode(mode);
  const chords: GeneratedChord[] = [];
  let currentDegree = tonic;

  for (let i = 0; i < numChords; i++) {
    if (i > 0) {
      currentDegree = sampleNextDegree(currentDegree, profile);
    }

    const quality = pickQuality(currentDegree, applicableDepth, profile);
    chords.push({ degree: currentDegree, quality });
  }

  return chords;
}

function getTonicForMode(mode: Mode): Degree {
  return MODE_TONICS[mode] ?? "I";
}

function pickQuality(
  degree: Degree,
  depth: Depth,
  profile: MoodProfile
): ChordQuality {
  const flavor = getDegreeFlavor(degree);
  const preferred = QUALITY_BY_FLAVOR[flavor][depth];
  const fallbackPool = profile.depthMapping[depth] ?? DEPTH_MAPPING[0];
  return fallbackPool.includes(preferred)
    ? preferred
    : fallbackPool[0] ?? QUALITY_BY_FLAVOR[flavor][0];
}

function getDegreeFlavor(degree: Degree): DegreeFlavor {
  if (degree.includes("°")) return "diminished";
  const stripped = degree.replace(/^b/, "");
  return stripped === stripped.toUpperCase() ? "major" : "minor";
}

