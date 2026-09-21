// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { useAudioSettingsStore } from "../audioSettingsStore";
import {
  DEFAULT_INSTRUMENT,
  FOLLOW_CHORDS,
  resolveMelodyInstrument,
  type SoundPresetId,
} from "../../audio/instrumentCatalog";
import { DEFAULT_MASTER_VOLUME, DEFAULT_SPACE } from "../../audio/audioSpace";

const STORAGE_KEY = "harmonia-audio-settings";

function defaults() {
  return {
    instrumentId: DEFAULT_INSTRUMENT,
    quality: "high" as const,
    melodyInstrumentId: FOLLOW_CHORDS,
    masterVolume: DEFAULT_MASTER_VOLUME,
    space: DEFAULT_SPACE,
  };
}

/**
 * Re-import the store with a persisted payload already in localStorage, which
 * is the only way to exercise the `merge` sanitizer that guards against values
 * written by an older build (or by hand).
 */
async function storeRehydratedFrom(state: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 2 }));
  const { resetModules } = await import("vitest").then((m) => ({ resetModules: m.vi.resetModules }));
  resetModules();
  const fresh = await import("../audioSettingsStore");
  return fresh.useAudioSettingsStore.getState();
}

describe("audioSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioSettingsStore.setState(defaults());
  });

  it("defaults to the lush piano in high quality", () => {
    const state = useAudioSettingsStore.getState();
    expect(state.instrumentId).toBe(DEFAULT_INSTRUMENT);
    expect(state.quality).toBe("high");
  });

  it("defaults the melody to following the chords, at 0.8 volume, in a room", () => {
    const state = useAudioSettingsStore.getState();
    expect(state.melodyInstrumentId).toBe(FOLLOW_CHORDS);
    expect(state.masterVolume).toBe(0.8);
    expect(state.space).toBe("room");
  });

  it("updates the instrument", () => {
    useAudioSettingsStore.getState().setInstrument("filtered-saw");
    expect(useAudioSettingsStore.getState().instrumentId).toBe("filtered-saw");
  });

  it("sanitizes unknown instrument ids", () => {
    useAudioSettingsStore.getState().setInstrument("retired-instrument" as SoundPresetId);
    expect(useAudioSettingsStore.getState().instrumentId).toBe(DEFAULT_INSTRUMENT);
  });

  it("updates and sanitizes the quality mode", () => {
    useAudioSettingsStore.getState().setQuality("lightweight");
    expect(useAudioSettingsStore.getState().quality).toBe("lightweight");
    useAudioSettingsStore.getState().setQuality("high");
    expect(useAudioSettingsStore.getState().quality).toBe("high");
  });

  it("selects a lead voice for the melody, or follows the chords", () => {
    useAudioSettingsStore.getState().setMelodyInstrument("vibraphone");
    expect(useAudioSettingsStore.getState().melodyInstrumentId).toBe("vibraphone");
    useAudioSettingsStore.getState().setMelodyInstrument(FOLLOW_CHORDS);
    expect(useAudioSettingsStore.getState().melodyInstrumentId).toBe(FOLLOW_CHORDS);
  });

  it("sanitizes an unknown lead voice back to following the chords", () => {
    useAudioSettingsStore.getState().setMelodyInstrument("harpsichord" as SoundPresetId);
    expect(useAudioSettingsStore.getState().melodyInstrumentId).toBe(FOLLOW_CHORDS);
  });

  it("resolves the melody voice the way the UI will", () => {
    const store = useAudioSettingsStore.getState();
    store.setInstrument("warm-strings");
    expect(
      resolveMelodyInstrument(
        useAudioSettingsStore.getState().instrumentId,
        useAudioSettingsStore.getState().melodyInstrumentId,
      ),
    ).toBe("warm-strings");

    useAudioSettingsStore.getState().setMelodyInstrument("pluck");
    expect(
      resolveMelodyInstrument(
        useAudioSettingsStore.getState().instrumentId,
        useAudioSettingsStore.getState().melodyInstrumentId,
      ),
    ).toBe("pluck");
  });

  it("clamps the master volume to 0–1", () => {
    const store = useAudioSettingsStore.getState();
    store.setMasterVolume(0.42);
    expect(useAudioSettingsStore.getState().masterVolume).toBeCloseTo(0.42);
    store.setMasterVolume(11);
    expect(useAudioSettingsStore.getState().masterVolume).toBe(1);
    store.setMasterVolume(-4);
    expect(useAudioSettingsStore.getState().masterVolume).toBe(0);
    store.setMasterVolume(Number.NaN);
    expect(useAudioSettingsStore.getState().masterVolume).toBe(DEFAULT_MASTER_VOLUME);
  });

  it("updates and sanitizes the space", () => {
    const store = useAudioSettingsStore.getState();
    store.setSpace("hall");
    expect(useAudioSettingsStore.getState().space).toBe("hall");
    store.setSpace("cathedral" as never);
    expect(useAudioSettingsStore.getState().space).toBe(DEFAULT_SPACE);
  });

  it("persists settings to localStorage", () => {
    useAudioSettingsStore.getState().setInstrument("soft-keys");
    useAudioSettingsStore.getState().setQuality("lightweight");
    useAudioSettingsStore.getState().setMelodyInstrument("vibraphone");
    useAudioSettingsStore.getState().setMasterVolume(0.55);
    useAudioSettingsStore.getState().setSpace("hall");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.instrumentId).toBe("soft-keys");
    expect(parsed.state.quality).toBe("lightweight");
    expect(parsed.state.melodyInstrumentId).toBe("vibraphone");
    expect(parsed.state.masterVolume).toBeCloseTo(0.55);
    expect(parsed.state.space).toBe("hall");
  });
});

describe("rehydrating stale or hostile persisted state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps values that are still valid", async () => {
    const state = await storeRehydratedFrom({
      instrumentId: "vibraphone",
      quality: "lightweight",
      melodyInstrumentId: "pluck",
      masterVolume: 0.35,
      space: "hall",
    });
    expect(state.instrumentId).toBe("vibraphone");
    expect(state.quality).toBe("lightweight");
    expect(state.melodyInstrumentId).toBe("pluck");
    expect(state.masterVolume).toBeCloseTo(0.35);
    expect(state.space).toBe("hall");
  });

  it("replaces an instrument id that no longer exists", async () => {
    const state = await storeRehydratedFrom({ instrumentId: "fm-bell", melodyInstrumentId: "wurli" });
    expect(state.instrumentId).toBe(DEFAULT_INSTRUMENT);
    expect(state.melodyInstrumentId).toBe(FOLLOW_CHORDS);
  });

  it("repairs an out-of-range or non-numeric volume", async () => {
    expect((await storeRehydratedFrom({ masterVolume: 42 })).masterVolume).toBe(1);
    expect((await storeRehydratedFrom({ masterVolume: -1 })).masterVolume).toBe(0);
    expect((await storeRehydratedFrom({ masterVolume: "loud" })).masterVolume).toBe(
      DEFAULT_MASTER_VOLUME,
    );
  });

  it("repairs an unknown space and a missing field", async () => {
    expect((await storeRehydratedFrom({ space: "cave" })).space).toBe(DEFAULT_SPACE);
    const partial = await storeRehydratedFrom({ instrumentId: "organ" });
    expect(partial.space).toBe(DEFAULT_SPACE);
    expect(partial.masterVolume).toBe(DEFAULT_MASTER_VOLUME);
    expect(partial.melodyInstrumentId).toBe(FOLLOW_CHORDS);
  });
});
