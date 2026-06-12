/**
 * Contour planning.
 *
 * A contour is a normalized shape function over the whole melody that gives
 * every beat a target register position. Pitch realization is pulled toward
 * the contour target, which is what turns local note choices into a single
 * recognizable line (arch, wave, rise...) instead of a random walk.
 */

import type { ContourShape } from "./types";
import { moodRegister, type MoodProfile } from "./moods";

/** Pick a contour shape using the mood's preference weights. */
export function pickContour(profile: MoodProfile, rng: () => number): ContourShape {
  const entries = Object.entries(profile.contourWeights) as [ContourShape, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [shape, w] of entries) {
    r -= w;
    if (r <= 0) return shape;
  }
  return entries[entries.length - 1][0];
}

/** Normalized shape value in [0, 1] for progress t in [0, 1]. */
function shapeValue(shape: ContourShape, t: number): number {
  switch (shape) {
    case "rising":
      return t;
    case "falling":
      return 1 - t;
    case "arch":
      return Math.sin(Math.PI * t);
    case "inverted-arch":
      return 1 - Math.sin(Math.PI * t);
    case "wave":
      // One full cycle starting and ending mid-register.
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * t);
    case "stair-step": {
      // Four rising terraces.
      const step = Math.min(3, Math.floor(t * 4));
      return step / 3;
    }
  }
}

/**
 * Warp progress so that peak-shaped contours place their peak at the planned
 * climax beat rather than the literal midpoint.
 */
function warpToClimax(shape: ContourShape, t: number, climaxT: number): number {
  if (shape !== "arch" && shape !== "inverted-arch") return t;
  const c = Math.min(0.9, Math.max(0.1, climaxT));
  return t <= c ? (0.5 * t) / c : 0.5 + (0.5 * (t - c)) / (1 - c);
}

/**
 * Target MIDI pitch for a given absolute beat. The realization stage treats
 * this as gravity, not a hard requirement.
 */
export function contourTargetAt(
  shape: ContourShape,
  beat: number,
  totalBeats: number,
  climaxBeat: number,
  profile: MoodProfile,
  octave: number,
): number {
  const { low, high } = moodRegister(profile, octave);
  if (totalBeats <= 0) return Math.round((low + high) / 2);
  const t = Math.max(0, Math.min(1, beat / totalBeats));
  const warped = warpToClimax(shape, t, climaxBeat / totalBeats);
  return low + shapeValue(shape, warped) * (high - low);
}
