import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTRUMENT,
  FOLLOW_CHORDS,
  INSTRUMENT_CATALOG,
  SOUND_PRESETS,
  getCatalogEntry,
  presetHasHighQuality,
  resolveMelodyInstrument,
  resolveMelodyInstrumentId,
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
    expect(ids).toContain("warm-strings");
    expect(ids).toContain("vibraphone");
    expect(ids).toContain("pluck");
  });

  it("gives every entry a label and a menu category", () => {
    const categories = new Set(["keys", "synth", "strings", "mallet", "plucked"]);
    for (const entry of INSTRUMENT_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(categories.has(entry.category)).toBe(true);
    }
  });

  it("marks only sampled instruments as high-quality capable", () => {
    expect(presetHasHighQuality("piano")).toBe(true);
    expect(presetHasHighQuality("electric-piano")).toBe(true);
    expect(presetHasHighQuality("soft-keys")).toBe(false);
    expect(presetHasHighQuality("filtered-saw")).toBe(false);
    expect(presetHasHighQuality("organ")).toBe(false);
    expect(presetHasHighQuality("warm-strings")).toBe(false);
    expect(presetHasHighQuality("vibraphone")).toBe(false);
    expect(presetHasHighQuality("pluck")).toBe(false);
  });

  it("declares every instrument velocity-sensitive, which the audition harness enforces", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      expect(entry.velocitySensitive).toBe(true);
    }
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

describe("melody voice resolution", () => {
  it("follows the chord instrument by default", () => {
    expect(resolveMelodyInstrument("vibraphone", FOLLOW_CHORDS)).toBe("vibraphone");
    expect(resolveMelodyInstrument("organ", "follow")).toBe("organ");
  });

  it("uses an explicit lead voice when one is chosen", () => {
    expect(resolveMelodyInstrument("warm-strings", "vibraphone")).toBe("vibraphone");
  });

  it("falls back to following the chords for an unknown lead voice", () => {
    expect(resolveMelodyInstrument("soft-keys", "theremin")).toBe("soft-keys");
    expect(resolveMelodyInstrument("soft-keys", undefined)).toBe("soft-keys");
  });

  it("sanitizes the chord instrument too, so the pair is always playable", () => {
    expect(resolveMelodyInstrument("retired-sound", FOLLOW_CHORDS)).toBe(DEFAULT_INSTRUMENT);
  });

  it("resolveMelodyInstrumentId keeps 'follow' distinct from an instrument", () => {
    expect(resolveMelodyInstrumentId("follow")).toBe(FOLLOW_CHORDS);
    expect(resolveMelodyInstrumentId("pluck")).toBe("pluck");
    expect(resolveMelodyInstrumentId("nonsense")).toBe(FOLLOW_CHORDS);
    expect(resolveMelodyInstrumentId(null)).toBe(FOLLOW_CHORDS);
  });
});
