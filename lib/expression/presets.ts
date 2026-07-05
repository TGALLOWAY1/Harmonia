/**
 * MPE Expression Editor — Musical presets
 *
 * Generators that turn a musical intent (a glide shape, a pitch drop, a scoop,
 * a vibrato region) into an editable set of control points. Presets are just
 * convenient starting points — every curve they produce is fully editable
 * afterwards by dragging handles, inserting/deleting points, and smoothing or
 * straightening.
 *
 * The pitch lane measures `y` in semitones relative to the note's base pitch.
 */

import type { ExpressionPoint, ExpressionSegment, ExpressionKind } from "./types";
import { clamp, makeSegmentId, sortPoints } from "./curve";

export interface GeneratedCurve {
  points: ExpressionPoint[];
  smooth: boolean;
}

/** Glide/transition shapes that move from the note's pitch to `target` semitones. */
export type GlidePreset =
  | "join"
  | "smooth"
  | "easeIn"
  | "easeOut"
  | "expRise"
  | "expFall";

export const GLIDE_PRESET_LABELS: Record<GlidePreset, string> = {
  join: "Join (linear)",
  smooth: "Smooth Glide",
  easeIn: "Ease In",
  easeOut: "Ease Out",
  expRise: "Exponential Rise",
  expFall: "Exponential Fall",
};

/**
 * Build the control points for a glide of `target` semitones (positive = up,
 * negative = down). `expRise`/`expFall` follow an exponential contour; their
 * naming reflects the typical direction but the actual `target` sign is honoured
 * so either can bend either way.
 */
export function glideCurve(preset: GlidePreset, target: number): GeneratedCurve {
  switch (preset) {
    case "join":
      return { points: [{ t: 0, y: 0 }, { t: 1, y: target }], smooth: false };
    case "smooth":
      return {
        points: [{ t: 0, y: 0 }, { t: 0.5, y: target * 0.5 }, { t: 1, y: target }],
        smooth: true,
      };
    case "easeIn":
      // Slow start: stays near the origin, then accelerates to the target.
      return {
        points: [{ t: 0, y: 0 }, { t: 0.65, y: target * 0.18 }, { t: 1, y: target }],
        smooth: true,
      };
    case "easeOut":
      // Slow finish: rushes toward the target, then settles.
      return {
        points: [{ t: 0, y: 0 }, { t: 0.35, y: target * 0.82 }, { t: 1, y: target }],
        smooth: true,
      };
    case "expRise":
    case "expFall": {
      const pts: ExpressionPoint[] = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Normalized exponential 0→1 with a firm knee.
        const shaped = (Math.pow(4, t) - 1) / 3;
        pts.push({ t, y: target * shaped });
      }
      return { points: pts, smooth: true };
    }
  }
}

export interface PitchDropOptions {
  /** Semitones dropped below the note (always applied downward). */
  amount: number;
  /** Fraction of the note the drop occupies, 0..1. */
  duration: number;
  /** Whether the drop lands at the note's start or its end. */
  position: "start" | "end";
  /** Curve feel. */
  curve: "linear" | "smooth";
}

/** A downward pitch drop — great for basses, growls, and cinematic impacts. */
export function pitchDropCurve(opts: PitchDropOptions): GeneratedCurve {
  const d = clamp(opts.duration, 0.05, 1);
  const a = -Math.abs(opts.amount);
  const smooth = opts.curve !== "linear";
  if (opts.position === "start") {
    // Fall away from pitch immediately, then hold low.
    return { points: [{ t: 0, y: 0 }, { t: d, y: a }, { t: 1, y: a }], smooth };
  }
  // Hold pitch, then drop into the tail.
  return { points: [{ t: 0, y: 0 }, { t: 1 - d, y: 0 }, { t: 1, y: a }], smooth };
}

export interface PitchScoopOptions {
  /** Semitones the note starts below its target pitch. */
  amount: number;
  /** Fraction of the note spent settling up to pitch, 0..1. */
  duration: number;
  curve: "linear" | "smooth";
}

/** Inverse of a drop: begin below the target pitch, then settle up to it. */
export function pitchScoopCurve(opts: PitchScoopOptions): GeneratedCurve {
  const d = clamp(opts.duration, 0.05, 1);
  const a = -Math.abs(opts.amount);
  const smooth = opts.curve !== "linear";
  return { points: [{ t: 0, y: a }, { t: d, y: 0 }, { t: 1, y: 0 }], smooth };
}

export interface VibratoOptions {
  /** Peak depth in semitones. */
  depth: number;
  /** Number of oscillation cycles across the region. */
  cycles: number;
  /** Region of the note the vibrato covers, as [start, end] in 0..1. */
  region: [number, number];
  /** Fraction of the region used to fade the depth in (0..1). */
  fadeIn: number;
  /** Fraction of the region used to fade the depth out (0..1). */
  fadeOut: number;
}

/**
 * A vibrato oscillation confined to `region`, with optional depth fades at each
 * end. Points outside the region sit flat at 0 so the note holds pitch there.
 */
export function vibratoCurve(opts: VibratoOptions): GeneratedCurve {
  const [r0raw, r1raw] = opts.region;
  const r0 = clamp(Math.min(r0raw, r1raw), 0, 1);
  const r1 = clamp(Math.max(r0raw, r1raw), 0, 1);
  const cycles = Math.max(0.5, opts.cycles);
  const depth = Math.abs(opts.depth);
  const fadeIn = clamp(opts.fadeIn, 0, 1);
  const fadeOut = clamp(opts.fadeOut, 0, 1);

  const pts: ExpressionPoint[] = [{ t: 0, y: 0 }];
  if (r0 > 0.001) pts.push({ t: r0, y: 0 });

  const samples = Math.max(4, Math.round(cycles * 8));
  for (let i = 0; i <= samples; i++) {
    const localT = i / samples; // 0..1 across the region
    const t = r0 + (r1 - r0) * localT;
    let amp = depth;
    if (fadeIn > 0 && localT < fadeIn) amp *= localT / fadeIn;
    if (fadeOut > 0 && localT > 1 - fadeOut) amp *= (1 - localT) / fadeOut;
    const y = Math.sin(localT * cycles * 2 * Math.PI) * amp;
    pts.push({ t, y });
  }

  if (r1 < 0.999) pts.push({ t: r1, y: 0 });
  pts.push({ t: 1, y: 0 });
  return { points: sortPoints(pts), smooth: true };
}

/** Wrap a generated curve into a full segment ready for the store. */
export function toSegment(kind: ExpressionKind, curve: GeneratedCurve): ExpressionSegment {
  return {
    id: makeSegmentId(),
    lane: "pitch",
    kind,
    points: curve.points,
    smooth: curve.smooth,
  };
}

// ─── Sensible defaults for one-click application ───

export const DEFAULT_GLIDE_TARGET = 2; // a whole step up, editable afterwards
export const DEFAULT_DROP: PitchDropOptions = {
  amount: 12,
  duration: 0.35,
  position: "end",
  curve: "smooth",
};
export const DEFAULT_SCOOP: PitchScoopOptions = {
  amount: 3,
  duration: 0.3,
  curve: "smooth",
};
export const DEFAULT_VIBRATO: VibratoOptions = {
  depth: 0.5,
  cycles: 4,
  region: [0.3, 1],
  fadeIn: 0.25,
  fadeOut: 0.1,
};
