"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import clsx from "clsx";
import { Download, RotateCcw, ChevronUp, ChevronDown, SlidersHorizontal, Music } from "lucide-react";
import {
  isWhiteKey,
  midiToNoteName,
  midiToPitchClass,
  generateMidiRange,
  type PitchClass,
} from "@/lib/theory/midiUtils";
import { spellMidiNote } from "@/lib/theory/spelling";
import { Heart } from "lucide-react";
import type { Chord } from "@/lib/theory/progressionTypes";
import type { ChordSourceType } from "@/lib/creative/types";
import type { MelodyNote } from "@/lib/music/generators/melody/types";
import type { ExpressionSegment } from "@/lib/expression/types";
import {
  makeSegmentId,
  reversePoints,
  scaleAmount as scaleAmountPoints,
  scaleDuration as scaleDurationPoints,
} from "@/lib/expression/curve";
import {
  glideCurve,
  pitchDropCurve,
  pitchScoopCurve,
  vibratoCurve,
  toSegment,
  DEFAULT_GLIDE_TARGET,
  type GlidePreset,
  type PitchDropOptions,
  type PitchScoopOptions,
  type VibratoOptions,
} from "@/lib/expression/presets";
import { MpeToolbar, type MpeSelectionKind } from "./MpeToolbar";
import { ExpressionOverlay, type RollGeom, type SelectedNoteRef } from "./ExpressionOverlay";

export type InteractivePianoRollProps = {
  chords: Chord[];
  playingIndex: number | null;
  selectedIndex: number | null;
  onPlayNote?: (note: string) => void;
  onDeleteChord?: (index: number) => void;
  onShiftNote?: (chordIndex: number, midiNote: number, direction: "up" | "down") => void;
  /** Pitch classes of the active key/scale; up/down steppers snap to these. */
  scalePitchClasses?: PitchClass[];
  /** Spell note labels with flats (e.g. "Bb") to match the active key. */
  useFlats?: boolean;
  onSelectChord?: (index: number | null) => void;
  onExportMidi?: () => void;
  onAddNote?: (chordIndex: number, midi: number) => void;
  onRemoveNote?: (chordIndex: number, midi: number) => void;
  onMoveNote?: (chordIndex: number, fromMidi: number, toMidi: number) => void;
  onResetChord?: (chordIndex: number) => void;
  chordSourceTypes?: ChordSourceType[];
  playheadRef?: React.Ref<HTMLDivElement>;
  melodyNotes?: MelodyNote[];
  showMelody?: boolean;
  onMoveMelodyNote?: (noteId: string, toMidi: number) => void;
  // ─── MPE expression editing ───
  // When these are provided the "MPE Editor" mode toggle appears. Absent them,
  // the roll behaves exactly as before.
  onSetNoteSegments?: (chordIndex: number, midi: number, segments: ExpressionSegment[]) => void;
  onRemoveNoteExpression?: (chordIndex: number, midi: number) => void;
};

/** Compute the MIDI range needed to display all chord notes, with padding. */
function computeAutoRange(chords: Chord[]): { low: number; high: number } {
  let minMidi = Infinity;
  let maxMidi = -Infinity;

  for (const chord of chords) {
    if (chord.midiNotes && chord.midiNotes.length > 0) {
      for (const m of chord.midiNotes) {
        if (m < minMidi) minMidi = m;
        if (m > maxMidi) maxMidi = m;
      }
    }
  }

  if (minMidi === Infinity) {
    return { low: 48, high: 72 };
  }

  const finalLow = Math.max(21, minMidi - 3);
  const finalHigh = Math.min(108, maxMidi + 4);
  return { low: finalLow, high: Math.max(finalLow + 12, finalHigh) };
}

type SelectedNote = { chordIndex: number; midi: number };

/** Map durationClass to a flex multiplier. */
function durationFlex(dc?: string): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

/** Convert durationClass to beat count. */
function durationToBeats(dc?: string): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

const SOURCE_BADGE_COLORS: Record<ChordSourceType, string> = {
  generated: "bg-blue-500/20 text-blue-300",
  substituted: "bg-purple-500/20 text-purple-300",
  manual: "bg-emerald-500/20 text-emerald-300",
};

const SOURCE_BADGE_LABELS: Record<ChordSourceType, string> = {
  generated: "Gen",
  substituted: "Sub",
  manual: "Edit",
};

// Compact dot indicator used on narrow (mobile) columns where a text badge
// would overlap the chord name.
const SOURCE_DOT_COLORS: Record<ChordSourceType, string> = {
  generated: "bg-blue-400",
  substituted: "bg-purple-400",
  manual: "bg-emerald-400",
};

export function InteractivePianoRoll({
  chords,
  playingIndex,
  selectedIndex,
  onPlayNote,
  onDeleteChord,
  onShiftNote,
  scalePitchClasses,
  useFlats = false,
  onSelectChord,
  onExportMidi,
  onAddNote,
  onRemoveNote,
  onMoveNote,
  onResetChord,
  chordSourceTypes,
  playheadRef,
  melodyNotes,
  showMelody,
  onMoveMelodyNote,
  onSetNoteSegments,
  onRemoveNoteExpression,
}: InteractivePianoRollProps) {
  const [hoveredColumnIdx, setHoveredColumnIdx] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
  const [flashingNote, setFlashingNote] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ chordIndex: number; midi: number } | null>(null);
  const [draggingMelodyId, setDraggingMelodyId] = useState<string | null>(null);

  // ─── MPE Editor state ───
  const mpeAvailable = !!onSetNoteSegments;
  const [mpeMode, setMpeMode] = useState(false);
  const [mpeSelection, setMpeSelection] = useState<SelectedNoteRef[]>([]);
  const [clipboard, setClipboard] = useState<ExpressionSegment[] | null>(null);
  const [geom, setGeom] = useState<RollGeom | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellsRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (selectedIndex === null) {
      setSelectedNote(null);
    }
  }, [selectedIndex]);

  // Group melody notes by chord index for overlay rendering
  const melodyByChord = useMemo(() => {
    if (!showMelody || !melodyNotes) return new Map<number, MelodyNote[]>();
    const map = new Map<number, MelodyNote[]>();
    for (const mn of melodyNotes) {
      const list = map.get(mn.chordIndex) ?? [];
      list.push(mn);
      map.set(mn.chordIndex, list);
    }
    return map;
  }, [showMelody, melodyNotes]);

  // Beat offsets per chord for melody bar positioning
  const chordBeatOffsets = useMemo(() => {
    const offsets: number[] = [];
    let beat = 0;
    for (const chord of chords) {
      offsets.push(beat);
      beat += durationToBeats(chord.durationClass);
    }
    return offsets;
  }, [chords]);

  const autoRange = useMemo(() => {
    const range = computeAutoRange(chords);
    if (!showMelody || !melodyNotes || melodyNotes.length === 0) return range;
    let { low, high } = range;
    for (const mn of melodyNotes) {
      if (mn.midi < low) low = mn.midi;
      if (mn.midi > high) high = mn.midi;
    }
    const lowOctave = Math.floor((low - 2) / 12) * 12;
    const highOctave = Math.ceil((high + 3) / 12) * 12;
    return { low: lowOctave, high: Math.max(highOctave, lowOctave + 12) };
  }, [chords, showMelody, melodyNotes]);

  const noteRange = useMemo(() => {
    const range = generateMidiRange(autoRange.low, autoRange.high);
    return range.reverse();
  }, [autoRange]);

  const rangeLabel = useMemo(() => {
    const lowNote = spellMidiNote(autoRange.low, useFlats);
    const highNote = spellMidiNote(autoRange.high, useFlats);
    return `${lowNote}\u2013${highNote}`;
  }, [autoRange, useFlats]);

  const activeChord = useMemo(() => {
    if (hoveredColumnIdx !== null && chords[hoveredColumnIdx]) {
      return chords[hoveredColumnIdx];
    }
    if (playingIndex !== null && chords[playingIndex]) {
      return chords[playingIndex];
    }
    return null;
  }, [chords, playingIndex, hoveredColumnIdx]);

  const activeMidiNotes = useMemo(() => {
    if (!activeChord) return new Set<number>();
    if (activeChord.midiNotes && activeChord.midiNotes.length > 0) {
      return new Set(activeChord.midiNotes);
    }
    return new Set<number>();
  }, [activeChord]);

  const activePitchClasses = useMemo(() => {
    if (!activeChord) return new Set<PitchClass>();
    if (activeChord.midiNotes && activeChord.midiNotes.length > 0) {
      return new Set<PitchClass>();
    }
    return new Set(activeChord.notes);
  }, [activeChord]);

  // ─── Note interaction handlers ───

  const handleNoteClick = useCallback((midi: number, colIdx: number, hasNote: boolean) => {
    if (hasNote) {
      const alreadySelected = selectedNote?.chordIndex === colIdx && selectedNote?.midi === midi;
      if (alreadySelected) {
        setSelectedNote(null);
      } else {
        setSelectedNote({ chordIndex: colIdx, midi });
        onSelectChord?.(colIdx);
      }
    }
    if (onPlayNote) {
      const noteNameWithOctave = midiToNoteName(midi);
      onPlayNote(noteNameWithOctave);
      setFlashingNote(midi);
      setTimeout(() => setFlashingNote(null), 250);
    }
  }, [selectedNote, onPlayNote, onSelectChord]);

  const handleDoubleClick = useCallback((midi: number, colIdx: number, hasNote: boolean) => {
    if (hasNote) {
      // Remove the note
      onRemoveNote?.(colIdx, midi);
    } else {
      // Add a note
      onAddNote?.(colIdx, midi);
    }
    if (onPlayNote) {
      onPlayNote(midiToNoteName(midi));
      setFlashingNote(midi);
      setTimeout(() => setFlashingNote(null), 250);
    }
  }, [onAddNote, onRemoveNote, onPlayNote]);

  // Drag handling for pitch changes. Mouse/pen only — on touch a vertical drag
  // is reserved for scrolling the roll (touch editing uses tap-to-select plus
  // the up/down steppers instead, which keep notes in the scale).
  const handlePointerDown = useCallback((e: React.PointerEvent, midi: number, colIdx: number, hasNote: boolean) => {
    if (e.pointerType === "touch") return;
    // In MPE mode a drag on a note edits its expression curve, not its pitch.
    if (mpeMode) return;
    if (hasNote && onMoveNote) {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setIsDragging(true);
      setDragStart({ chordIndex: colIdx, midi });
    }
  }, [onMoveNote, mpeMode]);

  const handlePointerEnterCell = useCallback((midi: number, colIdx: number) => {
    if (isDragging && dragStart && dragStart.chordIndex === colIdx && dragStart.midi !== midi) {
      onMoveNote?.(colIdx, dragStart.midi, midi);
      setDragStart({ chordIndex: colIdx, midi });
    }
    if (draggingMelodyId && onMoveMelodyNote) {
      onMoveMelodyNote(draggingMelodyId, midi);
    }
  }, [isDragging, dragStart, onMoveNote, draggingMelodyId, onMoveMelodyNote]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
    setDraggingMelodyId(null);
  }, []);

  // Move the selected note to the next/previous pitch in the active scale,
  // skipping pitches already used by the chord. Works the same on desktop and
  // touch — the intuitive "keep it in key" up/down control. Falls back to a
  // chromatic step if no scale is supplied.
  const stepSelectedNote = useCallback((direction: "up" | "down") => {
    if (!selectedNote || !onMoveNote) return;
    const { chordIndex, midi } = selectedNote;
    const occupied = new Set(chords[chordIndex]?.midiNotes ?? []);
    const scaleSet = scalePitchClasses && scalePitchClasses.length > 0
      ? new Set<PitchClass>(scalePitchClasses)
      : null;
    const delta = direction === "up" ? 1 : -1;
    const limit = direction === "up" ? 108 : 21;

    let candidate = midi + delta;
    while (direction === "up" ? candidate <= limit : candidate >= limit) {
      const inScale = !scaleSet || scaleSet.has(midiToPitchClass(candidate));
      if (inScale && !occupied.has(candidate)) {
        onMoveNote(chordIndex, midi, candidate);
        setSelectedNote({ chordIndex, midi: candidate });
        if (onPlayNote) {
          onPlayNote(midiToNoteName(candidate));
          setFlashingNote(candidate);
          setTimeout(() => setFlashingNote(null), 250);
        }
        return;
      }
      candidate += delta;
    }
  }, [selectedNote, onMoveNote, chords, scalePitchClasses, onPlayNote]);

  const isDraggingActive = isDragging || draggingMelodyId !== null;
  useEffect(() => {
    if (isDraggingActive) {
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      return () => {
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }
  }, [isDraggingActive, handlePointerUp]);

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedNote(null);
        onSelectChord?.(null);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNote) {
          if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
          e.preventDefault();
          onRemoveNote?.(selectedNote.chordIndex, selectedNote.midi);
          setSelectedNote(null);
          return;
        }
        if (selectedIndex !== null) {
          if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
          e.preventDefault();
          onDeleteChord?.(selectedIndex);
          onSelectChord?.(null);
          setSelectedNote(null);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (selectedNote) {
          e.preventDefault();
          const direction = e.key === "ArrowUp" ? "up" : "down";
          const newMidi = selectedNote.midi + (direction === "up" ? 12 : -12);
          onShiftNote?.(selectedNote.chordIndex, selectedNote.midi, direction);
          setSelectedNote({ chordIndex: selectedNote.chordIndex, midi: newMidi });
        }
        return;
      }

      // Plain Arrow Up/Down steps the selected note to the next in-scale pitch.
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (selectedNote) {
          if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
          e.preventDefault();
          stepSelectedNote(e.key === "ArrowUp" ? "up" : "down");
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, selectedNote, onDeleteChord, onShiftNote, onSelectChord, onRemoveNote, stepSelectedNote]);

  const selectedNoteLabel = useMemo(() => {
    if (!selectedNote) return null;
    return spellMidiNote(selectedNote.midi, useFlats);
  }, [selectedNote, useFlats]);

  // ─── MPE geometry measurement ───
  // The expression overlay draws on an SVG aligned to the note grid. Column
  // widths flex with chord duration and available width, so we measure the DOM
  // rather than compute — cheap and robust across responsive layouts.
  const measureGeom = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const columns: { left: number; width: number }[] = [];
    let rowHeight = 0;
    let cellsTop = 0;
    for (let i = 0; i < chords.length; i++) {
      const el = cellsRefs.current[i];
      if (!el) {
        columns.push({ left: 0, width: 0 });
        continue;
      }
      const r = el.getBoundingClientRect();
      const left = r.left - gridRect.left + grid.scrollLeft;
      const top = r.top - gridRect.top + grid.scrollTop;
      columns.push({ left, width: r.width });
      if (i === 0) {
        cellsTop = top;
        rowHeight = r.height / Math.max(noteRange.length, 1);
      }
    }
    setGeom({
      columns,
      cellsTop,
      rowHeight,
      contentWidth: grid.scrollWidth,
      contentHeight: grid.scrollHeight,
    });
  }, [chords.length, noteRange.length]);

  useLayoutEffect(() => {
    measureGeom();
  }, [measureGeom, chords, autoRange, mpeMode, showMelody, melodyNotes]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const ro = new ResizeObserver(() => measureGeom());
    ro.observe(grid);
    window.addEventListener("resize", measureGeom);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureGeom);
    };
  }, [measureGeom]);

  // Reset MPE selection whenever mode turns off.
  useEffect(() => {
    if (!mpeMode) setMpeSelection([]);
  }, [mpeMode]);

  // ─── MPE selection helpers ───

  const isMpeSelected = useCallback(
    (chordIndex: number, midi: number) =>
      mpeSelection.some((s) => s.chordIndex === chordIndex && s.midi === midi),
    [mpeSelection]
  );

  const toggleMpeNote = useCallback((chordIndex: number, midi: number) => {
    setMpeSelection((sel) => {
      const exists = sel.some((s) => s.chordIndex === chordIndex && s.midi === midi);
      return exists
        ? sel.filter((s) => !(s.chordIndex === chordIndex && s.midi === midi))
        : [...sel, { chordIndex, midi }];
    });
  }, []);

  const toggleMpeChord = useCallback((chordIndex: number) => {
    const midis = chords[chordIndex]?.midiNotes ?? [];
    if (midis.length === 0) return;
    setMpeSelection((sel) => {
      const allSelected = midis.every((m) => sel.some((s) => s.chordIndex === chordIndex && s.midi === m));
      if (allSelected) {
        return sel.filter((s) => s.chordIndex !== chordIndex);
      }
      const withoutChord = sel.filter((s) => s.chordIndex !== chordIndex);
      return [...withoutChord, ...midis.map((m) => ({ chordIndex, midi: m }))];
    });
  }, [chords]);

  // Classify the selection so the toolbar can offer the right operations.
  const { selectionKind, selectionCount } = useMemo<{ selectionKind: MpeSelectionKind; selectionCount: number }>(() => {
    const count = mpeSelection.length;
    if (count === 0) return { selectionKind: "none", selectionCount: 0 };
    if (count === 2) return { selectionKind: "two-notes", selectionCount: 2 };

    const byChord = new Map<number, number[]>();
    for (const s of mpeSelection) {
      const list = byChord.get(s.chordIndex) ?? [];
      list.push(s.midi);
      byChord.set(s.chordIndex, list);
    }
    const chordIndices = Array.from(byChord.keys());

    if (chordIndices.length === 2) {
      const bothFull = chordIndices.every((ci) => {
        const total = chords[ci]?.midiNotes?.length ?? 0;
        return total > 0 && byChord.get(ci)!.length === total;
      });
      if (bothFull) {
        const sizeA = chords[chordIndices[0]]!.midiNotes!.length;
        const sizeB = chords[chordIndices[1]]!.midiNotes!.length;
        return {
          selectionKind: sizeA === sizeB ? "two-chords" : "two-chords-unequal",
          selectionCount: count,
        };
      }
    }
    if (count === 1) return { selectionKind: "one-note", selectionCount: 1 };
    return { selectionKind: "multi-notes", selectionCount: count };
  }, [mpeSelection, chords]);

  const segmentsFor = useCallback(
    (chordIndex: number, midi: number): ExpressionSegment[] =>
      chords[chordIndex]?.expressions?.[midi] ?? [],
    [chords]
  );

  const hasExpression = useMemo(
    () => mpeSelection.some((s) => segmentsFor(s.chordIndex, s.midi).length > 0),
    [mpeSelection, segmentsFor]
  );

  // ─── MPE operations ───

  // Update a single segment in place (used by the overlay's drag/insert/delete).
  const handleUpdateSegment = useCallback(
    (
      chordIndex: number,
      midi: number,
      segId: string,
      patch: Partial<Pick<ExpressionSegment, "points" | "smooth">>
    ) => {
      if (!onSetNoteSegments) return;
      const current = segmentsFor(chordIndex, midi);
      const next = current.map((s) => (s.id === segId ? { ...s, ...patch } : s));
      onSetNoteSegments(chordIndex, midi, next);
    },
    [onSetNoteSegments, segmentsFor]
  );

  // Apply a freshly-built single segment to every selected note (replacing any
  // existing expression on that note — v1 keeps one authored segment per note).
  const applySegmentToSelection = useCallback(
    (build: (chordIndex: number, midi: number) => ExpressionSegment | null) => {
      if (!onSetNoteSegments) return;
      for (const s of mpeSelection) {
        const seg = build(s.chordIndex, s.midi);
        if (seg) onSetNoteSegments(s.chordIndex, s.midi, [seg]);
      }
    },
    [onSetNoteSegments, mpeSelection]
  );

  const handleGlide = useCallback(
    (preset: GlidePreset) => {
      applySegmentToSelection((ci, midi) => {
        const existing = segmentsFor(ci, midi)[0];
        // Reshape an existing glide (keep its target pitch) or start a fresh one.
        const target = existing
          ? existing.points[existing.points.length - 1].y || DEFAULT_GLIDE_TARGET
          : DEFAULT_GLIDE_TARGET;
        return toSegment("glide", glideCurve(preset, target));
      });
    },
    [applySegmentToSelection, segmentsFor]
  );

  const handlePitchDrop = useCallback(
    (opts: PitchDropOptions) => applySegmentToSelection(() => toSegment("drop", pitchDropCurve(opts))),
    [applySegmentToSelection]
  );
  const handleScoop = useCallback(
    (opts: PitchScoopOptions) => applySegmentToSelection(() => toSegment("scoop", pitchScoopCurve(opts))),
    [applySegmentToSelection]
  );
  const handleVibrato = useCallback(
    (opts: VibratoOptions) => applySegmentToSelection(() => toSegment("vibrato", vibratoCurve(opts))),
    [applySegmentToSelection]
  );

  // Join: create a linear pitch bend from a source note up/down to a target
  // note's pitch. For two chords of equal size, pair notes by pitch order and
  // give each pair its own independent bend.
  const handleJoin = useCallback(() => {
    if (!onSetNoteSegments) return;
    const buildBend = (srcChord: number, srcMidi: number, tgtMidi: number) => {
      const target = tgtMidi - srcMidi;
      onSetNoteSegments(srcChord, srcMidi, [toSegment("glide", glideCurve("join", target))]);
    };

    if (selectionKind === "two-notes") {
      const sorted = [...mpeSelection].sort(
        (a, b) => a.chordIndex - b.chordIndex || a.midi - b.midi
      );
      const [src, tgt] = sorted;
      buildBend(src.chordIndex, src.midi, tgt.midi);
    } else if (selectionKind === "two-chords") {
      const byChord = new Map<number, number[]>();
      for (const s of mpeSelection) {
        const list = byChord.get(s.chordIndex) ?? [];
        list.push(s.midi);
        byChord.set(s.chordIndex, list);
      }
      const [ciA, ciB] = Array.from(byChord.keys()).sort((a, b) => a - b);
      const notesA = byChord.get(ciA)!.sort((a, b) => a - b);
      const notesB = byChord.get(ciB)!.sort((a, b) => a - b);
      for (let i = 0; i < notesA.length; i++) {
        buildBend(ciA, notesA[i], notesB[i]);
      }
    }
  }, [onSetNoteSegments, selectionKind, mpeSelection]);

  const handleReset = useCallback(() => {
    if (!onRemoveNoteExpression) return;
    for (const s of mpeSelection) onRemoveNoteExpression(s.chordIndex, s.midi);
  }, [onRemoveNoteExpression, mpeSelection]);

  const handleReverse = useCallback(() => {
    if (!onSetNoteSegments) return;
    for (const s of mpeSelection) {
      const segs = segmentsFor(s.chordIndex, s.midi);
      if (segs.length === 0) continue;
      onSetNoteSegments(
        s.chordIndex,
        s.midi,
        segs.map((seg) => ({ ...seg, points: reversePoints(seg.points) }))
      );
    }
  }, [onSetNoteSegments, mpeSelection, segmentsFor]);

  const handleScaleAmount = useCallback(
    (factor: number) => {
      if (!onSetNoteSegments) return;
      for (const s of mpeSelection) {
        const segs = segmentsFor(s.chordIndex, s.midi);
        if (segs.length === 0) continue;
        onSetNoteSegments(
          s.chordIndex,
          s.midi,
          segs.map((seg) => ({ ...seg, points: scaleAmountPoints(seg.points, factor) }))
        );
      }
    },
    [onSetNoteSegments, mpeSelection, segmentsFor]
  );

  const handleScaleDuration = useCallback(
    (factor: number) => {
      if (!onSetNoteSegments) return;
      for (const s of mpeSelection) {
        const segs = segmentsFor(s.chordIndex, s.midi);
        if (segs.length === 0) continue;
        onSetNoteSegments(
          s.chordIndex,
          s.midi,
          segs.map((seg) => ({ ...seg, points: scaleDurationPoints(seg.points, factor) }))
        );
      }
    },
    [onSetNoteSegments, mpeSelection, segmentsFor]
  );

  // Clone segments with fresh ids so pasted/duplicated copies are independent.
  const cloneSegments = (segs: ExpressionSegment[]): ExpressionSegment[] =>
    segs.map((seg) => ({ ...seg, id: makeSegmentId(), points: seg.points.map((p) => ({ ...p })) }));

  const handleCopy = useCallback(() => {
    const withExpr = mpeSelection.find((s) => segmentsFor(s.chordIndex, s.midi).length > 0);
    if (withExpr) setClipboard(cloneSegments(segmentsFor(withExpr.chordIndex, withExpr.midi)));
  }, [mpeSelection, segmentsFor]);

  const handlePaste = useCallback(() => {
    if (!onSetNoteSegments || !clipboard) return;
    for (const s of mpeSelection) onSetNoteSegments(s.chordIndex, s.midi, cloneSegments(clipboard));
  }, [onSetNoteSegments, clipboard, mpeSelection]);

  const handleDuplicate = useCallback(() => {
    if (!onSetNoteSegments) return;
    const source = mpeSelection.find((s) => segmentsFor(s.chordIndex, s.midi).length > 0);
    if (!source) return;
    const segs = segmentsFor(source.chordIndex, source.midi);
    for (const s of mpeSelection) {
      if (s.chordIndex === source.chordIndex && s.midi === source.midi) continue;
      onSetNoteSegments(s.chordIndex, s.midi, cloneSegments(segs));
    }
  }, [onSetNoteSegments, mpeSelection, segmentsFor]);

  return (
    <div className="piano-roll-section">
      {/* Mode toggle — reveals the MPE expression tools without leaving the
          piano roll. The roll stays fully visible in both modes. */}
      {mpeAvailable && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="mpe-mode-switch">
            <button
              type="button"
              onClick={() => setMpeMode(false)}
              className={clsx("mpe-mode-btn", !mpeMode && "active")}
              aria-pressed={!mpeMode}
            >
              <Music className="w-3.5 h-3.5" />
              <span>Piano Roll</span>
            </button>
            <button
              type="button"
              onClick={() => setMpeMode(true)}
              className={clsx("mpe-mode-btn", mpeMode && "active")}
              aria-pressed={mpeMode}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>MPE Editor</span>
            </button>
          </div>
        </div>
      )}

      {mpeMode && mpeAvailable && (
        <MpeToolbar
          selectionKind={selectionKind}
          selectionCount={selectionCount}
          hasExpression={hasExpression}
          canPaste={clipboard !== null}
          onGlide={handleGlide}
          onPitchDrop={handlePitchDrop}
          onScoop={handleScoop}
          onVibrato={handleVibrato}
          onJoin={handleJoin}
          onReset={handleReset}
          onReverse={handleReverse}
          onScaleAmount={handleScaleAmount}
          onScaleDuration={handleScaleDuration}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onDuplicate={handleDuplicate}
          onRemove={handleReset}
        />
      )}

      {/* Selected-note stepper: tap a note, then nudge it up/down within the
          key. The primary editing control on touch (where drag is disabled). */}
      {!mpeMode && selectedNote && (
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-[11px] text-muted">
            Note <span className="font-semibold text-foreground font-mono">{selectedNoteLabel}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepSelectedNote("up")}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-border-subtle bg-surface hover:bg-surface-muted hover:border-accent/50 text-muted hover:text-accent transition-colors"
              title="Move note up (in key)"
              aria-label="Move note up"
            >
              <ChevronUp className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => stepSelectedNote("down")}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-border-subtle bg-surface hover:bg-surface-muted hover:border-accent/50 text-muted hover:text-accent transition-colors"
              title="Move note down (in key)"
              aria-label="Move note down"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
      <div className="piano-roll-wrap">
        {/* LEFT PIANO KEYBOARD */}
        <div className="piano-keys">
          {noteRange.map((midi) => {
            const isWhite = isWhiteKey(midi);
            const pClass = midiToPitchClass(midi);
            const isC = pClass === "C";
            const noteName = midiToNoteName(midi);
            const displayNote = spellMidiNote(midi, useFlats);
            const isActive = activeMidiNotes.size > 0
              ? activeMidiNotes.has(midi) || flashingNote === midi
              : activePitchClasses.has(pClass) || flashingNote === midi;

            return (
              <div
                key={midi}
                className={clsx(
                  "piano-key-row",
                  !isWhite && "black-key",
                  isC && "c-note",
                  isActive && "key-active"
                )}
                data-note={noteName}
              >
                {!isWhite ? "" : isC || isActive || noteRange.length <= 24 ? displayNote : ""}
              </div>
            );
          })}
        </div>

        {/* RIGHT NOTE GRID */}
        <div className={clsx("roll-grid", mpeMode && "mpe-active")} ref={gridRef}>
          {chords.map((chord, colIdx) => {
            const isPlaying = playingIndex === colIdx;
            const isSelected = selectedIndex === colIdx;
            const hasMidiNotes = chord.midiNotes && chord.midiNotes.length > 0;
            const midiSet = hasMidiNotes ? new Set(chord.midiNotes) : null;
            const chordPcs = !hasMidiNotes ? new Set(chord.notes) : null;
            const rootPc = chord.root ?? (chord.notes.length > 0 ? chord.notes[0] : null);
            const colFlex = durationFlex(chord.durationClass);
            const sourceType = chordSourceTypes?.[colIdx];

            return (
              <div
                key={`${colIdx}-${chord.romanNumeral}`}
                className={clsx("roll-column", isPlaying && "playing", isSelected && "selected")}
                style={{ "--col-flex": colFlex } as React.CSSProperties}
                onMouseEnter={() => setHoveredColumnIdx(colIdx)}
                onMouseLeave={() => setHoveredColumnIdx(null)}
              >
                <div
                  className={clsx("roll-col-header", isSelected && "selected-header")}
                  onClick={() => {
                    if (mpeMode) {
                      toggleMpeChord(colIdx);
                      return;
                    }
                    onSelectChord?.(isSelected ? null : colIdx);
                    setSelectedNote(null);
                  }}
                  title={`${chord.romanNumeral} \u2014 ${chord.symbol}`}
                >
                  <div className="col-chord-name flex items-center gap-1">
                    <span className="col-chord-symbol">{chord.symbol}</span>
                    {sourceType && sourceType !== "generated" && (
                      <>
                        {/* Mobile: compact dot so the badge never overlaps the name */}
                        <span
                          className={`lg:hidden inline-block w-1.5 h-1.5 rounded-full shrink-0 ${SOURCE_DOT_COLORS[sourceType]}`}
                          title={SOURCE_BADGE_LABELS[sourceType]}
                        />
                        {/* Desktop: full text badge */}
                        <span className={`hidden lg:inline-block px-1 py-0 rounded text-[8px] font-semibold shrink-0 ${SOURCE_BADGE_COLORS[sourceType]}`}>
                          {SOURCE_BADGE_LABELS[sourceType]}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="roll-col-cells" ref={(el) => { cellsRefs.current[colIdx] = el; }}>
                  {noteRange.map((midi) => {
                    const isWhite = isWhiteKey(midi);
                    const pClass = midiToPitchClass(midi);
                    const hasNote = midiSet ? midiSet.has(midi) : chordPcs!.has(pClass);
                    const isRoot = midiSet
                      ? hasNote && pClass === rootPc
                      : pClass === rootPc;
                    const isFlashing = flashingNote === midi && hoveredColumnIdx === colIdx;
                    const isNoteSelected = selectedNote?.chordIndex === colIdx && selectedNote?.midi === midi;
                    const isDragTarget = isDragging && dragStart?.chordIndex === colIdx;
                    const isMpeSel = mpeMode && hasNote && isMpeSelected(colIdx, midi);

                    return (
                      <div
                        key={midi}
                        className={clsx(
                          "note-cell",
                          !isWhite && "black-row",
                          hasNote && "has-note",
                          isRoot && "is-root",
                          isFlashing && "triggered",
                          isNoteSelected && "note-selected",
                          isMpeSel && "mpe-selected",
                          isDragTarget && "cursor-ns-resize",
                          !hasNote && isSelected && !mpeMode && "hover:ring-1 hover:ring-accent/20 hover:bg-accent/5"
                        )}
                        data-note={pClass}
                        onClick={() => {
                          if (mpeMode) {
                            if (hasNote) {
                              toggleMpeNote(colIdx, midi);
                              if (onPlayNote) {
                                onPlayNote(midiToNoteName(midi));
                                setFlashingNote(midi);
                                setTimeout(() => setFlashingNote(null), 250);
                              }
                            } else {
                              setMpeSelection([]);
                            }
                            return;
                          }
                          handleNoteClick(midi, colIdx, hasNote);
                        }}
                        onDoubleClick={() => handleDoubleClick(midi, colIdx, hasNote)}
                        onPointerDown={(e) => handlePointerDown(e, midi, colIdx, hasNote)}
                        onPointerEnter={() => handlePointerEnterCell(midi, colIdx)}
                      />
                    );
                  })}

                  {/* Melody note bar overlays */}
                  {showMelody && (melodyByChord.get(colIdx) ?? []).map((mn) => {
                    const chordBeats = durationToBeats(chord.durationClass);
                    const localBeat = mn.startBeat - chordBeatOffsets[colIdx];
                    const leftPct = (localBeat / chordBeats) * 100;
                    const widthPct = (mn.durationBeats / chordBeats) * 100;
                    const rowIdx = noteRange.indexOf(mn.midi);
                    if (rowIdx === -1) return null;
                    const topPct = (rowIdx / noteRange.length) * 100;
                    const heightPct = (1 / noteRange.length) * 100;

                    return (
                      <div
                        key={mn.id}
                        onPointerDown={(e) => {
                          if (e.pointerType === "touch") return;
                          e.stopPropagation();
                          if (onMoveMelodyNote) {
                            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                              e.currentTarget.releasePointerCapture(e.pointerId);
                            }
                            setDraggingMelodyId(mn.id);
                          }
                        }}
                        className={clsx(
                          "melody-overlay-bar",
                          mn.isChordTone && "chord-tone",
                          // Grabbable only when editable. While ANY note (chord or
                          // melody) is being dragged, disable pointer-events on every bar
                          // so the underlying note cells receive the pointerenter that
                          // moves the dragged note — this keeps chord notes draggable
                          // straight through rows that a melody bar overlaps.
                          !onMoveMelodyNote && "pointer-events-none",
                          onMoveMelodyNote && (isDraggingActive ? "pointer-events-none" : "pointer-events-auto cursor-grab"),
                          draggingMelodyId === mn.id && "dragging cursor-grabbing hover:cursor-grabbing"
                        )}
                        style={{
                          left: `${leftPct}%`,
                          width: `${Math.max(widthPct, 2)}%`,
                          top: `${topPct}%`,
                          height: `${heightPct}%`,
                        }}
                        title={`${mn.noteWithOctave} (${mn.durationBeats}b)`}
                      >
                        <span className="melody-bar-label">{mn.noteWithOctave}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {chords.length === 0 && (
            <div className="roll-column flex-1 opacity-50 pointer-events-none">
              <div className="roll-col-header">
                <div className="col-chord-name">Empty</div>
              </div>
              {noteRange.map((midi) => (
                <div key={midi} className={clsx("note-cell", !isWhiteKey(midi) && "black-row")} />
              ))}
            </div>
          )}

          {/* Expression curves overlay — draws pitch bends aligned to the grid.
              Renders nothing when no expression exists, so the roll is
              unchanged until the user authors a bend. */}
          {mpeAvailable && (
            <ExpressionOverlay
              chords={chords}
              noteRange={noteRange}
              geom={geom}
              mpeMode={mpeMode}
              selection={mpeSelection}
              containerRef={gridRef}
              onUpdateSegment={handleUpdateSegment}
            />
          )}

          {/* Playhead line */}
          <div
            ref={playheadRef}
            className="playhead-line"
            style={{ display: "none" }}
          />
        </div>
      </div>
    </div>
  );
}
