// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { useAudioSettingsStore } from "../audioSettingsStore";
import { DEFAULT_INSTRUMENT, type SoundPresetId } from "../../audio/instrumentCatalog";

describe("audioSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioSettingsStore.setState({
      instrumentId: DEFAULT_INSTRUMENT,
      quality: "high",
    });
  });

  it("defaults to the lush piano in high quality", () => {
    const state = useAudioSettingsStore.getState();
    expect(state.instrumentId).toBe(DEFAULT_INSTRUMENT);
    expect(state.quality).toBe("high");
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

  it("persists settings to localStorage", () => {
    useAudioSettingsStore.getState().setInstrument("soft-keys");
    useAudioSettingsStore.getState().setQuality("lightweight");
    const raw = localStorage.getItem("harmonia-audio-settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.instrumentId).toBe("soft-keys");
    expect(parsed.state.quality).toBe("lightweight");
  });
});
