/**
 * MPE Expression Editor — Curve helpers
 *
 * Geometry-agnostic operations on expression point arrays plus an SVG path
 * builder that turns already-projected pixel points into a `d` attribute.
 * Nothing here touches the DOM or the store — pure functions, easy to test.
 */

import type { ExpressionPoint } from "./types";

let segIdCounter = 0;
/** Stable-enough unique id for a segment (browser-only usage). */
export function makeSegmentId(): string {
  segIdCounter += 1;
  return `expr-${Date.now().toString(36)}-${segIdCounter}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Return a copy sorted ascending by `t`. */
export function sortPoints(points: ExpressionPoint[]): ExpressionPoint[] {
  return [...points].sort((a, b) => a.t - b.t);
}

/**
 * Linearly sample the value of a curve at time `t` (0..1). Used when inserting a
 * new control point so it lands on the existing line, and as a simple baker for
 * future playback/export. Smooth rendering is a visual concern handled by the
 * SVG path builder; sampling stays linear so it is monotonic and predictable.
 */
export function sampleY(points: ExpressionPoint[], t: number): number {
  if (points.length === 0) return 0;
  const pts = sortPoints(points);
  if (t <= pts[0].t) return pts[0].y;
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return a.y;
      const f = (t - a.t) / span;
      return a.y + (b.y - a.y) * f;
    }
  }
  return pts[pts.length - 1].y;
}

/** Insert a control point at time `t`, snapping its value onto the current curve. */
export function insertPointAt(points: ExpressionPoint[], t: number): ExpressionPoint[] {
  const ct = clamp(t, 0, 1);
  const y = sampleY(points, ct);
  return sortPoints([...points, { t: ct, y }]);
}

/**
 * Remove the point at `index`, but never the two endpoints — a curve always
 * keeps at least a start and an end.
 */
export function removePointAt(points: ExpressionPoint[], index: number): ExpressionPoint[] {
  if (points.length <= 2) return points;
  if (index <= 0 || index >= points.length - 1) return points;
  return points.filter((_, i) => i !== index);
}

/** Reverse the curve in time (mirror across the vertical mid-line). */
export function reversePoints(points: ExpressionPoint[]): ExpressionPoint[] {
  return sortPoints(points.map((p) => ({ t: 1 - p.t, y: p.y })));
}

/** Scale the pitch/value amount of the whole curve by `factor`. */
export function scaleAmount(points: ExpressionPoint[], factor: number): ExpressionPoint[] {
  return points.map((p) => ({ t: p.t, y: p.y * factor }));
}

/**
 * Scale the curve's time footprint by `factor`, anchored at the note start.
 * factor < 1 compresses the gesture toward the beginning; factor > 1 stretches
 * it toward the end (clamped to the note).
 */
export function scaleDuration(points: ExpressionPoint[], factor: number): ExpressionPoint[] {
  return sortPoints(points.map((p) => ({ t: clamp(p.t * factor, 0, 1), y: p.y })));
}

// ─── SVG path building (pixel space) ───

export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Build an SVG path `d` string from projected pixel points. When `smooth`, uses
 * a Catmull-Rom → cubic-Bézier conversion for a natural, non-overshooting curve;
 * otherwise draws straight segments.
 */
export function buildSvgPath(pts: PixelPoint[], smooth: boolean): string {
  if (pts.length < 2) return "";
  if (!smooth) {
    return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;

    // Catmull-Rom to Bézier (tension 0). Control points sit 1/6 of the way
    // along the neighbouring chords, which keeps the spline tight to the data.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
