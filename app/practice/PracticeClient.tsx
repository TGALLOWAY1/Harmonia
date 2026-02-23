"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FlashcardRenderer } from "@/components/practice/FlashcardRenderer";
import { Filter, X } from "lucide-react";

type LoadedCard = {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  kind?: string;
  meta?: any;
};

export default function PracticeClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const milestone = searchParams.get("milestone");
  const cardKindParam = searchParams.get("cardKind");
  const scaleTypeParam = searchParams.get("scaleType");
  const scaleRootParam = searchParams.get("scaleRoot");
  const difficultyParam = searchParams.get("difficulty");

  const [card, setCard] = useState<LoadedCard | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [cardCount, setCardCount] = useState<number | null>(null);

  // Filter state
  const [cardKind, setCardKind] = useState<string>(cardKindParam || "");
  const [scaleType, setScaleType] = useState<string>(scaleTypeParam || "");
  const [scaleRoot, setScaleRoot] = useState<string>(scaleRootParam || "");
  const [difficulty, setDifficulty] = useState<string>(difficultyParam || "all");

  const fetchNextCard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedIndex(null);
    setCorrectIndex(null);

    try {
      const base = "/api/cards/next";
      const params = new URLSearchParams();
      if (milestone) params.set("milestoneKey", milestone);
      if (cardKind) params.set("cardKind", cardKind);
      if (scaleType) params.set("scaleType", scaleType);
      if (scaleRoot) params.set("scaleRoot", scaleRoot);
      if (difficulty && difficulty !== "all") params.set("difficulty", difficulty);
      const url = params.toString() ? `${base}?${params.toString()}` : base;

      const res = await fetch(url);
      if (!res.ok) {
        let errorMessage = "Failed to fetch next card";
        try {
          const errorData = await res.json();
          if (errorData.error) {
            errorMessage = errorData.error;
            if (res.status === 404 && errorData.error.includes("milestoneKey")) {
              errorMessage = "No cards found for this milestone yet.";
            }
          }
        } catch {
          // If JSON parsing fails, use default message
        }
        throw new Error(errorMessage);
      }
      const data = await res.json();
      
      // Validate response structure
      if (!data.card || !data.card.id || !data.card.question || !Array.isArray(data.card.options)) {
        throw new Error("Invalid card data received from server");
      }
      setCard({
        id: data.card.id,
        question: data.card.question,
        options: data.card.options,
        correctIndex: data.card.correctIndex,
        kind: data.card.kind,
        meta: data.card.meta,
      });
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [milestone, cardKind, scaleType, scaleRoot, difficulty]);

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (milestone) params.set("milestone", milestone);
    if (cardKind) params.set("cardKind", cardKind);
    if (scaleType) params.set("scaleType", scaleType);
    if (scaleRoot) params.set("scaleRoot", scaleRoot);
    if (difficulty && difficulty !== "all") params.set("difficulty", difficulty);
    const newUrl = params.toString() ? `/practice?${params.toString()}` : "/practice";
    router.replace(newUrl, { scroll: false });
  }, [cardKind, scaleType, scaleRoot, difficulty, milestone, router]);

  const handleFilterChange = (filterType: string, value: string) => {
    if (filterType === "cardKind") setCardKind(value);
    else if (filterType === "scaleType") setScaleType(value);
    else if (filterType === "scaleRoot") setScaleRoot(value);
    else if (filterType === "difficulty") setDifficulty(value);
  };

  const clearFilters = () => {
    setCardKind("");
    setScaleType("");
    setScaleRoot("");
    setDifficulty("all");
  };

  const hasActiveFilters = cardKind || scaleType || scaleRoot || (difficulty && difficulty !== "all");

  // Chord-based card kinds that use scaleMemberships
  const CHORD_BASED_KINDS = ["notes_from_chord", "chord_from_notes"];
  const isChordBasedCard = CHORD_BASED_KINDS.includes(cardKind);

  // Card types that are key-agnostic (don't benefit from scale filtering)
  const KEY_AGNOSTIC_KINDS = ["key_signature", "circle_geometry", "circle_relative_minor", "circle_neighbor_key"];
  const isKeyAgnosticCard = KEY_AGNOSTIC_KINDS.includes(cardKind);

  // Scale root options (12 pitch classes)
  const SCALE_ROOT_OPTIONS: string[] = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];

  // Fetch card count when filters change
  const fetchCardCount = useCallback(async () => {
    try {
      const base = "/api/cards/count";
      const params = new URLSearchParams();
      if (milestone) params.set("milestoneKey", milestone);
      if (cardKind) params.set("cardKind", cardKind);
      if (scaleType) params.set("scaleType", scaleType);
      if (scaleRoot) params.set("scaleRoot", scaleRoot);
      if (difficulty && difficulty !== "all") params.set("difficulty", difficulty);
      const url = params.toString() ? `${base}?${params.toString()}` : base;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCardCount(data.count ?? 0);
      }
    } catch (err) {
      // Silently fail - count is not critical
      console.error("Error fetching card count:", err);
    }
  }, [milestone, cardKind, scaleType, scaleRoot, difficulty]);

  useEffect(() => {
    fetchNextCard();
    fetchCardCount();
  }, [fetchNextCard, fetchCardCount]);

  async function handleSelectOption(index: number) {
    setSelectedIndex(index);
  }

  async function handleSubmit() {
    if (!card || selectedIndex === null) return;

    setSubmitting(true);
    setError(null);

    try {
      // Check correctness locally by comparing selectedIndex with correctIndex
      setCorrectIndex(card.correctIndex);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitQuality(q: 0 | 1 | 2 | 3) {
    if (!card || selectedIndex === null) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/cards/${card.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedIndex,
          quality: q,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to submit quality rating (${res.status})`);
      }

      // After submitting quality, fetch the next card
      await fetchNextCard();
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-10">
        <header className="mb-6 text-center w-full">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted">Practice</p>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted transition"
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 rounded-full bg-emerald-500 text-white text-[10px] px-1.5 py-0.5">
                  {[cardKind, scaleType, scaleRoot, difficulty !== "all" ? difficulty : null].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
          <h1 className="text-2xl font-light tracking-tight text-foreground">
            Chords & scales flashcards
          </h1>
          {cardCount !== null && (
            <p className="text-sm text-muted mt-1">
              {cardCount === 0
                ? "No cards available"
                : cardCount === 1
                ? "1 card available"
                : `${cardCount} cards available`}
            </p>
          )}
        </header>

        {showFilters && (
          <div className="w-full max-w-2xl mb-6 p-4 rounded-xl border border-subtle bg-surface shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">Filter Practice</h2>
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs text-muted hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowFilters(false)}
                  className="text-xs text-muted hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card Kind Filter */}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Card Type
                </label>
                <select
                  value={cardKind}
                  onChange={(e) => handleFilterChange("cardKind", e.target.value)}
                  className="w-full rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                >
                  <option value="">All types</option>
                  <option value="scale_spelling">Scale Spelling</option>
                  <option value="diatonic_chord_id">Diatonic Chord ID</option>
                  <option value="degree_to_chord">Degree to Chord</option>
                  <option value="chord_to_degree">Chord to Degree</option>
                  <option value="progression_prediction">Progression Prediction</option>
                  <option value="mode_character">Mode Character</option>
                  <option value="notes_from_chord">Notes from Chord</option>
                  <option value="chord_from_notes">Chord from Notes</option>
                </select>
              </div>

              {/* Scale Type Filter */}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Scale Type
                </label>
                <select
                  value={scaleType}
                  onChange={(e) => handleFilterChange("scaleType", e.target.value)}
                  disabled={isKeyAgnosticCard}
                  className={`w-full rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all ${
                    isKeyAgnosticCard ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  <option value="">All scales</option>
                  <option value="major">Major</option>
                  <option value="natural_minor">Natural Minor</option>
                  <option value="dorian">Dorian</option>
                  <option value="mixolydian">Mixolydian</option>
                  <option value="phrygian">Phrygian</option>
                </select>
                {isKeyAgnosticCard && (
                  <p className="mt-1.5 text-xs text-muted italic">
                    Scale filter not applicable for this card type.
                  </p>
                )}
              </div>

              {/* Scale Root Filter */}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Scale Root
                </label>
                <select
                  value={scaleRoot}
                  onChange={(e) => handleFilterChange("scaleRoot", e.target.value)}
                  disabled={isKeyAgnosticCard}
                  className={`w-full rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all ${
                    isKeyAgnosticCard ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  <option value="">Any root</option>
                  {SCALE_ROOT_OPTIONS.map((root) => (
                    <option key={root} value={root}>
                      {root}
                    </option>
                  ))}
                </select>
                {isKeyAgnosticCard && (
                  <p className="mt-1.5 text-xs text-muted italic">
                    Scale filter not applicable for this card type.
                  </p>
                )}
              </div>

              {/* Difficulty Filter */}
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">
                  Difficulty
                </label>
                <select
                  value={difficulty}
                  onChange={(e) => handleFilterChange("difficulty", e.target.value)}
                  className="w-full rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                >
                  <option value="all">All cards</option>
                  <option value="easy">Easy only</option>
                </select>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="pt-2 border-t border-subtle">
                <p className="text-xs text-muted">
                  Filters are active. Cards will update automatically.
                </p>
                {(isChordBasedCard || cardKind === "scale_spelling" || cardKind === "diatonic_chord_id" || cardKind === "degree_to_chord" || cardKind === "chord_to_degree") && (scaleType || scaleRoot) && (
                  <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    Filtering by:{" "}
                    {scaleType && scaleRoot
                      ? `${scaleRoot} ${scaleType === "major" ? "major" : scaleType === "natural_minor" ? "natural minor" : scaleType}`
                      : scaleType
                      ? `Any ${scaleType === "major" ? "major" : scaleType === "natural_minor" ? "natural minor" : scaleType} key`
                      : scaleRoot
                      ? `${scaleRoot} key (any type)`
                      : ""}
                    {isChordBasedCard && (
                      <span className="block mt-1 text-emerald-500 dark:text-emerald-300 font-normal">
                        You&apos;ll be quizzed on chords that belong to this key.
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="text-center text-muted">
            <p>Loading next card…</p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="mb-4 text-red-500">{error}</p>
            <button
              type="button"
              onClick={fetchNextCard}
              className="rounded-full bg-surface px-4 py-2 text-sm font-medium text-foreground border border-subtle hover:bg-surface-muted"
            >
              Retry
            </button>
          </div>
        )}

        {card && !loading && !error && (
          <>
            <FlashcardRenderer
              question={card.question}
              options={card.options.map((label, index) => ({ index, label }))}
              selectedIndex={selectedIndex}
              correctIndex={correctIndex}
              onSelect={handleSelectOption}
              isSubmitting={submitting}
              showResult={correctIndex !== null}
              cardKind={card.kind}
              cardMeta={card.meta}
            />

            <div className="mt-4 flex flex-col gap-3">
              {correctIndex === null ? (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={selectedIndex === null || submitting}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-600 disabled:opacity-60"
                >
                  {submitting ? "Checking..." : "Check answer"}
                </button>
              ) : (
                <div className="flex flex-wrap gap-3 justify-center">
                  <button
                    type="button"
                    onClick={() => submitQuality(0)}
                    disabled={submitting}
                    className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-600 disabled:opacity-60"
                  >
                    Again
                  </button>
                  <button
                    type="button"
                    onClick={() => submitQuality(1)}
                    disabled={submitting}
                    className="rounded-full bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-orange-600 disabled:opacity-60"
                  >
                    Hard
                  </button>
                  <button
                    type="button"
                    onClick={() => submitQuality(2)}
                    disabled={submitting}
                    className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-600 disabled:opacity-60"
                  >
                    Good
                  </button>
                  <button
                    type="button"
                    onClick={() => submitQuality(3)}
                    disabled={submitting}
                    className="rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-600 disabled:opacity-60"
                  >
                    Easy
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
