import { PITCH_CLASSES, pitchClassToMidi, type PitchClass } from "@/lib/theory/midiUtils";
import type { PlannedAdvancedChord, VoicingCandidateContext, VoicingStyle } from "./types";

// ---------------------------------------------------------------------------
// Interval helpers
// ---------------------------------------------------------------------------

function toIntervals(root: PitchClass, notes: PitchClass[]): number[] {
  const rootIndex = PITCH_CLASSES.indexOf(root);
  const intervals = notes.map((note) => {
    const noteIndex = PITCH_CLASSES.indexOf(note);
    return (noteIndex - rootIndex + 12) % 12;
  });

  if (!intervals.includes(0)) {
    intervals.unshift(0);
  }

  return Array.from(new Set(intervals)).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Tone selection — decides which pitch classes to include/omit/double
// ---------------------------------------------------------------------------

/** Whether an interval is a "perfect 5th" (7 semitones). */
function isPerfectFifth(interval: number): boolean {
  return interval % 12 === 7;
}

/** Whether an interval is a 7th (major=11, minor=10, dim=9). */
function isSeventh(interval: number): boolean {
  const mod = interval % 12;
  return mod === 9 || mod === 10 || mod === 11;
}

/** Whether an interval is the 3rd (major=4, minor=3). */
function isThird(interval: number): boolean {
  const mod = interval % 12;
  return mod === 3 || mod === 4;
}

/** Whether an interval is an extension or alteration (not root, 3rd, 5th, 7th). */
function isExtension(interval: number): boolean {
  const mod = interval % 12;
  return mod !== 0 && !isThird(mod) && !isPerfectFifth(mod) && !isSeventh(mod);
}

/**
 * Select which intervals to use for voicing, respecting tone priority:
 * 1. Root (always keep)
 * 2. 3rd (always keep — defines chord quality)
 * 3. 7th (keep if present — defines chord color)
 * 4. Highest extension (keep for color)
 * 5. Perfect 5th (omit first when space is needed)
 *
 * Doubling rules: only double root or (rarely) 5th. Never double 3rd/7th/extensions.
 */
function selectTones(intervals: number[], targetCount: number): number[] {
  const unique = [...new Set(intervals.map(i => ((i % 12) + 12) % 12))].sort((a, b) => a - b);

  // If we have fewer voices than unique tones, omit in priority order
  if (targetCount < unique.length) {
    const result = [...unique];

    while (result.length > targetCount) {
      // Omit perfect 5th first
      const p5idx = result.findIndex(isPerfectFifth);
      if (p5idx !== -1) {
        result.splice(p5idx, 1);
        continue;
      }
      // Then omit extensions (lowest first — least important)
      const extIdx = result.findIndex(isExtension);
      if (extIdx !== -1) {
        result.splice(extIdx, 1);
        continue;
      }
      break; // don't omit root/3rd/7th
    }
    return result;
  }

  // We have enough or extra voices — include all unique tones
  if (targetCount === unique.length) {
    return unique;
  }

  // Extra voices: double selectively (root only, then 5th)
  const result = [...unique];
  const has7th = unique.some(isSeventh);

  // When chord has a 7th, omit perfect 5th and use the voice for root doubling
  if (has7th && unique.some(isPerfectFifth) && result.length < targetCount) {
    const p5idx = result.findIndex(isPerfectFifth);
    if (p5idx !== -1) {
      result.splice(p5idx, 1);
    }
  }

  // Fill remaining with safe doublings
  while (result.length < targetCount) {
    // Double root (as octave offset for placement)
    if (result.filter(i => i === 0).length === 1) {
      result.push(0);
      continue;
    }
    // Double 5th if present and no 7th conflict
    if (!has7th && result.some(isPerfectFifth) && result.filter(isPerfectFifth).length === 1) {
      result.push(7);
      continue;
    }
    break; // no more safe doublings
  }

  return result.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Voice placement
// ---------------------------------------------------------------------------

function enforceAscending(notes: number[]): number[] {
  const result = [...notes].sort((a, b) => a - b);
  for (let i = 1; i < result.length; i++) {
    while (result[i] <= result[i - 1]) {
      result[i] += 12;
    }
  }
  return result;
}

/**
 * Validate low-register spacing rules (psychoacoustic).
 * Returns true if spacing is acceptable.
 */
function validateSpacing(notes: number[]): boolean {
  const sorted = [...notes].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const interval = sorted[i + 1] - sorted[i];
    const note = sorted[i];

    if (note < 48 && interval < 7) return false;     // below C3: need P5+
    if (note >= 48 && note < 52 && interval < 5) return false; // C3-E3: need P4+
  }
  return true;
}

/**
 * Build a voicing by placing selected tones from root MIDI upward.
 * Each tone is placed in the lowest octave that keeps it above the previous note,
 * with special handling for doubled root (placed an octave above).
 */
function buildDistributedVoicing(rootMidi: number, tones: number[], voiceCount: number): number[] {
  const effectiveCount = Math.min(voiceCount, tones.length);
  const result: number[] = [];
  let rootSeen = false;

  for (let i = 0; i < effectiveCount; i++) {
    const tone = tones[i];
    let midi = rootMidi + tone;

    if (tone === 0 && rootSeen) {
      // Doubled root — place an octave above the first root
      midi = rootMidi + 12;
    }
    if (tone === 0) rootSeen = true;

    // Ensure ascending order
    if (result.length > 0) {
      while (midi <= result[result.length - 1]) {
        midi += 12;
      }
    }

    result.push(midi);
  }

  return result.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Inversion
// ---------------------------------------------------------------------------

function invert(notes: number[], inversion: number): number[] {
  const inverted = [...notes];
  for (let i = 0; i < inversion; i++) {
    const first = inverted.shift();
    if (first === undefined) break;
    inverted.push(first + 12);
  }
  return inverted.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Voicing styles
// ---------------------------------------------------------------------------

function applyStyle(notes: number[], style: VoicingStyle): number[] {
  const voiced = [...notes].sort((a, b) => a - b);

  switch (style) {
    case "closed":
      return voiced;
    case "open": {
      if (voiced.length >= 3) {
        voiced[1] += 12;
      }
      return voiced.sort((a, b) => a - b);
    }
    case "drop2": {
      if (voiced.length >= 2) {
        const idx = voiced.length - 2;
        voiced[idx] -= 12;
      }
      return voiced.sort((a, b) => a - b);
    }
    case "drop3": {
      if (voiced.length >= 3) {
        const idx = voiced.length - 3;
        voiced[idx] -= 12;
      }
      return voiced.sort((a, b) => a - b);
    }
    case "spread": {
      // More restrained spread: only move every other voice, and by less aggressive amounts
      for (let i = 1; i < voiced.length; i += 2) {
        voiced[i] += 12;
      }
      return voiced.sort((a, b) => a - b);
    }
    case "auto":
      return voiced;
    default:
      return voiced;
  }
}

// ---------------------------------------------------------------------------
// Range normalization
// ---------------------------------------------------------------------------

export function normalizeVoicingToRange(notes: number[], rangeLow: number, rangeHigh: number): number[] | null {
  const voiced = enforceAscending(notes);

  let guard = 0;
  while (voiced[0] < rangeLow && guard < 16) {
    for (let i = 0; i < voiced.length; i++) {
      voiced[i] += 12;
    }
    guard += 1;
  }

  guard = 0;
  while (voiced[voiced.length - 1] > rangeHigh && guard < 16) {
    for (let i = 0; i < voiced.length; i++) {
      voiced[i] -= 12;
    }
    guard += 1;
  }

  const normalized = enforceAscending(voiced);

  if (normalized[0] < rangeLow || normalized[normalized.length - 1] > rangeHigh) {
    return null;
  }

  // Reject voicings that violate low-register spacing rules
  if (!validateSpacing(normalized)) {
    return null;
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

function stylesForContext(style: VoicingStyle, voiceCount: number): VoicingStyle[] {
  if (style !== "auto") return [style];

  const styles: VoicingStyle[] = ["closed", "open", "drop2"];
  if (voiceCount >= 4) styles.push("drop3");
  // Omit spread from auto — it's too aggressive for most contexts
  return styles;
}

function possibleOctaves(rangeLow: number, rangeHigh: number): number[] {
  const lowOct = Math.floor(rangeLow / 12) - 2;
  const highOct = Math.floor(rangeHigh / 12);
  const octaves: number[] = [];

  for (let octave = lowOct; octave <= highOct; octave++) {
    octaves.push(octave);
  }

  return octaves;
}

export function generateVoicingCandidates(
  chord: PlannedAdvancedChord,
  context: VoicingCandidateContext
): number[][] {
  const intervals = toIntervals(chord.root, chord.pitchClasses);

  // Cap voice count: never more than unique pitch classes + 1 (for root doubling)
  const effectiveVoiceCount = Math.min(context.voiceCount, intervals.length + 1);

  // For passing/suspension chords, use lighter voicing (3 voices max)
  const roleVoiceCount = (chord.role === "passing" || chord.role === "suspension")
    ? Math.min(effectiveVoiceCount, 3)
    : effectiveVoiceCount;

  const tones = selectTones(intervals, roleVoiceCount);
  const candidates: number[][] = [];
  const octaves = possibleOctaves(context.rangeLow, context.rangeHigh);

  for (const style of stylesForContext(context.style, roleVoiceCount)) {
    for (const octave of octaves) {
      const rootMidi = pitchClassToMidi(chord.root, octave);
      const base = buildDistributedVoicing(rootMidi, tones, roleVoiceCount);

      const inversionLimit = Math.min(2, Math.max(1, base.length - 1));
      for (let inversion = 0; inversion <= inversionLimit; inversion++) {
        const inverted = invert(base, inversion);
        const styled = applyStyle(inverted, style);
        const normalized = normalizeVoicingToRange(styled, context.rangeLow, context.rangeHigh);
        if (normalized) {
          candidates.push(normalized);
        }
      }
    }
  }

  const dedup = new Map<string, number[]>();
  for (const candidate of candidates) {
    dedup.set(candidate.join("-"), candidate);
  }

  return Array.from(dedup.values());
}
