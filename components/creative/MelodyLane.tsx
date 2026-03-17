"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import clsx from "clsx";
import {
  isWhiteKey,
  midiToNoteName,
  midiToPitchClass,
  type PitchClass,
} from "@/lib/theory/midiUtils";
import type { MelodyNote } from "@/lib/music/generators/melody/types";
import type { Chord } from "@/lib/theory/progressionTypes";

export type MelodyLaneProps = {
  chords: Chord[];
  melodyNotes: MelodyNote[];
  playingIndex: number | null;
  onAddNote: (note: MelodyNote) => void;
  onMoveNote: (noteId: string, newMidi: number, newStartBeat: number) => void;
  onResizeNote: (noteId: string, newDurationBeats: number) => void;
  onDeleteNote: (noteId: string) => void;
  onPlayNote?: (noteWithOctave: string) => void;
};

const QUANTIZE_BEATS = 0.5; // eighth note quantization
const LANE_HEIGHT = 192;
const MIN_MIDI = 60; // C4
const MAX_MIDI = 84; // C6
const SEMITONE_RANGE = MAX_MIDI - MIN_MIDI;

function durationFlex(dc?: string): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

function durationToBeats(dc?: string): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

let noteIdCounter = 0;
function newNoteId(): string {
  return `mn-draw-${++noteIdCounter}-${Date.now().toString(36)}`;
}

/** Compute a tighter range from the actual melody notes, with padding. */
function computeMelodyRange(notes: MelodyNote[]): { low: number; high: number } {
  if (notes.length === 0) return { low: MIN_MIDI, high: MAX_MIDI };
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  return {
    low: Math.min(MIN_MIDI, min - 3),
    high: Math.max(MAX_MIDI, max + 3),
  };
}

export function MelodyLane({
  chords,
  melodyNotes,
  playingIndex,
  onAddNote,
  onMoveNote,
  onResizeNote,
  onDeleteNote,
  onPlayNote,
}: MelodyLaneProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    type: "move" | "resize";
    noteId: string;
    startX: number;
    startY: number;
    origMidi: number;
    origStartBeat: number;
    origDuration: number;
    colElement: HTMLElement | null;
  } | null>(null);

  const laneRef = useRef<HTMLDivElement>(null);

  const range = useMemo(() => computeMelodyRange(melodyNotes), [melodyNotes]);
  const semitones = range.high - range.low;
  const noteHeight = LANE_HEIGHT / semitones;

  // Build beat offsets for each chord
  const chordBeatOffsets = useMemo(() => {
    const offsets: number[] = [];
    let beat = 0;
    for (const chord of chords) {
      offsets.push(beat);
      beat += durationToBeats(chord.durationClass);
    }
    return offsets;
  }, [chords]);

  // Group melody notes by chord index
  const notesByChord = useMemo(() => {
    const map = new Map<number, MelodyNote[]>();
    for (const note of melodyNotes) {
      const list = map.get(note.chordIndex) ?? [];
      list.push(note);
      map.set(note.chordIndex, list);
    }
    return map;
  }, [melodyNotes]);

  // Convert Y position to MIDI
  const yToMidi = useCallback(
    (y: number) => {
      const midi = range.high - Math.round((y / LANE_HEIGHT) * semitones);
      return Math.max(range.low, Math.min(range.high, midi));
    },
    [range, semitones]
  );

  // Convert MIDI to Y position
  const midiToY = useCallback(
    (midi: number) => {
      return ((range.high - midi) / semitones) * LANE_HEIGHT;
    },
    [range, semitones]
  );

  // Convert X position within a column to beat offset within that chord
  const xToBeatOffset = useCallback(
    (x: number, colWidth: number, chordBeats: number) => {
      const raw = (x / colWidth) * chordBeats;
      return quantize(Math.max(0, Math.min(chordBeats - QUANTIZE_BEATS, raw)), QUANTIZE_BEATS);
    },
    []
  );

  // Click on empty space to add a note
  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, chordIndex: number) => {
      // Ignore if clicking on an existing note bar
      if ((e.target as HTMLElement).closest(".melody-bar")) return;

      const col = e.currentTarget;
      const rect = col.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const chordBeats = durationToBeats(chords[chordIndex]?.durationClass);
      const beatOffset = xToBeatOffset(x, rect.width, chordBeats);
      const midi = yToMidi(y);
      const globalStart = chordBeatOffsets[chordIndex] + beatOffset;
      const noteWithOctave = midiToNoteName(midi);

      const note: MelodyNote = {
        id: newNoteId(),
        midi,
        noteWithOctave,
        pitchClass: midiToPitchClass(midi),
        durationBeats: QUANTIZE_BEATS,
        startBeat: globalStart,
        chordIndex,
        isChordTone: false,
        source: "drawn",
      };
      onAddNote(note);
      onPlayNote?.(noteWithOctave);
      setSelectedNoteId(note.id);
    },
    [chords, chordBeatOffsets, xToBeatOffset, yToMidi, onAddNote, onPlayNote]
  );

  // Right-click to delete
  const handleNoteContextMenu = useCallback(
    (e: React.MouseEvent, noteId: string) => {
      e.preventDefault();
      e.stopPropagation();
      onDeleteNote(noteId);
      if (selectedNoteId === noteId) setSelectedNoteId(null);
    },
    [onDeleteNote, selectedNoteId]
  );

  // Start dragging a note (move)
  const handleNoteMouseDown = useCallback(
    (e: React.MouseEvent, note: MelodyNote, colElement: HTMLElement) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedNoteId(note.id);
      setDragState({
        type: "move",
        noteId: note.id,
        startX: e.clientX,
        startY: e.clientY,
        origMidi: note.midi,
        origStartBeat: note.startBeat,
        origDuration: note.durationBeats,
        colElement,
      });
    },
    []
  );

  // Start resizing a note (drag right edge)
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, note: MelodyNote, colElement: HTMLElement) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedNoteId(note.id);
      setDragState({
        type: "resize",
        noteId: note.id,
        startX: e.clientX,
        startY: e.clientY,
        origMidi: note.midi,
        origStartBeat: note.startBeat,
        origDuration: note.durationBeats,
        colElement,
      });
    },
    []
  );

  // Mouse move/up for drag operations
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.colElement) return;
      const rect = dragState.colElement.getBoundingClientRect();
      const chordIdx = melodyNotes.find((n) => n.id === dragState.noteId)?.chordIndex;
      if (chordIdx === undefined) return;

      const chordBeats = durationToBeats(chords[chordIdx]?.durationClass);

      if (dragState.type === "move") {
        // Vertical: pitch change
        const dy = e.clientY - dragState.startY;
        const midiDelta = -Math.round(dy / noteHeight);
        const newMidi = Math.max(range.low, Math.min(range.high, dragState.origMidi + midiDelta));

        // Horizontal: beat offset change
        const dx = e.clientX - dragState.startX;
        const beatDelta = (dx / rect.width) * chordBeats;
        const localBeat = dragState.origStartBeat - chordBeatOffsets[chordIdx] + beatDelta;
        const quantizedLocal = quantize(
          Math.max(0, Math.min(chordBeats - dragState.origDuration, localBeat)),
          QUANTIZE_BEATS
        );
        const newStartBeat = chordBeatOffsets[chordIdx] + quantizedLocal;

        onMoveNote(dragState.noteId, newMidi, newStartBeat);
      } else {
        // Resize: change duration based on horizontal drag
        const dx = e.clientX - dragState.startX;
        const beatDelta = (dx / rect.width) * chordBeats;
        const newDuration = quantize(
          Math.max(QUANTIZE_BEATS, dragState.origDuration + beatDelta),
          QUANTIZE_BEATS
        );
        onResizeNote(dragState.noteId, newDuration);
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, chords, chordBeatOffsets, melodyNotes, noteHeight, range, onMoveNote, onResizeNote]);

  // Keyboard: Delete selected note
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNoteId) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDeleteNote(selectedNoteId);
        setSelectedNoteId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNoteId, onDeleteNote]);

  // Build pitch labels for the left axis
  const pitchLabels = useMemo(() => {
    const labels: { midi: number; label: string; isWhite: boolean }[] = [];
    for (let m = range.high; m >= range.low; m--) {
      const pc = midiToPitchClass(m);
      if (pc === "C" || pc === "E" || pc === "G" || pc === "A") {
        labels.push({ midi: m, label: midiToNoteName(m), isWhite: isWhiteKey(m) });
      }
    }
    return labels;
  }, [range]);

  return (
    <div className="melody-lane-section">
      <div className="melody-lane-label">Melody Lane</div>
      <div className="melody-lane-wrap" ref={laneRef}>
        {/* Left pitch axis */}
        <div className="melody-pitch-axis" style={{ height: LANE_HEIGHT }}>
          {pitchLabels.map(({ midi, label }) => (
            <div
              key={midi}
              className="melody-pitch-label"
              style={{ top: midiToY(midi) - 6 }}
            >
              {label}
            </div>
          ))}
          {/* Horizontal guide lines for C notes */}
          {Array.from({ length: Math.ceil(semitones / 12) + 1 }, (_, i) => {
            const cMidi = Math.ceil(range.low / 12) * 12 + i * 12;
            if (cMidi > range.high || cMidi < range.low) return null;
            return (
              <div
                key={`guide-${cMidi}`}
                className="melody-guide-line"
                style={{ top: midiToY(cMidi) }}
              />
            );
          })}
        </div>

        {/* Chord columns */}
        <div className="melody-grid">
          {chords.map((chord, colIdx) => {
            const colFlex = durationFlex(chord.durationClass);
            const chordBeats = durationToBeats(chord.durationClass);
            const isPlaying = playingIndex === colIdx;
            const notes = notesByChord.get(colIdx) ?? [];

            return (
              <div
                key={`melody-col-${colIdx}`}
                className={clsx("melody-column", isPlaying && "melody-col-playing")}
                style={{ "--col-flex": colFlex, height: LANE_HEIGHT } as React.CSSProperties}
                onClick={(e) => handleColumnClick(e, colIdx)}
              >
                {/* Beat grid lines */}
                {Array.from({ length: Math.floor(chordBeats / QUANTIZE_BEATS) }, (_, i) => {
                  const isBeat = (i * QUANTIZE_BEATS) % 1 === 0;
                  return (
                    <div
                      key={`grid-${i}`}
                      className={clsx("melody-beat-line", isBeat && "melody-beat-strong")}
                      style={{ left: `${(i / (chordBeats / QUANTIZE_BEATS)) * 100}%` }}
                    />
                  );
                })}

                {/* C-note horizontal guides */}
                {Array.from({ length: Math.ceil(semitones / 12) + 1 }, (_, i) => {
                  const cMidi = Math.ceil(range.low / 12) * 12 + i * 12;
                  if (cMidi > range.high || cMidi < range.low) return null;
                  return (
                    <div
                      key={`hguide-${cMidi}`}
                      className="melody-h-guide"
                      style={{ top: midiToY(cMidi) }}
                    />
                  );
                })}

                {/* Melody note bars */}
                {notes.map((note) => {
                  const localBeat = note.startBeat - chordBeatOffsets[colIdx];
                  const leftPct = (localBeat / chordBeats) * 100;
                  const widthPct = (note.durationBeats / chordBeats) * 100;
                  const top = midiToY(note.midi);
                  const isSelected = selectedNoteId === note.id;

                  return (
                    <div
                      key={note.id}
                      className={clsx(
                        "melody-bar",
                        isSelected && "melody-bar-selected",
                        note.source === "drawn" && "melody-bar-drawn"
                      )}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: top - noteHeight / 2,
                        height: noteHeight,
                      }}
                      onMouseDown={(e) => handleNoteMouseDown(e, note, e.currentTarget.parentElement!)}
                      onContextMenu={(e) => handleNoteContextMenu(e, note.id)}
                      title={`${note.noteWithOctave} (${note.durationBeats} beats)`}
                    >
                      <span className="melody-bar-label">{note.noteWithOctave}</span>
                      {/* Resize handle on right edge */}
                      <div
                        className="melody-resize-handle"
                        onMouseDown={(e) => handleResizeMouseDown(e, note, e.currentTarget.parentElement!.parentElement!)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
