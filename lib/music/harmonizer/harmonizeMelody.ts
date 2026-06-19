/**
 * Rule-based melody harmonization engine.
 *
 * Pipeline:
 *   1. Build the diatonic chord candidates for the key/scale.
 *   2. Split the melody into harmonic regions (one chord per bar by default).
 *   3. Weight each melody note's importance (strong beats, length, downbeats,
 *      phrase ends, repetition).
 *   4. Score every candidate against every region's weighted melody notes.
 *   5. Choose the best progression with a Viterbi-style search that also
 *      rewards smooth, functional chord-to-chord motion (T → PD → D → T).
 *
 * The whole process is deterministic — the same melody + key always yields the
 * same progression — and every choice can be explained back to the user.
 */

import type { PitchClass } from "@/lib/theory/midiUtils";
import { pitchClassToMidi, midiToNoteName, midiToPitchClass } from "@/lib/theory/midiUtils";
import type { ScaleType } from "@/lib/theory/types";
import { getScaleDefinition } from "@/lib/theory/scale";
import {
  buildTriadFromScale,
  buildSeventhFromScale,
  formatChordSymbol,
  type TriadQuality,
  type SeventhQuality,
} from "@/lib/theory/chord";
import type { Chord } from "@/lib/theory/progressionTypes";
import type { DurationClass } from "@/lib/music/generators/advanced/types";
import type { MelodyNote } from "@/lib/music/generators/melody/types";
import type { Speller } from "@/lib/theory/spelling";
import type {
  ChordCandidate,
  HarmonizationResult,
  HarmonizationStyle,
  HarmonizeOptions,
  HarmonizedRegion,
} from "./types";

const EPSILON = 1e-6;
const ROMAN_BASE = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** True when `pc` belongs to the supplied scale. */
export function isScalePitchClass(
  pc: PitchClass,
  scalePitchClasses: PitchClass[]
): boolean {
  return scalePitchClasses.includes(pc);
}

/**
 * Snap a MIDI note to the nearest pitch in the scale. Ties prefer the lower
 * pitch. Used both by the drawing UI and when validating melody input.
 */
export function snapMidiToScale(
  midi: number,
  scalePitchClasses: PitchClass[]
): number {
  if (scalePitchClasses.length === 0) return midi;
  const inScale = (m: number) => scalePitchClasses.includes(midiToPitchClass(m));
  if (inScale(midi)) return midi;
  for (let d = 1; d <= 6; d++) {
    if (inScale(midi - d)) return midi - d;
    if (inScale(midi + d)) return midi + d;
  }
  return midi;
}

/** Roman numeral for a degree, cased and decorated by triad/seventh quality. */
function romanForDegree(
  degreeIndex: number,
  quality: TriadQuality | SeventhQuality
): string {
  const base = ROMAN_BASE[degreeIndex] ?? "I";
  const isMinorish =
    quality === "min" ||
    quality === "dim" ||
    quality === "min7" ||
    quality === "half-dim7" ||
    quality === "dim7";
  let roman = isMinorish ? base.toLowerCase() : base;
  if (quality === "dim" || quality === "dim7") roman += "°";
  else if (quality === "half-dim7") roman += "ø";
  else if (quality === "aug") roman += "+";
  if (
    quality === "maj7" ||
    quality === "min7" ||
    quality === "dom7" ||
    quality === "half-dim7" ||
    quality === "dim7"
  ) {
    roman += "7";
  }
  return roman;
}

/**
 * Build all diatonic chord candidates for a key/scale. Triads are always
 * produced; sevenths are added when `includeSevenths` is set.
 */
export function buildDiatonicCandidates(
  root: PitchClass,
  scaleType: ScaleType,
  includeSevenths = false
): ChordCandidate[] {
  const scale = getScaleDefinition(root, scaleType);
  const candidates: ChordCandidate[] = [];

  for (let i = 0; i < 7; i++) {
    const triad = buildTriadFromScale(scale, i);
    candidates.push({
      symbol: formatChordSymbol(triad.root, triad.quality),
      root: triad.root,
      quality: triad.quality,
      romanNumeral: romanForDegree(i, triad.quality),
      pitchClasses: [...triad.pitchClasses],
      degreeIndex: i,
      isSeventh: false,
    });

    if (includeSevenths) {
      const seventh = buildSeventhFromScale(scale, i);
      candidates.push({
        symbol: formatChordSymbol(seventh.root, seventh.quality),
        root: seventh.root,
        quality: seventh.quality,
        romanNumeral: romanForDegree(i, seventh.quality),
        pitchClasses: [...seventh.pitchClasses],
        degreeIndex: i,
        isSeventh: true,
      });
    }
  }

  return candidates;
}

/** A melody note plus its computed harmonic importance for a region. */
type WeightedNote = {
  note: MelodyNote;
  /** Importance weight (>= 1). Higher = matters more to the chord choice. */
  weight: number;
  /** Cached: does this note land on a beat (integer beat position)? */
  onBeat: boolean;
  /** Cached: is this a long note (>= 1 beat)? */
  isLong: boolean;
};

function isOnBeat(startBeat: number): boolean {
  return Math.abs(startBeat - Math.round(startBeat)) < EPSILON;
}

/**
 * Weight a melody note by harmonic importance. Notes matter more when they fall
 * on strong beats, are long, start a measure, end the phrase, or repeat a pitch
 * heard often elsewhere in the melody.
 */
export function noteImportanceWeight(
  note: MelodyNote,
  regionStartBeat: number,
  beatsPerBar: number,
  context?: { pitchClassCounts?: Map<string, number>; isPhraseEnd?: boolean }
): number {
  let weight = 1;
  const localBeat = note.startBeat - regionStartBeat;

  // Strong beat (lands on a beat boundary).
  if (isOnBeat(note.startBeat)) weight += 1;
  // Downbeat of the bar (also "starts a measure").
  if (Math.abs(localBeat) < EPSILON) weight += 1.5;
  else if (Math.abs((note.startBeat % beatsPerBar)) < EPSILON) weight += 1;
  // Longer notes anchor the harmony more.
  if (note.durationBeats >= 1) weight += 1;
  if (note.durationBeats >= 2) weight += 0.5;
  // Ends a phrase (final note of the melody).
  if (context?.isPhraseEnd) weight += 1;
  // Repetition: pitches heard often are structurally important.
  const count = context?.pitchClassCounts?.get(note.pitchClass) ?? 0;
  if (count >= 3) weight += 0.5;

  return weight;
}

/** Semitone distance (0-6) between two pitch classes. */
function pcInterval(a: PitchClass, b: PitchClass): number {
  const order = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const diff = Math.abs(order.indexOf(a) - order.indexOf(b)) % 12;
  return Math.min(diff, 12 - diff);
}

/** True if `pc` sits a semitone away from any chord tone (a harsh clash). */
function isSemitoneClash(pc: PitchClass, chordPcs: PitchClass[]): boolean {
  if (chordPcs.includes(pc)) return false;
  return chordPcs.some((c) => pcInterval(pc, c) === 1);
}

/**
 * Split a melody into harmonic regions of `beatsPerBar` beats each. A note is
 * assigned to the region its start beat falls in. There is always at least one
 * region even for an empty melody.
 */
export function splitMelodyIntoRegions(
  melodyNotes: MelodyNote[],
  beatsPerBar: number
): { index: number; startBeat: number; endBeat: number; melodyNotes: MelodyNote[] }[] {
  let maxEnd = 0;
  for (const n of melodyNotes) {
    maxEnd = Math.max(maxEnd, n.startBeat + n.durationBeats);
  }
  const barCount = Math.max(1, Math.ceil((maxEnd - EPSILON) / beatsPerBar));

  const regions = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBeat: index * beatsPerBar,
    endBeat: (index + 1) * beatsPerBar,
    melodyNotes: [] as MelodyNote[],
  }));

  for (const note of melodyNotes) {
    const idx = Math.min(barCount - 1, Math.floor((note.startBeat + EPSILON) / beatsPerBar));
    regions[idx].melodyNotes.push(note);
  }

  return regions;
}

/**
 * Score how well a chord fits a region's weighted melody notes.
 *
 * Chord tones on strong beats score highest; chord tones that are merely long
 * or present still help; non-chord-tones on strong beats are penalised, and a
 * semitone clash against an important note is penalised harder. Diatonic
 * candidates get a small baseline bonus (every candidate here is diatonic, so
 * this just keeps scores positive and predictable).
 */
export function scoreChordForRegion(
  candidate: ChordCandidate,
  weightedNotes: WeightedNote[]
): number {
  let score = 0.5; // diatonic baseline

  for (const wn of weightedNotes) {
    const { note, weight, onBeat, isLong } = wn;
    const isChordTone = candidate.pitchClasses.includes(note.pitchClass);

    if (isChordTone && onBeat) score += 3 * weight;
    else if (isChordTone && isLong) score += 2 * weight;
    else if (isChordTone) score += 1 * weight;
    else if (onBeat) score -= 1 * weight;

    if (!isChordTone && (onBeat || isLong) && isSemitoneClash(note.pitchClass, candidate.pitchClasses)) {
      score -= 1.5 * weight;
    }
  }

  // Reward a region whose downbeat note is the chord root (a clear anchor).
  const downbeat = weightedNotes.find((wn) => isOnBeat(wn.note.startBeat));
  if (downbeat && downbeat.note.pitchClass === candidate.root) {
    score += 1;
  }

  return score;
}

const DOMINANT_DEGREES = new Set([4, 6]); // V / v and vii° / VII
const PREDOMINANT_DEGREES = new Set([1, 3]); // ii / ii° and iv / IV

function isDominantFn(c: ChordCandidate): boolean {
  return DOMINANT_DEGREES.has(c.degreeIndex);
}
function isPredominantFn(c: ChordCandidate): boolean {
  return PREDOMINANT_DEGREES.has(c.degreeIndex);
}

/**
 * Score the musical motion from `prev` to `next`. Rewards functional cadences
 * (dominant → tonic, predominant → dominant) and smooth voice leading (shared
 * tones); discourages static repetition.
 */
export function scoreChordTransition(
  prev: ChordCandidate,
  next: ChordCandidate
): number {
  let s = 0;

  if (isDominantFn(prev) && next.degreeIndex === 0) s += 2; // authentic cadence pull
  if (isPredominantFn(prev) && isDominantFn(next)) s += 1; // PD → D
  if (prev.degreeIndex === 0 && isPredominantFn(next)) s += 0.5; // T → PD

  // Static repetition of the exact same chord is dull.
  if (prev.root === next.root && prev.quality === next.quality) s -= 1;

  // Smooth voice leading: shared pitch classes ease the move.
  const shared = next.pitchClasses.filter((pc) => prev.pitchClasses.includes(pc)).length;
  s += shared * 0.3;

  return s;
}

/**
 * Style bias applied to a candidate's emission score. Keeps `bestFit` neutral
 * and nudges the others toward a mood. Biases are deliberately small so melody
 * fit still dominates.
 *
 * TODO: these flavours are a first pass — they re-weight diatonic candidates
 * only. Richer styles (borrowed chords, secondary dominants for "tense",
 * modal interchange for "darker"/"brighter") can build on this hook later.
 */
function styleBias(candidate: ChordCandidate, style: HarmonizationStyle): number {
  const major = candidate.quality === "maj" || candidate.quality === "maj7";
  const minor = candidate.quality === "min" || candidate.quality === "min7";
  const tense =
    candidate.quality === "dim" ||
    candidate.quality === "dim7" ||
    candidate.quality === "half-dim7" ||
    isDominantFn(candidate);

  switch (style) {
    case "darker":
      return (minor ? 1.2 : 0) - (major ? 0.6 : 0);
    case "brighter":
      return (major ? 1.2 : 0) - (minor ? 0.6 : 0);
    case "tense":
      return tense ? 1.5 : 0;
    case "simple":
      // Prefer primary triads (I/IV/V family), avoid diminished & sevenths.
      return (
        ([0, 3, 4, 5].includes(candidate.degreeIndex) ? 0.8 : 0) -
        (candidate.quality === "dim" ? 1 : 0) -
        (candidate.isSeventh ? 1.5 : 0)
      );
    case "bestFit":
    default:
      return 0;
  }
}

/** Voice a chord as an ascending close voicing rooted at `octave`. */
function voicePitchClasses(pitchClasses: PitchClass[], octave: number): number[] {
  if (pitchClasses.length === 0) return [];
  let prev = pitchClassToMidi(pitchClasses[0], octave);
  const midis = [prev];
  for (let i = 1; i < pitchClasses.length; i++) {
    let m = pitchClassToMidi(pitchClasses[i], octave);
    while (m <= prev) m += 12;
    midis.push(m);
    prev = m;
  }
  return midis;
}

/** Turn a chosen candidate into a canonical `Chord`, spelled for the key. */
function candidateToChord(
  candidate: ChordCandidate,
  octave: number,
  durationClass: DurationClass,
  speller?: Speller
): Chord {
  const midiNotes = voicePitchClasses(candidate.pitchClasses, octave);
  const notesWithOctave = midiNotes.map((m) =>
    speller ? speller.midiNote(m) : midiToNoteName(m)
  );
  const notes = candidate.pitchClasses.map((pc) => (speller ? speller.pc(pc) : pc));

  return {
    symbol: speller ? speller.symbol(candidate.symbol) : candidate.symbol,
    notes,
    romanNumeral: candidate.romanNumeral,
    notesWithOctave,
    midiNotes,
    root: candidate.root,
    quality: candidate.quality,
    durationClass,
  };
}

/** Build a plain-language explanation for why a chord was chosen for a region. */
function explainRegion(
  candidate: ChordCandidate,
  weightedNotes: WeightedNote[],
  prev: ChordCandidate | null,
  spellPc: (pc: PitchClass) => string,
  symbol: string
): string {
  // Emphasised chord tones present in the melody, ordered by importance.
  const chordToneHits = weightedNotes
    .filter((wn) => candidate.pitchClasses.includes(wn.note.pitchClass))
    .sort((a, b) => b.weight - a.weight);

  const seen = new Set<string>();
  const emphasized: string[] = [];
  for (const wn of chordToneHits) {
    const name = spellPc(wn.note.pitchClass);
    if (!seen.has(name)) {
      seen.add(name);
      emphasized.push(name);
    }
  }

  if (emphasized.length > 0) {
    const list =
      emphasized.length === 1
        ? emphasized[0]
        : `${emphasized.slice(0, -1).join(", ")} and ${emphasized[emphasized.length - 1]}`;
    return `${symbol} fits because your melody emphasizes ${list}.`;
  }

  // Empty / non-chord-tone bar — explain by harmonic function instead.
  if (prev && isDominantFn(prev) && candidate.degreeIndex === 0) {
    return `${symbol} resolves the tension back to the tonic.`;
  }
  if (isDominantFn(candidate)) {
    return `${symbol} adds tension that pulls toward resolution.`;
  }
  if (isPredominantFn(candidate)) {
    return `${symbol} builds motion toward the cadence.`;
  }
  return `${symbol} keeps the harmony moving under this bar.`;
}

/**
 * Harmonize a melody into a deterministic, explainable chord progression.
 */
export function harmonizeMelody(options: HarmonizeOptions): HarmonizationResult {
  const {
    melodyNotes,
    root,
    scaleType,
    beatsPerBar = 4,
    octave = 3,
    includeSevenths = false,
    style = "bestFit",
    speller,
  } = options;

  const spellPc = (pc: PitchClass): string => (speller ? speller.pc(pc) : pc);

  // The "simple" flavour is triads-only by definition, regardless of the
  // seventh-chord opt-in.
  const useSevenths = includeSevenths && style !== "simple";
  const candidates = buildDiatonicCandidates(root, scaleType, useSevenths);
  const rawRegions = splitMelodyIntoRegions(melodyNotes, beatsPerBar);

  // Context shared across regions: pitch-class frequency and the phrase-end note.
  const pitchClassCounts = new Map<string, number>();
  for (const n of melodyNotes) {
    pitchClassCounts.set(n.pitchClass, (pitchClassCounts.get(n.pitchClass) ?? 0) + 1);
  }
  let phraseEndId: string | null = null;
  if (melodyNotes.length > 0) {
    phraseEndId = melodyNotes.reduce((latest, n) =>
      n.startBeat + n.durationBeats > latest.startBeat + latest.durationBeats ? n : latest
    ).id;
  }

  // Weight every note once, grouped by region.
  const weightedByRegion: WeightedNote[][] = rawRegions.map((region) =>
    region.melodyNotes.map((note) => ({
      note,
      weight: noteImportanceWeight(note, region.startBeat, beatsPerBar, {
        pitchClassCounts,
        isPhraseEnd: note.id === phraseEndId,
      }),
      onBeat: isOnBeat(note.startBeat),
      isLong: note.durationBeats >= 1,
    }))
  );

  const lastRegion = rawRegions.length - 1;

  // Emission scores: candidate fit per region, plus style + positional bias.
  const emission: number[][] = rawRegions.map((_, r) =>
    candidates.map((c) => {
      let e = scoreChordForRegion(c, weightedByRegion[r]) + styleBias(c, style);
      // Open and close on the tonic for a sense of resolution.
      if (r === 0 && c.degreeIndex === 0) e += 1;
      if (r === lastRegion && c.degreeIndex === 0) e += 2.5;
      return e;
    })
  );

  // Viterbi search for the best-scoring path through the candidates.
  const TRANSITION_WEIGHT = 1;
  const n = candidates.length;
  const dp: number[][] = rawRegions.map(() => new Array(n).fill(-Infinity));
  const back: number[][] = rawRegions.map(() => new Array(n).fill(-1));

  for (let c = 0; c < n; c++) dp[0][c] = emission[0][c];

  for (let r = 1; r < rawRegions.length; r++) {
    for (let c = 0; c < n; c++) {
      let best = -Infinity;
      let bestPrev = -1;
      for (let p = 0; p < n; p++) {
        const val =
          dp[r - 1][p] + TRANSITION_WEIGHT * scoreChordTransition(candidates[p], candidates[c]);
        if (val > best + EPSILON) {
          best = val;
          bestPrev = p;
        }
      }
      dp[r][c] = emission[r][c] + best;
      back[r][c] = bestPrev;
    }
  }

  // Backtrack: pick the highest-scoring final state (first-wins tie-break keeps
  // results deterministic and biases toward lower scale degrees / tonic).
  let lastBest = 0;
  for (let c = 1; c < n; c++) {
    if (dp[lastRegion][c] > dp[lastRegion][lastBest] + EPSILON) lastBest = c;
  }
  const path: number[] = new Array(rawRegions.length);
  path[lastRegion] = lastBest;
  for (let r = lastRegion; r > 0; r--) {
    path[r - 1] = back[r][path[r]];
  }

  // Assemble the result.
  const regions: HarmonizedRegion[] = [];
  const chords: Chord[] = [];
  const explanations: string[] = [];
  let prevCandidate: ChordCandidate | null = null;

  for (let r = 0; r < rawRegions.length; r++) {
    const candidate = candidates[path[r]];
    const chord = candidateToChord(candidate, octave, "full", speller);
    const explanation = explainRegion(
      candidate,
      weightedByRegion[r],
      prevCandidate,
      spellPc,
      chord.symbol
    );

    regions.push({
      index: r,
      startBeat: rawRegions[r].startBeat,
      endBeat: rawRegions[r].endBeat,
      melodyNotes: rawRegions[r].melodyNotes,
      candidate,
      chord,
      explanation,
      score: dp[r][path[r]],
    });
    chords.push(chord);
    explanations.push(explanation);
    prevCandidate = candidate;
  }

  return { chords, regions, explanations, style };
}
