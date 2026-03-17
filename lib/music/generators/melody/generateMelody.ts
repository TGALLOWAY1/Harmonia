/**
 * Melody Generation Engine
 *
 * Generates a monophonic melody line that fits over a chord progression,
 * constrained to the given scale. Three styles are supported:
 *   - lyrical:     mostly stepwise motion, longer notes, occasional leaps
 *   - rhythmic:    shorter notes, syncopation, repeated pitches
 *   - arpeggiated: chord-tone focused, wider intervals
 */

import { pitchClassToMidi, midiToNoteName, midiToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";
import type { DurationClass } from "../advanced/types";
import type { Melody, MelodyNote, MelodyGenerationOptions } from "./types";

/* ─── Helpers ─── */

/** Simple seeded PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function durationClassToBeats(dc?: DurationClass): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

/** Build an ordered set of scale MIDI notes in the target octave range. */
function buildScaleMidiSet(
  scalePitchClasses: PitchClass[],
  octave: number,
): number[] {
  const notes: number[] = [];
  // Cover one octave below to one octave above the target for flexibility
  for (let oct = octave - 1; oct <= octave + 1; oct++) {
    for (const pc of scalePitchClasses) {
      notes.push(pitchClassToMidi(pc, oct));
    }
  }
  return notes.sort((a, b) => a - b);
}

/** Find the closest scale tone to a given MIDI note. */
function closestScaleTone(target: number, scaleMidi: number[]): number {
  let best = scaleMidi[0];
  let bestDist = Math.abs(target - best);
  for (const m of scaleMidi) {
    const d = Math.abs(target - m);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

/** Step up or down by N scale degrees from the current note. */
function stepByDegrees(
  current: number,
  degrees: number,
  scaleMidi: number[],
): number {
  const idx = scaleMidi.indexOf(current);
  if (idx === -1) {
    // Not exactly on a scale tone — snap first
    const snapped = closestScaleTone(current, scaleMidi);
    const snapIdx = scaleMidi.indexOf(snapped);
    const targetIdx = Math.max(0, Math.min(scaleMidi.length - 1, snapIdx + degrees));
    return scaleMidi[targetIdx];
  }
  const targetIdx = Math.max(0, Math.min(scaleMidi.length - 1, idx + degrees));
  return scaleMidi[targetIdx];
}

/** Check whether a MIDI note is a chord tone. */
function isChordTone(midi: number, chordPitchClasses: PitchClass[]): boolean {
  const pc = midiToPitchClass(midi);
  return chordPitchClasses.includes(pc);
}

/* ─── Rhythm Patterns ─── */

/** Return an array of note durations (in beats) that fill the given total beats. */
function generateRhythm(
  totalBeats: number,
  style: "lyrical" | "rhythmic" | "arpeggiated",
  rng: () => number,
): number[] {
  const durations: number[] = [];
  let remaining = totalBeats;

  if (style === "lyrical") {
    // Mostly half and whole notes
    while (remaining > 0) {
      if (remaining >= 2 && rng() < 0.5) {
        durations.push(2);
        remaining -= 2;
      } else if (remaining >= 1) {
        durations.push(1);
        remaining -= 1;
      } else {
        durations.push(remaining);
        remaining = 0;
      }
    }
  } else if (style === "rhythmic") {
    // Mostly quarter and eighth notes
    while (remaining > 0) {
      if (remaining >= 1 && rng() < 0.55) {
        durations.push(1);
        remaining -= 1;
      } else if (remaining >= 0.5) {
        durations.push(0.5);
        remaining -= 0.5;
      } else {
        durations.push(remaining);
        remaining = 0;
      }
    }
  } else {
    // Arpeggiated: even quarter notes mostly
    while (remaining > 0) {
      if (remaining >= 1) {
        durations.push(1);
        remaining -= 1;
      } else {
        durations.push(remaining);
        remaining = 0;
      }
    }
  }

  return durations;
}

/* ─── Pitch Selection ─── */

function pickNextPitch(
  current: number,
  chordPCs: PitchClass[],
  scaleMidi: number[],
  style: "lyrical" | "rhythmic" | "arpeggiated",
  rng: () => number,
  isFirst: boolean,
): number {
  if (style === "arpeggiated") {
    // Pick a chord tone near the current pitch
    const chordTonesInRange = scaleMidi.filter(
      (m) => chordPCs.includes(midiToPitchClass(m)) && Math.abs(m - current) <= 12,
    );
    if (chordTonesInRange.length > 0) {
      return chordTonesInRange[Math.floor(rng() * chordTonesInRange.length)];
    }
  }

  if (isFirst) {
    // Start on a chord tone (prefer root or fifth)
    const rootMidi = scaleMidi.filter(
      (m) => midiToPitchClass(m) === chordPCs[0] && Math.abs(m - current) <= 7,
    );
    if (rootMidi.length > 0) return rootMidi[Math.floor(rng() * rootMidi.length)];
  }

  // Stepwise motion with occasional leaps
  const r = rng();
  let degrees: number;
  if (style === "lyrical") {
    // Mostly steps (1-2), occasional leap (3-4)
    if (r < 0.35) degrees = 1;
    else if (r < 0.65) degrees = -1;
    else if (r < 0.78) degrees = 2;
    else if (r < 0.88) degrees = -2;
    else if (r < 0.94) degrees = 3;
    else degrees = -3;
  } else {
    // Rhythmic: allow repeated notes and small steps
    if (r < 0.20) degrees = 0; // repeated pitch
    else if (r < 0.45) degrees = 1;
    else if (r < 0.70) degrees = -1;
    else if (r < 0.82) degrees = 2;
    else if (r < 0.92) degrees = -2;
    else degrees = rng() < 0.5 ? 3 : -3;
  }

  return stepByDegrees(current, degrees, scaleMidi);
}

/* ─── Main Generator ─── */

export function generateMelody(options: MelodyGenerationOptions): Melody {
  const {
    scalePitchClasses,
    chords,
    style,
    octave = 5,
    seed,
  } = options;

  const rng = createRng(seed ?? Date.now());
  const scaleMidi = buildScaleMidiSet(scalePitchClasses, octave);
  const notes: MelodyNote[] = [];

  // Starting pitch: root of first chord in the target octave
  const firstRoot = chords[0]?.root ?? scalePitchClasses[0];
  let currentPitch = pitchClassToMidi(firstRoot, octave);
  currentPitch = closestScaleTone(currentPitch, scaleMidi);

  let globalBeatOffset = 0;

  for (let ci = 0; ci < chords.length; ci++) {
    const chord = chords[ci];
    const chordBeats = durationClassToBeats(chord.durationClass);
    const chordPCs = chord.pitchClasses;

    // Generate rhythm for this chord's duration
    const rhythm = generateRhythm(chordBeats, style, rng);

    let localBeatOffset = 0;
    for (let ni = 0; ni < rhythm.length; ni++) {
      const dur = rhythm[ni];
      const isFirst = ni === 0;

      currentPitch = pickNextPitch(
        currentPitch,
        chordPCs,
        scaleMidi,
        style,
        rng,
        isFirst,
      );

      // Clamp to reasonable range
      const low = pitchClassToMidi(scalePitchClasses[0], octave - 1);
      const high = pitchClassToMidi(scalePitchClasses[0], octave + 1);
      if (currentPitch < low) currentPitch = closestScaleTone(low, scaleMidi);
      if (currentPitch > high) currentPitch = closestScaleTone(high, scaleMidi);

      const pc = midiToPitchClass(currentPitch);

      notes.push({
        midi: currentPitch,
        noteWithOctave: midiToNoteName(currentPitch),
        pitchClass: pc,
        durationBeats: dur,
        startBeat: globalBeatOffset + localBeatOffset,
        chordIndex: ci,
        isChordTone: isChordTone(currentPitch, chordPCs),
      });

      localBeatOffset += dur;
    }

    globalBeatOffset += chordBeats;
  }

  return { notes, octave };
}
