"use client";

import React, { useMemo, useState } from "react";
import { X, Play, ArrowLeft } from "lucide-react";
import type { SubstitutionOption, SubstitutionCategory } from "@/lib/creative/types";
import type { Chord } from "@/lib/theory/progressionTypes";

// Short, friendly tab labels. The underlying engine categories are preserved;
// only their presentation is simplified here.
const CATEGORY_LABELS: Record<SubstitutionCategory, string> = {
  diatonic: "Diatonic",
  relative: "Relative",
  "dominant-function": "Function",
  tritone: "Tritone",
  "modal-mixture": "Borrowed",
  inversion: "Voicing",
};

// Categories worth flagging inline on the bubble. Diatonic/voicing are the
// "default" expectation, so we keep those bubbles clean and unlabelled.
const INLINE_LABEL: Partial<Record<SubstitutionCategory, string>> = {
  relative: "relative",
  "dominant-function": "function",
  tritone: "tritone",
  "modal-mixture": "borrowed",
};

const CATEGORY_DOT: Record<SubstitutionCategory, string> = {
  diatonic: "bg-blue-400",
  relative: "bg-purple-400",
  "dominant-function": "bg-amber-400",
  tritone: "bg-red-400",
  "modal-mixture": "bg-emerald-400",
  inversion: "bg-gray-400",
};

type SubstitutionPanelProps = {
  chord: Chord;
  chordIndex: number;
  progressionChords: Chord[];
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
  progressionChords,
  substitutions,
  onPreview,
  onApply,
  onRevert,
  onClose,
  canRevert,
}: SubstitutionPanelProps) {
  const [activeCategory, setActiveCategory] = useState<SubstitutionCategory | "all">("all");
  // The currently "armed" candidate: first tap previews + reveals details,
  // a second tap (or the Apply button) commits it.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set(substitutions.map((s) => s.category));
    return Array.from(cats);
  }, [substitutions]);

  const filtered = useMemo(() => {
    if (activeCategory === "all") return substitutions;
    return substitutions.filter((s) => s.category === activeCategory);
  }, [substitutions, activeCategory]);

  const selected = useMemo(
    () => substitutions.find((s) => s.id === selectedId) ?? null,
    [substitutions, selectedId],
  );

  const handleBubbleTap = (option: SubstitutionOption) => {
    if (selectedId === option.id) {
      // Second tap on an armed bubble commits the substitution.
      onApply(option);
      setSelectedId(null);
      return;
    }
    // First tap: arm + preview in context.
    setSelectedId(option.id);
    onPreview(option);
  };

  return (
    <div className="bg-surface rounded-t-2xl lg:rounded-2xl border border-border-subtle shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Substitute</h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors text-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mini progression strip */}
      <div className="px-5 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {progressionChords.map((c, i) => (
            <div
              key={i}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                i === chordIndex
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-surface-muted text-muted border-transparent"
              }`}
            >
              {c.symbol}
            </div>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <div className="px-5 pb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveCategory("all")}
          className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            activeCategory === "all"
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCategory === cat
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Chord option bubbles */}
      <div className="px-5 pb-1 max-h-[280px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            No substitutions available here.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {filtered.map((option) => {
              const isSelected = selectedId === option.id;
              const inline = INLINE_LABEL[option.category];
              return (
                <button
                  key={option.id}
                  onClick={() => handleBubbleTap(option)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 py-3 px-1 rounded-2xl border text-center transition-all ${
                    isSelected
                      ? "bg-accent text-white border-accent shadow-md scale-[1.03]"
                      : "bg-surface-muted border-border-subtle hover:border-accent/40 active:scale-95"
                  }`}
                  title={isSelected ? "Tap again to apply" : "Tap to preview"}
                >
                  <span
                    className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${CATEGORY_DOT[option.category]} ${
                      isSelected ? "opacity-90" : "opacity-70"
                    }`}
                  />
                  <span className="text-base font-semibold leading-tight">
                    {option.candidateSymbol}
                  </span>
                  <span
                    className={`text-[10px] font-mono leading-tight ${
                      isSelected ? "text-white/80" : "text-muted"
                    }`}
                  >
                    {option.candidateRomanNumeral}
                  </span>
                  {inline && (
                    <span
                      className={`text-[9px] uppercase tracking-wide leading-tight ${
                        isSelected ? "text-white/70" : "text-muted/70"
                      }`}
                    >
                      {inline}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail + apply for the armed candidate (progressive disclosure) */}
      {selected && (
        <div className="mx-5 my-3 p-3 rounded-xl bg-surface-muted border border-border-subtle">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{selected.candidateSymbol}</span>
                <span className="text-xs font-mono text-muted">{selected.candidateRomanNumeral}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted/70">
                  {CATEGORY_LABELS[selected.category]}
                </span>
              </div>
              <div className="text-xs text-muted mt-1">
                <span className="opacity-70">{selected.candidateNotes.join(" · ")}</span>
              </div>
              <p className="text-xs text-muted mt-1.5 leading-relaxed">{selected.reason}</p>
            </div>
            <button
              onClick={() => onPreview(selected)}
              className="shrink-0 p-2 rounded-lg hover:bg-accent/10 text-muted hover:text-accent transition-colors"
              title="Preview again"
              aria-label="Preview again"
            >
              <Play className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => {
              onApply(selected);
              setSelectedId(null);
            }}
            className="mt-3 w-full py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 active:scale-[0.98] transition-all"
          >
            Apply {selected.candidateSymbol}
          </button>
        </div>
      )}

      {/* Footer with revert */}
      {canRevert && (
        <div className="px-5 py-3 border-t border-border-subtle">
          <button
            onClick={onRevert}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Revert to original
          </button>
        </div>
      )}
    </div>
  );
}
