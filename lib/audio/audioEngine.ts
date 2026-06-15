/**
 * audioEngine — single entry point for unlocking and observing the Web Audio
 * context, with explicit status and development diagnostics.
 *
 * Why this exists
 * ---------------
 * Browsers (especially mobile Safari/Chrome) start every AudioContext in a
 * `suspended` state and only let it resume from inside a real user gesture.
 * Tone.js exposes `Tone.start()` for this, but it must be:
 *   1. called from a gesture handler (a click/tap), and
 *   2. awaited before notes are triggered, or the notes hit a suspended
 *      context and produce **no sound and no error** — a silent failure.
 *
 * Previously only the Play and Generate buttons resumed the context; every
 * "preview" gesture (tapping a chord card, a piano-roll key, a substitution)
 * triggered the synth directly. On desktop the context often resumes leniently
 * so this was masked, but on mobile the first tap is frequently a preview, so
 * audio silently never started.
 *
 * `ensureAudioReady()` centralises the unlock: it is idempotent, safe to call
 * from any gesture, surfaces failures through `useAudioStatusStore`, and logs
 * diagnostics so silent failures become visible. Call it at the top of every
 * gesture that makes sound, then await it before triggering notes.
 */

import * as Tone from "tone";
import { create } from "zustand";

/* ─── User-visible status ─── */

export type AudioStatus =
  /** No sound attempted yet; context is suspended. "Tap to enable audio." */
  | "idle"
  /** `Tone.start()` in flight. "Audio initializing…" */
  | "initializing"
  /** Context is running; playback will be audible. "Audio ready." */
  | "ready"
  /** Unlock failed or the context is stuck. "Audio failed: <reason>." */
  | "failed";

interface AudioStatusState {
  status: AudioStatus;
  /** Human-readable reason when `status === "failed"`, else null. */
  error: string | null;
  set: (status: AudioStatus, error?: string | null) => void;
}

/**
 * Reactive audio status, consumed by the on-screen audio indicator. Kept in a
 * tiny store (not React state) so non-React modules — the engine itself, the
 * instrument hook — can update it from anywhere.
 */
export const useAudioStatusStore = create<AudioStatusState>((set) => ({
  status: "idle",
  error: null,
  set: (status, error = null) => set({ status, error }),
}));

function setStatus(status: AudioStatus, error: string | null = null): void {
  useAudioStatusStore.getState().set(status, error);
}

/* ─── Diagnostics ─── */

const DEBUG_STORAGE_KEY = "harmonia-audio-debug";

/**
 * Console diagnostics are on automatically outside production and can be
 * toggled in any build with `localStorage.harmonia-audio-debug = "1"`.
 */
export function audioDebugEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch {
      /* private mode / storage disabled */
    }
  }
  return false;
}

/** Namespaced, level-tagged logger gated behind {@link audioDebugEnabled}. */
export function audioDebug(...args: unknown[]): void {
  if (audioDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.info("[audio]", ...args);
  }
}

/** Warnings are always logged — a swallowed audio error helps nobody. */
export function audioWarn(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn("[audio]", ...args);
}

/* ─── Context helpers ─── */

/** Current AudioContext state, or "unknown" if Tone hasn't created one yet. */
export function getAudioContextState(): AudioContextState | "unknown" {
  try {
    return Tone.getContext().state as AudioContextState;
  } catch {
    return "unknown";
  }
}

let stateSubscribed = false;

/**
 * Keep {@link useAudioStatusStore} in sync if the context is suspended later
 * (e.g. the tab is backgrounded on mobile, then foregrounded). Attaches once.
 */
export function subscribeAudioContextState(): void {
  if (stateSubscribed) return;
  stateSubscribed = true;
  try {
    const raw = Tone.getContext().rawContext as unknown as AudioContext;
    raw.addEventListener?.("statechange", () => {
      const state = getAudioContextState();
      audioDebug("context statechange →", state);
      if (state === "running") {
        setStatus("ready");
      } else if (state === "suspended" || state === "closed") {
        // Don't clobber an in-flight initialize or a hard failure.
        const current = useAudioStatusStore.getState().status;
        if (current === "ready") setStatus("idle");
      }
    });
  } catch {
    /* no context yet; ensureAudioReady will create and resume it */
  }
}

/* ─── The unlock ─── */

let pending: Promise<boolean> | null = null;

/**
 * Resume the AudioContext, returning whether it is running afterwards. Safe to
 * call repeatedly and from any gesture; concurrent callers share one attempt.
 *
 * Call it **synchronously at the top of a gesture handler** (so the gesture is
 * still "live" for mobile unlock), then `await` the returned promise before
 * triggering notes.
 */
export async function ensureAudioReady(): Promise<boolean> {
  subscribeAudioContextState();

  if (getAudioContextState() === "running") {
    setStatus("ready");
    return true;
  }
  if (pending) return pending;

  setStatus("initializing");
  audioDebug("ensureAudioReady → starting (context:", getAudioContextState() + ")");

  pending = (async () => {
    try {
      await Tone.start();
      // Some mobile contexts ignore the first resume; nudge once more.
      if (getAudioContextState() !== "running") {
        try {
          await Tone.getContext().resume();
        } catch {
          /* fall through to the state check below */
        }
      }
      const running = getAudioContextState() === "running";
      if (running) {
        audioDebug("audio ready — context running");
        setStatus("ready");
      } else {
        const reason = `context ${getAudioContextState()}`;
        audioWarn("Tone.start resolved but context is not running:", getAudioContextState());
        setStatus("failed", reason);
      }
      return running;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      audioWarn("Tone.start failed:", message);
      setStatus("failed", message);
      return false;
    } finally {
      pending = null;
    }
  })();

  return pending;
}
