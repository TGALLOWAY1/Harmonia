/**
 * Playback Dynamics Model
 *
 * Pure, deterministic velocity shaping so a generated progression and melody
 * sound *played* rather than *triggered*. Every function here is a plain
 * multiplier factory — no randomness (the bounded random variation that
 * makes two takes differ lives in `humanization.ts`) and no Tone.js
 * dependency, so the same model drives live playback, previews, the
 * Sketchpad, and MIDI export identically.
 *
 * The multipliers are intentionally small and are meant to be layered:
 * `applyDynamics` composes them against a user-chosen base velocity and
 * clamps the result, so this module can never override the user's own
 * velocity setting — only shade it the way a real player would.
 */

import { metricWeight } from "../music/generators/melody/meter";
import type { Melody, MelodyNote, MelodyPhrase } from "../music/generators/melody/types";

/* ─── Shared helpers ─── */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Positive modulo (unlike `%`, never returns a negative result). */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/* ─── Chord voicing ─── */

/** The top voice (the ear's melody) is the strongest. */
const TOP_VOICE_WEIGHT = 1.12;
/** The bass anchors the chord — a little stronger than the inner voices. */
const BASS_VOICE_WEIGHT = 1.05;
/** Inner voices sit back so the outer voices carry the chord. */
const INNER_VOICE_WEIGHT = 0.92;
/** Below this pitch, register compensation starts softening notes. */
const LOW_REGISTER_THRESHOLD = 48; // C3
/** By this pitch, the full compensation is reached. */
const LOW_REGISTER_FLOOR = 24; // C1
/** Maximum softening applied at/below the floor, to avoid mud. */
const LOW_REGISTER_MAX_CUT = 0.1;

function registerCompensation(midi: number): number {
  if (midi >= LOW_REGISTER_THRESHOLD) return 1;
  const depth = clamp(
    (LOW_REGISTER_THRESHOLD - midi) / (LOW_REGISTER_THRESHOLD - LOW_REGISTER_FLOOR),
    0,
    1,
  );
  return 1 - depth * LOW_REGISTER_MAX_CUT;
}

/**
 * Per-note velocity multipliers for a chord, aligned to `midiNotes`' input
 * order (the caller may pass notes in any order — the bass and top voice are
 * found by pitch, not position). The bass is a little stronger, the top
 * voice (the ear's melody) is strongest, inner voices sit back, and very low
 * notes are softened a touch further so they don't turn to mud.
 */
export function chordVoiceWeights(midiNotes: number[]): number[] {
  const n = midiNotes.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  let lowestIndex = 0;
  let highestIndex = 0;
  for (let i = 1; i < n; i++) {
    if (midiNotes[i] < midiNotes[lowestIndex]) lowestIndex = i;
    if (midiNotes[i] > midiNotes[highestIndex]) highestIndex = i;
  }

  return midiNotes.map((midi, i) => {
    const role = i === highestIndex ? TOP_VOICE_WEIGHT : i === lowestIndex ? BASS_VOICE_WEIGHT : INNER_VOICE_WEIGHT;
    return role * registerCompensation(midi);
  });
}

/* ─── Metric accent ─── */

const ACCENT_DOWNBEAT = 1.1;
const ACCENT_BEAT_THREE = 1.04;
const ACCENT_SECONDARY_BEAT = 0.98;
const ACCENT_OFFBEAT = 0.92;

/**
 * Velocity multiplier from the metric weight of a position within the bar:
 * the downbeat strongest, beat three next, beats two/four a little softer,
 * and the off-beats softest — within roughly ±10%. `beatInBar` need not
 * already be reduced to `[0, beatsPerBar)`; non-4/4 meters are mapped onto
 * the same GTTM-derived shape proportionally.
 */
export function metricAccent(beatInBar: number, beatsPerBar = 4): number {
  const scaled = beatsPerBar === 4 ? beatInBar : (beatInBar / beatsPerBar) * 4;
  const weight = metricWeight(scaled);
  switch (weight) {
    case 4:
      return ACCENT_DOWNBEAT;
    case 3:
      return ACCENT_BEAT_THREE;
    case 2:
      return ACCENT_SECONDARY_BEAT;
    default:
      return ACCENT_OFFBEAT;
  }
}

/* ─── Progression-level dynamics ─── */

const FIRST_CHORD_LIFT = 1.05;
const LAST_CHORD_SETTLE = 0.95;
/** Short chords (a beat or less) are passing harmony and sit a little lighter. */
const SHORT_CHORD_WEIGHTS: Record<string, number> = { quarter: 0.96, eighth: 0.93 };
const TENSION_SWELL_MAX = 0.05;
const PROGRESSION_DYNAMICS_RANGE = 0.08;

/**
 * Per-chord velocity multipliers across a progression: a slight lift on the
 * first chord, a slight settle on the last, a touch less on short passing
 * chords (a beat or less), and — when tension values are given (already
 * 0–1) — a small additional swell that peaks with the tensest chord. Stays
 * within about ±8%.
 */
export function progressionDynamics(chords: { durationClass?: string; tension?: number }[]): number[] {
  const n = chords.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  return chords.map((chord, i) => {
    let mult = 1;
    if (i === 0) mult *= FIRST_CHORD_LIFT;
    if (i === n - 1) mult *= LAST_CHORD_SETTLE;
    const shortWeight = chord.durationClass ? SHORT_CHORD_WEIGHTS[chord.durationClass] : undefined;
    if (shortWeight !== undefined) mult *= shortWeight;
    if (typeof chord.tension === "number" && Number.isFinite(chord.tension)) {
      mult *= 1 + clamp(chord.tension, 0, 1) * TENSION_SWELL_MAX;
    }
    return clamp(mult, 1 - PROGRESSION_DYNAMICS_RANGE, 1 + PROGRESSION_DYNAMICS_RANGE);
  });
}

/* ─── Melody dynamics ─── */

const CHORD_TONE_BOOST = 1.03;
const NON_CHORD_TONE_CUT = 0.93;
/** No boost at or below this many beats; boost grows with duration past it. */
const LONG_NOTE_REFERENCE_BEATS = 1;
const LONG_NOTE_SCALE = 0.04;
const LONG_NOTE_MAX_BOOST = 0.08;
/** How far a note's velocity can swell towards a phrase's peak. */
const PHRASE_ARC_RANGE = 0.12;
const CLIMAX_PHRASE_BOOST = 1.05;
/** Closing taper on the last note of a phrase that ends in a final cadence. */
const FINAL_CADENCE_TAPER = 0.85;
/** Small lift on the note that leads into the next phrase as a pickup. */
const PICKUP_LIFT = 1.05;
const PICKUP_WINDOW_BEATS = 1;
/** Guards the arc ratio when a phrase's peak sits exactly at its edge. */
const ARC_EPSILON = 0.25;

const MELODY_DYNAMICS_MIN = 0.75;
const MELODY_DYNAMICS_MAX = 1.2;

export interface MelodyDynamicsOptions {
  /** Beats per bar for the metric-accent component (default 4). */
  beatsPerBar?: number;
}

function chordToneWeight(isChordTone: boolean): number {
  return isChordTone ? CHORD_TONE_BOOST : NON_CHORD_TONE_CUT;
}

function longNoteBoost(durationBeats: number): number {
  return 1 + clamp((durationBeats - LONG_NOTE_REFERENCE_BEATS) * LONG_NOTE_SCALE, 0, LONG_NOTE_MAX_BOOST);
}

/** The phrase containing `beat`, or the nearest edge phrase for notes that fall outside every range (pickups, rounding). */
function findPhraseIndex(phrases: MelodyPhrase[], beat: number): number {
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    if (beat >= p.startBeat && beat < p.endBeat) return i;
  }
  if (phrases.length === 0) return -1;
  if (beat < phrases[0].startBeat) return 0;
  return phrases.length - 1;
}

/** 0 at the phrase's edges, 1 at its peak — crescendo in, decrescendo out. */
function phraseArcFactor(note: MelodyNote, phrase: MelodyPhrase): number {
  const peak = clamp(phrase.peakBeat, phrase.startBeat, phrase.endBeat);
  if (note.startBeat <= peak) {
    const span = Math.max(peak - phrase.startBeat, ARC_EPSILON);
    return clamp((note.startBeat - phrase.startBeat) / span, 0, 1);
  }
  const span = Math.max(phrase.endBeat - peak, ARC_EPSILON);
  return clamp(1 - (note.startBeat - peak) / span, 0, 1);
}

/**
 * Per-note velocity multipliers aligned with `melody.notes`: a phrase arc
 * (crescendo toward `peakBeat`, decrescendo after), the climax phrase
 * slightly louder overall, a taper on the last note of a `final` cadence,
 * non-chord tones a little softer than chord tones, metric accent, longer
 * notes a little stronger, and a small lift on pickup notes leading into the
 * next phrase. Drawn melodies carry no `phrases`; that degrades gracefully
 * to metric accent + chord-tone weighting only. The overall range stays
 * within about 0.75–1.2 so it never overrides the user's velocity setting.
 */
export function melodyDynamics(melody: Melody, opts: MelodyDynamicsOptions = {}): number[] {
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const notes = melody.notes;
  const phrases = melody.phrases;

  if (!phrases || phrases.length === 0) {
    return notes.map((note) => {
      const mult = metricAccent(mod(note.startBeat, beatsPerBar), beatsPerBar) * chordToneWeight(note.isChordTone);
      return clamp(mult, MELODY_DYNAMICS_MIN, MELODY_DYNAMICS_MAX);
    });
  }

  // Notes in time order (by original index) so adjacency-based effects —
  // pickups and phrase-final notes — can be found without assuming the
  // caller's array is already sorted.
  const orderedIndices = notes.map((_, i) => i).sort((a, b) => notes[a].startBeat - notes[b].startBeat);

  // The single note immediately before each phrase boundary, within a short
  // window, reads as a pickup (anacrusis) into that phrase.
  const pickupIndices = new Set<number>();
  for (const phrase of phrases) {
    let candidate = -1;
    for (const idx of orderedIndices) {
      if (notes[idx].startBeat < phrase.startBeat) candidate = idx;
      else break;
    }
    if (candidate >= 0 && phrase.startBeat - notes[candidate].startBeat <= PICKUP_WINDOW_BEATS) {
      pickupIndices.add(candidate);
    }
  }

  // The last note of a phrase that closes with a final cadence gets a
  // closing taper.
  const finalTaperIndices = new Set<number>();
  phrases.forEach((phrase, phraseIdx) => {
    if (phrase.cadence !== "final") return;
    const isLastPhrase = phraseIdx === phrases.length - 1;
    let lastIdx = -1;
    let lastBeat = -Infinity;
    for (const idx of orderedIndices) {
      const beat = notes[idx].startBeat;
      const inThisPhrase = beat >= phrase.startBeat && beat < phrase.endBeat;
      // The very last phrase may have a trailing note whose start lands on
      // or after its nominal end (rounding, or a held final note) — still
      // its closing note, so include it too.
      const isTrailingNote = isLastPhrase && beat >= phrase.startBeat;
      if ((inThisPhrase || isTrailingNote) && beat >= lastBeat) {
        lastBeat = beat;
        lastIdx = idx;
      }
    }
    if (lastIdx >= 0) finalTaperIndices.add(lastIdx);
  });

  return notes.map((note, i) => {
    const phraseIndex = findPhraseIndex(phrases, note.startBeat);
    const phrase = phraseIndex >= 0 ? phrases[phraseIndex] : undefined;

    let mult = metricAccent(mod(note.startBeat, beatsPerBar), beatsPerBar);
    mult *= chordToneWeight(note.isChordTone);
    mult *= longNoteBoost(note.durationBeats);

    if (phrase) {
      mult *= 1 + phraseArcFactor(note, phrase) * PHRASE_ARC_RANGE;
      if (phrase.isClimax) mult *= CLIMAX_PHRASE_BOOST;
    }
    if (pickupIndices.has(i)) mult *= PICKUP_LIFT;
    if (finalTaperIndices.has(i)) mult *= FINAL_CADENCE_TAPER;

    return clamp(mult, MELODY_DYNAMICS_MIN, MELODY_DYNAMICS_MAX);
  });
}

/* ─── Composition ─── */

/** Velocity floor/ceiling, matching `humanization.ts`'s own bounds. */
const MIN_VELOCITY = 0.15;
const MAX_VELOCITY = 1;

/**
 * Compose a base velocity (0–1) with any number of dynamics multipliers and
 * clamp the result to [0.15, 1] — the same floor/ceiling `humanization.ts`
 * uses, so a note is always audible and never clips.
 */
export function applyDynamics(base: number, ...multipliers: number[]): number {
  const value = multipliers.reduce((acc, m) => acc * m, base);
  return clamp(value, MIN_VELOCITY, MAX_VELOCITY);
}
