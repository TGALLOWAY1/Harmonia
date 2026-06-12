/**
 * Phrase planning.
 *
 * Before any note is placed, the melody gets a phrase plan: the progression's
 * total beats are partitioned into intro / development / climax / resolution
 * segments (snapped to chord boundaries), each with a motif slot and a
 * tension level taken from the same tension curve that shaped the chord
 * progression. The plan also fixes the contour shape and the climax beat, so
 * every later stage works toward the same arc.
 */

import { getTensionCurve } from "../advanced/phraseStructure";
import { durationClassToBeats } from "./helpers";
import { pickContour } from "./contour";
import type { MoodProfile } from "./moods";
import type { ContourShape, MelodyGenerationOptions } from "./types";

export type PhraseSegmentRole = "intro" | "development" | "climax" | "resolution";

export type PhraseSegment = {
  role: PhraseSegmentRole;
  /** Absolute beats from progression start. */
  startBeat: number;
  endBeat: number;
  /** Which motif material fills this segment. */
  motifSlot: "A" | "A'" | "climax" | "cadence";
  /** 0–1, scaled by the mood's tensionScale. */
  tension: number;
  /** Whether the segment ends the phrase (long note + resolution). */
  isPhraseEnd: boolean;
};

export type PhrasePlan = {
  segments: PhraseSegment[];
  totalBeats: number;
  contour: ContourShape;
  /** Beat where the registral peak should land. */
  climaxBeat: number;
  /** Absolute start beat of each chord, in order. */
  chordStartBeats: number[];
};

const SEGMENT_TEMPLATE: { role: PhraseSegmentRole; motifSlot: PhraseSegment["motifSlot"]; endFraction: number }[] = [
  { role: "intro", motifSlot: "A", endFraction: 0.25 },
  { role: "development", motifSlot: "A'", endFraction: 0.6 },
  { role: "climax", motifSlot: "climax", endFraction: 0.85 },
  { role: "resolution", motifSlot: "cadence", endFraction: 1 },
];

/** Snap a target beat to the nearest chord boundary (chord start beat). */
function nearestChordBoundary(target: number, chordStartBeats: number[], totalBeats: number): number {
  let best = totalBeats;
  let bestDist = Math.abs(totalBeats - target);
  for (const b of chordStartBeats) {
    const d = Math.abs(b - target);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function averageTension(
  curve: number[],
  chordStartBeats: number[],
  chordBeats: number[],
  startBeat: number,
  endBeat: number,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < chordStartBeats.length; i++) {
    const chordStart = chordStartBeats[i];
    const chordEnd = chordStart + chordBeats[i];
    if (chordEnd > startBeat && chordStart < endBeat) {
      sum += curve[i] ?? 0.3;
      count++;
    }
  }
  return count > 0 ? sum / count : 0.3;
}

export function buildPhrasePlan(
  chords: MelodyGenerationOptions["chords"],
  profile: MoodProfile,
  rng: () => number,
): PhrasePlan {
  const chordBeats = chords.map((c) => durationClassToBeats(c.durationClass));
  const chordStartBeats: number[] = [];
  let cursor = 0;
  for (const beats of chordBeats) {
    chordStartBeats.push(cursor);
    cursor += beats;
  }
  const totalBeats = cursor;

  const contour = pickContour(profile, rng);
  const tensionCurve = getTensionCurve(chords.length);
  const scaleTension = (t: number) => Math.max(0, Math.min(1, t * profile.tensionScale));

  const segments: PhraseSegment[] = [];

  if (chords.length <= 1 || totalBeats <= 4) {
    // Too short for an arc: a single resolving gesture.
    segments.push({
      role: "resolution",
      startBeat: 0,
      endBeat: totalBeats,
      motifSlot: "cadence",
      tension: scaleTension(0.3),
      isPhraseEnd: true,
    });
  } else if (totalBeats <= 8 || chords.length <= 2) {
    // Short form: development + resolution.
    const split = nearestChordBoundary(totalBeats * 0.6, chordStartBeats, totalBeats);
    const devEnd = split > 0 && split < totalBeats ? split : totalBeats / 2;
    segments.push({
      role: "development",
      startBeat: 0,
      endBeat: devEnd,
      motifSlot: "A",
      tension: scaleTension(averageTension(tensionCurve, chordStartBeats, chordBeats, 0, devEnd)),
      isPhraseEnd: false,
    });
    segments.push({
      role: "resolution",
      startBeat: devEnd,
      endBeat: totalBeats,
      motifSlot: "cadence",
      tension: scaleTension(averageTension(tensionCurve, chordStartBeats, chordBeats, devEnd, totalBeats)),
      isPhraseEnd: true,
    });
  } else {
    // Full form: intro → development → climax → resolution.
    let prevEnd = 0;
    for (const tpl of SEGMENT_TEMPLATE) {
      const rawEnd = tpl.endFraction >= 1
        ? totalBeats
        : nearestChordBoundary(totalBeats * tpl.endFraction, chordStartBeats, totalBeats);
      const endBeat = Math.min(totalBeats, Math.max(prevEnd, rawEnd));
      if (endBeat <= prevEnd) continue; // degenerate segment — merge into neighbor
      segments.push({
        role: tpl.role,
        startBeat: prevEnd,
        endBeat,
        motifSlot: tpl.motifSlot,
        tension: scaleTension(averageTension(tensionCurve, chordStartBeats, chordBeats, prevEnd, endBeat)),
        isPhraseEnd: tpl.role === "resolution",
      });
      prevEnd = endBeat;
    }
    // Guarantee the plan covers the full progression and ends with a resolution.
    if (segments.length === 0 || segments[segments.length - 1].endBeat < totalBeats) {
      segments.push({
        role: "resolution",
        startBeat: prevEnd,
        endBeat: totalBeats,
        motifSlot: "cadence",
        tension: scaleTension(0.2),
        isPhraseEnd: true,
      });
    } else {
      segments[segments.length - 1].role = "resolution";
      segments[segments.length - 1].motifSlot = "cadence";
      segments[segments.length - 1].isPhraseEnd = true;
    }
  }

  // Climax beat: start of the climax segment plus a small jitter, on the grid.
  const climaxSegment = segments.find((s) => s.role === "climax");
  let climaxBeat: number;
  if (climaxSegment) {
    const span = climaxSegment.endBeat - climaxSegment.startBeat;
    climaxBeat = climaxSegment.startBeat + Math.round((rng() * span * 0.5) / 0.5) * 0.5;
  } else {
    climaxBeat = Math.round((totalBeats * 0.6) / 0.5) * 0.5;
  }

  return { segments, totalBeats, contour, climaxBeat, chordStartBeats };
}
