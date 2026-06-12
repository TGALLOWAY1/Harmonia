import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTRUMENT,
  INSTRUMENT_CATALOG,
  SOUND_PRESETS,
  getCatalogEntry,
  presetHasHighQuality,
  resolvePresetId,
} from "../instrumentCatalog";

describe("instrumentCatalog", () => {
  it("has unique ids", () => {
    const ids = INSTRUMENT_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the default instrument", () => {
    expect(INSTRUMENT_CATALOG.some((e) => e.id === DEFAULT_INSTRUMENT)).toBe(true);
  });

  it("exposes the full target palette", () => {
    const ids = INSTRUMENT_CATALOG.map((e) => e.id);
    expect(ids).toContain("piano");
    expect(ids).toContain("electric-piano");
    expect(ids).toContain("soft-keys");
    expect(ids).toContain("filtered-saw");
    expect(ids).toContain("organ");
  });

  it("marks only sampled instruments as high-quality capable", () => {
    expect(presetHasHighQuality("piano")).toBe(true);
    expect(presetHasHighQuality("electric-piano")).toBe(true);
    expect(presetHasHighQuality("soft-keys")).toBe(false);
    expect(presetHasHighQuality("filtered-saw")).toBe(false);
    expect(presetHasHighQuality("organ")).toBe(false);
  });

  it("resolves unknown or stale ids to the default instrument", () => {
    expect(resolvePresetId("piano")).toBe("piano");
    expect(resolvePresetId("no-such-instrument")).toBe(DEFAULT_INSTRUMENT);
    expect(resolvePresetId(undefined)).toBe(DEFAULT_INSTRUMENT);
    expect(resolvePresetId(42)).toBe(DEFAULT_INSTRUMENT);
  });

  it("getCatalogEntry never returns undefined", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      expect(getCatalogEntry(entry.id)).toBe(entry);
    }
  });

  it("keeps the back-compat SOUND_PRESETS alias in sync", () => {
    expect(SOUND_PRESETS).toBe(INSTRUMENT_CATALOG);
  });
});
