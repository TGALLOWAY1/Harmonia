/**
 * Harmonic context — what the melody knows about each chord.
 *
 * The realization stage used to see only a chord's pitch classes and its
 * root. Every non-chord tone looked alike, the one thing it knew to avoid was
 * "a note a semitone from a chord tone", and nothing told it that a leading
 * tone wants to rise or that a chordal seventh wants to fall. This module
 * derives the rest, deterministically, from the pitch classes and the home
 * scale (the chord engine's own tags are used when the caller passes them):
 *
 *   - the chord quality (from the intervals above the root) and the scale
 *     degree of the root, from which the harmonic function and a planning
 *     tension follow — the same formula the chord engine plans against, so
 *     the melody's climax can sit where the harmony is actually tense;
 *   - a category for every pitch class over the chord: chord tone, colour
 *     tone, avoid tone, or chromatic. The avoid rule is the jazz one: a scale
 *     tone a semitone above a chord tone (the 4th over a major triad, the b6
 *     over a minor one, the tonic over V7) or a semitone below the third. It
 *     reproduces the Impro-Visor chord/colour/avoid tables and, for chromatic
 *     chords, the right chord-scale by construction: over D7 in C the F is
 *     demoted and the F# is a chord tone, so the melody reads G major there;
 *   - tendency tones: the leading tone into the tonic, an applied leading tone
 *     into its target, a chordal seventh down by step into the next chord,
 *     fa→mi over the dominant, le→sol (Open Music Theory, "Tendency tones and
 *     functional harmonic dissonances");
 *   - a targeting priority for chord changes (third first, then seventh or
 *     root) and a guide-tone line — one backbone pitch per chord connected by
 *     the smallest motion — for the realization stage to lean on.
 */

import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";
import { planningTension, TENSION_TARGET_SCALE } from "../advanced/tensionCurve";
import type { ChordKind, HarmonicFunction, PlannedAdvancedChord } from "../advanced/types";
import type { MelodyGenerationOptions } from "./types";

export type NoteCategory = "chord" | "color" | "avoid" | "chromatic";

export type ChordQualityClass =
  | "maj"
  | "maj7"
  | "6"
  | "add9"
  | "min"
  | "min7"
  | "min6"
  | "dom7"
  | "aug7"
  | "7sus4"
  | "sus2"
  | "sus4"
  | "m7b5"
  | "dim"
  | "dim7"
  | "aug"
  | "unknown";

export type TendencyKind =
  | "leading-tone"
  | "applied-leading-tone"
  | "seventh"
  | "fa-mi"
  | "le-sol";

export type TendencyTone = {
  /** The pitch class that wants to move. */
  pc: number;
  /** Pitch classes that satisfy it (empty when the next chord offers none). */
  to: number[];
  /** 0–1, how badly it wants to (1 = a cadential leading tone). */
  strength: number;
  kind: TendencyKind;
};

export type ChordContext = {
  index: number;
  rootPc: number;
  /** Chord-tone pitch classes. */
  pcs: number[];
  /** Semitones above the root, ascending. */
  intervals: number[];
  quality: ChordQualityClass;
  /** Index of the root in the home scale, or null for a chromatic root. */
  degreeIndex: number | null;
  /** Every chord tone belongs to the home scale. */
  isDiatonic: boolean;
  kind: ChordKind;
  functionTag: HarmonicFunction;
  /** Pulls toward a resolution: V, V7, vii°, an applied dominant. */
  isDominantFunction: boolean;
  /** Root of the chord an applied dominant resolves to, else null. */
  appliedTarget: number | null;
  /** 0–1, the chord engine's planning tension rescaled to the curve range. */
  tension: number;
  /** Pitch classes the melody may draw from over this chord. */
  universe: number[];
  /** Category of every pitch class 0..11. */
  categories: NoteCategory[];
  /** Chord-change targeting order (pitch classes). */
  priority: number[];
  /** The two most characteristic chord tones (3rd and 7th, or 3rd and root). */
  guideTones: number[];
  tendencies: TendencyTone[];
};

export type HarmonicContext = {
  tonicPc: number;
  scalePcs: number[];
  isMinorKey: boolean;
  isPentatonic: boolean;
  chords: ChordContext[];
  /** Per-chord tension, 0–1. */
  tensionCurve: number[];
};

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;
export const pcIndex = (pc: PitchClass): number => PITCH_CLASSES.indexOf(pc);
export const midiPc = (midi: number): number => mod12(midi);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/* ─── Quality ─── */

export function classifyQuality(intervals: Iterable<number>): ChordQualityClass {
  const s = new Set(Array.from(intervals).map(mod12));
  const has = (i: number) => s.has(i);
  const third = has(4);
  const minorThird = has(3) && !third;
  if (third) {
    if (has(10)) return has(8) && !has(7) ? "aug7" : "dom7";
    if (has(11)) return "maj7";
    if (has(8) && !has(7)) return "aug";
    if (has(9)) return "6";
    if (has(2)) return "add9";
    return "maj";
  }
  if (minorThird) {
    if (has(6) && !has(7)) {
      if (has(9)) return "dim7";
      if (has(10)) return "m7b5";
      return "dim";
    }
    if (has(10)) return "min7";
    if (has(9)) return "min6";
    return "min";
  }
  if (has(5)) return has(10) ? "7sus4" : "sus4";
  if (has(2) && has(7)) return "sus2";
  return "unknown";
}

/** Chord tones in order of how strongly they identify the chord at a change. */
function priorityIntervals(quality: ChordQualityClass, intervals: number[]): number[] {
  const order: number[] = (() => {
    switch (quality) {
      case "maj7": return [4, 11, 0, 7];
      case "dom7": return [4, 10, 0, 7];
      case "aug7": return [4, 10, 0, 8];
      case "6": return [4, 9, 0, 7];
      case "add9": return [4, 2, 0, 7];
      case "maj": return [4, 0, 7];
      case "min7": return [3, 10, 0, 7];
      case "min6": return [3, 9, 0, 7];
      case "min": return [3, 0, 7];
      case "m7b5": return [6, 3, 10, 0];
      case "dim7": return [3, 9, 6, 0];
      case "dim": return [3, 6, 0];
      case "7sus4": return [5, 10, 0, 7];
      case "sus4": return [5, 0, 7];
      case "sus2": return [2, 0, 7];
      case "aug": return [4, 8, 0];
      default: return [];
    }
  })();
  const present = new Set(intervals);
  const ranked = order.filter((i) => present.has(i));
  for (const i of intervals) if (!ranked.includes(i)) ranked.push(i);
  return ranked;
}

/* ─── Context construction ─── */

type ChordInput = MelodyGenerationOptions["chords"][number];

const DOMINANT_QUALITIES = new Set<ChordQualityClass>(["dom7", "aug7", "7sus4"]);

export function buildHarmonicContext(
  chords: ChordInput[],
  scalePitchClasses: PitchClass[],
  options: { tensionCurve?: number[] } = {},
): HarmonicContext {
  const scalePcs = scalePitchClasses.map(pcIndex);
  const scaleSet = new Set(scalePcs);
  const tonicPc = scalePcs[0] ?? 0;
  const isPentatonic = scalePcs.length === 5;
  const isMinorKey = scaleSet.has(mod12(tonicPc + 3)) && !scaleSet.has(mod12(tonicPc + 4));
  const dominantDegree = scalePcs.indexOf(mod12(tonicPc + 7));
  const leadingTonePc = mod12(tonicPc + 11);

  const contexts: ChordContext[] = chords.map((chord, index) => {
    const rootPc = pcIndex(chord.root);
    const pcs = Array.from(new Set((chord.pitchClasses.length ? chord.pitchClasses : [chord.root]).map(pcIndex)));
    if (!pcs.includes(rootPc)) pcs.unshift(rootPc);
    const intervals = pcs.map((pc) => mod12(pc - rootPc)).sort((a, b) => a - b);
    const quality = classifyQuality(intervals);
    const chordSet = new Set(pcs);
    const degreeIndex = scalePcs.indexOf(rootPc);
    const isDiatonic = pcs.every((pc) => scaleSet.has(pc));
    const hasMajorThird = chordSet.has(mod12(rootPc + 4));
    const dominantQuality = DOMINANT_QUALITIES.has(quality);

    // Kind and function: prefer the chord engine's tags, infer otherwise.
    let kind: ChordKind = chord.kind ?? "diatonic";
    let appliedTarget: number | null = null;
    if (!chord.kind) {
      if (!isDiatonic) {
        const target = mod12(rootPc + 5);
        if (target === tonicPc && (dominantQuality || hasMajorThird)) {
          // The key's own dominant with a raised leading tone (harmonic
          // minor V, or a V7 whose seventh is foreign to the mode).
          kind = "borrowed";
        } else if (dominantQuality || (hasMajorThird && degreeIndex === -1)) {
          if (scaleSet.has(target)) {
            kind = "secondary-dominant";
            appliedTarget = target;
          } else if (scaleSet.has(mod12(rootPc - 1)) && dominantQuality) {
            kind = "tritone-substitution";
            appliedTarget = mod12(rootPc - 1);
          } else {
            kind = "borrowed";
          }
        } else {
          kind = "borrowed";
        }
      }
    } else if (chord.kind === "secondary-dominant") {
      appliedTarget = mod12(rootPc + 5);
    } else if (chord.kind === "tritone-substitution") {
      appliedTarget = mod12(rootPc - 1);
    }

    const isKeyDominant =
      degreeIndex !== -1 && degreeIndex === dominantDegree && (hasMajorThird || dominantQuality);
    const isLeadingToneChord =
      degreeIndex !== -1 && rootPc === leadingTonePc && (quality === "dim" || quality === "dim7" || quality === "m7b5");
    let functionTag: HarmonicFunction;
    if (chord.functionTag) {
      functionTag = chord.functionTag;
    } else if (kind === "secondary-dominant" || kind === "tritone-substitution") {
      functionTag = "applied";
    } else if (degreeIndex === -1) {
      functionTag = "chromatic";
    } else if (isPentatonic) {
      functionTag = degreeIndex === 0 ? "tonic" : degreeIndex === 3 ? "dominant" : degreeIndex === 1 ? "predominant" : "mediant";
    } else {
      switch (degreeIndex) {
        case 0: functionTag = "tonic"; break;
        case 2:
        case 5: functionTag = "mediant"; break;
        case 1:
        case 3: functionTag = "predominant"; break;
        default: functionTag = "dominant"; break;
      }
    }
    const isDominantFunction =
      chord.isDominant ??
      (functionTag === "applied" || isKeyDominant || isLeadingToneChord ||
        (functionTag === "dominant" && (hasMajorThird || dominantQuality)));

    // Tension on the chord engine's scale.
    const planned: PlannedAdvancedChord = {
      degreeLabel: chord.romanNumeral ?? "",
      symbol: chord.symbol ?? "",
      root: chord.root,
      pitchClasses: chord.pitchClasses.length ? chord.pitchClasses : [chord.root],
      kind,
      isDominant: isDominantFunction,
      degreeIndex: degreeIndex === -1 ? undefined : degreeIndex,
      functionTag,
    };
    const tension = chord.tension !== undefined
      ? clamp01(chord.tension)
      : clamp01(planningTension(planned, scalePitchClasses) / TENSION_TARGET_SCALE);

    // Universe: home scale ∪ chord tones (∪ the ninth of a dominant, which in
    // a minor key is the raised sixth of melodic minor).
    const universeSet = new Set<number>([...scalePcs, ...pcs]);
    if (isDominantFunction && (hasMajorThird || dominantQuality)) universeSet.add(mod12(rootPc + 2));
    const thirdPc = hasMajorThird ? mod12(rootPc + 4) : chordSet.has(mod12(rootPc + 3)) ? mod12(rootPc + 3) : null;
    const categories: NoteCategory[] = [];
    for (let pc = 0; pc < 12; pc++) {
      if (chordSet.has(pc)) categories.push("chord");
      else if (!universeSet.has(pc)) categories.push("chromatic");
      else if (chordSet.has(mod12(pc - 1))) categories.push("avoid");
      else if (thirdPc !== null && mod12(pc + 1) === thirdPc) categories.push("avoid");
      else if (quality === "aug" && pc === mod12(rootPc + 7)) categories.push("avoid");
      else categories.push("color");
    }
    const universe = Array.from(universeSet).sort((a, b) => a - b);

    const priority = priorityIntervals(quality, intervals).map((i) => mod12(rootPc + i));
    const guideTones = priority.slice(0, Math.min(2, priority.length));

    return {
      index,
      rootPc,
      pcs,
      intervals,
      quality,
      degreeIndex: degreeIndex === -1 ? null : degreeIndex,
      isDiatonic,
      kind,
      functionTag,
      isDominantFunction,
      appliedTarget,
      tension,
      universe,
      categories,
      priority,
      guideTones,
      tendencies: [],
    };
  });

  // Tendency tones need the next chord.
  for (let k = 0; k < contexts.length; k++) {
    contexts[k].tendencies = deriveTendencies(contexts[k], contexts[k + 1], tonicPc, isMinorKey, k === contexts.length - 1);
  }

  const tensionCurve = contexts.map((c, i) => {
    const supplied = options.tensionCurve?.[i];
    return supplied !== undefined && Number.isFinite(supplied) ? clamp01(supplied) : c.tension;
  });
  for (let i = 0; i < contexts.length; i++) contexts[i].tension = tensionCurve[i];

  return { tonicPc, scalePcs, isMinorKey, isPentatonic, chords: contexts, tensionCurve };
}

function deriveTendencies(
  chord: ChordContext,
  next: ChordContext | undefined,
  tonicPc: number,
  isMinorKey: boolean,
  isLast: boolean,
): TendencyTone[] {
  const out: TendencyTone[] = [];
  const nextSet = new Set(next?.pcs ?? []);
  const chordSet = new Set(chord.pcs);
  const leadingTone = mod12(tonicPc + 11);

  // The leading tone rises to the tonic; strongest when the dominant resolves.
  if (chord.isDominantFunction && chordSet.has(leadingTone) && chord.appliedTarget === null) {
    const resolves = next ? nextSet.has(tonicPc) : true;
    out.push({ pc: leadingTone, to: [tonicPc], strength: isLast ? 0.5 : resolves ? 1 : 0.5, kind: "leading-tone" });
  }
  // An applied dominant's third is the leading tone of its target.
  if (chord.appliedTarget !== null) {
    const applied = mod12(chord.rootPc + 4);
    const target = chord.appliedTarget;
    if (chordSet.has(applied) && applied !== leadingTone) {
      const resolves = next ? nextSet.has(target) : false;
      out.push({ pc: applied, to: [target], strength: resolves ? 0.9 : 0.4, kind: "applied-leading-tone" });
    }
  }
  // A chordal seventh falls by step into the next chord.
  const seventh = chord.intervals.find((i) => i === 10 || i === 11) ?? (chord.quality === "dim7" ? 9 : undefined);
  if (seventh !== undefined && next) {
    const pc = mod12(chord.rootPc + seventh);
    const to = [mod12(pc - 1), mod12(pc - 2)].filter((p) => nextSet.has(p));
    if (to.length > 0 && !(nextSet.has(pc) && chord.functionTag === next.functionTag)) {
      out.push({ pc, to, strength: chord.isDominantFunction ? 0.9 : 0.7, kind: "seventh" });
    }
  }
  // fa over the dominant leans to mi (a functional dissonance of D).
  if (chord.isDominantFunction && chord.appliedTarget === null && next && next.functionTag === "tonic") {
    const fa = mod12(tonicPc + 5);
    const mi = isMinorKey ? mod12(tonicPc + 3) : mod12(tonicPc + 4);
    if (!chordSet.has(fa) && nextSet.has(mi)) out.push({ pc: fa, to: [mi], strength: 0.6, kind: "fa-mi" });
  }
  // le falls to sol regardless of function.
  const le = mod12(tonicPc + 8);
  const sol = mod12(tonicPc + 7);
  if (chord.universe.includes(le) && (isMinorKey || chordSet.has(le))) {
    out.push({ pc: le, to: [sol], strength: chordSet.has(le) && !isMinorKey ? 0.6 : 0.4, kind: "le-sol" });
  }
  return out;
}

/* ─── Queries ─── */

export function categoryOf(chord: ChordContext, midi: number): NoteCategory {
  return chord.categories[midiPc(midi)];
}

export function isChordTonePc(chord: ChordContext, midi: number): boolean {
  return chord.categories[midiPc(midi)] === "chord";
}

/** Tendency carried by a sounding pitch over the chord, if any. */
export function tendencyOf(chord: ChordContext, midi: number): TendencyTone | undefined {
  const pc = midiPc(midi);
  return chord.tendencies.find((t) => t.pc === pc);
}

/** Scale degree index (0-based) of a MIDI note in the home scale, or -1. */
export function degreeOf(ctx: HarmonicContext, midi: number): number {
  return ctx.scalePcs.indexOf(midiPc(midi));
}

/** Nearest MIDI note with the given pitch class to a reference pitch. */
export function nearestWithPc(pc: number, reference: number): number {
  const base = reference - mod12(reference - pc);
  const above = base + 12;
  return Math.abs(above - reference) < Math.abs(base - reference) ? above : base;
}

/**
 * A guide-tone line: one backbone pitch per chord, drawn from each chord's
 * priority tones and connected by the smallest motion (Impro-Visor's guide-line
 * generator, reduced). The realization stage rewards landing on it when a
 * chord changes; it is a target, not a constraint.
 */
export function guideToneLine(
  ctx: HarmonicContext,
  low: number,
  high: number,
  start?: number,
): number[] {
  const line: number[] = [];
  const centre = (low + high) / 2;
  const clampRange = (m: number) => {
    let out = m;
    while (out < low) out += 12;
    while (out > high) out -= 12;
    return out;
  };
  for (let k = 0; k < ctx.chords.length; k++) {
    const chord = ctx.chords[k];
    const prev = k === 0 ? (start ?? centre) : line[k - 1];
    let best: number | null = null;
    let bestCost = Infinity;
    chord.priority.forEach((pc, rank) => {
      const candidate = clampRange(nearestWithPc(pc, prev));
      const distance = Math.abs(candidate - prev);
      const cost =
        (distance === 0 ? 1 : distance <= 2 ? 1 : distance <= 4 ? 2 : distance <= 7 ? 3 : 4) +
        rank * 0.5 +
        (k > 0 && distance === 0 ? 0.25 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    });
    line.push(best ?? clampRange(nearestWithPc(chord.rootPc, prev)));
  }
  return line;
}
