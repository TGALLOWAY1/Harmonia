import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";

import type { ChordMoodProfile } from "./chordMoods";
import type { PlannedAdvancedChord, VoicedChord } from "./types";

/**
 * Whole-progression scoring.
 *
 * The melody engine draws eight candidate melodies, scores each and keeps the
 * best. Chord generation was a single pass: whatever the one template draw and
 * the one greedy voicing sweep produced was what the user heard, bad draws
 * included. This rubric is the other half of that architecture — it lets the
 * generator compare finished progressions rather than hope.
 *
 * Every term is deterministic, so a seeded generation stays reproducible.
 * Higher is better; terms are roughly commensurate and combined by weight.
 */
export type ProgressionScore = {
  total: number;
  breakdown: {
    cadence: number;
    bassMotion: number;
    registerArc: number;
    voiceLeading: number;
    variety: number;
    tensionMatch: number;
    moodMatch: number;
  };
};

const WEIGHTS = {
  cadence: 2.0,
  bassMotion: 1.5,
  registerArc: 1.0,
  voiceLeading: 1.2,
  variety: 1.5,
  tensionMatch: 1.0,
  moodMatch: 0.8,
} as const;

const pitchClassOf = (midi: number) => ((midi % 12) + 12) % 12;

/**
 * Does the progression actually land?
 *
 * Rewards a tonic arrival in root position, and the approach to it: a dominant
 * or pre-dominant before the final chord is what makes the arrival read as a
 * cadence rather than a stop.
 */
function scoreCadence(
  voiced: VoicedChord[],
  planned: PlannedAdvancedChord[],
  tonic: PitchClass
): number {
  if (voiced.length === 0) return 0;

  const last = voiced[voiced.length - 1];
  const tonicPc = PITCH_CLASSES.indexOf(tonic);
  let score = 0;

  // Arrival on the tonic.
  if (pitchClassOf(Math.min(...last.midi)) === tonicPc) score += 0.5;
  else if (last.midi.some((m) => pitchClassOf(m) === tonicPc)) score += 0.2;

  // Approached by a dominant or pre-dominant.
  if (planned.length >= 2) {
    const approach = planned[planned.length - 2];
    if (approach.isDominant) score += 0.4;
    else if (approach.degreeLabel.toLowerCase().startsWith("iv") ||
             approach.degreeLabel.toLowerCase().startsWith("ii")) score += 0.25;
  }

  // The final chord should be the most settled thing in the progression.
  const finalTension = planned[planned.length - 1]?.tensionLevel ?? 0;
  if (finalTension <= 0.1) score += 0.1;

  return Math.min(1, score);
}

/**
 * Bass-line quality.
 *
 * Root motion is what listeners track hardest for direction. Step and fifth
 * motion read as purposeful; a static bass reads as a pedal, and large leaps
 * read as disjointed. Measured on signed semitone distance, not a `% 12` fold,
 * so a step and a ninth leap are genuinely distinguished.
 */
function scoreBassLine(voiced: VoicedChord[]): number {
  if (voiced.length < 2) return 0.5;

  const bass = voiced.map((chord) => Math.min(...chord.midi));
  let total = 0;

  for (let i = 1; i < bass.length; i++) {
    const delta = Math.abs(bass[i] - bass[i - 1]);
    const interval = delta % 12;

    if (delta === 0) total += 0.1;                        // static — allowed, not rewarded
    else if (interval === 1 || interval === 2) total += 1.0;  // step: the strongest motion
    else if (interval === 5 || interval === 7) total += 0.9;  // fourth/fifth: functional
    else if (interval === 3 || interval === 4) total += 0.7;  // third: smooth
    else total += 0.3;

    if (delta > 12) total -= 0.3;                          // penalise octave-plus leaps
  }

  const motion = total / (bass.length - 1);

  // A bass that never moves at all is the pedal failure mode.
  const distinct = new Set(bass).size;
  const stagnation = distinct === 1 ? 0.5 : 0;

  return Math.max(0, Math.min(1, motion - stagnation));
}

/**
 * Does the register describe a shape?
 *
 * Rewards a soprano that rises into the body of the phrase and settles at the
 * cadence, rather than sitting still. Without this nothing in the pipeline
 * planned an arc; the top voice just wandered wherever local cost sent it.
 */
function scoreRegisterArc(voiced: VoicedChord[]): number {
  if (voiced.length < 3) return 0.5;

  const soprano = voiced.map((chord) => Math.max(...chord.midi));
  const distinct = new Set(soprano).size;
  if (distinct === 1) return 0; // frozen top voice

  const peakIndex = soprano.indexOf(Math.max(...soprano));
  const interior = peakIndex > 0 && peakIndex < soprano.length - 1;

  // Movement without thrash: reward range, penalise constant direction changes.
  const range = Math.max(...soprano) - Math.min(...soprano);
  const rangeScore = Math.min(1, range / 12);

  let reversals = 0;
  for (let i = 2; i < soprano.length; i++) {
    const a = Math.sign(soprano[i - 1] - soprano[i - 2]);
    const b = Math.sign(soprano[i] - soprano[i - 1]);
    if (a !== 0 && b !== 0 && a !== b) reversals++;
  }
  const smoothness = 1 - reversals / Math.max(1, soprano.length - 2);

  return Math.max(0, Math.min(1, 0.4 * rangeScore + 0.3 * smoothness + (interior ? 0.3 : 0)));
}

/** Smooth voice leading, normalised against a generous per-chord budget. */
function scoreVoiceLeading(costs: number[]): number {
  if (costs.length === 0) return 0.5;
  const finite = costs.filter((c) => Number.isFinite(c));
  if (finite.length === 0) return 0;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  // Costs in this engine sit roughly in 0..10; map that onto 1..0.
  return Math.max(0, Math.min(1, 1 - mean / 10));
}

/**
 * Harmonic variety.
 *
 * Penalises back-to-back repeats (which read as one long chord and waste a
 * slot the user asked for) and tonic-heavy progressions that never leave home.
 */
function scoreVariety(planned: PlannedAdvancedChord[], tonic: PitchClass): number {
  if (planned.length < 2) return 0.5;

  let adjacentRepeats = 0;
  for (let i = 1; i < planned.length; i++) {
    if (planned[i].symbol === planned[i - 1].symbol) adjacentRepeats++;
  }

  const distinct = new Set(planned.map((c) => c.symbol)).size;
  const distinctRatio = distinct / planned.length;

  const tonicCount = planned.filter((c) => c.root === tonic).length;
  // One tonic at each end is healthy; more than half the progression is not.
  const tonicPenalty = Math.max(0, tonicCount / planned.length - 0.5) * 2;

  const repeatPenalty = adjacentRepeats / (planned.length - 1);

  return Math.max(0, Math.min(1, distinctRatio - repeatPenalty - tonicPenalty));
}

/**
 * How closely the realised tension follows the phrase's target curve.
 *
 * The generator has always computed a tension curve; nothing ever checked
 * whether the chords it picked actually followed it.
 */
function scoreTensionMatch(planned: PlannedAdvancedChord[], target: number[]): number {
  if (planned.length === 0 || target.length === 0) return 0.5;

  let error = 0;
  let counted = 0;
  for (let i = 0; i < planned.length && i < target.length; i++) {
    const realised = realisedTension(planned[i]);
    error += Math.abs(realised - target[i]);
    counted++;
  }
  if (counted === 0) return 0.5;
  return Math.max(0, 1 - error / counted);
}

/** Tension a chord actually carries, from its function and colour. */
function realisedTension(chord: PlannedAdvancedChord): number {
  let tension = 0;
  if (chord.isDominant) tension += 0.6;
  if (chord.kind === "secondary-dominant") tension += 0.25;
  if (chord.kind === "tritone-substitution") tension += 0.35;
  if (chord.kind === "passing") tension += 0.3;
  if (chord.kind === "suspension") tension += 0.2;
  // More pitch classes means more colour, and more colour means more tension.
  tension += Math.max(0, chord.pitchClasses.length - 3) * 0.12;
  return Math.min(1, tension);
}

/** Does the realised texture sit where the mood asked for it? */
function scoreMoodMatch(voiced: VoicedChord[], profile: ChordMoodProfile): number {
  if (voiced.length === 0) return 0.5;

  const centres = voiced.map((chord) => (Math.min(...chord.midi) + Math.max(...chord.midi)) / 2);
  const meanCentre = centres.reduce((a, b) => a + b, 0) / centres.length;
  const centreError = Math.abs(meanCentre - profile.registerCenter);
  const centreScore = Math.max(0, 1 - centreError / 18);

  const meanSpan =
    voiced.reduce((sum, chord) => sum + (Math.max(...chord.midi) - Math.min(...chord.midi)), 0) /
    voiced.length;
  const spanTarget = profile.registerSpan;
  const spanScore = Math.max(0, 1 - Math.abs(meanSpan - spanTarget) / 18);

  return Math.max(0, Math.min(1, 0.6 * centreScore + 0.4 * spanScore));
}

export function scoreProgression(params: {
  voiced: VoicedChord[];
  planned: PlannedAdvancedChord[];
  voiceLeadingCosts: number[];
  tensionCurve: number[];
  tonic: PitchClass;
  mood: ChordMoodProfile;
}): ProgressionScore {
  const { voiced, planned, voiceLeadingCosts, tensionCurve, tonic, mood } = params;

  const breakdown = {
    cadence: scoreCadence(voiced, planned, tonic),
    bassMotion: scoreBassLine(voiced),
    registerArc: scoreRegisterArc(voiced),
    voiceLeading: scoreVoiceLeading(voiceLeadingCosts),
    variety: scoreVariety(planned, tonic),
    tensionMatch: scoreTensionMatch(planned, tensionCurve),
    moodMatch: scoreMoodMatch(voiced, mood),
  };

  const total = (Object.keys(breakdown) as (keyof typeof breakdown)[]).reduce(
    (sum, key) => sum + breakdown[key] * WEIGHTS[key],
    0
  );

  return { total, breakdown };
}
