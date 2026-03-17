"use client";

import { useMemo } from "react";
import {
  Play,
  Square,
  Repeat,
  ListMusic,
  ArrowRightLeft,
} from "lucide-react";
import {
  isWhiteKey,
  midiToNoteName,
  midiToPitchClass,
  generateMidiRange,
  type PitchClass,
} from "@/lib/theory/midiUtils";
import type {
  HarmonicSketchProject,
  HarmonicSection,
  HarmonicVariant,
  HarmonicEvent,
  PlaybackMode,
} from "@/lib/sketchpad/types";
import type { Mode } from "@/lib/theory/harmonyEngine";
import { SOUND_PRESETS } from "@/lib/audio/synthPresets";
import clsx from "clsx";

const MODES: { value: Mode; label: string }[] = [
  { value: "ionian", label: "Major" },
  { value: "aeolian", label: "Minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
];

function computeAutoRange(events: HarmonicEvent[]): { low: number; high: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const ev of events) {
    for (const m of ev.midiNotes) {
      if (m < min) min = m;
      if (m > max) max = m;
    }
  }
  if (min === Infinity) return { low: 48, high: 72 };
  const low = Math.floor((min - 2) / 12) * 12;
  const high = Math.max(Math.ceil((max + 3) / 12) * 12, low + 12);
  return { low, high };
}

export function HarmonicPreviewPanel({
  project,
  section,
  variant,
  playbackMode,
  playbackEventIndex,
  playbackSectionIndex,
  onPlayChord,
  onPlaySection,
  onPlayFullSong,
  onPlayTransition,
  onStop,
  onPlayNote,
  soundPreset,
  onSoundPresetChange,
  isSynthLoading,
}: {
  project: HarmonicSketchProject;
  section: HarmonicSection | null;
  variant: HarmonicVariant | null;
  playbackMode: PlaybackMode;
  playbackEventIndex: number;
  playbackSectionIndex: number;
  onPlayChord: (event: HarmonicEvent) => void;
  onPlaySection: (loop: boolean) => void;
  onPlayFullSong: (fromIdx: number) => void;
  onPlayTransition: () => void;
  onStop: () => void;
  onPlayNote: (noteWithOctave: string) => void;
  soundPreset: string;
  onSoundPresetChange: (preset: any) => void;
  isSynthLoading: boolean;
}) {
  const events = useMemo(() => variant?.events ?? [], [variant]);
  const isPlaying = playbackMode !== "stopped";

  const autoRange = useMemo(() => computeAutoRange(events), [events]);
  const noteRange = useMemo(() => {
    const range = generateMidiRange(autoRange.low, autoRange.high);
    return range.reverse();
  }, [autoRange]);

  const sectionIdx = section
    ? project.sections.findIndex((s) => s.id === section.id)
    : -1;
  const hasNextSection = sectionIdx >= 0 && sectionIdx < project.sections.length - 1;

  const activeEvent = useMemo(() => {
    if (!isPlaying || !events[playbackEventIndex]) return null;
    return events[playbackEventIndex];
  }, [isPlaying, events, playbackEventIndex]);

  const activeMidiSet = useMemo(() => {
    if (!activeEvent) return new Set<number>();
    return new Set(activeEvent.midiNotes);
  }, [activeEvent]);

  return (
    <div className="w-80 flex-shrink-0 border-l border-border-subtle bg-surface flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted uppercase tracking-wider">
            Preview
          </span>
          <select
            value={soundPreset}
            onChange={(e) => onSoundPresetChange(e.target.value)}
            className="bg-surface-muted border border-border-subtle rounded px-2 py-0.5 text-xs outline-none appearance-none cursor-pointer"
          >
            {SOUND_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Playback controls */}
        <div className="flex flex-wrap gap-1.5">
          {isPlaying ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-muted border border-border-subtle text-xs font-medium hover:bg-accent/10"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          ) : (
            <>
              <button
                onClick={() => onPlaySection(false)}
                disabled={events.length === 0 || isSynthLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
              >
                {isSynthLoading ? (
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                Section
              </button>
              <button
                onClick={() => onPlaySection(true)}
                disabled={events.length === 0 || isSynthLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-muted border border-border-subtle text-xs font-medium hover:bg-accent/10 disabled:opacity-40"
                title="Loop section"
              >
                <Repeat className="w-3 h-3" />
              </button>
              <button
                onClick={() => onPlayFullSong(0)}
                disabled={project.sections.length === 0 || isSynthLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-muted border border-border-subtle text-xs font-medium hover:bg-accent/10 disabled:opacity-40"
                title="Play full song"
              >
                <ListMusic className="w-3 h-3" />
                All
              </button>
              {hasNextSection && (
                <button
                  onClick={onPlayTransition}
                  disabled={events.length === 0 || isSynthLoading}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-muted border border-border-subtle text-xs font-medium hover:bg-accent/10 disabled:opacity-40"
                  title="Preview transition to next section"
                >
                  <ArrowRightLeft className="w-3 h-3" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Theory context */}
      {section && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="text-xs font-medium text-muted uppercase tracking-wider mb-1.5">
            Harmonic Context
          </div>
          <div className="text-sm">
            <span className="font-semibold">{section.keyRoot}</span>{" "}
            <span className="text-muted">
              {MODES.find((m) => m.value === section.scaleType)?.label}
            </span>
          </div>
          {activeEvent && (
            <div className="mt-2 p-2 rounded-lg bg-surface-muted">
              <div className="text-xs font-mono text-muted">{activeEvent.romanNumeral}</div>
              <div className="text-sm font-semibold">{activeEvent.chordSymbol}</div>
              <div className="text-xs text-muted mt-0.5">
                {activeEvent.notesWithOctave.join(" · ")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Piano Roll visualization */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {events.length > 0 ? (
          <div>
            <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Piano Roll
            </div>
            <div className="border border-border-subtle rounded-lg overflow-hidden">
              <div className="flex">
                {/* Piano keys */}
                <div className="w-10 flex-shrink-0 border-r border-border-subtle">
                  {noteRange.map((midi) => {
                    const isWhite = isWhiteKey(midi);
                    const pc = midiToPitchClass(midi);
                    const isC = pc === "C";
                    const noteName = midiToNoteName(midi);
                    const isActive = activeMidiSet.has(midi);

                    return (
                      <div
                        key={midi}
                        className={clsx(
                          "h-4 flex items-center justify-end pr-1 text-[8px] border-b border-border-subtle",
                          !isWhite && "bg-surface-muted",
                          isActive && "bg-accent/20 text-accent font-medium"
                        )}
                      >
                        {(isC || isActive) ? noteName : ""}
                      </div>
                    );
                  })}
                </div>

                {/* Grid */}
                <div className="flex flex-1 overflow-x-auto">
                  {events.map((ev, colIdx) => {
                    const midiSet = new Set(ev.midiNotes);
                    const rootPc = ev.chordRoot;
                    const isPlayingCol = isPlaying && playbackEventIndex === colIdx;

                    return (
                      <div
                        key={ev.id}
                        className={clsx(
                          "flex-1 min-w-[32px] border-r border-border-subtle last:border-r-0 cursor-pointer",
                          isPlayingCol && "bg-accent/5"
                        )}
                        onClick={() => onPlayChord(ev)}
                      >
                        {/* Column header */}
                        <div
                          className={clsx(
                            "h-5 flex items-center justify-center text-[8px] font-semibold border-b-2 border-border-subtle",
                            isPlayingCol && "bg-accent/10 text-accent border-accent"
                          )}
                        >
                          {ev.chordSymbol}
                        </div>
                        {/* Notes */}
                        {noteRange.map((midi) => {
                          const isWhite = isWhiteKey(midi);
                          const pc = midiToPitchClass(midi);
                          const hasNote = midiSet.has(midi);
                          const isRoot = hasNote && pc === rootPc;

                          return (
                            <div
                              key={midi}
                              className={clsx(
                                "h-4 border-b border-border-subtle relative",
                                !isWhite && "bg-surface-muted/50"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasNote) onPlayNote(midiToNoteName(midi));
                              }}
                            >
                              {hasNote && (
                                <div
                                  className={clsx(
                                    "absolute inset-x-0.5 inset-y-0.5 rounded-sm",
                                    isRoot
                                      ? "bg-[var(--vert-accent-teal)]"
                                      : "bg-[var(--vert-accent-coral)]"
                                  )}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted text-center py-8">
            Add chords to see the piano roll visualization.
          </div>
        )}

        {/* Section flow overview */}
        {project.sections.length > 1 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Song Flow
            </div>
            <div className="flex flex-wrap gap-1">
              {project.sections.map((s, idx) => {
                const isCurrentSection = s.id === section?.id;
                const isPlayingSection = isPlaying && playbackSectionIndex === idx;
                const activeVariant = s.variants.find((v) => v.id === s.activeVariantId);
                const chordCount = activeVariant?.events.length ?? 0;

                return (
                  <div
                    key={s.id}
                    className={clsx(
                      "px-2 py-1 rounded text-[10px] border transition-colors",
                      isCurrentSection
                        ? "bg-accent/10 border-accent/30 font-medium"
                        : isPlayingSection
                        ? "bg-accent/5 border-accent/20"
                        : "bg-surface-muted border-border-subtle"
                    )}
                  >
                    <div className="font-medium">{s.name}</div>
                    <div className="text-muted">{chordCount}ch</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
