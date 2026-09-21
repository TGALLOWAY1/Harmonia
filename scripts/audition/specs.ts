/**
 * Audition specs — what gets rendered, and the shape of what comes back.
 *
 * Shared by the node CLI and the browser bundle, so both sides agree on the
 * timing of every take without duplicating constants.
 */

import type { RenderMetrics, RenderTiming } from "./analysis";

export type AuditionRole = "chord" | "melody";

/** The notes each role plays: a close-position triad, and a lead note above it. */
export const CHORD_NOTES = ["C3", "E3", "G3", "C4"];
export const MELODY_NOTE = "E5";

/** The three velocities every instrument is measured at. */
export const VELOCITIES = [0.3, 0.7, 1.0];

/** Seconds from the start of the render to `triggerAttack`. */
export const ONSET_SEC = 0.05;
/** How long the note is held before the release. */
export const HOLD_SEC = 1.2;

/**
 * Default render length. The brief's 2.5 s captures the note plus 1.25 s of
 * tail; the `--check` budget allows a 6 s tail, so the default render is long
 * enough to actually observe (and fail) one. Every measurement window below is
 * unchanged by the extra length.
 */
export const DEFAULT_RENDER_SEC = 7.5;

export const SAMPLE_RATE = 44100;
export const CHANNELS = 2;

export function renderTiming(): RenderTiming {
  return {
    onset: ONSET_SEC,
    release: ONSET_SEC + HOLD_SEC,
    // Loudness is read from the sustained middle of the note, after the
    // transient and before the release.
    sustainStart: 0.2,
    sustainEnd: 1.0,
    // Brightness is read from the first half second after the onset, where the
    // velocity-dependent layers live.
    spectrumWindow: 0.5,
  };
}

export interface RenderSpec {
  instrumentId: string;
  label: string;
  role: AuditionRole;
  velocity: number;
  /** Whether `--check` demands loudness/brightness rise with velocity. */
  velocitySensitive: boolean;
}

export interface RenderResult extends RenderSpec {
  metrics: RenderMetrics;
  /** Base-64 16-bit PCM, present only when WAV output was requested. */
  pcm16?: string;
  /** A render that threw rather than producing audio. */
  error?: string;
}

/** Stable file/row name for one take. */
export function renderKey(spec: RenderSpec): string {
  return `${spec.instrumentId}-${spec.role}-v${spec.velocity.toFixed(2)}`;
}
