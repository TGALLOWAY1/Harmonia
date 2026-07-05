import { describe, it, expect } from "vitest";
import {
  glideCurve,
  pitchDropCurve,
  pitchScoopCurve,
  vibratoCurve,
  toSegment,
} from "../presets";
import {
  buildSvgPath,
  insertPointAt,
  removePointAt,
  reversePoints,
  sampleY,
  scaleAmount,
  scaleDuration,
  sortPoints,
} from "../curve";

describe("glideCurve", () => {
  it("linear join has two endpoints landing exactly on the target", () => {
    const { points, smooth } = glideCurve("join", 5);
    expect(smooth).toBe(false);
    expect(points[0]).toEqual({ t: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ t: 1, y: 5 });
  });

  it("respects the sign of the target (downward glide)", () => {
    const { points } = glideCurve("smooth", -3);
    expect(points[0].y).toBe(0);
    expect(points[points.length - 1].y).toBe(-3);
  });

  it("exponential rise ends on the target and is monotonic in |y|", () => {
    const { points } = glideCurve("expRise", 12);
    expect(points[0].y).toBeCloseTo(0);
    expect(points[points.length - 1].y).toBeCloseTo(12);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y - 1e-9);
    }
  });
});

describe("pitchDropCurve / pitchScoopCurve", () => {
  it("drop at end holds pitch then falls below", () => {
    const { points } = pitchDropCurve({ amount: 12, duration: 0.3, position: "end", curve: "smooth" });
    expect(points[0].y).toBe(0);
    expect(points[points.length - 1].y).toBe(-12);
    // the pre-drop point is still at pitch
    expect(points[1].y).toBe(0);
  });

  it("drop amount is always downward regardless of sign", () => {
    const { points } = pitchDropCurve({ amount: -8, duration: 0.5, position: "start", curve: "linear" });
    expect(Math.min(...points.map((p) => p.y))).toBe(-8);
  });

  it("scoop begins below and settles to pitch", () => {
    const { points } = pitchScoopCurve({ amount: 3, duration: 0.3, curve: "smooth" });
    expect(points[0].y).toBe(-3);
    expect(points[points.length - 1].y).toBe(0);
  });
});

describe("vibratoCurve", () => {
  it("stays within depth and starts/ends flat", () => {
    const { points } = vibratoCurve({ depth: 0.5, cycles: 4, region: [0.2, 1], fadeIn: 0.2, fadeOut: 0.1 });
    expect(points[0]).toEqual({ t: 0, y: 0 });
    expect(points[points.length - 1].y).toBeCloseTo(0);
    for (const p of points) {
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("normalizes an inverted region", () => {
    const { points } = vibratoCurve({ depth: 1, cycles: 2, region: [0.9, 0.3], fadeIn: 0, fadeOut: 0 });
    const ts = points.map((p) => p.t);
    // sorted and within [0,1]
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
    expect(Math.min(...ts)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ts)).toBeLessThanOrEqual(1);
  });
});

describe("curve operations", () => {
  const base = [
    { t: 0, y: 0 },
    { t: 0.5, y: 2 },
    { t: 1, y: 4 },
  ];

  it("sampleY interpolates linearly between points", () => {
    expect(sampleY(base, 0.25)).toBeCloseTo(1);
    expect(sampleY(base, 0.75)).toBeCloseTo(3);
    expect(sampleY(base, -1)).toBe(0);
    expect(sampleY(base, 2)).toBe(4);
  });

  it("insertPointAt snaps the new point onto the existing curve", () => {
    const next = insertPointAt(base, 0.25);
    const inserted = next.find((p) => Math.abs(p.t - 0.25) < 1e-9);
    expect(inserted?.y).toBeCloseTo(1);
    expect(next.length).toBe(4);
  });

  it("removePointAt never removes endpoints", () => {
    expect(removePointAt(base, 0).length).toBe(3);
    expect(removePointAt(base, 2).length).toBe(3);
    expect(removePointAt(base, 1).length).toBe(2);
  });

  it("reversePoints mirrors time", () => {
    const r = reversePoints(base);
    expect(r[0]).toEqual({ t: 0, y: 4 });
    expect(r[r.length - 1]).toEqual({ t: 1, y: 0 });
  });

  it("scaleAmount scales only y", () => {
    const s = scaleAmount(base, 2);
    expect(s.map((p) => p.y)).toEqual([0, 4, 8]);
    expect(s.map((p) => p.t)).toEqual([0, 0.5, 1]);
  });

  it("scaleDuration compresses time toward the start, clamped to 1", () => {
    const s = sortPoints(scaleDuration(base, 0.5));
    expect(s[0].t).toBe(0);
    expect(s[1].t).toBeCloseTo(0.25);
    expect(s[2].t).toBeCloseTo(0.5);
    const stretched = scaleDuration(base, 4);
    expect(Math.max(...stretched.map((p) => p.t))).toBeLessThanOrEqual(1);
  });
});

describe("buildSvgPath", () => {
  it("produces a straight polyline when not smooth", () => {
    const d = buildSvgPath([{ x: 0, y: 0 }, { x: 10, y: 5 }], false);
    expect(d).toContain("M 0 0");
    expect(d).toContain("L 10 5");
  });

  it("uses cubic beziers when smooth", () => {
    const d = buildSvgPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], true);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("C ");
  });

  it("returns empty for < 2 points", () => {
    expect(buildSvgPath([{ x: 0, y: 0 }], true)).toBe("");
  });
});

describe("toSegment", () => {
  it("wraps a curve into a pitch-lane segment with a unique id", () => {
    const a = toSegment("glide", glideCurve("join", 2));
    const b = toSegment("glide", glideCurve("join", 2));
    expect(a.lane).toBe("pitch");
    expect(a.kind).toBe("glide");
    expect(a.id).not.toBe(b.id);
    expect(a.points.length).toBeGreaterThanOrEqual(2);
  });
});
