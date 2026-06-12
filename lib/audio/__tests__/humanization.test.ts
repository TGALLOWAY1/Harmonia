import { describe, it, expect } from "vitest";
import { buildChordEvents, humanizeVelocity } from "../humanization";

const NOTES_3 = ["C4", "E4", "G4"];

describe("buildChordEvents — block", () => {
  it("is fully mechanical with humanize 0 (regression-safe)", () => {
    const events = buildChordEvents(NOTES_3, { baseVelocity: 0.7, humanize: 0, style: "block" });
    expect(events).toHaveLength(3);
    for (const ev of events) {
      expect(ev.timeOffset).toBe(0);
      expect(ev.velocity).toBe(0.7);
    }
  });
});

describe("buildChordEvents — strum", () => {
  it("offsets each note by a fixed ~18ms step", () => {
    const events = buildChordEvents(NOTES_3, { baseVelocity: 0.7, humanize: 0, style: "strum" });
    expect(events[0].timeOffset).toBeCloseTo(0, 6);
    expect(events[1].timeOffset).toBeCloseTo(0.018, 6);
    expect(events[2].timeOffset).toBeCloseTo(0.036, 6);
  });

  it("does not strum a single note", () => {
    const events = buildChordEvents(["C4"], { baseVelocity: 0.7, humanize: 0, style: "strum" });
    expect(events[0].timeOffset).toBe(0);
  });
});

describe("buildChordEvents — arpeggio", () => {
  it("scales the step to the chord duration when within bounds", () => {
    // 4 notes, 0.5s window*0.6=0.3, raw step 0.3/3 = 0.1 (inside [0.06, 0.16])
    const events = buildChordEvents(["C4", "E4", "G4", "B4"], {
      baseVelocity: 0.7,
      humanize: 0,
      style: "arpeggio",
      spreadSeconds: 0.5,
    });
    expect(events.map((e) => e.timeOffset)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
    ]);
  });

  it("clamps the step so slow tempos do not drag", () => {
    // 3 notes, 1s window*0.6=0.6, raw 0.3 -> clamped to MAX 0.16
    const events = buildChordEvents(NOTES_3, {
      baseVelocity: 0.7,
      humanize: 0,
      style: "arpeggio",
      spreadSeconds: 1,
    });
    expect(events[1].timeOffset).toBeCloseTo(0.16, 6);
    expect(events[2].timeOffset).toBeCloseTo(0.32, 6);
  });

  it("clamps the step so fast tempos stay audible", () => {
    // 5 notes, 0.2s window*0.6=0.12, raw 0.03 -> clamped to MIN 0.06
    const events = buildChordEvents(["C4", "E4", "G4", "B4", "D5"], {
      baseVelocity: 0.7,
      humanize: 0,
      style: "arpeggio",
      spreadSeconds: 0.2,
    });
    expect(events[1].timeOffset).toBeCloseTo(0.06, 6);
  });

  it("never starts notes in the past and rolls upward in order", () => {
    const events = buildChordEvents(NOTES_3, {
      baseVelocity: 0.7,
      humanize: 0,
      style: "arpeggio",
      spreadSeconds: 0.4,
    });
    for (let i = 0; i < events.length; i++) {
      expect(events[i].timeOffset).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(events[i].timeOffset).toBeGreaterThan(events[i - 1].timeOffset);
    }
  });
});

describe("humanization bounds", () => {
  it("keeps velocity within [0.15, 1] under full humanization", () => {
    for (let i = 0; i < 500; i++) {
      const v = humanizeVelocity(1, 1);
      expect(v).toBeGreaterThanOrEqual(0.15);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < 500; i++) {
      const v = humanizeVelocity(0.2, 1);
      expect(v).toBeGreaterThanOrEqual(0.15);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("bounds timing jitter to ±12ms at full humanization (block)", () => {
    for (let i = 0; i < 500; i++) {
      const [ev] = buildChordEvents(["C4"], { baseVelocity: 0.7, humanize: 1, style: "block" });
      expect(Math.abs(ev.timeOffset)).toBeLessThanOrEqual(0.012 + 1e-9);
    }
  });
});
