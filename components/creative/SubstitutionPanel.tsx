"use client";

import React, { useMemo, useState } from "react";
import { X, Play, Check, ArrowLeft } from "lucide-react";
import type { SubstitutionOption, SubstitutionCategory } from "@/lib/creative/types";
import type { Chord } from "@/lib/theory/progressionTypes";

const CATEGORY_LABELS: Record<SubstitutionCategory, string> = {
  diatonic: "Diatonic",
  relative: "Relative",
  "dominant-function": "Dominant Function",
  tritone: "Tritone Sub",
  "modal-mixture": "Modal Mixture",
  inversion: "Inversion",
};

const CATEGORY_COLORS: Record<SubstitutionCategory, string> = {
  diatonic: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  relative: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  "dominant-function": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  tritone: "bg-red-500/15 text-red-300 border-red-500/30",
  "modal-mixture": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  inversion: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

type SubstitutionPanelProps = {
  chord: Chord;
  chordIndex: number;
  substitutions: SubstitutionOption[];
  onPreview: (option: SubstitutionOption) => void;
  onApply: (option: SubstitutionOption) => void;
  onRevert: () => void;
  onClose: () => void;
  canRevert: boolean;
};

export function SubstitutionPanel({
  chord,
  chordIndex,
  substitutions,
  onPreview,
  onApply,
  onRevert,
  onClose,
  canRevert,
}: SubstitutionPanelProps) {
  const [activeCategory, setActiveCategory] = useState<SubstitutionCategory | "all">("all");

  const categories = useMemo(() => {
    const cats = new Set(substitutions.map(s => s.category));
    return Array.from(cats);
  }, [substitutions]);

  const filtered = useMemo(() => {
    if (activeCategory === "all") return substitutions;
    return substitutions.filter(s => s.category === activeCategory);
  }, [substitutions, activeCategory]);

  return (
    <div className="bg-surface rounded-2xl border border-border-subtle shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Substitute Chord</h3>
          <div className="text-xs text-muted mt-0.5">
            Chord {chordIndex + 1}: <span className="font-medium text-foreground">{chord.symbol}</span>
            <span className="ml-2 opacity-60">{chord.romanNumeral}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors text-muted hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category filters */}
      <div className="px-5 py-3 border-b border-border-subtle flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory("all")}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
            activeCategory === "all"
              ? "bg-accent/15 text-accent border-accent/30"
              : "bg-surface-muted text-muted border-transparent hover:border-border-subtle"
          }`}
        >
          All ({substitutions.length})
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
              activeCategory === cat
                ? CATEGORY_COLORS[cat]
                : "bg-surface-muted text-muted border-transparent hover:border-border-subtle"
            }`}
          >
            {CATEGORY_LABELS[cat]} ({substitutions.filter(s => s.category === cat).length})
          </button>
        ))}
      </div>

      {/* Options list */}
      <div className="max-h-[360px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            No substitutions available for this category.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {filtered.map(option => (
              <div
                key={option.id}
                className="px-5 py-3 hover:bg-surface-muted/50 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">{option.candidateSymbol}</span>
                    <span className="text-xs font-mono text-muted">{option.candidateRomanNumeral}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLORS[option.category]}`}>
                      {CATEGORY_LABELS[option.category]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onPreview(option)}
                      className="p-1.5 rounded-lg hover:bg-accent/10 text-muted hover:text-accent transition-colors"
                      title="Preview"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onApply(option)}
                      className="px-2.5 py-1 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-xs font-medium transition-colors"
                    >
                      <Check className="w-3 h-3 inline mr-1" />
                      Apply
                    </button>
                  </div>
                </div>
                <div className="text-xs text-muted">
                  <span className="opacity-70">{option.candidateNotes.join(" · ")}</span>
                  <span className="mx-1.5 opacity-30">—</span>
                  <span>{option.reason}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with revert */}
      {canRevert && (
        <div className="px-5 py-3 border-t border-border-subtle">
          <button
            onClick={onRevert}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Revert to original chord
          </button>
        </div>
      )}
    </div>
  );
}
