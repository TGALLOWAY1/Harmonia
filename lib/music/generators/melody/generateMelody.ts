/**
 * Melody Generation Engine — phrase-based composer.
 *
 * Composes melodies top-down instead of sampling notes one at a time:
 *
 *   1. Harmonic context — what each chord is (quality, function, tension),
 *      which notes are chord, colour or avoid tones over it, which tones
 *      want to resolve where, and a guide-tone line through the changes
 *      (harmonicContext.ts).
 *   2. Form plan     — the progression cut into two-bar phrases with
 *      question/answer cadences, one climax phrase, a local peak, a pickup,
 *      a breath and a density for each (phrasePlan.ts).
 *   3. Rhythm        — a small vocabulary of metrically weighted one-bar
 *      cells, tiled and varied per phrase, with onsets at chord changes and
 *      a lengthened cadence note (rhythm.ts).
 *   4. Motifs        — a basic idea stated, restated with a new ending,
 *      fragmented and sequenced, and liquidated into the close (motif.ts).
 *   5. Realization   — a beam search per phrase over expectation, harmony,
 *      tendency-tone and climax costs (realizePitches.ts).
 *   6. Ornaments     — passing/neighbour/suspension/anticipation/appoggiatura
 *      tones inserted with guaranteed resolution (ornaments.ts).
 *   7. Selection     — several candidates from derived seeds are scored
 *      against corpus-calibrated targets; one of the near-best is kept, so
 *      equal-quality candidates still vary with the seed (scoring.ts).
 *
 * Mood profiles (dark / emotional / dreamy / energetic) parameterize every
 * stage; the user's melody style modulates the mood. Output is deterministic
 * for a fixed seed.
 */

import { midiToNoteName, midiToPitchClass } from "@/lib/theory/midiUtils";
import { planApproaches } from "./approach";
import { buildHarmonicContext, midiPc, type HarmonicContext } from "./harmonicContext";
import {
  buildChordMidiSet,
  buildScaleMidiSet,
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
import type { Melody, MelodyGenerationOptions, MelodyNote, MelodyPhrase } from "./types";

let noteIdCounter = 0;
function nextNoteId(): string {
  return `mn-${++noteIdCounter}-${Date.now().toString(36)}`;
}

const DEFAULT_CANDIDATES = 8;

/**
 * How close to the best score a candidate may be and still count as a tie.
 * A strict argmax lets the same few melodies win over and over; treating
 * near-equal candidates as tied keeps the quality gain while letting the seed
 * choose among melodies that are, musically, equally good (the chord engine
 * does the same).
 */
const SCORE_TIE_BAND = 0.04;

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
    tensionCurve,
    form = "auto",
  } = options;

  if (chords.length === 0 || scalePitchClasses.length === 0) {
    return { notes: [], octave };
  }

  const baseSeed = seed ?? Date.now();
  const candidates = Math.max(1, candidateCount ?? DEFAULT_CANDIDATES);
  const profile = applyStyleToMood(MOOD_PROFILES[mood], style);
  const harmonyContext = buildHarmonicContext(chords, scalePitchClasses, { tensionCurve });
  const scaleMidi = buildScaleMidiSet(scalePitchClasses, octave);
  const { low, high } = moodRegister(profile, octave);

  const scored: { notes: MelodyNote[]; score: MelodyScore; plan: PhrasePlan }[] = [];

  for (let k = 0; k < candidates; k++) {
    const rng = createRng(deriveSeed(baseSeed, k));

    const plan = buildPhrasePlan(chords, profile, rng, { octave, harmony: harmonyContext, form });
    const motifA = generateMotif(profile, Math.min(4, plan.totalBeats), rng, "A");
    const events = layoutMotifs(plan, motifA, profile, rng, style);

    // Which chord changes this candidate walks into, and how. Planned after
    // the rhythm, because an approach needs an onset in the beat before the
    // change; spent inside the beam search, which is free to overrule it.
    const approaches = planApproaches(events, plan.chordStartBeats, profile, harmony, rng, harmonyContext);

    let noteEvents = realizePitches(events, plan, {
      scalePitchClasses,
      chords,
      style,
      harmony,
      profile,
      octave,
      approaches,
    });

    noteEvents = applyOrnaments(noteEvents, plan, {
      chords,
      scaleMidi,
      harmony,
      profile,
      registerLow: low,
      registerHigh: high,
      harmonyContext,
    }, rng);

    const notes = finalize(noteEvents, plan, chords, harmony, profile, octave, harmonyContext);
    const score = scoreMelody(notes, plan, chords, profile, octave);
    scored.push({ notes, score, plan });
  }

  const winner = pickAmongBest(scored, baseSeed);
  return { notes: winner.notes, octave, phrases: summarizePhrases(winner.plan) };
}

function pickAmongBest<T extends { score: MelodyScore }>(scored: T[], baseSeed: number): T {
  if (scored.length === 1) return scored[0];
  const best = Math.max(...scored.map((s) => s.score.total));
  const threshold = best - Math.abs(best) * SCORE_TIE_BAND;
  const contenders = scored.filter((s) => s.score.total >= threshold);
  const pick = Math.floor(createRng(baseSeed ^ 0x5bf03635)() * contenders.length);
  return contenders[Math.min(pick, contenders.length - 1)];
}

function summarizePhrases(plan: PhrasePlan): MelodyPhrase[] {
  return plan.phrases.map((p) => ({
    startBeat: p.startBeat,
    endBeat: p.endBeat,
    material: p.material,
    cadence: p.isFinal ? "final" : p.cadence,
    isClimax: p.isClimax,
    peakBeat: p.peakBeat,
  }));
}

/**
 * Final safety passes that make the engine's harmonic promises true by
 * construction, then convert to the public MelodyNote shape:
 *   - notes held over a chord change may not clash with the new chord
 *     (deliberate suspensions are exempt: they resolve by design);
 *   - strong beats sound chord tones (strict) / never semitone-clash
 *     (expressive);
 *   - every non-chord tone resolves by step — anything stranded is pulled
 *     onto the nearest chord tone — and a chromatic tone, which exists only
 *     as an approach, resolves by a semitone on the very next onset.
 * With the beam search these passes rarely fire; they remain the guarantee.
 */
function finalize(
  noteEvents: NoteEvent[],
  plan: PhrasePlan,
  chords: MelodyGenerationOptions["chords"],
  harmony: "expressive" | "strict",
  profile: MoodProfile,
  octave: number,
  harmonyContext: HarmonicContext,
): MelodyNote[] {
  const { low, high } = moodRegister(profile, octave);
  const chordMidiSets = chords.map((c) => buildChordMidiSet(c.pitchClasses, octave));
  const inRangeChordTones = (ci: number) => {
    const inRange = chordMidiSets[ci].filter((m) => m >= low && m <= high);
    return inRange.length > 0 ? inRange : chordMidiSets[ci];
  };
  /**
   * Where a note has to become a chord tone, the nearest one is the obvious
   * choice and often the wrong one: moving a semitone away from its
   * neighbours turns two steps into two fourths. The repair stays near the
   * note it replaces and, among the tones that do, takes the one that keeps
   * the line either side of it closest together.
   */
  const neighbourPull = (m: number, other: number | undefined) =>
    other === undefined ? 0 : 0.9 * Math.max(0, Math.abs(m - other) - 2);
  const repair = (midi: number, chordIndex: number, from: number | undefined, to: number | undefined, keepShape = false): number => {
    const tones = inRangeChordTones(chordIndex);
    let best = tones[0];
    let bestCost = Infinity;
    for (const m of tones) {
      const cost = Math.abs(m - midi) + (keepShape ? 0 : neighbourPull(m, from) + neighbourPull(m, to));
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    return best;
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
  for (let i = 0; i < noteEvents.length; i++) {
    const n = noteEvents[i];
    if (!isStrongBeat(n.startBeat)) continue;
    const pcs = chords[n.chordIndex].pitchClasses;
    const needsSnap = harmony === "strict"
      ? !isChordTone(n.midi, pcs)
      : isSemitoneClash(n.midi, pcs);
    if (needsSnap) {
      n.midi = repair(n.midi, n.chordIndex, noteEvents[i - 1]?.midi, noteEvents[i + 1]?.midi, n.isHead === true);
    }
  }

  // Non-chord tones must resolve by step; otherwise become chord tones.
  // A tone outside the chord's own scale is an approach or nothing: it has to
  // resolve by a semitone, not merely by a step. Walk right-to-left so a snap
  // never invalidates an already-verified resolution earlier in the line.
  for (let i = noteEvents.length - 1; i >= 0; i--) {
    const n = noteEvents[i];
    const pcs = chords[n.chordIndex].pitchClasses;
    if (n.suspended || isChordTone(n.midi, pcs)) continue;
    const chromatic = harmonyContext.chords[n.chordIndex]?.categories[midiPc(n.midi)] === "chromatic";
    const next = noteEvents[i + 1];
    const motion = next !== undefined ? Math.abs(next.midi - n.midi) : Infinity;
    const resolvesByStep =
      next !== undefined &&
      (chromatic ? motion === 1 : motion <= 2) &&
      next.startBeat - (n.startBeat + n.durationBeats) <= 1;
    if (!resolvesByStep) {
      n.midi = repair(n.midi, n.chordIndex, noteEvents[i - 1]?.midi, next?.midi, n.isHead === true);
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
