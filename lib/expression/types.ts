/**
 * MPE Expression Editor — Data Model
 *
 * Expressive per-note automation (pitch bends, and — in the future — pressure,
 * timbre, slide, and CC lanes). Pitch is the first supported lane; the shapes
 * below are intentionally lane-generic so additional expressive dimensions can
 * reuse the same architecture without a redesign.
 *
 * All of this data is stored and visualized independently of playback. If/when
 * Harmonia gains real-time pitch automation or MIDI/MPE export, these segments
 * are the source of truth to render from — nothing here depends on playback
 * being implemented first.
 */

/** Expressive dimensions. Only "pitch" is authored today; the rest are reserved. */
export type ExpressionLane =
  | "pitch"
  | "pressure"
  | "timbre"
  | "expression"
  | "slide"
  | "cc";

/** How a segment was produced — drives labelling and default editing affordances. */
export type ExpressionKind =
  | "glide"
  | "drop"
  | "scoop"
  | "vibrato"
  | "custom";

/**
 * A single control point on an expression curve.
 *   - `t`: normalized position across the note's duration (0 = note start, 1 = note end).
 *   - `y`: value offset in the lane's units. For the pitch lane this is a
 *          semitone offset from the note's base pitch (fractional allowed;
 *          positive = higher). +1 semitone renders exactly one piano-roll row up.
 */
export interface ExpressionPoint {
  t: number;
  y: number;
}

/**
 * One expressive segment attached to a note. A note may carry several segments
 * (e.g. a glide plus a vibrato region), though the toolbar authors one at a time.
 */
export interface ExpressionSegment {
  id: string;
  lane: ExpressionLane;
  kind: ExpressionKind;
  /** Ordered by `t`, length >= 2. The first/last points are the curve endpoints. */
  points: ExpressionPoint[];
  /** true → smooth (spline) interpolation between points; false → straight lines. */
  smooth: boolean;
}

/**
 * Expression data for a chord, keyed by the note's MIDI number. Keeping the key
 * as the MIDI value (rather than an index) means the mapping survives voicing
 * reorders; stale keys for notes that no longer exist are simply ignored when
 * rendering.
 */
export type ChordExpression = Record<number, ExpressionSegment[]>;
