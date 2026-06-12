/**
 * Shared pitch/duration helpers for the melody engine.
 *
 * These are the harmonic primitives carried over from the original
 * note-by-note generator: scale/chord MIDI set construction, chord-tone and
 * semitone-clash tests, scale stepping, and the melodic smoothness cost.
 */

import { pitchClassToMidi, midiToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";
import type { DurationClass } from "../advanced/types";

export function durationClassToBeats(dc?: DurationClass): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

/** Build an ordered set of scale MIDI notes spanning octave-1 .. octave+1. */
export function buildScaleMidiSet(scalePitchClasses: PitchClass[], octave: number): number[] {
  const notes: number[] = [];
  for (let oct = octave - 1; oct <= octave + 1; oct++) {
    for (const pc of scalePitchClasses) {
      notes.push(pitchClassToMidi(pc, oct));
    }
  }
  return notes.sort((a, b) => a - b);
}

/**
 * Build an ordered set of chord-tone MIDI notes spanning octave-1 .. octave+1.
 * Materialises chromatic chord tones (e.g. the F# of a D7 in C major) that are
 * absent from the diatonic scale set, so the melody can actually reach them.
 */
export function buildChordMidiSet(chordPitchClasses: PitchClass[], octave: number): number[] {
  const notes: number[] = [];
  for (let oct = octave - 1; oct <= octave + 1; oct++) {
    for (const pc of chordPitchClasses) {
      notes.push(pitchClassToMidi(pc, oct));
    }
  }
  return notes.sort((a, b) => a - b);
}

/** Find the closest tone to a target MIDI note in a sorted candidate set. */
export function closestTone(target: number, tones: number[]): number {
  let best = tones[0];
  let bestDist = Math.abs(target - best);
  for (const m of tones) {
    const d = Math.abs(target - m);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

/** Step by N scale degrees from a current note. */
export function stepByDegrees(current: number, degrees: number, scaleMidi: number[]): number {
  let idx = scaleMidi.indexOf(current);
  if (idx === -1) {
    const snapped = closestTone(current, scaleMidi);
    idx = scaleMidi.indexOf(snapped);
  }
  const targetIdx = Math.max(0, Math.min(scaleMidi.length - 1, idx + degrees));
  return scaleMidi[targetIdx];
}

export function isChordTone(midi: number, chordPitchClasses: PitchClass[]): boolean {
  return chordPitchClasses.includes(midiToPitchClass(midi));
}

/**
 * Whether `midi` is a non-chord-tone sitting a semitone away from a chord tone.
 * These are the worst offenders harmonically (e.g. a diatonic F natural a
 * semitone below the F# third of a D7) and are penalised / avoided on strong
 * beats so the melody never clashes with the chord notes.
 */
export function isSemitoneClash(midi: number, chordPitchClasses: PitchClass[]): boolean {
  if (isChordTone(midi, chordPitchClasses)) return false;
  return (
    isChordTone(midi - 1, chordPitchClasses) ||
    isChordTone(midi + 1, chordPitchClasses)
  );
}

/**
 * Compute a melodic movement cost between two pitches.
 * Penalises large leaps, rewards stepwise motion, penalises consecutive
 * same-direction leaps.
 */
export function melodicCost(from: number, to: number, prevDirection: number): number {
  const interval = Math.abs(to - from);
  const direction = to > from ? 1 : to < from ? -1 : 0;

  if (interval <= 2) return 0;
  if (interval <= 4) return 1;
  if (interval <= 7) return 3;
  let cost = interval * 0.8;

  if (direction !== 0 && direction === prevDirection && interval > 2) {
    cost += 2;
  }

  return cost;
}

/**
 * Strong beats are even global beats (0, 2, 4, ...) — the beats listeners
 * perceive as metric anchors, and the beats the harmony tests check.
 */
export function isStrongBeat(beat: number): boolean {
  return beat % 2 === 0;
}

/** Find the index of the chord sounding at an absolute beat position. */
export function chordIndexAtBeat(chordStartBeats: number[], beat: number): number {
  let idx = 0;
  for (let i = 0; i < chordStartBeats.length; i++) {
    if (chordStartBeats[i] <= beat) idx = i;
    else break;
  }
  return idx;
}
