/**
 * Pitch realization.
 *
 * Turns placed motif events into concrete pitches. Each motif instance is
 * anchored to the contour curve, the motif's degree contour is walked from
 * that anchor, and every event is resolved against the sounding chord:
 * strong beats are pulled hard onto chord tones, semitone clashes are
 * avoided, leaps obey the mood's limit, and chord changes prefer common
 * tones / stepwise voice leading. Crucially, the first realization of each
 * motif pattern is memoized so later statements replay the same shape
 * (re-anchored and re-harmonized) — repetition you can hear.
 */

import { type PitchClass } from "@/lib/theory/midiUtils";
import {
  buildChordMidiSet,
  buildScaleMidiSet,
  chordIndexAtBeat,
  closestTone,
  isChordTone,
  isSemitoneClash,
  isStrongBeat,
  melodicCost,
  stepByDegrees,
} from "./helpers";
import { contourTargetAt } from "./contour";
import { moodRegister, type MoodProfile } from "./moods";
import type { PlacedEvent } from "./motif";
import type { PhrasePlan } from "./phrasePlan";
import type { MelodyGenerationOptions, MelodyHarmony, MelodyStyle } from "./types";

/** Internal pipeline note, before conversion to MelodyNote. */
export type NoteEvent = {
  midi: number;
  startBeat: number;
  durationBeats: number;
  chordIndex: number;
  /** Suspensions deliberately hold a tone across a chord change. */
  suspended?: boolean;
};

export type RealizationContext = {
  scalePitchClasses: PitchClass[];
  chords: MelodyGenerationOptions["chords"];
  style: MelodyStyle;
  harmony: MelodyHarmony;
  profile: MoodProfile;
  octave: number;
};

export function realizePitches(
  events: PlacedEvent[],
  plan: PhrasePlan,
  ctx: RealizationContext,
): NoteEvent[] {
  const { scalePitchClasses, chords, style, harmony, profile, octave } = ctx;
  const scaleMidi = buildScaleMidiSet(scalePitchClasses, octave);
  const chordMidiSets = chords.map((c) => buildChordMidiSet(c.pitchClasses, octave));
  const { low, high } = moodRegister(profile, octave);

  // Candidate universe per chord: scale ∪ chromatic chord tones, in register.
  const universes = chords.map((c, i) =>
    Array.from(new Set([...scaleMidi, ...chordMidiSets[i]]))
      .filter((m) => m >= low && m <= high)
      .sort((a, b) => a - b),
  );

  // Anchor each phrase segment to the contour at its start. Sharing one
  // anchor per segment makes motif statements within a segment repeat at the
  // same pitch (a real hook), while the contour moves between segments
  // (repeat, then sequence). Pickups anchor to the segment they lead into.
  const inRangeScale = scaleMidi.filter((m) => m >= low && m <= high);
  const segmentAnchor: number[] = [];
  for (const seg of plan.segments) {
    let target = contourTargetAt(
      plan.contour, seg.startBeat, plan.totalBeats, plan.climaxBeat, profile, octave,
    );
    // Smooth anchor motion: a segment may not jump more than a fifth from
    // the previous one, so transitions stay singable even when the contour
    // swings across the register.
    const prevAnchor = segmentAnchor[segmentAnchor.length - 1];
    if (prevAnchor !== undefined) {
      target = Math.max(prevAnchor - 7, Math.min(prevAnchor + 7, target));
    }
    // Anchor on a chord tone of the segment's opening harmony so the motif's
    // home degree is consonant by construction — otherwise strong-beat
    // snapping collapses neighboring degrees onto the same pitch.
    const segChordIdx = chordIndexAtBeat(plan.chordStartBeats, seg.startBeat);
    const chordPool = chordMidiSets[segChordIdx].filter((m) => m >= low && m <= high);
    const pool = chordPool.length > 0
      ? chordPool
      : inRangeScale.length > 0 ? inRangeScale : scaleMidi;
    segmentAnchor.push(closestTone(target, pool));
  }
  const anchorForEvent = (ev: PlacedEvent): number => {
    // Pickups sit just before a boundary; anchor them to the next segment.
    const beat = ev.segmentRole === "pickup" ? ev.startBeat + ev.durationBeats : ev.startBeat;
    for (let i = 0; i < plan.segments.length; i++) {
      if (beat >= plan.segments[i].startBeat && beat < plan.segments[i].endBeat) {
        return segmentAnchor[i];
      }
    }
    return segmentAnchor[segmentAnchor.length - 1];
  };

  // Memoized realization per motif pattern: semitone offsets from the anchor,
  // so repeated statements of a motif replay the same audible shape.
  const patternMemo = new Map<string, number[]>();

  const notes: NoteEvent[] = [];
  let prev: number | null = null;
  let prevDirection = 0;

  for (const ev of events) {
    const chordIdx = chordIndexAtBeat(plan.chordStartBeats, ev.startBeat);
    const chordPCs = chords[chordIdx].pitchClasses;
    const chordMidi = chordMidiSets[chordIdx];
    const universe = universes[chordIdx];
    const anchor = anchorForEvent(ev);
    const strong = isStrongBeat(ev.startBeat);

    let midi: number;

    if (ev.isCadenceFinal) {
      // The melody's resting point: a stable tone (root or 3rd preferred) of
      // the final chord, near the preceding note.
      const inRangeChord = chordMidi.filter((m) => m >= low && m <= high);
      const pool = inRangeChord.length > 0 ? inRangeChord : chordMidi;
      const rootPc = chords[chordIdx].root;
      const stable = new Set<number>([0, 4, 3]); // root, major 3rd, minor 3rd above root
      let best = pool[0];
      let bestScore = Infinity;
      for (const m of pool) {
        const ref = prev ?? anchor;
        const fromRoot = (((m - rootToMidiClass(rootPc)) % 12) + 12) % 12;
        const score = Math.abs(m - ref) + (stable.has(fromRoot) ? 0 : 3);
        if (score < bestScore) {
          bestScore = score;
          best = m;
        }
      }
      midi = best;
    } else {
      const memoKey = ev.patternKey;
      const memo = patternMemo.get(memoKey);
      if (memo && memo[ev.indexInInstance] !== undefined) {
        // Replay the realized motif shape, re-anchored to this statement —
        // but never beyond the mood's leap limit from the previous note.
        let raw = anchor + memo[ev.indexInInstance];
        if (prev !== null) {
          raw = Math.max(prev - profile.maxLeap, Math.min(prev + profile.maxLeap, raw));
        }
        midi = closestTone(raw, universe.length > 0 ? universe : scaleMidi);
      } else {
        const target = stepByDegrees(anchor, ev.degreeOffset, scaleMidi);
        midi = pickPitch(
          target, prev, prevDirection, chordPCs, universe, chordMidi,
          style, harmony, strong, profile.maxLeap,
        );
        if (memoKey !== "pickup") {
          const arr = patternMemo.get(memoKey) ?? [];
          arr[ev.indexInInstance] = midi - anchor;
          patternMemo.set(memoKey, arr);
        }
      }
    }

    // Harmony correction at the source: strict pins strong beats to chord
    // tones; expressive only repairs semitone clashes.
    const inRangeChord = chordMidi.filter((m) => m >= low && m <= high);
    if (strong && inRangeChord.length > 0) {
      const needsSnap = harmony === "strict"
        ? !isChordTone(midi, chordPCs)
        : isSemitoneClash(midi, chordPCs);
      if (needsSnap) midi = closestTone(midi, inRangeChord);
    }

    if (midi < low || midi > high) {
      const inRange = (universe.length > 0 ? universe : scaleMidi).filter(
        (m) => m >= low && m <= high,
      );
      if (inRange.length > 0) midi = closestTone(midi, inRange);
    }

    prevDirection = prev === null ? 0 : midi > prev ? 1 : midi < prev ? -1 : 0;
    prev = midi;

    notes.push({
      midi,
      startBeat: ev.startBeat,
      durationBeats: ev.durationBeats,
      chordIndex: chordIdx,
    });
  }

  return notes;
}

function rootToMidiClass(root: PitchClass): number {
  const order: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return order.indexOf(root);
}

/**
 * Score candidates around the motif target. Deterministic argmin: structure
 * and variety come from the planning stages, not from per-note dice rolls.
 */
function pickPitch(
  target: number,
  prev: number | null,
  prevDirection: number,
  chordPCs: PitchClass[],
  universe: number[],
  chordMidi: number[],
  style: MelodyStyle,
  harmony: MelodyHarmony,
  strong: boolean,
  maxLeap: number,
): number {
  let candidates = universe.filter(
    (m) =>
      Math.abs(m - target) <= 5 &&
      (prev === null || Math.abs(m - prev) <= maxLeap),
  );
  if (candidates.length === 0) {
    candidates = universe.filter((m) => prev === null || Math.abs(m - prev) <= maxLeap);
  }
  if (candidates.length === 0) candidates = universe.length > 0 ? universe : [target];

  // Strict harmony: strong beats may only sound chord tones.
  if (harmony === "strict" && strong) {
    const chordCandidates = candidates.filter((m) => isChordTone(m, chordPCs));
    if (chordCandidates.length > 0) {
      candidates = chordCandidates;
    } else if (chordMidi.length > 0) {
      return closestTone(prev ?? target, chordMidi);
    }
  }

  let best = candidates[0];
  let bestScore = Infinity;
  for (const m of candidates) {
    // Motif fidelity is the dominant term: the planned shape wins unless
    // harmony genuinely objects.
    let score = Math.abs(m - target) * 1.5;

    if (prev !== null) {
      score += melodicCost(prev, m, prevDirection) * 0.8;
      // Leap recovery: after a leap, continuing away in the same direction
      // is strongly discouraged.
      if (prevDirection !== 0 && Math.abs(m - prev) > 2 && Math.sign(m - prev) === prevDirection) {
        score += 1.5;
      }
    }

    if (isChordTone(m, chordPCs)) {
      score -= strong ? 5 : 1;
      if (style === "arpeggiated") score -= 3;
    }
    if (isSemitoneClash(m, chordPCs)) {
      score += strong ? 6 : 2;
    }

    // Pitch repetition is a rhythmic-style device; elsewhere it flattens
    // the line into monotony.
    if (prev !== null && m === prev) {
      score += style === "rhythmic" ? -0.5 : 1.5;
    }

    if (score < bestScore || (score === bestScore && Math.abs(m - target) < Math.abs(best - target))) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
