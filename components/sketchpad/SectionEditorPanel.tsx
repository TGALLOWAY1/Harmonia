"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Play,
  Square,
  Repeat,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Music,
} from "lucide-react";
import { useSketchpadStore } from "@/lib/sketchpad/store";
import type {
  HarmonicSketchProject,
  HarmonicSection,
  HarmonicVariant,
  HarmonicEvent,
  SectionType,
  PlaybackMode,
} from "@/lib/sketchpad/types";
import type { PitchClass } from "@/lib/theory/midiUtils";
import type { Mode } from "@/lib/theory/harmonyEngine";
import {
  getDiatonicChordsForKey,
  chordInfoToEvent,
  parseChordSymbol,
  buildChordFromParsed,
} from "@/lib/sketchpad/chordUtils";

const NOTES: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES: { value: Mode; label: string }[] = [
  { value: "ionian", label: "Major" },
  { value: "aeolian", label: "Minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
  { value: "major_pentatonic", label: "Major Pentatonic" },
];

const DURATIONS = [
  { beats: 1, label: "1 beat" },
  { beats: 2, label: "2 beats" },
  { beats: 4, label: "4 beats" },
  { beats: 8, label: "8 beats" },
];

export function SectionEditorPanel({
  project,
  section,
  variant,
  playbackMode,
  playbackEventIndex,
  onPlayChord,
  onPlaySection,
  onStop,
}: {
  project: HarmonicSketchProject;
  section: HarmonicSection | null;
  variant: HarmonicVariant | null;
  playbackMode: PlaybackMode;
  playbackEventIndex: number;
  onPlayChord: (event: HarmonicEvent) => void;
  onPlaySection: (loop: boolean) => void;
  onStop: () => void;
}) {
  const {
    updateSectionKey,
    updateSectionBars,
    addVariant,
    duplicateVariant,
    deleteVariant,
    setActiveVariant,
    renameVariant,
    addEvent,
    updateEvent,
    deleteEvent,
    reorderEvents,
  } = useSketchpadStore();

  const [chordInput, setChordInput] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editChordValue, setEditChordValue] = useState("");

  const keyRoot = section?.keyRoot ?? project.globalKeyRoot;
  const scaleType = section?.scaleType ?? project.globalScaleType;

  const diatonicChords = useMemo(
    () => getDiatonicChordsForKey(keyRoot, scaleType),
    [keyRoot, scaleType]
  );

  const isPlaying = playbackMode !== "stopped";

  const handleAddDiatonicChord = useCallback(
    (chordIndex: number) => {
      if (!section || !variant) return;
      const chord = diatonicChords[chordIndex];
      const eventData = chordInfoToEvent(chord, variant.id, variant.events.length);
      addEvent(section.id, variant.id, eventData);
    },
    [section, variant, diatonicChords, addEvent]
  );

  const handleAddCustomChord = useCallback(() => {
    if (!section || !variant || !chordInput.trim()) return;
    const parsed = parseChordSymbol(chordInput.trim());
    if (!parsed) return;
    const eventData = buildChordFromParsed(
      parsed.root,
      parsed.quality,
      keyRoot,
      scaleType
    );
    addEvent(section.id, variant.id, eventData);
    setChordInput("");
  }, [section, variant, chordInput, keyRoot, scaleType, addEvent]);

  const handleUpdateChordSymbol = useCallback(
    (eventId: string) => {
      if (!section || !variant || !editChordValue.trim()) return;
      const parsed = parseChordSymbol(editChordValue.trim());
      if (!parsed) {
        setEditingEventId(null);
        return;
      }
      const eventData = buildChordFromParsed(parsed.root, parsed.quality, keyRoot, scaleType);
      updateEvent(section.id, variant.id, eventId, eventData);
      setEditingEventId(null);
      setEditChordValue("");
    },
    [section, variant, editChordValue, keyRoot, scaleType, updateEvent]
  );

  const handleMoveEvent = useCallback(
    (eventIndex: number, direction: "left" | "right") => {
      if (!section || !variant) return;
      const toIndex = direction === "left" ? eventIndex - 1 : eventIndex + 1;
      if (toIndex < 0 || toIndex >= variant.events.length) return;
      reorderEvents(section.id, variant.id, eventIndex, toIndex);
    },
    [section, variant, reorderEvents]
  );

  if (!section) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-surface-muted border border-border-subtle flex items-center justify-center mx-auto mb-4">
            <Music className="w-7 h-7 text-muted" />
          </div>
          <p className="text-sm text-muted max-w-xs">
            Select a section from the left panel to edit its chord progression,
            or add a new section to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {/* Section header */}
      <div className="px-6 py-4 border-b border-border-subtle bg-surface/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">{section.name}</h3>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-muted uppercase tracking-wider">Key</label>
                <select
                  value={section.keyRoot}
                  onChange={(e) =>
                    updateSectionKey(section.id, e.target.value as PitchClass, section.scaleType)
                  }
                  className="bg-surface-muted border border-border-subtle rounded px-1.5 py-0.5 text-xs outline-none appearance-none cursor-pointer"
                >
                  {NOTES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <select
                  value={section.scaleType}
                  onChange={(e) =>
                    updateSectionKey(section.id, section.keyRoot, e.target.value as Mode)
                  }
                  className="bg-surface-muted border border-border-subtle rounded px-1.5 py-0.5 text-xs outline-none appearance-none cursor-pointer"
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-muted uppercase tracking-wider">Bars</label>
                <select
                  value={section.bars}
                  onChange={(e) => updateSectionBars(section.id, Number(e.target.value))}
                  className="bg-surface-muted border border-border-subtle rounded px-1.5 py-0.5 text-xs outline-none appearance-none cursor-pointer"
                >
                  {[2, 4, 8, 16].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section playback */}
          <div className="flex items-center gap-2">
            {isPlaying ? (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs font-medium hover:bg-accent/10"
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            ) : (
              <>
                <button
                  onClick={() => onPlaySection(false)}
                  disabled={!variant || variant.events.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
                >
                  <Play className="w-3 h-3" />
                  Play
                </button>
                <button
                  onClick={() => onPlaySection(true)}
                  disabled={!variant || variant.events.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs font-medium hover:bg-accent/10 disabled:opacity-40"
                  title="Loop section"
                >
                  <Repeat className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Variant tabs */}
        <div className="flex items-center gap-1 mt-3">
          {section.variants.map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveVariant(section.id, v.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                v.id === section.activeVariantId
                  ? "bg-accent text-white"
                  : "bg-surface-muted text-muted hover:text-foreground hover:bg-surface"
              }`}
            >
              {v.name}
            </button>
          ))}
          <button
            onClick={() => addVariant(section.id)}
            className="px-2 py-1 rounded-md text-xs text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
            title="Add variant"
          >
            <Plus className="w-3 h-3" />
          </button>
          {variant && section.variants.length > 1 && (
            <>
              <div className="w-px h-4 bg-border-subtle mx-1" />
              <button
                onClick={() => duplicateVariant(section.id, variant.id)}
                className="p-1 rounded text-muted hover:text-foreground hover:bg-surface-muted"
                title="Duplicate variant"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => deleteVariant(section.id, variant.id)}
                className="p-1 rounded text-muted hover:text-red-500 hover:bg-red-50"
                title="Delete variant"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Chord progression editor */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {variant ? (
          <div>
            {/* Diatonic chord palette */}
            <div className="mb-4">
              <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Diatonic Chords in {keyRoot} {MODES.find((m) => m.value === scaleType)?.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {diatonicChords.map((chord, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAddDiatonicChord(idx)}
                    className="flex flex-col items-center px-3 py-2 rounded-lg border border-border-subtle bg-surface hover:border-accent/40 hover:bg-accent/5 transition-colors"
                  >
                    <span className="text-[10px] font-mono text-muted">
                      {chord.romanNumeral}
                    </span>
                    <span className="text-xs font-semibold">{chord.symbol}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom chord input */}
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={chordInput}
                onChange={(e) => setChordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddCustomChord()}
                placeholder="Type chord (e.g. Am7, F#dim, Gsus4)"
                className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 flex-1"
              />
              <button
                onClick={handleAddCustomChord}
                disabled={!chordInput.trim()}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
              >
                Add
              </button>
            </div>

            {/* Event list */}
            <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Progression ({variant.events.length} chord{variant.events.length !== 1 ? "s" : ""})
            </div>

            {variant.events.length === 0 ? (
              <div className="text-xs text-muted text-center py-8 border border-dashed border-border-subtle rounded-lg">
                Click a diatonic chord above or type a custom chord to build your progression.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <AnimatePresence mode="popLayout">
                  {variant.events.map((event, index) => {
                    const isPlayingEvent =
                      isPlaying && playbackEventIndex === index;

                    return (
                      <motion.div
                        key={event.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                        className={`relative flex flex-col items-center rounded-xl border px-4 py-3 min-w-[80px] transition-all ${
                          isPlayingEvent
                            ? "bg-accent/10 border-accent shadow-md ring-2 ring-accent/20"
                            : "bg-surface border-border-subtle shadow-sm hover:border-accent/40"
                        }`}
                      >
                        {/* Chord symbol (editable) */}
                        {editingEventId === event.id ? (
                          <input
                            value={editChordValue}
                            onChange={(e) => setEditChordValue(e.target.value)}
                            onBlur={() => handleUpdateChordSymbol(event.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleUpdateChordSymbol(event.id);
                              if (e.key === "Escape") {
                                setEditingEventId(null);
                                setEditChordValue("");
                              }
                            }}
                            className="text-sm font-semibold text-center bg-surface-muted border border-border-subtle rounded px-2 py-0.5 w-20 outline-none focus:ring-1 focus:ring-accent/30"
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="text-[10px] font-mono text-muted mb-0.5">
                              {event.romanNumeral}
                            </div>
                            <div
                              className="text-lg font-semibold cursor-pointer hover:text-accent transition-colors"
                              onClick={() => onPlayChord(event)}
                              onDoubleClick={() => {
                                setEditingEventId(event.id);
                                setEditChordValue(event.chordSymbol);
                              }}
                            >
                              {event.chordSymbol}
                            </div>
                          </>
                        )}

                        <div className="text-[9px] text-muted mt-0.5">
                          {event.notes.join(" · ")}
                        </div>

                        {/* Duration */}
                        <select
                          value={event.durationBeats}
                          onChange={(e) =>
                            updateEvent(section.id, variant.id, event.id, {
                              durationBeats: Number(e.target.value),
                            })
                          }
                          className="mt-1 text-[9px] text-muted bg-transparent border-none outline-none cursor-pointer appearance-none text-center"
                        >
                          {DURATIONS.map((d) => (
                            <option key={d.beats} value={d.beats}>
                              {d.label}
                            </option>
                          ))}
                        </select>

                        {/* Controls on hover */}
                        <div className="absolute -top-1 -right-1 flex gap-0.5 opacity-0 hover:opacity-100 group-hover:opacity-100 transition-opacity"
                          style={{ opacity: undefined }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
                        >
                          {index > 0 && (
                            <button
                              onClick={() => handleMoveEvent(index, "left")}
                              className="p-0.5 rounded bg-surface border border-border-subtle text-muted hover:text-foreground"
                            >
                              <ChevronLeft className="w-2.5 h-2.5" />
                            </button>
                          )}
                          {index < variant.events.length - 1 && (
                            <button
                              onClick={() => handleMoveEvent(index, "right")}
                              className="p-0.5 rounded bg-surface border border-border-subtle text-muted hover:text-foreground"
                            >
                              <ChevronRight className="w-2.5 h-2.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteEvent(section.id, variant.id, event.id)}
                            className="p-0.5 rounded bg-surface border border-border-subtle text-muted hover:text-red-500"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted text-center py-8">
            No variant selected.
          </div>
        )}
      </div>
    </div>
  );
}
