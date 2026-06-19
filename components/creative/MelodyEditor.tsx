"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Trash2, ChevronUp, ChevronDown } from "lucide-react";
import {
  isWhiteKey,
  midiToNoteName,
  midiToPitchClass,
  pitchClassToMidi,
  type PitchClass,
} from "@/lib/theory/midiUtils";
import { spellMidiNote, spellMidiPc } from "@/lib/theory/spelling";
import { snapMidiToScale, isScalePitchClass } from "@/lib/music/harmonizer";
import type { MelodyNote } from "@/lib/music/generators/melody/types";

/**
 * Scale-snapped melody drawing surface — a simple DAW-style piano roll the user
 * draws a melody into *before* any chords exist. Notes are constrained to the
 * selected key/scale; the editor highlights scale rows and de-emphasises the
 * rest. Tap an empty cell to add a note, drag a note to move it (pitch snaps to
 * the scale), drag the right edge to resize, and Delete/⌫ (or the trash button)
 * to remove the selected note. Works with mouse, pen, and touch via pointer
 * events.
 */
export type MelodyEditorProps = {
  melodyNotes: MelodyNote[];
  /** Pitch classes of the active key/scale (notes the user may place). */
  scalePitchClasses: PitchClass[];
  /** Tonic of the key (highlighted distinctly). */
  rootKey: PitchClass;
  /** Spell labels with flats to match the active key (e.g. "Bb"). */
  useFlats?: boolean;
  /** Number of bars in the editable area (default 4). */
  bars?: number;
  /** Beats per bar (default 4). */
  beatsPerBar?: number;
  /** Lowest octave shown (default 4 → C4). */
  octaveLow?: number;
  /** Highest octave shown (default 5 → B5). */
  octaveHigh?: number;
  onAddNote: (note: MelodyNote) => void;
  onMoveNote: (noteId: string, newMidi: number, newStartBeat: number) => void;
  onResizeNote: (noteId: string, newDurationBeats: number) => void;
  onDeleteNote: (noteId: string) => void;
  onPlayNote?: (noteWithOctave: string) => void;
};

const ROW_HEIGHT = 16; // px per semitone row
const QUANTIZE_BEATS = 0.25; // 1/16-note grid

/** Selectable note lengths, in beats (quarter-note = 1 beat). */
const NOTE_LENGTHS: { label: string; beats: number }[] = [
  { label: "1/16", beats: 0.25 },
  { label: "1/8", beats: 0.5 },
  { label: "1/4", beats: 1 },
  { label: "1/2", beats: 2 },
  { label: "whole", beats: 4 },
];

let noteIdCounter = 0;
function newNoteId(): string {
  return `mn-draw-${++noteIdCounter}-${Date.now().toString(36)}`;
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

type DragState = {
  type: "move" | "resize";
  noteId: string;
  startClientX: number;
  startClientY: number;
  origMidi: number;
  origStartBeat: number;
  origDuration: number;
};

export function MelodyEditor({
  melodyNotes,
  scalePitchClasses,
  rootKey,
  useFlats = false,
  bars = 4,
  beatsPerBar = 4,
  octaveLow = 4,
  octaveHigh = 5,
  onAddNote,
  onMoveNote,
  onResizeNote,
  onDeleteNote,
  onPlayNote,
}: MelodyEditorProps) {
  const [noteLength, setNoteLength] = useState(1); // beats; default quarter note
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const totalBeats = bars * beatsPerBar;
  const scaleSet = useMemo(() => new Set(scalePitchClasses), [scalePitchClasses]);

  // Rows: MIDI notes from high (top) to low (bottom).
  const rows = useMemo(() => {
    const low = pitchClassToMidi("C", octaveLow);
    const high = pitchClassToMidi("B", octaveHigh);
    const arr: number[] = [];
    for (let m = high; m >= low; m--) arr.push(m);
    return arr;
  }, [octaveLow, octaveHigh]);

  const rowIndexOf = useCallback((midi: number) => rows.indexOf(midi), [rows]);
  const gridHeight = rows.length * ROW_HEIGHT;

  const selectedNote = useMemo(
    () => melodyNotes.find((n) => n.id === selectedNoteId) ?? null,
    [melodyNotes, selectedNoteId]
  );

  // ─── Coordinate helpers ───

  const clientToBeat = useCallback(
    (clientX: number): number => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const x = clientX - rect.left;
      const beat = (x / rect.width) * totalBeats;
      return Math.max(0, Math.min(totalBeats, beat));
    },
    [totalBeats]
  );

  const clientToMidi = useCallback(
    (clientY: number): number => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return rows[rows.length - 1];
      const y = clientY - rect.top;
      const idx = Math.max(0, Math.min(rows.length - 1, Math.floor(y / ROW_HEIGHT)));
      return rows[idx];
    },
    [rows]
  );

  // ─── Add a note by tapping empty grid ───

  const handleSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore taps that land on a note bar / handle (they stopPropagation).
      const beat = quantize(clientToBeat(e.clientX), QUANTIZE_BEATS);
      const rawMidi = clientToMidi(e.clientY);
      const midi = snapMidiToScale(rawMidi, scalePitchClasses);
      const duration = noteLength;
      const startBeat = Math.max(0, Math.min(totalBeats - QUANTIZE_BEATS, beat));
      const noteWithOctave = midiToNoteName(midi);

      const note: MelodyNote = {
        id: newNoteId(),
        midi,
        noteWithOctave,
        pitchClass: midiToPitchClass(midi),
        durationBeats: duration,
        startBeat,
        chordIndex: 0,
        isChordTone: false,
        source: "drawn",
      };
      onAddNote(note);
      setSelectedNoteId(note.id);
      onPlayNote?.(noteWithOctave);
    },
    [clientToBeat, clientToMidi, scalePitchClasses, noteLength, totalBeats, onAddNote, onPlayNote]
  );

  // ─── Drag (move / resize) ───

  const beginDrag = useCallback(
    (e: React.PointerEvent, note: MelodyNote, type: "move" | "resize") => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedNoteId(note.id);
      dragRef.current = {
        type,
        noteId: note.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origMidi: note.midi,
        origStartBeat: note.startBeat,
        origDuration: note.durationBeats,
      };
    },
    []
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;

      if (drag.type === "move") {
        const dx = e.clientX - drag.startClientX;
        const beatDelta = (dx / rect.width) * totalBeats;
        const newStart = quantize(
          Math.max(0, Math.min(totalBeats - drag.origDuration, drag.origStartBeat + beatDelta)),
          QUANTIZE_BEATS
        );
        const dy = e.clientY - drag.startClientY;
        const midiDelta = -Math.round(dy / ROW_HEIGHT);
        const rawMidi = Math.max(rows[rows.length - 1], Math.min(rows[0], drag.origMidi + midiDelta));
        const newMidi = snapMidiToScale(rawMidi, scalePitchClasses);
        onMoveNote(drag.noteId, newMidi, newStart);
      } else {
        const dx = e.clientX - drag.startClientX;
        const beatDelta = (dx / rect.width) * totalBeats;
        const newDuration = quantize(
          Math.max(QUANTIZE_BEATS, Math.min(totalBeats - drag.origStartBeat, drag.origDuration + beatDelta)),
          QUANTIZE_BEATS
        );
        onResizeNote(drag.noteId, newDuration);
      }
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [totalBeats, rows, scalePitchClasses, onMoveNote, onResizeNote]);

  // ─── Keyboard delete ───

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedNoteId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDeleteNote(selectedNoteId);
        setSelectedNoteId(null);
      } else if (e.key === "Escape") {
        setSelectedNoteId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNoteId, onDeleteNote]);

  // ─── Step the selected note up/down within the scale (touch-friendly) ───

  const stepSelected = useCallback(
    (direction: "up" | "down") => {
      if (!selectedNote) return;
      const delta = direction === "up" ? 1 : -1;
      const limitHigh = rows[0];
      const limitLow = rows[rows.length - 1];
      let candidate = selectedNote.midi + delta;
      while (candidate >= limitLow && candidate <= limitHigh) {
        if (scaleSet.has(midiToPitchClass(candidate))) {
          onMoveNote(selectedNote.id, candidate, selectedNote.startBeat);
          onPlayNote?.(midiToNoteName(candidate));
          return;
        }
        candidate += delta;
      }
    },
    [selectedNote, rows, scaleSet, onMoveNote, onPlayNote]
  );

  // Vertical grid lines (one per beat, stronger at bar boundaries).
  const beatLines = useMemo(() => {
    const lines: { beat: number; strong: boolean }[] = [];
    for (let b = 0; b <= totalBeats; b += 1) {
      lines.push({ beat: b, strong: b % beatsPerBar === 0 });
    }
    return lines;
  }, [totalBeats, beatsPerBar]);

  return (
    <div className="melody-editor">
      {/* Toolbar: note length + selected-note properties / controls */}
      <div className="melody-editor-toolbar">
        <div className="melody-editor-lengths" role="group" aria-label="Note length">
          <span className="melody-editor-toolbar-label">Length</span>
          {NOTE_LENGTHS.map((len) => (
            <button
              key={len.label}
              type="button"
              onClick={() => setNoteLength(len.beats)}
              className={clsx(
                "melody-editor-length-btn",
                noteLength === len.beats && "melody-editor-length-btn-active"
              )}
            >
              {len.label}
            </button>
          ))}
        </div>

        {selectedNote ? (
          <div className="melody-editor-selected">
            <span className="melody-editor-selected-info">
              <span className="font-mono font-semibold text-foreground">
                {spellMidiNote(selectedNote.midi, useFlats)}
              </span>
              <span className="text-muted">
                · beat {(+selectedNote.startBeat.toFixed(2))} · {selectedNote.durationBeats}b
              </span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => stepSelected("up")}
                className="melody-editor-icon-btn"
                title="Move up (in key)"
                aria-label="Move note up"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => stepSelected("down")}
                className="melody-editor-icon-btn"
                title="Move down (in key)"
                aria-label="Move note down"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteNote(selectedNote.id);
                  setSelectedNoteId(null);
                }}
                className="melody-editor-icon-btn melody-editor-delete-btn"
                title="Delete note"
                aria-label="Delete note"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <span className="melody-editor-hint-inline">Tap the grid to add a note</span>
        )}
      </div>

      {/* Roll: pitch axis + grid */}
      <div className="melody-editor-wrap">
        {/* Left pitch keyboard */}
        <div className="melody-editor-keys" style={{ height: gridHeight }}>
          {rows.map((midi) => {
            const pc = midiToPitchClass(midi);
            const inScale = isScalePitchClass(pc, scalePitchClasses);
            const isTonic = pc === rootKey;
            return (
              <div
                key={midi}
                className={clsx(
                  "melody-editor-key",
                  !isWhiteKey(midi) && "black",
                  inScale && "in-scale",
                  isTonic && "tonic"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                {(inScale || pc === "C") && (
                  <span className="melody-editor-key-label">{spellMidiPc(midi, useFlats)}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Grid */}
        <div
          ref={gridRef}
          className="melody-editor-grid"
          style={{ height: gridHeight }}
        >
          {/* Row backgrounds (scale highlight) */}
          {rows.map((midi, idx) => {
            const pc = midiToPitchClass(midi);
            const inScale = isScalePitchClass(pc, scalePitchClasses);
            const isTonic = pc === rootKey;
            return (
              <div
                key={midi}
                className={clsx(
                  "melody-editor-row",
                  inScale ? "in-scale" : "off-scale",
                  isTonic && "tonic"
                )}
                style={{ top: idx * ROW_HEIGHT, height: ROW_HEIGHT }}
              />
            );
          })}

          {/* Vertical beat / bar lines */}
          {beatLines.map(({ beat, strong }) => (
            <div
              key={`bl-${beat}`}
              className={clsx("melody-editor-beat-line", strong && "strong")}
              style={{ left: `${(beat / totalBeats) * 100}%` }}
            />
          ))}

          {/* Tap surface for adding notes (behind the note bars) */}
          <div
            className="melody-editor-surface"
            onPointerDown={handleSurfacePointerDown}
          />

          {/* Note bars */}
          {melodyNotes.map((note) => {
            const idx = rowIndexOf(note.midi);
            if (idx === -1) return null; // outside the visible range
            const leftPct = (note.startBeat / totalBeats) * 100;
            const widthPct = (note.durationBeats / totalBeats) * 100;
            const isSelected = note.id === selectedNoteId;
            return (
              <div
                key={note.id}
                className={clsx("melody-editor-note", isSelected && "selected")}
                style={{
                  left: `${leftPct}%`,
                  width: `calc(${widthPct}% - 1px)`,
                  top: idx * ROW_HEIGHT + 1,
                  height: ROW_HEIGHT - 2,
                }}
                onPointerDown={(e) => beginDrag(e, note, "move")}
                title={`${note.noteWithOctave} · ${note.durationBeats} beats`}
              >
                <span className="melody-editor-note-label">
                  {spellMidiNote(note.midi, useFlats)}
                </span>
                <div
                  className="melody-editor-resize"
                  onPointerDown={(e) => beginDrag(e, note, "resize")}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
