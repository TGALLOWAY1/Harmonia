"use client";

import React, { useState } from "react";
import { Shuffle, Undo2 } from "lucide-react";
import type { MutationChange } from "@/lib/creative/types";

type MutationControlsProps = {
  onMutate: (intensity: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  lastChanges: MutationChange[];
  disabled?: boolean;
};

const INTENSITY_LABELS: Array<{ max: number; label: string }> = [
  { max: 20, label: "Minimal" },
  { max: 50, label: "Subtle" },
  { max: 80, label: "Moderate" },
  { max: 100, label: "Adventurous" },
];

function getIntensityLabel(value: number): string {
  for (const { max, label } of INTENSITY_LABELS) {
    if (value <= max) return label;
  }
  return "Adventurous";
}

function getIntensityColor(value: number): string {
  if (value <= 20) return "text-blue-400";
  if (value <= 50) return "text-emerald-400";
  if (value <= 80) return "text-amber-400";
  return "text-red-400";
}

export function MutationControls({
  onMutate,
  onUndo,
  canUndo,
  lastChanges,
  disabled,
}: MutationControlsProps) {
  const [intensity, setIntensity] = useState(30);

  return (
    <div className="bg-surface rounded-2xl border border-border-subtle p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold tracking-tight">Mutate</h3>
        {canUndo && (
          <button
            onClick={onUndo}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
        )}
      </div>

      {/* Intensity slider */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted">Intensity</span>
          <span className={`text-xs font-medium ${getIntensityColor(intensity)}`}>
            {getIntensityLabel(intensity)}
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={1}
            max={100}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="w-full accent-accent h-1.5 rounded-full appearance-none bg-surface-muted cursor-pointer"
          />
          <div className="flex justify-between mt-1 px-0.5">
            <span className="text-[9px] text-muted/50">Subtle</span>
            <span className="text-[9px] text-muted/50">Adventurous</span>
          </div>
        </div>
      </div>

      {/* Mutate button */}
      <button
        onClick={() => onMutate(intensity)}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed border border-accent/20 hover:border-accent/40"
      >
        <Shuffle className="w-4 h-4" />
        Mutate Progression
      </button>

      {/* Change summary */}
      {lastChanges.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border-subtle">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2 font-medium">
            Last Changes
          </div>
          <ul className="space-y-1">
            {lastChanges.map((change, i) => (
              <li key={i} className="text-xs text-muted flex items-start gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60 mt-1 flex-shrink-0" />
                <span>{change.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
