/**
 * Melody Generation Engine
 *
 * Generates a monophonic melody line over a chord progression.
 * Uses tension curves to shape contour, scale membership for pitch selection,
 * chord-tone preference on strong beats, and a smoothness cost function
 * (adapted from the voice-leading engine) for melodic coherence.
 *
 * Three styles:
 *   - lyrical:     stepwise motion, longer notes, occasional expressive leaps
 *   - rhythmic:    shorter notes, syncopation, repeated pitches
 *   - arpeggiated: chord-tone focused, wider intervals
 */

import { pitchClassToMidi, midiToNoteName, midiToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";
import type { DurationClass } from "../advanced/types";
import type { Melody, MelodyNote, MelodyGenerationOptions } from "./types";

/* ─── Helpers ─── */

let noteIdCounter = 0;
function nextNoteId(): string {
  return `mn-${++noteIdCounter}-${Date.now().toString(36)}`;
}

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

/** Build an ordered set of scale MIDI notes spanning the target range. */
function buildScaleMidiSet(scalePitchClasses: PitchClass[], octave: number): number[] {
  const notes: number[] = [];
  for (let oct = octave - 1; oct <= octave + 1; oct++) {
    for (const pc of scalePitchClasses) {
      notes.push(pitchClassToMidi(pc, oct));
    }
  }
  return notes.sort((a, b) => a - b);
}

/** Find the closest scale tone to a target MIDI note. */
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

/** Step by N scale degrees from a current note. */
function stepByDegrees(current: number, degrees: number, scaleMidi: number[]): number {
  let idx = scaleMidi.indexOf(current);
  if (idx === -1) {
    const snapped = closestScaleTone(current, scaleMidi);
    idx = scaleMidi.indexOf(snapped);
  }
  const targetIdx = Math.max(0, Math.min(scaleMidi.length - 1, idx + degrees));
  return scaleMidi[targetIdx];
}

function isChordTone(midi: number, chordPitchClasses: PitchClass[]): boolean {
  return chordPitchClasses.includes(midiToPitchClass(midi));
}

/* ─── Smoothness cost (adapted from voiceLeading.ts) ─── */

/**
 * Compute a melodic movement cost between two pitches.
 * Penalises large leaps, rewards stepwise motion, penalises consecutive
 * same-direction leaps (when tracking direction).
 */
function melodicCost(from: number, to: number, prevDirection: number): number {
  const interval = Math.abs(to - from);
  const direction = to > from ? 1 : to < from ? -1 : 0;

  // Stepwise (1-2 semitones) is cheapest
  if (interval <= 2) return 0;
  // Small third (3-4 semitones) is acceptable
  if (interval <= 4) return 1;
  // Fifth/fourth (5-7) moderate cost
  if (interval <= 7) return 3;
  // Larger leaps get expensive
  let cost = interval * 0.8;

  // Penalise consecutive same-direction leaps
  if (direction !== 0 && direction === prevDirection && interval > 2) {
    cost += 2;
  }

  return cost;
}

/* ─── Rhythm Generation ─── */

/**
 * Generate rhythm pattern for a chord's duration.
 * Tension influences density: higher tension → shorter, denser notes.
 */
function generateRhythm(
  totalBeats: number,
  style: "lyrical" | "rhythmic" | "arpeggiated",
  tension: number,
  rng: () => number,
): number[] {
  const durations: number[] = [];
  let remaining = totalBeats;

  // Tension shifts probability toward shorter notes
  const shortBias = tension * 0.3; // 0–0.3

  if (style === "lyrical") {
    while (remaining > 0) {
      if (remaining >= 2 && rng() < 0.5 - shortBias) {
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
    while (remaining > 0) {
      if (remaining >= 1 && rng() < 0.5 - shortBias) {
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
    // Arpeggiated: even quarter notes
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

/* ─── Pitch Selection with Smoothness ─── */

/**
 * Pick the next pitch using a candidate scoring system.
 * Candidates are nearby scale tones scored by:
 *   1. Melodic smoothness (low interval cost)
 *   2. Chord-tone bonus on strong beats
 *   3. Tension-driven range (higher tension → allow bigger leaps)
 *   4. Style-specific preferences
 */
function pickNextPitch(
  current: number,
  chordPCs: PitchClass[],
  scaleMidi: number[],
  style: "lyrical" | "rhythmic" | "arpeggiated",
  tension: number,
  prevDirection: number,
  rng: () => number,
  isStrongBeat: boolean,
): { midi: number; direction: number } {
  // Determine search range based on style and tension
  const baseRange = style === "arpeggiated" ? 12 : style === "lyrical" ? 7 : 5;
  const range = baseRange + Math.floor(tension * 5); // tension widens range

  // Gather candidates
  const candidates = scaleMidi.filter(
    (m) => Math.abs(m - current) <= range,
  );
  if (candidates.length === 0) {
    return { midi: current, direction: 0 };
  }

  // Score each candidate (lower is better)
  const scored = candidates.map((m) => {
    let score = melodicCost(current, m, prevDirection);

    // Chord tone bonus on strong beats
    if (isStrongBeat && isChordTone(m, chordPCs)) {
      score -= 3;
    }

    // Non-strong beat: mild chord tone preference
    if (!isStrongBeat && isChordTone(m, chordPCs)) {
      score -= 1;
    }

    // Penalise staying on same note in lyrical style
    if (style === "lyrical" && m === current) {
      score += 4;
    }

    // Rhythmic style: allow repeated notes
    if (style === "rhythmic" && m === current) {
      score -= 1;
    }

    // Arpeggiated: strongly prefer chord tones
    if (style === "arpeggiated" && isChordTone(m, chordPCs)) {
      score -= 4;
    }

    // Slight downward tendency resolution at low tension
    if (tension < 0.2 && m < current && Math.abs(m - current) <= 2) {
      score -= 1;
    }

    // Contour: higher tension → slight upward pull
    if (tension > 0.5 && m > current) {
      score -= tension * 1.5;
    }

    return { midi: m, score };
  });

  // Sort by score, then weighted random selection from top candidates
  scored.sort((a, b) => a.score - b.score);

  // Take top 4 candidates, softmax-like selection
  const topN = scored.slice(0, Math.min(4, scored.length));
  const minScore = topN[0].score;
  const weights = topN.map((c) => Math.exp(-(c.score - minScore) * 0.5));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  let r = rng() * totalWeight;
  for (let i = 0; i < topN.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      const chosen = topN[i].midi;
      const dir = chosen > current ? 1 : chosen < current ? -1 : 0;
      return { midi: chosen, direction: dir };
    }
  }

  const chosen = topN[0].midi;
  return { midi: chosen, direction: chosen > current ? 1 : chosen < current ? -1 : 0 };
}

/* ─── Leap Recovery ─── */

/**
 * After a large leap (> 4 semitones), the next note should step back
 * in the opposite direction. This is a fundamental melodic writing principle.
 */
function shouldRecover(prev: number, current: number): number | null {
  const interval = Math.abs(current - prev);
  if (interval > 4) {
    // Return the direction to recover toward
    return current > prev ? -1 : 1;
  }
  return null;
}

/* ─── Default Tension Curve ─── */

function defaultTensionCurve(numChords: number): number[] {
  if (numChords <= 1) return [0.0];
  return Array.from({ length: numChords }, (_, i) => {
    const pos = i / (numChords - 1);
    // Rise to ~0.7 at 75%, then resolve
    if (pos >= 0.9) return 0.1;
    return Math.min(0.7, pos * 0.95);
  });
}

/* ─── Main Generator ─── */

export function generateMelody(options: MelodyGenerationOptions): Melody {
  const {
    scalePitchClasses,
    chords,
    style,
    tensionCurve,
    octave = 5,
    seed,
  } = options;

  const rng = createRng(seed ?? Date.now());
  const scaleMidi = buildScaleMidiSet(scalePitchClasses, octave);
  const tensions = tensionCurve ?? defaultTensionCurve(chords.length);
  const notes: MelodyNote[] = [];

  // Starting pitch: root of first chord in target octave
  const firstRoot = chords[0]?.root ?? scalePitchClasses[0];
  let currentPitch = pitchClassToMidi(firstRoot, octave);
  currentPitch = closestScaleTone(currentPitch, scaleMidi);

  let prevDirection = 0;
  let prevPitch = currentPitch;
  let globalBeatOffset = 0;

  for (let ci = 0; ci < chords.length; ci++) {
    const chord = chords[ci];
    const chordBeats = durationClassToBeats(chord.durationClass);
    const chordPCs = chord.pitchClasses;
    const tension = tensions[ci] ?? 0.3;

    const rhythm = generateRhythm(chordBeats, style, tension, rng);

    let localBeatOffset = 0;
    for (let ni = 0; ni < rhythm.length; ni++) {
      const dur = rhythm[ni];
      const isStrongBeat = localBeatOffset % 1 === 0 && (localBeatOffset === 0 || localBeatOffset % 2 === 0);

      // Check if we need leap recovery
      const recovery = shouldRecover(prevPitch, currentPitch);
      if (recovery !== null && ni > 0) {
        // Force a step in recovery direction
        const recovered = stepByDegrees(currentPitch, recovery, scaleMidi);
        prevPitch = currentPitch;
        currentPitch = recovered;
        prevDirection = recovery;
      } else {
        const result = pickNextPitch(
          currentPitch,
          chordPCs,
          scaleMidi,
          style,
          tension,
          prevDirection,
          rng,
          isStrongBeat,
        );
        prevPitch = currentPitch;
        currentPitch = result.midi;
        prevDirection = result.direction;
      }

      // Clamp to range
      const low = pitchClassToMidi(scalePitchClasses[0], octave - 1);
      const high = pitchClassToMidi(scalePitchClasses[0], octave + 1);
      if (currentPitch < low) currentPitch = closestScaleTone(low, scaleMidi);
      if (currentPitch > high) currentPitch = closestScaleTone(high, scaleMidi);

      const pc = midiToPitchClass(currentPitch);

      notes.push({
        id: nextNoteId(),
        midi: currentPitch,
        noteWithOctave: midiToNoteName(currentPitch),
        pitchClass: pc,
        durationBeats: dur,
        startBeat: globalBeatOffset + localBeatOffset,
        chordIndex: ci,
        isChordTone: isChordTone(currentPitch, chordPCs),
        source: "generated",
      });

      localBeatOffset += dur;
    }

    globalBeatOffset += chordBeats;
  }

  return { notes, octave };
}
