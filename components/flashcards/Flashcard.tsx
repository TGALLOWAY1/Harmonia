"use client";

import clsx from "clsx";
import { CircleOfFifths } from "@/components/circle/CircleOfFifths";
import type { PitchClass } from "@/lib/theory";
import { useSettingsStore } from "@/lib/state/settingsStore";
import { useMemo } from "react";

export type FlashcardOption = {
  index: number;
  label: string;
};

export type FlashcardProps = {
  question: string;
  options: FlashcardOption[];
  selectedIndex: number | null;
  correctIndex: number | null;
  onSelect: (index: number) => void;
  isSubmitting?: boolean;
  showResult?: boolean;
  cardKind?: string;
  cardMeta?: any;
};

/**
 * Extract pitch class from option text
 * Handles formats like "E minor", "A", "C#", "F# minor"
 */
function extractPitchClass(text: string): PitchClass | null {
  // Remove "minor" or "major" suffix and trim
  const cleaned = text.replace(/\s*(minor|major)$/i, "").trim();
  
  // Check if it's a valid pitch class
  const validPitchClasses: PitchClass[] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
  ];
  
  if (validPitchClasses.includes(cleaned as PitchClass)) {
    return cleaned as PitchClass;
  }
  
  return null;
}

export function Flashcard({
  question,
  options,
  selectedIndex,
  correctIndex,
  onSelect,
  isSubmitting = false,
  showResult = false,
  cardKind,
  cardMeta,
}: FlashcardProps) {
  const hintLevel = useSettingsStore((state) => state.hintLevel);
  const isCircleCard = cardKind?.startsWith("circle_");
  const isChordCard = cardKind === "notes_from_chord" || cardKind === "chord_from_notes";
  const showAnswerDetails = showResult && correctIndex !== null && isChordCard;

  // Determine which root to show on circle and what to highlight
  const { selectedRoot, highlightedRoot } = useMemo(() => {
    if (!isCircleCard) {
      return { selectedRoot: "C" as PitchClass, highlightedRoot: null };
    }

    let root: PitchClass = "C";
    let highlight: PitchClass | null = null;

    if (cardKind === "circle_relative_minor" && cardMeta?.majorRoot) {
      root = cardMeta.majorRoot;
      if (showResult && correctIndex !== null) {
        const correctOption = options[correctIndex];
        const pitchClass = extractPitchClass(correctOption.label);
        if (pitchClass) {
          highlight = pitchClass;
        }
      }
    } else if (cardKind === "circle_neighbor_key" && cardMeta?.majorRoot) {
      root = cardMeta.majorRoot;
      if (showResult && correctIndex !== null) {
        const correctOption = options[correctIndex];
        const pitchClass = extractPitchClass(correctOption.label);
        if (pitchClass) {
          highlight = pitchClass;
        }
      }
    } else if (cardKind === "circle_geometry") {
      // For geometry questions, just show C as default
      root = "C";
      if (showResult && correctIndex !== null) {
        const correctOption = options[correctIndex];
        const pitchClass = extractPitchClass(correctOption.label);
        if (pitchClass) {
          highlight = pitchClass;
        }
      }
    }

    return { selectedRoot: root, highlightedRoot: highlight };
  }, [isCircleCard, cardKind, cardMeta, showResult, correctIndex, options]);

  const base =
    "flex min-h-[64px] items-center justify-center rounded-xl border text-sm text-foreground px-3 py-2 text-center transition-colors duration-150";

  const questionContent = (
    <>
      <h2 className="text-lg font-medium text-foreground">{question}</h2>
      {cardKind === "circle_relative_minor" && hintLevel === "light" && (
        <p className="mt-2 text-xs text-muted italic">
          Hint: Relative minor is the 6th degree of the major scale.
        </p>
      )}
    </>
  );

  const optionsGrid = (
    <div className="mt-4 grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isSelected = selectedIndex === opt.index;
          const isCorrect = opt.index === correctIndex;
          const isIncorrect = isSelected && showResult && !isCorrect;

          let buttonClasses = base;

          if (showResult) {
            // After result is shown
            if (isCorrect) {
              // Correct answer - green
              buttonClasses = clsx(
                base,
                "border-emerald-500 bg-emerald-500 text-white"
              );
            } else if (isIncorrect) {
              // Selected but incorrect - red
              buttonClasses = clsx(
                base,
                "border-red-500 bg-red-500 text-white"
              );
            } else {
              // Not selected, not correct - muted
              buttonClasses = clsx(
                base,
                "border-subtle bg-surface-muted text-muted"
              );
            }
          } else {
            // Before result is shown
            if (isSelected) {
              // Selected - emerald highlight
              buttonClasses = clsx(
                base,
                "border-emerald-400 bg-emerald-50 text-foreground"
              );
            } else {
              // Idle - default muted
              buttonClasses = clsx(
                base,
                "border-subtle bg-surface-muted text-muted hover:bg-surface"
              );
            }
          }

          return (
            <button
              key={opt.index}
              type="button"
              onClick={() => onSelect(opt.index)}
              disabled={isSubmitting || showResult}
              className={buttonClasses}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
  );

  const answerDetails = showAnswerDetails ? (
    <div className="mt-4 rounded-xl border border-subtle bg-surface-muted px-4 py-3 text-left">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Answer details</p>
      <p className="mt-1 text-sm text-foreground">
        {cardMeta?.display?.name && cardMeta?.display?.symbol
          ? `${cardMeta.display.name} (${cardMeta.display.symbol})`
          : "Chord details unavailable"}
      </p>
      {Array.isArray(cardMeta?.notes) && (
        <p className="mt-1 text-sm text-muted">Notes: {cardMeta.notes.join(" – ")}</p>
      )}
      {typeof cardMeta?.formula === "string" && (
        <p className="mt-1 text-sm text-muted">Formula: {cardMeta.formula}</p>
      )}
    </div>
  ) : null;

  if (isCircleCard) {
    return (
      <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-sm max-w-4xl w-full">
        {questionContent}
        <div className="mt-4 flex flex-col gap-4 md:flex-row">
          <div className="md:w-1/2 flex items-center justify-center">
            <CircleOfFifths
              selectedRoot={selectedRoot}
              onSelectRoot={() => {}}
              showRelativeMinors
              highlightedRoot={highlightedRoot}
            />
          </div>
          <div className="md:w-1/2">{optionsGrid}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-sm max-w-xl w-full">
      {questionContent}
      {optionsGrid}
      {answerDetails}
    </div>
  );
}
