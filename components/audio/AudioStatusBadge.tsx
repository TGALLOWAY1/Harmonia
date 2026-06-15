"use client";

/**
 * AudioStatusBadge — small, shared indicator that makes the otherwise-invisible
 * Web Audio state obvious: whether the context still needs a tap to unlock,
 * is initializing, is ready, or failed. Backed by `useAudioStatusStore`, which
 * the audio engine updates from every gesture.
 *
 * It renders nothing in the steady "ready" state after a moment, so it adds no
 * clutter once sound is working — it only speaks up when the user needs to know.
 */

import { useEffect, useState } from "react";
import { Volume2, VolumeX, AlertTriangle, Loader2 } from "lucide-react";
import { useAudioStatusStore } from "@/lib/audio/audioEngine";

export function AudioStatusBadge({ className = "" }: { className?: string }) {
  const status = useAudioStatusStore((s) => s.status);
  const error = useAudioStatusStore((s) => s.error);

  // Show a brief "Audio ready" confirmation the first time we go live, then
  // fade out so the steady state is uncluttered.
  const [showReady, setShowReady] = useState(false);
  useEffect(() => {
    if (status !== "ready") return;
    setShowReady(true);
    const t = setTimeout(() => setShowReady(false), 2200);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "ready" && !showReady) return null;

  const base =
    "inline-flex items-center justify-center gap-1.5 text-xs " + className;

  if (status === "failed") {
    return (
      <div className={base + " text-red-600 dark:text-red-400"} role="status" aria-live="polite">
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Audio failed{error ? `: ${error}` : ""}</span>
      </div>
    );
  }

  if (status === "initializing") {
    return (
      <div className={base + " text-muted"} role="status" aria-live="polite">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Audio initializing…</span>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className={base + " text-muted"} role="status" aria-live="polite">
        <VolumeX className="w-3.5 h-3.5" />
        <span>Tap any control to enable audio</span>
      </div>
    );
  }

  // status === "ready" (briefly)
  return (
    <div className={base + " text-emerald-600 dark:text-emerald-400"} role="status" aria-live="polite">
      <Volume2 className="w-3.5 h-3.5" />
      <span>Audio ready</span>
    </div>
  );
}
