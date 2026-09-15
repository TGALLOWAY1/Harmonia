import { formatChordSymbol, type SeventhQuality, type TriadQuality } from "@/lib/theory/chord";
import type { Mode } from "@/lib/theory/harmonyEngine";
import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";

import type { ChordMood } from "./chordMoods";
import type {
  AdvancedComplexity,
  BrightnessCurve,
  HarmonicFunction,
  PlannedAdvancedChord,
} from "./types";

/**
 * Modal interchange keyed to brightness.
 *
 * Borrowed harmony — iv in major, bVI, bVII, the Neapolitan bII, the lydian
 * II — is most of the emotional vocabulary of film and pop harmony, and none
 * of it was reachable by automatic generation. The catalogue below is derived
 * rather than typed: every chord diatonic to a parallel mode but foreign to
 * the home mode is a candidate, tagged with the brightness of the nearest
 * mode that contains it. Selection then runs against a brightness curve, so
 * a darkening phrase reaches for aeolian and phrygian chords and a sunrise
 * for mixolydian and lydian ones.
 *
 * Brightness order (Lehman, *Hollywood Harmony*): lydian +3 > ionian +2 >
 * mixolydian +1 > dorian 0 > aeolian −1 > phrygian −2. Locrian is omitted as
 * a source: its chords are not idiomatic borrowings.
 */

export type ParallelMode = "lydian" | "ionian" | "mixolydian" | "dorian" | "aeolian" | "phrygian";

export const MODE_BRIGHTNESS: Record<ParallelMode, number> = {
  lydian: 3,
  ionian: 2,
  mixolydian: 1,
  dorian: 0,
  aeolian: -1,
  phrygian: -2,
};

/** Semitone offsets of each degree from the tonic. */
const MODE_STEPS: Record<ParallelMode, number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

const PARALLEL_MODES: ParallelMode[] = ["lydian", "ionian", "mixolydian", "dorian", "aeolian", "phrygian"];

/** The parallel-mode family a generator mode belongs to; pentatonic has none. */
export function parallelModeOf(mode: Mode): ParallelMode | null {
  return mode === "major_pentatonic" ? null : mode;
}

/** Brightness of a generator mode on the −3..3 scale. */
export function homeBrightness(mode: Mode): number {
  const parallel = parallelModeOf(mode);
  return parallel ? MODE_BRIGHTNESS[parallel] : MODE_BRIGHTNESS.ionian;
}

type ModeTriad = { degree: number; offset: number; quality: TriadQuality };

function modeTriads(mode: ParallelMode): ModeTriad[] {
  const steps = MODE_STEPS[mode];
  return steps.map((offset, degree) => {
    const third = (steps[(degree + 2) % 7] - offset + 12) % 12;
    const fifth = (steps[(degree + 4) % 7] - offset + 12) % 12;
    const quality: TriadQuality =
      third === 4 ? (fifth === 8 ? "aug" : "maj") : fifth === 6 ? "dim" : "min";
    return { degree, offset, quality };
  });
}

// ---------------------------------------------------------------------------
// Roman-numeral labelling for chords that need not be diatonic
// ---------------------------------------------------------------------------

const OFFSET_NUMERALS = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];

/**
 * Label a chord by its root's distance from the tonic, on the same
 * major-reference convention `romanNumeralsForScale` uses (aeolian's sixth
 * degree reads "bVI"). Six semitones reads "#iv°" for a diminished chord — the
 * lydian chord — and "bV" otherwise.
 */
export function romanForOffset(offset: number, quality: TriadQuality): string {
  const normalized = ((offset % 12) + 12) % 12;
  let numeral = OFFSET_NUMERALS[normalized];
  if (normalized === 6 && quality === "dim") numeral = "#IV";
  switch (quality) {
    case "maj":
      return numeral;
    case "aug":
      return `${numeral}+`;
    case "dim":
      return `${numeral.toLowerCase()}°`;
    default:
      return numeral.toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

type BorrowRule = {
  function: HarmonicFunction;
  affect: string;
  /** Quality used from complexity 2 upward. */
  seventh: SeventhQuality | null;
  /** Only meaningful as the final chord (the Picardy third). */
  finalOnly?: boolean;
};

/**
 * Which foreign triads are idiomatic borrowings, keyed `${semitones}:${quality}`.
 * Anything not listed here is skipped even if some parallel mode contains it.
 */
const BORROWABLE: Record<string, BorrowRule> = {
  "0:min": { function: "tonic", affect: "shadowed tonic", seventh: "min7" },
  "0:maj": { function: "tonic", affect: "Picardy third — closes in the light", seventh: "maj7", finalOnly: true },
  "1:maj": { function: "predominant", affect: "darkest; a strong half-step descent (Neapolitan)", seventh: "maj7" },
  "2:maj": { function: "predominant", affect: "lift, sparkle (lydian II)", seventh: "maj7" },
  "2:min": { function: "predominant", affect: "hopeful pre-dominant", seventh: "min7" },
  "2:dim": { function: "predominant", affect: "darker pre-dominant", seventh: "half-dim7" },
  "3:maj": { function: "mediant", affect: "cinematic (bIII)", seventh: "maj7" },
  "4:min": { function: "mediant", affect: "brightened mediant", seventh: "min7" },
  "5:maj": { function: "predominant", affect: "hopeful shade of minor (dorian IV)", seventh: "dom7" },
  "5:min": { function: "predominant", affect: "bittersweet, yearning (iv in major)", seventh: "min7" },
  "6:dim": { function: "dominant", affect: "lift, sparkle (lydian #iv°)", seventh: "half-dim7" },
  "7:maj": { function: "dominant", affect: "a true leading-tone dominant", seventh: "dom7" },
  "7:min": { function: "dominant", affect: "epic, anthemic (mixolydian v)", seventh: "min7" },
  "8:maj": { function: "predominant", affect: "cinematic (bVI)", seventh: "maj7" },
  "9:min": { function: "mediant", affect: "hopeful", seventh: "min7" },
  "10:maj": { function: "dominant", affect: "epic, anthemic (bVII, double plagal)", seventh: "dom7" },
  "11:dim": { function: "dominant", affect: "operatic urgency (vii°7)", seventh: "dim7" },
};

export type BorrowedChordSpec = {
  /** `${semitones}:${quality}` — stable identity across keys. */
  key: string;
  label: string;
  /** Root offset from the tonic in semitones. */
  semitones: number;
  triadQuality: TriadQuality;
  seventhQuality: SeventhQuality | null;
  sourceMode: ParallelMode | "harmonic-minor";
  /** Source-mode brightness on the −3..3 scale. */
  brightness: number;
  /** Brightness relative to the home mode, on the −1..1 scale moods use. */
  relativeBrightness: number;
  function: HarmonicFunction;
  affect: string;
  finalOnly: boolean;
};

const clampUnit = (x: number) => Math.max(-1, Math.min(1, x));

function makeSpec(
  key: string,
  hit: { offset: number; quality: TriadQuality; source: ParallelMode | "harmonic-minor"; brightness: number },
  home: number
): BorrowedChordSpec {
  const rule = BORROWABLE[key];
  return {
    key,
    label: romanForOffset(hit.offset, hit.quality),
    semitones: hit.offset,
    triadQuality: hit.quality,
    seventhQuality: rule.seventh,
    sourceMode: hit.source,
    brightness: hit.brightness,
    relativeBrightness: clampUnit((hit.brightness - home) / 3),
    function: rule.function,
    affect: rule.affect,
    finalOnly: rule.finalOnly ?? false,
  };
}

/**
 * Every idiomatic borrowed chord for a home mode, each tagged with the
 * brightness of the nearest parallel mode that contains it.
 *
 * `allowRaisedDominant` marks modes where the generator already raises the
 * fifth degree (ionian, aeolian), so a "borrowed V" would be a duplicate.
 * Minor-flavoured modes additionally get the harmonic-minor leading-tone
 * chords (V, vii°7) at neutral brightness: they darken nothing, they pull.
 */
export function borrowedChordCatalogue(mode: Mode, allowRaisedDominant: boolean): BorrowedChordSpec[] {
  const home = parallelModeOf(mode);
  if (!home) return [];
  const homeLevel = MODE_BRIGHTNESS[home];

  const diatonic = new Set(modeTriads(home).map((t) => `${t.offset}:${t.quality}`));
  if (allowRaisedDominant) diatonic.add("7:maj");

  const best = new Map<
    string,
    { offset: number; quality: TriadQuality; source: ParallelMode | "harmonic-minor"; brightness: number }
  >();

  for (const source of PARALLEL_MODES) {
    if (source === home) continue;
    for (const triad of modeTriads(source)) {
      const key = `${triad.offset}:${triad.quality}`;
      if (diatonic.has(key) || !(key in BORROWABLE)) continue;
      const previous = best.get(key);
      const distance = Math.abs(MODE_BRIGHTNESS[source] - homeLevel);
      if (!previous || distance < Math.abs(previous.brightness - homeLevel)) {
        best.set(key, {
          offset: triad.offset,
          quality: triad.quality,
          source,
          brightness: MODE_BRIGHTNESS[source],
        });
      }
    }
  }

  const isMinorish = home === "aeolian" || home === "dorian" || home === "phrygian";
  if (isMinorish) {
    for (const [key, offset, quality] of [
      ["7:maj", 7, "maj"],
      ["11:dim", 11, "dim"],
    ] as const) {
      if (diatonic.has(key)) continue;
      best.set(key, { offset, quality, source: "harmonic-minor", brightness: homeLevel });
    }
  }

  return [...best.entries()]
    .map(([key, hit]) => makeSpec(key, hit, homeLevel))
    .sort((a, b) => a.semitones - b.semitones || a.triadQuality.localeCompare(b.triadQuality));
}

/**
 * Describe a chromatic triad reached some other way (a Neo-Riemannian
 * transform, say) in the catalogue's terms. Triads the catalogue knows keep
 * their function and affect; anything else is a chromatic mediant.
 * Returns null for a triad diatonic to the home mode.
 */
export function describeChromaticTriad(
  offset: number,
  quality: TriadQuality,
  mode: Mode,
  allowRaisedDominant: boolean
): BorrowedChordSpec | null {
  const home = parallelModeOf(mode);
  if (!home) return null;
  const normalized = ((offset % 12) + 12) % 12;
  const key = `${normalized}:${quality}`;
  const diatonic = new Set(modeTriads(home).map((t) => `${t.offset}:${t.quality}`));
  if (allowRaisedDominant) diatonic.add("7:maj");
  if (diatonic.has(key)) return null;

  const fromCatalogue = borrowedChordCatalogue(mode, allowRaisedDominant).find((spec) => spec.key === key);
  if (fromCatalogue) return fromCatalogue;
  if (quality === "dim" || quality === "aug") return null;
  // Outside the catalogue only the chromatic mediants — a third away from
  // the tonic — are idiomatic; the slide and hexatonic pole of a non-tonic
  // chord land on roots (bv, bii) that read as a wrong key, not a colour.
  if (![3, 4, 8, 9].includes(normalized)) return null;

  const homeLevel = MODE_BRIGHTNESS[home];
  return {
    key,
    label: romanForOffset(normalized, quality),
    semitones: normalized,
    triadQuality: quality,
    seventhQuality: quality === "maj" ? "maj7" : "min7",
    sourceMode: home,
    brightness: homeLevel,
    // A major triad from nowhere reads as a lift, a minor one as a shadow.
    relativeBrightness: quality === "maj" ? 0.5 : -0.5,
    function: "chromatic",
    affect: "chromatic mediant — colour from outside the key",
    finalOnly: false,
  };
}

// ---------------------------------------------------------------------------
// Brightness curves
// ---------------------------------------------------------------------------

export const BRIGHTNESS_CURVES: BrightnessCurve[] = [
  "auto",
  "steady",
  "darkening",
  "sunrise",
  "arch",
  "collapse",
];

const MOOD_BRIGHTNESS_CURVE: Record<ChordMood, Exclude<BrightnessCurve, "auto">> = {
  dark: "darkening",
  emotional: "steady",
  dreamy: "sunrise",
  energetic: "arch",
};

/** The concrete curve to use: the caller's, or the mood's own. */
export function resolveBrightnessCurve(
  curve: BrightnessCurve | undefined,
  mood: ChordMood
): Exclude<BrightnessCurve, "auto"> {
  if (curve && curve !== "auto") return curve;
  return MOOD_BRIGHTNESS_CURVE[mood];
}

/**
 * Brightness target per slot, on the −1..1 scale, starting from the mood's
 * base brightness.
 */
export function brightnessTargetsFor(
  curve: Exclude<BrightnessCurve, "auto">,
  base: number,
  numChords: number
): number[] {
  if (numChords <= 0) return [];
  const last = Math.max(1, numChords - 1);

  return Array.from({ length: numChords }, (_, i) => {
    const position = i / last;
    switch (curve) {
      case "darkening":
        return clampUnit(base - 1.2 * position);
      case "sunrise":
        return clampUnit(base - 0.6 + 1.6 * position);
      case "arch":
        return clampUnit(base + 0.8 * Math.sin(Math.PI * position));
      case "collapse":
        return clampUnit(base + 0.6 - 1.6 * position);
      case "steady":
      default:
        return clampUnit(base);
    }
  });
}

/** Brightness a diatonic chord contributes, from its quality alone. */
export function diatonicBrightness(quality: TriadQuality): number {
  switch (quality) {
    case "maj": return 0.25;
    case "min": return -0.25;
    case "dim": return -0.4;
    case "aug": return 0.1;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Building the chord
// ---------------------------------------------------------------------------

const QUALITY_INTERVALS: Record<TriadQuality | SeventhQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  "half-dim7": [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
};

function transpose(root: PitchClass, semitones: number): PitchClass {
  return PITCH_CLASSES[(PITCH_CLASSES.indexOf(root) + semitones + 120) % 12];
}

/**
 * Realise a borrowed chord as a plan entry. Triads at complexity 1, the
 * catalogue's seventh from complexity 2. No further extensions are added:
 * a borrowed chord is already the colour in the phrase, and its symbol must
 * stay something the validator can parse.
 */
export function buildBorrowedChordPlan(params: {
  spec: BorrowedChordSpec;
  tonic: PitchClass;
  complexity: AdvancedComplexity;
  tensionLevel: number;
  source?: string;
  transform?: string;
}): PlannedAdvancedChord {
  const { spec, tonic, complexity, tensionLevel } = params;
  const root = transpose(tonic, spec.semitones);
  const quality: TriadQuality | SeventhQuality =
    complexity >= 2 && spec.seventhQuality ? spec.seventhQuality : spec.triadQuality;
  const pitchClasses = QUALITY_INTERVALS[quality].map((interval) => transpose(root, interval));

  return {
    degreeLabel: spec.label,
    symbol: formatChordSymbol(root, quality),
    root,
    pitchClasses,
    kind: "borrowed",
    // Only a major chord on the fifth degree carries a leading tone.
    isDominant: spec.key === "7:maj",
    role: "structural",
    durationClass: "full",
    tensionLevel,
    isProtected: false,
    functionTag: spec.function,
    brightness: spec.relativeBrightness,
    source: params.source ?? `borrowed:${spec.sourceMode}`,
    transform: params.transform,
  };
}

/**
 * The Picardy third: a minor-mode progression closing on its major tonic.
 * Kept separate from the catalogue because it is only ever the final chord.
 */
export function picardyTonic(params: {
  tonic: PitchClass;
  complexity: AdvancedComplexity;
  mode: Mode;
}): PlannedAdvancedChord {
  const spec: BorrowedChordSpec = {
    key: "0:maj",
    label: "I",
    semitones: 0,
    triadQuality: "maj",
    seventhQuality: "maj7",
    sourceMode: "ionian",
    brightness: MODE_BRIGHTNESS.ionian,
    relativeBrightness: clampUnit((MODE_BRIGHTNESS.ionian - homeBrightness(params.mode)) / 3),
    function: "tonic",
    affect: BORROWABLE["0:maj"].affect,
    finalOnly: true,
  };
  const chord = buildBorrowedChordPlan({
    spec,
    tonic: params.tonic,
    complexity: params.complexity,
    tensionLevel: 0,
    source: "picardy",
  });
  return { ...chord, isProtected: true };
}
