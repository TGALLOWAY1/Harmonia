/**
 * Audition harness — browser half.
 *
 * Bundled with esbuild and loaded into headless Chromium, where a real
 * `OfflineAudioContext` exists. It builds each instrument through the *same*
 * registry the app uses (no test doubles, no parallel patch definitions),
 * renders one note offline, and measures it.
 *
 * The node CLI drives it one render at a time through `window.__audition`.
 */

import * as Tone from "tone";
import {
  INSTRUMENT_CATALOG,
  type SoundPresetId,
} from "../../lib/audio/instrumentCatalog";
import {
  createMelodySynthForPreset,
  createSynthForPreset,
  effectsChainReady,
  resetEffectsChain,
} from "../../lib/audio/synthPresets";
import { clampMasterVolume, resolveSpaceId } from "../../lib/audio/audioSpace";
import { useAudioSettingsStore } from "../../lib/state/audioSettingsStore";
import { analyzeRender, type RenderedAudio } from "./analysis";
import {
  CHANNELS,
  CHORD_NOTES,
  HOLD_SEC,
  MELODY_NOTE,
  ONSET_SEC,
  SAMPLE_RATE,
  renderTiming,
  type AuditionRole,
  type RenderResult,
  type RenderSpec,
} from "./specs";

interface RenderRequest {
  instrumentId: string;
  role: AuditionRole;
  velocity: number;
  seconds: number;
  /** Master output level (0–1) the chain should be built with. */
  masterVolume: number;
  /** Reverb space the chain should be built with. */
  space: string;
  /** Return the rendered audio as base-64 PCM16 as well as the metrics. */
  wantPcm: boolean;
}

/** Interleave and quantise to 16-bit PCM, then base-64 it for the CDP hop. */
function encodePcm16(channels: Float32Array[]): string {
  const frames = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(frames * channels.length * 2);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[i] || 0));
      view.setInt16(offset, Math.round(sample * 32767), true);
      offset += 2;
    }
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function renderOne(request: RenderRequest): Promise<Omit<RenderResult, keyof RenderSpec>> {
  const id = request.instrumentId as SoundPresetId;

  // The chain reads the settings store when it is built, so the render is of
  // the app exactly as a listener at these settings would hear it.
  useAudioSettingsStore.setState({
    masterVolume: clampMasterVolume(request.masterVolume),
    space: resolveSpaceId(request.space),
  });

  const buffer = await Tone.Offline(
    async () => {
      // Every effects singleton binds to whatever context is current when it
      // is built, so each offline pass starts from a clean chain.
      resetEffectsChain();

      const instrument =
        request.role === "melody"
          ? createMelodySynthForPreset(id, "lightweight", {})
          : createSynthForPreset(id, "lightweight", {});

      // Convolution reverbs generate their impulse response asynchronously;
      // rendering before it lands would silently measure a dry signal.
      await effectsChainReady();

      const notes = request.role === "melody" ? MELODY_NOTE : CHORD_NOTES;
      instrument.triggerAttackRelease(
        notes as never,
        HOLD_SEC,
        ONSET_SEC,
        request.velocity,
      );
    },
    request.seconds,
    CHANNELS,
    SAMPLE_RATE,
  );

  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  const audio: RenderedAudio = { channels, sampleRate: buffer.sampleRate };

  return {
    metrics: analyzeRender(audio, renderTiming()),
    ...(request.wantPcm ? { pcm16: encodePcm16(channels) } : {}),
  };
}

const api = {
  catalog: () =>
    INSTRUMENT_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.label,
      category: entry.category,
      velocitySensitive: Boolean(
        (entry as { velocitySensitive?: boolean }).velocitySensitive,
      ),
    })),

  render: async (request: RenderRequest) => {
    try {
      return await renderOne(request);
    } catch (err) {
      return {
        metrics: {
          peakDb: -Infinity,
          noteRmsDb: -Infinity,
          rmsDb: -Infinity,
          centroidHz: 0,
          attackMs: 0,
          tailS: 0,
          silent: true,
          nan: false,
          clipping: false,
        },
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      };
    }
  },
};

declare global {
  interface Window {
    __audition: typeof api;
  }
}

window.__audition = api;
