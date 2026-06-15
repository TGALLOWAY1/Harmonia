/**
 * useInstrument — instrument lifecycle with quality modes, hot-swap, and
 * timbre-preserving fallback.
 *
 * Centralises the synth lifecycle shared by the main progression page and the
 * Sketchpad workspace. The contract:
 *
 * - A playable instrument is available **synchronously**: the lightweight
 *   (pure-synth) realization is created immediately, so playback never waits
 *   on a download and the Play button never needs disabling.
 * - In "high" quality mode, the sampled realization loads in the background
 *   and is **hot-swapped** into `synthRef` when ready — ringing lightweight
 *   notes are released and the old instrument is disposed after its tail.
 * - If sample loading errors or times out, the lightweight twin of the *same*
 *   instrument keeps playing (degradation preserves the timbre family), and
 *   `loadError` carries the instrument label so callers can surface a notice
 *   with a `retry()` affordance.
 */

import { useCallback, useEffect, useState } from "react";
import type { SustainMode } from "./humanization";
import { audioDebug, audioWarn } from "./audioEngine";
import { presetHasHighQuality, type AudioQuality } from "./instrumentCatalog";
import {
  INSTRUMENTS,
  createMelodySynthForPreset,
  createSynthForPreset,
  type MelodySynth,
  type SoundPresetId,
  type Synth,
} from "./synthPresets";

/** How long to wait for samples before falling back to lightweight (ms). */
const LOAD_TIMEOUT_MS = 10_000;

/** How long a replaced instrument keeps ringing before disposal (ms). */
const SWAP_DISPOSE_DELAY_MS = 3_000;

type Playable = Synth | MelodySynth;

/** Release any held/ringing notes on either a poly or mono instrument. */
function silence(inst: Playable): void {
  if ("releaseAll" in inst && typeof inst.releaseAll === "function") {
    inst.releaseAll();
  } else if ("triggerRelease" in inst && typeof inst.triggerRelease === "function") {
    (inst as MelodySynth & { triggerRelease: () => void }).triggerRelease();
  }
}

function safeDispose(inst: Playable | null): void {
  if (!inst) return;
  try {
    inst.dispose();
  } catch {
    // Disposing an already-disposed node throws in some Tone versions; ignore.
  }
}

export interface UseInstrumentOptions<T extends Playable> {
  /** Quality mode; "high" lazily loads samples where the instrument has them. */
  quality: AudioQuality;
  sustainMode?: SustainMode;
  /** Build the melody (mono-oriented) realization instead of the chord one. */
  role?: "chord" | "melody";
  /** When false, no instrument is created (e.g. melody lane disabled). */
  enabled?: boolean;
  /**
   * Caller-owned ref that receives the live instrument. Passing the ref in
   * (rather than returning a new one) keeps it a stable `useRef` at the call
   * site so React's exhaustive-deps lint stays happy.
   */
  synthRef: React.MutableRefObject<T | null>;
}

export interface UseInstrumentResult {
  /** True while a high-quality (sampled) realization downloads. */
  isLoading: boolean;
  /** Label of an instrument whose samples failed to load, or null. */
  loadError: string | null;
  /** Quality of the realization currently in `synthRef`. */
  activeQuality: AudioQuality;
  /** Dismiss the current load-error notice. */
  dismissError: () => void;
  /** Re-attempt loading the high-quality samples. */
  retry: () => void;
}

export function useInstrument(
  preset: SoundPresetId,
  options: UseInstrumentOptions<Synth>,
): UseInstrumentResult;
export function useInstrument(
  preset: SoundPresetId,
  options: UseInstrumentOptions<MelodySynth> & { role: "melody" },
): UseInstrumentResult;
export function useInstrument(
  preset: SoundPresetId,
  {
    quality,
    sustainMode,
    role = "chord",
    enabled = true,
    synthRef,
  }: UseInstrumentOptions<Playable>,
): UseInstrumentResult {
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeQuality, setActiveQuality] = useState<AudioQuality>("lightweight");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setLoadError(null);
      setActiveQuality("lightweight");
      return;
    }

    let cancelled = false;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let disposeTimerId: ReturnType<typeof setTimeout> | null = null;
    let replaced: Playable | null = null;
    let highInstrument: Playable | null = null;

    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const build = (q: AudioQuality, cbs?: { onLoaded?: () => void; onError?: () => void }) =>
      role === "melody"
        ? createMelodySynthForPreset(preset, q, cbs)
        : createSynthForPreset(preset, q, { sustainMode, ...cbs });

    // The lightweight realization is always available synchronously, so the
    // caller has a playable instrument from the first render.
    synthRef.current = build("lightweight");
    setActiveQuality("lightweight");
    setLoadError(null);

    const wantHigh = quality === "high" && presetHasHighQuality(preset);
    setIsLoading(wantHigh);

    if (wantHigh) {
      const label = INSTRUMENTS[preset].label;

      audioDebug(`loading high-quality samples for "${label}" (${role})`);

      const fail = (reason?: unknown) => {
        if (cancelled || settled) return;
        settled = true;
        clearTimer();
        safeDispose(highInstrument);
        highInstrument = null;
        setIsLoading(false);
        setLoadError(label);
        // Surface the swallowed error: the UI keeps playing the lightweight
        // twin, but the reason the samples never arrived should not vanish.
        audioWarn(
          `high-quality samples for "${label}" failed — using lightweight voice.`,
          reason ?? "(load timed out)",
        );
      };

      highInstrument = build("high", {
        onLoaded: () => {
          if (cancelled || settled) return;
          settled = true;
          clearTimer();
          audioDebug(`high-quality "${label}" loaded — hot-swapping in`);
          // Hot-swap: future triggers hit the sampler; the lightweight twin
          // releases its notes and is disposed once its tail has faded.
          const old = synthRef.current;
          synthRef.current = highInstrument;
          if (old && old !== highInstrument) {
            silence(old);
            replaced = old;
            disposeTimerId = setTimeout(() => {
              safeDispose(replaced);
              replaced = null;
            }, SWAP_DISPOSE_DELAY_MS);
          }
          setActiveQuality("high");
          setIsLoading(false);
        },
        onError: fail,
      });
      timeoutId = setTimeout(fail, LOAD_TIMEOUT_MS);
    }

    return () => {
      cancelled = true;
      clearTimer();
      if (disposeTimerId) clearTimeout(disposeTimerId);
      safeDispose(replaced);
      replaced = null;
      // A sampler still loading (or failed) that never made it into the ref.
      if (highInstrument && highInstrument !== synthRef.current) {
        safeDispose(highInstrument);
      }
      highInstrument = null;
      if (synthRef.current) {
        silence(synthRef.current);
        safeDispose(synthRef.current);
        synthRef.current = null;
      }
    };
  }, [preset, quality, sustainMode, role, enabled, synthRef, retryNonce]);

  return {
    isLoading,
    loadError,
    activeQuality,
    dismissError: useCallback(() => setLoadError(null), []),
    retry: useCallback(() => setRetryNonce((n) => n + 1), []),
  };
}
