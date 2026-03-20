"use client";

import { useState, useCallback, useMemo } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useFeedbackStore, type FeedbackEntry, type FeedbackRating } from "@/lib/feedback/feedbackStore";
import type { Progression } from "@/lib/theory/progressionTypes";

interface VoicingFeedbackProps {
  progression: Progression;
  rootKey: string;
  mode: string;
  complexity: number;
  numChords: number;
  bpm: number;
  voicingStyle: string;
  voiceCount: number;
}

export function VoicingFeedback({
  progression,
  rootKey,
  mode,
  complexity,
  numChords,
  bpm,
  voicingStyle,
  voiceCount,
}: VoicingFeedbackProps) {
  const addFeedback = useFeedbackStore((s) => s.addFeedback);
  const entries = useFeedbackStore((s) => s.entries);

  // Derive persisted rating for the current progression
  const persistedRating = useMemo(() => {
    const existing = entries.find((e) => e.progressionId === progression.id);
    return existing ? existing.rating : null;
  }, [entries, progression.id]);

  const [submitted, setSubmitted] = useState<FeedbackRating | null>(persistedRating);
  const [fadeKey, setFadeKey] = useState(progression.id);

  // Reset when progression changes, restoring any persisted rating
  if (fadeKey !== progression.id) {
    setFadeKey(progression.id);
    setSubmitted(persistedRating);
  }

  const handleRate = useCallback(
    (rating: FeedbackRating) => {
      const chords = progression.chords;
      const chordMidi = chords.map((c) => c.midiNotes ?? []);

      // Compute voice-leading costs between adjacent chords
      const costs: number[] = [];
      for (let i = 1; i < chordMidi.length; i++) {
        const prev = chordMidi[i - 1];
        const next = chordMidi[i];
        if (prev.length > 0 && next.length > 0) {
          // Simple total motion cost (semitones)
          const sorted1 = [...prev].sort((a, b) => a - b);
          const sorted2 = [...next].sort((a, b) => a - b);
          const overlap = Math.min(sorted1.length, sorted2.length);
          let cost = 0;
          for (let v = 0; v < overlap; v++) {
            cost += Math.abs(sorted1[v] - sorted2[v]);
          }
          costs.push(cost);
        }
      }

      const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;

      const entry: FeedbackEntry = {
        id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        rating,
        progressionId: progression.id,
        chordSymbols: chords.map((c) => c.symbol),
        chordMidi,
        rootKey,
        mode,
        complexity,
        numChords,
        bpm,
        voicingStyle,
        voiceCount,
        voiceLeadingCosts: costs,
        averageCost: Math.round(avgCost * 100) / 100,
      };

      addFeedback(entry);
      setSubmitted(rating);
    },
    [progression, rootKey, mode, complexity, numChords, bpm, voicingStyle, voiceCount, addFeedback]
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted mr-1">Rate voicing</span>
      <button
        onClick={() => handleRate("up")}
        disabled={submitted !== null}
        className={`p-1.5 rounded-lg transition-all ${
          submitted === "up"
            ? "bg-emerald-500/20 text-emerald-400 scale-110"
            : submitted !== null
              ? "opacity-30 cursor-not-allowed text-muted"
              : "text-muted/50 hover:text-emerald-400 hover:bg-emerald-500/10"
        }`}
        title="Good voicing"
      >
        <ThumbsUp className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleRate("down")}
        disabled={submitted !== null}
        className={`p-1.5 rounded-lg transition-all ${
          submitted === "down"
            ? "bg-red-500/20 text-red-400 scale-110"
            : submitted !== null
              ? "opacity-30 cursor-not-allowed text-muted"
              : "text-muted/50 hover:text-red-400 hover:bg-red-500/10"
        }`}
        title="Bad voicing"
      >
        <ThumbsDown className="w-4 h-4" />
      </button>
      {submitted && (
        <span className="text-[10px] text-muted/60 ml-1">Logged</span>
      )}
    </div>
  );
}
