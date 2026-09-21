import { describe, expect, it } from "vitest";
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_SPACE,
  MASTER_VOLUME_FLOOR_DB,
  SPACES,
  SPACE_LIST,
  clampMasterVolume,
  getSpace,
  masterVolumeToDb,
  masterVolumeToGain,
  resolveSpaceId,
} from "../audioSpace";

describe("spaces", () => {
  it("lists every space, driest first", () => {
    expect(SPACE_LIST.map((s) => s.id)).toEqual(["dry", "room", "hall"]);
  });

  it("grows the reverb and the sends as the room grows", () => {
    expect(SPACES.dry.sendScale).toBe(0);
    expect(SPACES.room.decay).toBeLessThan(SPACES.hall.decay);
    expect(SPACES.room.sendScale).toBeLessThan(SPACES.hall.sendScale);
  });

  it("resolves unknown or stale values to the default", () => {
    expect(resolveSpaceId("hall")).toBe("hall");
    expect(resolveSpaceId("cathedral")).toBe(DEFAULT_SPACE);
    expect(resolveSpaceId(undefined)).toBe(DEFAULT_SPACE);
    expect(resolveSpaceId(7)).toBe(DEFAULT_SPACE);
    expect(getSpace("nope" as never).id).toBe(DEFAULT_SPACE);
  });
});

describe("master volume", () => {
  it("defaults just below unity", () => {
    expect(DEFAULT_MASTER_VOLUME).toBeGreaterThan(0);
    expect(DEFAULT_MASTER_VOLUME).toBeLessThanOrEqual(1);
  });

  it("clamps and sanitizes anything it is handed", () => {
    expect(clampMasterVolume(0.5)).toBe(0.5);
    expect(clampMasterVolume(4)).toBe(1);
    expect(clampMasterVolume(-2)).toBe(0);
    expect(clampMasterVolume(Number.NaN)).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampMasterVolume("loud")).toBe(DEFAULT_MASTER_VOLUME);
    expect(clampMasterVolume(undefined)).toBe(DEFAULT_MASTER_VOLUME);
  });

  it("maps 1 to unity and 0 to silence", () => {
    expect(masterVolumeToDb(1)).toBe(0);
    expect(masterVolumeToGain(1)).toBe(1);
    expect(masterVolumeToDb(0)).toBe(-Infinity);
    expect(masterVolumeToGain(0)).toBe(0);
  });

  it("halves the gain 6 dB at a time", () => {
    expect(masterVolumeToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(masterVolumeToDb(0.25)).toBeCloseTo(-12.04, 1);
    expect(masterVolumeToGain(0.5)).toBeCloseTo(0.5, 5);
  });

  it("mutes below the floor rather than ramping to an inaudible sliver", () => {
    expect(masterVolumeToDb(0.0005)).toBe(-Infinity);
    expect(masterVolumeToGain(0.0005)).toBe(0);
    expect(MASTER_VOLUME_FLOOR_DB).toBeLessThan(0);
  });

  it("is monotonic across the slider range", () => {
    let previous = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const gain = masterVolumeToGain(v);
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });
});
