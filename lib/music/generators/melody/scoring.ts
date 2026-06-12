/**
 * Catchiness scoring.
 *
 * Scores a finished melody on the qualities that make lines memorable:
 * motif repetition, contour adherence, chord-tone alignment on strong beats,
 * smooth voice leading, phrase-ending resolution, and rhythmic interest —
 * with penalties for zig-zag motion, oversized leaps, runaway density, and
 * unresolved non-chord tones. The orchestrator generates several candidate
 * melodies and keeps the highest scorer.
 */

import { isChordTone, isStrongBeat } from "./helpers";
import { contourTargetAt } from "./contour";
import type { MoodProfile } from "./moods";
import type { PhrasePlan } from "./phrasePlan";
import type { MelodyGenerationOptions, MelodyNote } from "./types";

export type MelodyScore = {
  total: number;
  breakdown: {
    motifRepetition: number;
    contour: number;
    chordAlignment: number;
    voiceLeading: number;
    phraseEnding: number;
    rhythmicInterest: number;
    range: number;
    penalties: number;
  };
};

/* ── Motif repetition: repeated (interval, duration) n-grams ── */

/**
 * Fraction of the melody covered by 3-event patterns that occur at least
 * twice. Matching is transposition-invariant (intervals, not pitches) and
 * tolerates ±1 semitone so harmony snapping doesn't erase repetition credit.
 */
export function motifRepetitionCoverage(notes: MelodyNote[]): number {
  if (notes.length < 6) return 0;
  const grams: { intervals: number[]; durations: number[] }[] = [];
  for (let i = 0; i + 3 < notes.length; i++) {
    grams.push({
      intervals: [
        notes[i + 1].midi - notes[i].midi,
        notes[i + 2].midi - notes[i + 1].midi,
        notes[i + 3].midi - notes[i + 2].midi,
      ],
      durations: [
        notes[i].durationBeats,
        notes[i + 1].durationBeats,
        notes[i + 2].durationBeats,
      ],
    });
  }

  const matches = (a: typeof grams[number], b: typeof grams[number]) =>
    a.intervals.every((v, k) => Math.abs(v - b.intervals[k]) <= 1) &&
    a.durations.every((v, k) => v === b.durations[k]);

  const covered = new Set<number>();
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 4; j < grams.length; j++) {
      if (matches(grams[i], grams[j])) {
        for (let k = 0; k < 4; k++) {
          covered.add(i + k);
          covered.add(j + k);
        }
      }
    }
  }
  return covered.size / notes.length;
}

/* ── Contour adherence: correlation with the planned curve ── */

function contourCorrelation(notes: MelodyNote[], plan: PhrasePlan, profile: MoodProfile, octave: number): number {
  if (notes.length < 3 || plan.totalBeats <= 0) return 0;
  const realized: number[] = [];
  const planned: number[] = [];
  let ni = 0;
  for (let beat = 0; beat < plan.totalBeats; beat += 1) {
    while (ni + 1 < notes.length && notes[ni + 1].startBeat <= beat) ni++;
    realized.push(notes[ni].midi);
    planned.push(contourTargetAt(plan.contour, beat, plan.totalBeats, plan.climaxBeat, profile, octave));
  }
  return pearson(realized, planned);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/* ── Main scorer ── */

export function scoreMelody(
  notes: MelodyNote[],
  plan: PhrasePlan,
  chords: MelodyGenerationOptions["chords"],
  profile: MoodProfile,
  octave: number,
): MelodyScore {
  const breakdown: MelodyScore["breakdown"] = {
    motifRepetition: 0,
    contour: 0,
    chordAlignment: 0,
    voiceLeading: 0,
    phraseEnding: 0,
    rhythmicInterest: 0,
    range: 0,
    penalties: 0,
  };

  if (notes.length === 0) {
    return { total: -100, breakdown };
  }

  // Motif repetition (+25): coverage by repeated material, capped — wall-to-
  // wall repetition is monotony, not a hook.
  const coverage = motifRepetitionCoverage(notes);
  breakdown.motifRepetition = (Math.min(coverage, 0.7) / 0.7) * 25;
  if (notes.length >= 8 && coverage === 0) breakdown.penalties -= 15;

  // Contour adherence (+15).
  const corr = contourCorrelation(notes, plan, profile, octave);
  breakdown.contour = Math.max(0, corr) * 15;

  // Strong-beat chord-tone alignment (+20).
  const strongNotes = notes.filter((n) => isStrongBeat(n.startBeat));
  if (strongNotes.length > 0) {
    const aligned = strongNotes.filter((n) =>
      isChordTone(n.midi, chords[n.chordIndex]?.pitchClasses ?? []),
    ).length;
    breakdown.chordAlignment = (aligned / strongNotes.length) * 20;
  }

  // Smooth voice leading (+10): full credit for a stepwise-dominated line.
  if (notes.length > 1) {
    let sum = 0;
    for (let i = 1; i < notes.length; i++) {
      sum += Math.abs(notes[i].midi - notes[i - 1].midi);
    }
    const mean = sum / (notes.length - 1);
    breakdown.voiceLeading = mean <= 2.5 ? 10 : Math.max(0, 10 - (mean - 2.5) * (10 / 3.5));
  }

  // Phrase ending (+15): long final note, on a stable tone of the last chord.
  const last = notes[notes.length - 1];
  const lastChord = chords[chords.length - 1];
  let ending = 0;
  if (last.durationBeats >= 2) ending += 6;
  else if (last.durationBeats >= 1) ending += 3;
  if (lastChord && isChordTone(last.midi, lastChord.pitchClasses)) ending += 6;
  if (notes.length > 1 && Math.abs(last.midi - notes[notes.length - 2].midi) <= 2) ending += 3;
  breakdown.phraseEnding = Math.min(15, ending);

  // Rhythmic interest (+10): a few distinct durations with one dominant.
  const durCounts = new Map<number, number>();
  for (const n of notes) durCounts.set(n.durationBeats, (durCounts.get(n.durationBeats) ?? 0) + 1);
  const distinct = durCounts.size;
  if (distinct >= 2 && distinct <= 4) breakdown.rhythmicInterest = 10;
  else if (distinct === 1) breakdown.rhythmicInterest = 3;
  else breakdown.rhythmicInterest = 6;

  // Range sanity (+5).
  const inRange = notes.every((n) => n.midi >= 36 && n.midi <= 96);
  breakdown.range = inRange ? 5 : 0;

  // Penalties.
  let directionChanges = 0;
  let prevDir = 0;
  for (let i = 1; i < notes.length; i++) {
    const interval = notes[i].midi - notes[i - 1].midi;
    const dir = Math.sign(interval);
    if (Math.abs(interval) > 9) breakdown.penalties -= 2;
    if (dir !== 0 && prevDir !== 0 && dir !== prevDir) directionChanges++;
    if (dir !== 0) prevDir = dir;
  }
  if (notes.length > 4) {
    const changeRate = directionChanges / (notes.length - 2);
    if (changeRate > 0.6) {
      breakdown.penalties -= Math.min(10, (changeRate - 0.6) * 25);
    }
  }
  if (plan.totalBeats > 0 && notes.length / plan.totalBeats > 2) {
    breakdown.penalties -= 5;
  }
  for (let i = 0; i < notes.length - 1; i++) {
    const n = notes[i];
    if (!n.isChordTone && Math.abs(notes[i + 1].midi - n.midi) > 2) {
      breakdown.penalties -= 3;
    }
  }

  const total =
    breakdown.motifRepetition +
    breakdown.contour +
    breakdown.chordAlignment +
    breakdown.voiceLeading +
    breakdown.phraseEnding +
    breakdown.rhythmicInterest +
    breakdown.range +
    breakdown.penalties;

  return { total, breakdown };
}
