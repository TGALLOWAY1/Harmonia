/**
 * Melody Generation Engine — phrase-based composer.
 *
 * Composes melodies top-down instead of sampling notes one at a time:
 *
 *   1. Phrase plan   — intro/development/climax/resolution segments mapped
 *                      onto the progression's beats, plus a contour shape
 *                      and climax point (phrasePlan.ts, contour.ts).
 *   2. Motifs        — a rhythmic/melodic cell is generated, varied, and
 *                      tiled into the plan with call-and-response, pickups,
 *                      and a cadence cell ending on a long note (motif.ts).
 *   3. Realization   — motif events become pitches: contour-anchored,
 *                      chord-aware, leap-limited, with motif statements
 *                      memoized so repetition is audible (realizePitches.ts).
 *   4. Ornaments     — passing/neighbor/suspension/anticipation/appoggiatura
 *                      tones inserted with guaranteed resolution (ornaments.ts).
 *   5. Selection     — several candidate melodies are generated from derived
 *                      seeds, scored for catchiness, and the best one is
 *                      returned (scoring.ts).
 *
 * Mood profiles (dark / emotional / dreamy / energetic) parameterize every
 * stage; the user's melody style modulates the mood. Output is deterministic
 * for a fixed seed.
 */

import { midiToNoteName, midiToPitchClass } from "@/lib/theory/midiUtils";
import {
  buildChordMidiSet,
  buildScaleMidiSet,
  closestTone,
  isChordTone,
  isSemitoneClash,
  isStrongBeat,
} from "./helpers";
import { applyStyleToMood, MOOD_PROFILES, moodRegister, type MoodProfile } from "./moods";
import { generateMotif, layoutMotifs } from "./motif";
import { applyOrnaments } from "./ornaments";
import { buildPhrasePlan, type PhrasePlan } from "./phrasePlan";
import { realizePitches, type NoteEvent } from "./realizePitches";
import { createRng, deriveSeed } from "./rng";
import { scoreMelody, type MelodyScore } from "./scoring";
import type { Melody, MelodyGenerationOptions, MelodyNote } from "./types";

let noteIdCounter = 0;
function nextNoteId(): string {
  return `mn-${++noteIdCounter}-${Date.now().toString(36)}`;
}

const DEFAULT_CANDIDATES = 8;

export function generateMelody(options: MelodyGenerationOptions): Melody {
  const {
    scalePitchClasses,
    chords,
    style,
    harmony = "expressive",
    mood = "emotional",
    octave = 5,
    seed,
    candidateCount,
  } = options;

  if (chords.length === 0 || scalePitchClasses.length === 0) {
    return { notes: [], octave };
  }

  const baseSeed = seed ?? Date.now();
  const candidates = Math.max(1, candidateCount ?? DEFAULT_CANDIDATES);
  const profile = applyStyleToMood(MOOD_PROFILES[mood], style);

  let best: { notes: MelodyNote[]; score: MelodyScore } | null = null;

  for (let k = 0; k < candidates; k++) {
    const rng = createRng(deriveSeed(baseSeed, k));

    const plan = buildPhrasePlan(chords, profile, rng);
    const motifLength = plan.totalBeats >= 16 ? 4 : 2;
    const motifA = generateMotif(profile, Math.min(motifLength, plan.totalBeats), rng, "A");
    const events = layoutMotifs(plan, motifA, profile, rng);

    let noteEvents = realizePitches(events, plan, {
      scalePitchClasses,
      chords,
      style,
      harmony,
      profile,
      octave,
    });

    const scaleMidi = buildScaleMidiSet(scalePitchClasses, octave);
    noteEvents = applyOrnaments(noteEvents, plan, {
      chords,
      scaleMidi,
      harmony,
      profile,
    }, rng);

    const notes = finalize(noteEvents, plan, chords, harmony, profile, octave);
    const score = scoreMelody(notes, plan, chords, profile, octave);

    if (best === null || score.total > best.score.total) {
      best = { notes, score };
    }
  }

  return { notes: best!.notes, octave };
}

/**
 * Final safety passes that make the engine's harmonic promises true by
 * construction, then convert to the public MelodyNote shape:
 *   - notes held over a chord change may not clash with the new chord
 *     (deliberate suspensions are exempt: they resolve by design);
 *   - strong beats sound chord tones (strict) / never semitone-clash
 *     (expressive);
 *   - every non-chord tone resolves by step — anything stranded is pulled
 *     onto the nearest chord tone.
 */
function finalize(
  noteEvents: NoteEvent[],
  plan: PhrasePlan,
  chords: MelodyGenerationOptions["chords"],
  harmony: "expressive" | "strict",
  profile: MoodProfile,
  octave: number,
): MelodyNote[] {
  const { low, high } = moodRegister(profile, octave);
  const chordMidiSets = chords.map((c) => buildChordMidiSet(c.pitchClasses, octave));
  const inRangeChordTones = (ci: number) => {
    const inRange = chordMidiSets[ci].filter((m) => m >= low && m <= high);
    return inRange.length > 0 ? inRange : chordMidiSets[ci];
  };

  // Shorten notes that are held into a chord they clash with.
  for (const n of noteEvents) {
    if (n.suspended) continue;
    const noteEnd = n.startBeat + n.durationBeats;
    for (let ci = n.chordIndex + 1; ci < chords.length; ci++) {
      const boundary = plan.chordStartBeats[ci];
      if (boundary >= noteEnd) break;
      if (isSemitoneClash(n.midi, chords[ci].pitchClasses)) {
        n.durationBeats = boundary - n.startBeat;
        break;
      }
    }
  }

  // Re-assert strong-beat harmony after ornamentation.
  for (const n of noteEvents) {
    if (!isStrongBeat(n.startBeat)) continue;
    const pcs = chords[n.chordIndex].pitchClasses;
    const needsSnap = harmony === "strict"
      ? !isChordTone(n.midi, pcs)
      : isSemitoneClash(n.midi, pcs);
    if (needsSnap) {
      n.midi = closestTone(n.midi, inRangeChordTones(n.chordIndex));
    }
  }

  // Non-chord tones must resolve by step; otherwise become chord tones.
  for (let i = 0; i < noteEvents.length; i++) {
    const n = noteEvents[i];
    const pcs = chords[n.chordIndex].pitchClasses;
    if (n.suspended || isChordTone(n.midi, pcs)) continue;
    const next = noteEvents[i + 1];
    const resolvesByStep =
      next !== undefined &&
      Math.abs(next.midi - n.midi) <= 2 &&
      next.startBeat - (n.startBeat + n.durationBeats) <= 1;
    if (!resolvesByStep) {
      n.midi = closestTone(n.midi, inRangeChordTones(n.chordIndex));
    }
  }

  return noteEvents.map((n) => ({
    id: nextNoteId(),
    midi: n.midi,
    noteWithOctave: midiToNoteName(n.midi),
    pitchClass: midiToPitchClass(n.midi),
    durationBeats: n.durationBeats,
    startBeat: n.startBeat,
    chordIndex: n.chordIndex,
    isChordTone: isChordTone(n.midi, chords[n.chordIndex].pitchClasses),
    source: "generated" as const,
  }));
}
