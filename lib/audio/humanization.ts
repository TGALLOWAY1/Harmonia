/**
 * Playback Humanization Engine
 *
 * Pure helpers that turn a set of chord notes into per-note playback events
 * with subtle velocity and timing variation, so generated progressions feel
 * hand-played rather than software-triggered.
 *
 * Intentionally free of any Tone.js dependency — it returns plain data that
 * the scheduler applies. This keeps the logic easy to reason about and reuse.
 */

/** How notes within a chord are articulated. */
export type PlaybackStyle = "block" | "strum" | "arpeggio";

/** How long notes are allowed to ring after release. */
export type SustainMode = "off" | "natural";

/** A single note ready to be scheduled. */
export interface NoteEvent {
  /** Note name with octave, e.g. "C4". */
  note: string;
  /** Playback velocity in the range 0–1. */
  velocity: number;
  /** Timing offset in seconds, relative to the chord's scheduled time. */
  timeOffset: number;
}

export interface HumanizeOptions {
  /** Base velocity (0–1) before any humanization. */
  baseVelocity: number;
  /** Humanization amount (0 = off, 1 = full natural variation). */
  humanize: number;
  /** Articulation style. Strum/arpeggio only apply to multi-note chords. */
  style?: PlaybackStyle;
  /**
   * The chord's total ring time in seconds. Used to scale an arpeggio so it
   * fits musically inside the chord regardless of tempo. Ignored by block/strum.
   */
  spreadSeconds?: number;
}

/* ─── Tuning constants ─── */

/** Maximum +/- velocity swing at full humanization. Small, musical. */
const MAX_VELOCITY_VARIATION = 0.12;
/** Maximum +/- timing jitter at full humanization, in seconds (±12 ms). */
const MAX_TIMING_JITTER = 0.012;
/** Per-note delay between strummed notes, in seconds (~18 ms). */
const STRUM_STEP = 0.018;
/** Arpeggio spreads notes across this fraction of the chord's duration. */
const ARP_WINDOW_FRACTION = 0.6;
/** Clamp arpeggio per-note step so it never drags or blurs into a strum. */
const ARP_MIN_STEP = 0.06; // 60 ms
const ARP_MAX_STEP = 0.16; // 160 ms
/** Velocity floor/ceiling so notes are always audible and never clip. */
const MIN_VELOCITY = 0.15;
const MAX_VELOCITY = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Symmetric random value in [-1, 1]. */
function bipolarRandom(): number {
  return Math.random() * 2 - 1;
}

/**
 * Compute a single humanized velocity from a base velocity and amount.
 * Used for both chords and melody so dynamics stay consistent.
 */
export function humanizeVelocity(baseVelocity: number, humanize: number): number {
  const variation = bipolarRandom() * MAX_VELOCITY_VARIATION * humanize;
  return clamp(baseVelocity + variation, MIN_VELOCITY, MAX_VELOCITY);
}

/**
 * Build per-note playback events for a chord, applying velocity variation,
 * timing jitter, and (optionally) a soft strum.
 *
 * The result preserves musical balance: variation is small and bounded, and
 * with `humanize === 0` and `style === "block"` every note is identical with a
 * zero offset — i.e. the original mechanical behaviour, for regression safety.
 */
export function buildChordEvents(
  notes: string[],
  { baseVelocity, humanize, style = "block", spreadSeconds = 0 }: HumanizeOptions,
): NoteEvent[] {
  const isMulti = notes.length > 1;
  const useStrum = style === "strum" && isMulti;
  const useArpeggio = style === "arpeggio" && isMulti;

  // Per-note step between successive note onsets. Strum is a fixed soft roll;
  // arpeggio scales with the chord's duration so it spans the chord at any
  // tempo, bounded so it never drags or collapses into a strum.
  let step = 0;
  if (useStrum) {
    step = STRUM_STEP;
  } else if (useArpeggio) {
    const window = spreadSeconds * ARP_WINDOW_FRACTION;
    const raw = window / (notes.length - 1);
    step = clamp(raw, ARP_MIN_STEP, ARP_MAX_STEP);
  }

  return notes.map((note, index) => {
    const jitter = bipolarRandom() * MAX_TIMING_JITTER * humanize;
    const spreadOffset = step * index;

    return {
      note,
      velocity: humanizeVelocity(baseVelocity, humanize),
      // Spread offsets are always >= 0; jitter is symmetric around the beat.
      // The scheduler fires ahead of the event time, so small negative
      // offsets stay safely in the future.
      timeOffset: spreadOffset + jitter,
    };
  });
}
