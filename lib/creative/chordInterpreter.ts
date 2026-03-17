/**
 * Chord Interpretation Engine
 *
 * Analyzes a set of MIDI notes and infers the most likely chord identity,
 * including inversions, quality, and alternate interpretations.
 */

import { PITCH_CLASSES, type PitchClass, midiToPitchClass } from "../theory/midiUtils";
import { formatChordSymbol } from "../theory/chord";
import type { ChordInterpretation } from "./types";

interface ChordTemplate {
  quality: string;
  intervals: number[];
  symbol: string;
  priority: number; // Lower = higher priority
}

const CHORD_TEMPLATES: ChordTemplate[] = [
  // Triads
  { quality: "maj", intervals: [0, 4, 7], symbol: "", priority: 1 },
  { quality: "min", intervals: [0, 3, 7], symbol: "m", priority: 1 },
  { quality: "dim", intervals: [0, 3, 6], symbol: "dim", priority: 3 },
  { quality: "aug", intervals: [0, 4, 8], symbol: "+", priority: 3 },
  { quality: "sus4", intervals: [0, 5, 7], symbol: "sus4", priority: 2 },
  { quality: "sus2", intervals: [0, 2, 7], symbol: "sus2", priority: 2 },

  // Seventh chords
  { quality: "maj7", intervals: [0, 4, 7, 11], symbol: "maj7", priority: 2 },
  { quality: "dom7", intervals: [0, 4, 7, 10], symbol: "7", priority: 2 },
  { quality: "min7", intervals: [0, 3, 7, 10], symbol: "m7", priority: 2 },
  { quality: "half-dim7", intervals: [0, 3, 6, 10], symbol: "m7b5", priority: 3 },
  { quality: "dim7", intervals: [0, 3, 6, 9], symbol: "dim7", priority: 3 },

  // Add chords
  { quality: "add9", intervals: [0, 2, 4, 7], symbol: "add9", priority: 3 },
];

/**
 * Extract unique pitch classes from MIDI notes, normalized to semitone values.
 */
function midiToPitchClassSet(midiNotes: number[]): Set<number> {
  return new Set(midiNotes.map(m => m % 12));
}

/**
 * Score how well a template matches a set of pitch classes with a given root.
 * Returns a score from 0 to 1 where 1 is a perfect match.
 */
function scoreTemplate(
  pcSet: Set<number>,
  rootSemitone: number,
  template: ChordTemplate,
): number {
  const templatePcs = new Set(template.intervals.map(i => (rootSemitone + i) % 12));

  let matched = 0;
  for (const pc of templatePcs) {
    if (pcSet.has(pc)) matched++;
  }

  // Penalty for extra notes not in the template
  let extras = 0;
  for (const pc of pcSet) {
    if (!templatePcs.has(pc)) extras++;
  }

  const templateSize = templatePcs.size;
  const matchRatio = matched / templateSize;
  const extraPenalty = extras * 0.15;
  const priorityBonus = (5 - template.priority) * 0.05;

  return Math.max(0, matchRatio - extraPenalty + priorityBonus);
}

/**
 * Determine the inversion based on the lowest MIDI note.
 */
function determineInversion(
  lowestMidi: number,
  rootSemitone: number,
  intervals: number[],
): number {
  const lowestPc = lowestMidi % 12;
  const rootPc = rootSemitone;

  for (let inv = 0; inv < intervals.length; inv++) {
    const expectedBass = (rootPc + intervals[inv]) % 12;
    if (lowestPc === expectedBass) return inv;
  }
  return 0;
}

/**
 * Interpret a set of MIDI notes as a chord.
 *
 * Returns the best interpretation along with alternates.
 */
export function interpretChord(midiNotes: number[]): ChordInterpretation {
  if (midiNotes.length === 0) {
    return {
      symbol: "—",
      root: "C",
      quality: "",
      inversion: 0,
      confidence: 0,
      alternates: [],
      isCustomVoicing: true,
      customLabel: "Empty",
    };
  }

  if (midiNotes.length === 1) {
    const pc = midiToPitchClass(midiNotes[0]);
    return {
      symbol: pc,
      root: pc,
      quality: "",
      inversion: 0,
      confidence: 1,
      alternates: [],
      isCustomVoicing: false,
    };
  }

  const pcSet = midiToPitchClassSet(midiNotes);
  const sortedMidi = [...midiNotes].sort((a, b) => a - b);
  const lowestMidi = sortedMidi[0];

  type Candidate = {
    root: PitchClass;
    rootSemitone: number;
    template: ChordTemplate;
    score: number;
    inversion: number;
  };

  const candidates: Candidate[] = [];

  // Try every pitch class as a potential root
  for (let rootSemitone = 0; rootSemitone < 12; rootSemitone++) {
    for (const template of CHORD_TEMPLATES) {
      const score = scoreTemplate(pcSet, rootSemitone, template);
      if (score > 0.4) {
        const inversion = determineInversion(lowestMidi, rootSemitone, template.intervals);
        candidates.push({
          root: PITCH_CLASSES[rootSemitone],
          rootSemitone,
          template,
          score,
          inversion,
        });
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // No match — custom voicing
    const lowestPc = midiToPitchClass(lowestMidi);
    const noteNames = sortedMidi.map(m => midiToPitchClass(m));
    return {
      symbol: `${lowestPc}(custom)`,
      root: lowestPc,
      quality: "custom",
      inversion: 0,
      confidence: 0.2,
      alternates: [],
      isCustomVoicing: true,
      customLabel: `Custom voicing: ${[...new Set(noteNames)].join("-")}`,
    };
  }

  const best = candidates[0];
  const symbol = formatChordSymbol(best.root, best.template.quality);
  const inversionSuffix = best.inversion > 0 ? `/${PITCH_CLASSES[(best.rootSemitone + best.template.intervals[best.inversion]) % 12]}` : "";

  const alternates = candidates
    .slice(1, 4)
    .filter(c => c.score > 0.5)
    .map(c => ({
      symbol: formatChordSymbol(c.root, c.template.quality) +
        (c.inversion > 0 ? `/${PITCH_CLASSES[(c.rootSemitone + c.template.intervals[c.inversion]) % 12]}` : ""),
      confidence: c.score,
    }));

  return {
    symbol: symbol + inversionSuffix,
    root: best.root,
    quality: best.template.quality,
    inversion: best.inversion,
    confidence: best.score,
    alternates,
    isCustomVoicing: best.score < 0.65,
    customLabel: best.score < 0.65 ? `${symbol}${inversionSuffix} (approx.)` : undefined,
  };
}
