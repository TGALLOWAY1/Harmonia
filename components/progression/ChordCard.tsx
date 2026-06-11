"use client";

import { motion } from "framer-motion";
import { Shuffle, Lock, Unlock, RotateCcw } from "lucide-react";
import type { Chord } from "@/lib/theory/progressionTypes";
import type { ChordSourceType } from "@/lib/creative/types";

/** Human-readable duration label (only shown for non-full bars). */
const DURATION_LABEL: Record<string, string> = {
  half: "2 beats",
  quarter: "1 beat",
  eighth: "½ beat",
};

/** Provenance styling — kept as a small dot so it never crowds the chord name. */
const SOURCE_META: Record<ChordSourceType, { dot: string; label: string }> = {
  generated: { dot: "", label: "" },
  substituted: { dot: "bg-purple-400", label: "Substituted" },
  manual: { dot: "bg-emerald-400", label: "Edited" },
};

export type ChordCardProps = {
  chord: Chord;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  sourceType: ChordSourceType;
  canRevert: boolean;
  onSelect: () => void;
  onSubstitute: () => void;
  onToggleLock: () => void;
  onRevert: () => void;
};

/**
 * A single chord in the progression grid. Sized by the parent grid (not by
 * musical duration) so it stays readable at any chord count and aligns to a
 * uniform height — the duration is communicated by the label and the piano roll
 * below. Per-card substitute/lock controls appear from `sm` up; on phones the
 * contextual action bar under the grid is the canonical control surface.
 */
export function ChordCard({
  chord,
  index,
  isActive,
  isSelected,
  sourceType,
  canRevert,
  onSelect,
  onSubstitute,
  onToggleLock,
  onRevert,
}: ChordCardProps) {
  const source = SOURCE_META[sourceType];
  const durationLabel =
    chord.durationClass && chord.durationClass !== "full"
      ? DURATION_LABEL[chord.durationClass]
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: index * 0.05,
        duration: 0.3,
        ease: [0.22, 1, 0.36, 1],
      }}
      onClick={onSelect}
      className={`group relative flex min-h-[92px] flex-col rounded-xl border px-2.5 py-2.5 transition-all duration-200 cursor-pointer select-none sm:px-3 sm:py-3 ${
        isActive
          ? "bg-accent/10 border-accent shadow-md ring-2 ring-inset ring-accent/20"
          : isSelected
            ? "bg-accent/5 border-accent ring-2 ring-inset ring-accent/40 shadow-sm"
            : chord.isLocked
              ? "bg-surface border-accent/30 ring-1 ring-inset ring-accent/10"
              : "bg-surface border-border-subtle shadow-sm hover:border-accent/60 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm"
      }`}
    >
      {/* Playback glow pulse */}
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded-xl bg-accent/5 pointer-events-none"
          animate={{ opacity: [0.3, 0.08, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Top meta row: provenance dot (left) + controls (right). The controls
          are sized for fingers and only render from sm up; the lock dot keeps
          a persistent, compact indicator on phones. */}
      <div className="relative z-10 flex w-full items-center justify-between gap-1 min-h-[18px]">
        <span className="flex items-center gap-1">
          {source.dot && (
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${source.dot}`}
              title={source.label}
            />
          )}
          {chord.isLocked && (
            <Lock className="sm:hidden w-3 h-3 text-accent" aria-label="Locked" />
          )}
        </span>
        <div className="hidden sm:flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSubstitute();
            }}
            className="p-1.5 lg:p-1 rounded-md text-muted/40 hover:text-accent transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            title="Substitute chord"
            aria-label="Substitute chord"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock();
            }}
            className={`p-1.5 lg:p-1 rounded-md transition-colors ${
              chord.isLocked
                ? "text-accent hover:text-accent/80"
                : "text-muted/40 hover:text-muted/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
            title={chord.isLocked ? "Unlock chord" : "Lock chord"}
            aria-label={chord.isLocked ? "Unlock chord" : "Lock chord"}
          >
            {chord.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Centered chord content */}
      <div className="relative z-10 flex flex-1 w-full min-w-0 flex-col items-center justify-center text-center">
        <div className="w-full truncate text-[11px] font-mono text-muted mb-0.5 tracking-wider">
          {chord.romanNumeral}
        </div>
        <div className="w-full truncate text-base sm:text-lg lg:text-xl font-semibold leading-tight">
          {chord.symbol}
        </div>
        <div className="hidden sm:block w-full truncate text-[10px] text-muted opacity-70 mt-1">
          {chord.notes.join(" · ")}
        </div>
        {durationLabel && (
          <div className="mt-1 hidden sm:block text-[9px] font-mono text-muted/50 uppercase tracking-widest">
            {durationLabel}
          </div>
        )}

        {canRevert && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRevert();
            }}
            className="mt-1.5 flex items-center gap-1 text-[9px] text-muted/50 hover:text-accent transition-colors"
            title="Revert to original"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            revert
          </button>
        )}
      </div>
    </motion.div>
  );
}
