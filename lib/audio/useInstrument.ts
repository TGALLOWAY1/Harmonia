/**
 * useInstrument — chord-instrument lifecycle with loading state and fallback.
 *
 * Centralises the synth lifecycle that the main progression page and the
 * Sketchpad workspace previously duplicated. Beyond creating/disposing the
 * instrument, it guarantees the UI can never get stuck on a "Loading…" state:
 * if sample loading errors or takes too long, it disposes the failed
 * instrument, falls back to the always-available Organ synth, and exposes a
 * `loadError` label so callers can surface a brief notice.
 */

import { useEffect, useState } from "react";
import type { SustainMode } from "./humanization";
import {
  INSTRUMENTS,
  createSynthForPreset,
  presetNeedsLoading,
  type SoundPresetId,
  type Synth,
} from "./synthPresets";

/** Instrument used when a sample-based preset fails to load. */
const FALLBACK_PRESET: SoundPresetId = "organ";

/** How long to wait for samples before treating the load as failed (ms). */
const LOAD_TIMEOUT_MS = 10_000;

export interface UseInstrumentOptions {
  sustainMode?: SustainMode;
  /**
   * Caller-owned ref that receives the live instrument. Passing the ref in
   * (rather than returning a new one) keeps it a stable `useRef` at the call
   * site so React's exhaustive-deps lint stays happy.
   */
  synthRef: React.MutableRefObject<Synth | null>;
}

export interface UseInstrumentResult {
  /** True while sample-based instruments download. */
  isLoading: boolean;
  /** Label of an instrument that failed to load (and was replaced), or null. */
  loadError: string | null;
  /** Dismiss the current load-error notice. */
  dismissError: () => void;
}

export function useInstrument(
  preset: SoundPresetId,
  { sustainMode, synthRef }: UseInstrumentOptions,
): UseInstrumentResult {
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    /** Swap in the Organ synth and surface a notice naming the failed preset. */
    const fallBack = () => {
      if (cancelled || settled) return;
      settled = true;
      clearTimer();
      if (synthRef.current) {
        synthRef.current.releaseAll();
        synthRef.current.dispose();
        synthRef.current = null;
      }
      synthRef.current = createSynthForPreset(FALLBACK_PRESET, { sustainMode });
      setIsLoading(false);
      setLoadError(INSTRUMENTS[preset].label);
    };

    setIsLoading(presetNeedsLoading(preset));
    setLoadError(null);

    const synth = createSynthForPreset(preset, {
      sustainMode,
      onLoaded: () => {
        if (cancelled || settled) return;
        settled = true;
        clearTimer();
        setIsLoading(false);
      },
      onError: fallBack,
    });
    synthRef.current = synth;

    if (presetNeedsLoading(preset)) {
      timeoutId = setTimeout(fallBack, LOAD_TIMEOUT_MS);
    }

    return () => {
      cancelled = true;
      clearTimer();
      if (synthRef.current) {
        synthRef.current.releaseAll();
        synthRef.current.dispose();
        synthRef.current = null;
      }
    };
  }, [preset, sustainMode, synthRef]);

  return {
    isLoading,
    loadError,
    dismissError: () => setLoadError(null),
  };
}
