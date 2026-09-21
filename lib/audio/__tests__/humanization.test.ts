import { describe, it, expect } from "vitest";
import { beatsToSeconds, buildChordEvents, humanizeVelocity, noteDurationWithinEvent } from "../humanization";

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

describe("buildChordEvents — weights", () => {
  it("leaves velocity unchanged with no weights (regression-safe)", () => {
    const events = buildChordEvents(NOTES_3, { baseVelocity: 0.7, humanize: 0, style: "block" });
    for (const ev of events) expect(ev.velocity).toBe(0.7);
  });

  it("applies a per-note multiplier before the (zero) random variation", () => {
    const events = buildChordEvents(NOTES_3, {
      baseVelocity: 0.5,
      humanize: 0,
      style: "block",
      weights: [0.8, 1, 1.2],
    });
    expect(events[0].velocity).toBeCloseTo(0.4, 6);
    expect(events[1].velocity).toBeCloseTo(0.5, 6);
    expect(events[2].velocity).toBeCloseTo(0.6, 6);
  });

  it("treats a missing entry in a short weights array as neutral (1)", () => {
    const events = buildChordEvents(NOTES_3, {
      baseVelocity: 0.5,
      humanize: 0,
      style: "block",
      weights: [2], // only the first note is weighted
    });
    expect(events[0].velocity).toBeCloseTo(1, 6); // clamped ceiling would also read 1 here
    expect(events[1].velocity).toBeCloseTo(0.5, 6);
    expect(events[2].velocity).toBeCloseTo(0.5, 6);
  });

  it("still clamps a weighted velocity to [0.15, 1]", () => {
    const [loud] = buildChordEvents(["C4"], { baseVelocity: 0.9, humanize: 0, weights: [3] });
    expect(loud.velocity).toBe(1);
    const [quiet] = buildChordEvents(["C4"], { baseVelocity: 0.9, humanize: 0, weights: [0.01] });
    expect(quiet.velocity).toBe(0.15);
  });
});

describe("beatsToSeconds", () => {
  it("converts whole beats at 120 BPM (0.5s per beat)", () => {
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2, 6);
    expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5, 6);
  });

  it("is exact for the fractional beat counts the melody engine emits", () => {
    // These would previously fall through beatsToDuration's switch to a
    // whole-note default; beatsToSeconds has no such gap.
    for (const beats of [1.5, 2.5, 3, 3.5]) {
      expect(beatsToSeconds(beats, 120)).toBeCloseTo((beats * 60) / 120, 9);
    }
  });

  it("scales with tempo", () => {
    expect(beatsToSeconds(1, 60)).toBeCloseTo(1, 6);
    expect(beatsToSeconds(1, 240)).toBeCloseTo(0.25, 6);
  });
});

describe("noteDurationWithinEvent", () => {
  it("keeps the full length for on-time and early notes", () => {
    expect(noteDurationWithinEvent(2, 0)).toBe(2);
    expect(noteDurationWithinEvent(2, -0.01)).toBe(2);
  });

  it("shortens a late (strummed/arpeggiated) note so it ends with the event", () => {
    expect(noteDurationWithinEvent(2, 0.5)).toBeCloseTo(1.5);
    expect(noteDurationWithinEvent(1, 0.6)).toBeCloseTo(0.4);
  });

  it("never returns less than the minimum audible length", () => {
    expect(noteDurationWithinEvent(0.1, 0.09)).toBe(0.05);
    expect(noteDurationWithinEvent(0.1, 5)).toBe(0.05);
  });
});
