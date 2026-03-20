"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import clsx from "clsx";
import { Download, RotateCcw } from "lucide-react";
import {
  isWhiteKey,
  midiToNoteName,
  midiToPitchClass,
  generateMidiRange,
  type PitchClass,
} from "@/lib/theory/midiUtils";
import type { Chord } from "@/lib/theory/progressionTypes";
import type { ChordSourceType } from "@/lib/creative/types";
import type { MelodyNote } from "@/lib/music/generators/melody/types";

export type InteractivePianoRollProps = {
  chords: Chord[];
  playingIndex: number | null;
  selectedIndex: number | null;
  onPlayNote?: (note: string) => void;
  onDeleteChord?: (index: number) => void;
  onShiftNote?: (chordIndex: number, midiNote: number, direction: "up" | "down") => void;
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
  onToggleMelody?: () => void;
  onExportMelodyMidi?: () => void;
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

  const lowOctave = Math.floor((minMidi - 2) / 12) * 12;
  const highOctave = Math.ceil((maxMidi + 3) / 12) * 12;
  const finalHigh = Math.max(highOctave, lowOctave + 12);
  return { low: lowOctave, high: finalHigh };
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

export function InteractivePianoRoll({
  chords,
  playingIndex,
  selectedIndex,
  onPlayNote,
  onDeleteChord,
  onShiftNote,
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
  onToggleMelody,
  onExportMelodyMidi,
}: InteractivePianoRollProps) {
  const [hoveredColumnIdx, setHoveredColumnIdx] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
  const [flashingNote, setFlashingNote] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ chordIndex: number; midi: number } | null>(null);

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
    const lowNote = midiToNoteName(autoRange.low);
    const highNote = midiToNoteName(autoRange.high);
    return `${lowNote}\u2013${highNote}`;
  }, [autoRange]);

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

  // Drag handling for pitch changes
  const handleMouseDown = useCallback((midi: number, colIdx: number, hasNote: boolean) => {
    if (hasNote && onMoveNote) {
      setIsDragging(true);
      setDragStart({ chordIndex: colIdx, midi });
    }
  }, [onMoveNote]);

  const handleMouseEnterCell = useCallback((midi: number, colIdx: number) => {
    if (isDragging && dragStart && dragStart.chordIndex === colIdx && dragStart.midi !== midi) {
      onMoveNote?.(colIdx, dragStart.midi, midi);
      setDragStart({ chordIndex: colIdx, midi });
    }
  }, [isDragging, dragStart, onMoveNote]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mouseup", handleMouseUp);
      return () => window.removeEventListener("mouseup", handleMouseUp);
    }
  }, [isDragging, handleMouseUp]);

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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, selectedNote, onDeleteChord, onShiftNote, onSelectChord, onRemoveNote]);

  const selectedNoteLabel = useMemo(() => {
    if (!selectedNote) return null;
    return midiToNoteName(selectedNote.midi);
  }, [selectedNote]);

  return (
    <div className="piano-roll-section">
      <div className="flex items-center justify-between mb-2.5">
        <div className="piano-roll-label">Piano Roll</div>
        <div className="flex items-center gap-3">
          {selectedNote && (
            <div className="text-xs text-muted flex items-center gap-2">
              <span className="opacity-60">Note: {selectedNoteLabel}</span>
              <span className="opacity-40">|</span>
              <span className="opacity-60">Del to remove · Dbl-click to add/remove</span>
              <span className="opacity-40">|</span>
              <span className="opacity-60">{typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+\u2191\u2193 octave</span>
            </div>
          )}
          {selectedIndex !== null && !selectedNote && (
            <div className="text-xs text-muted flex items-center gap-2">
              <span className="opacity-60">{chords[selectedIndex]?.symbol}</span>
              <span className="opacity-40">|</span>
              <span className="opacity-60">Dbl-click grid to add note · Click note to select</span>
              {onResetChord && (
                <>
                  <span className="opacity-40">|</span>
                  <button
                    onClick={() => onResetChord(selectedIndex)}
                    className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </button>
                </>
              )}
            </div>
          )}
          {onToggleMelody && (
            <button
              onClick={onToggleMelody}
              className={clsx(
                "px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                showMelody
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-surface-muted text-muted border-border-subtle hover:border-amber-500/30 hover:text-amber-300"
              )}
            >
              Melody
            </button>
          )}
          <div className="range-toggle">{rangeLabel}</div>
          {onExportMidi && (
            <button
              onClick={onExportMidi}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border-subtle bg-surface hover:bg-surface-muted text-xs font-medium transition-colors text-muted hover:text-foreground"
            >
              <Download className="w-3 h-3" />
              Export MIDI
            </button>
          )}
          {onExportMelodyMidi && showMelody && (
            <button
              onClick={onExportMelodyMidi}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-500/30 bg-surface hover:bg-amber-500/10 text-xs font-medium transition-colors text-amber-300 hover:text-amber-200"
            >
              <Download className="w-3 h-3" />
              Export Melody
            </button>
          )}
        </div>
      </div>

      <div className="piano-roll-wrap">
        {/* LEFT PIANO KEYBOARD */}
        <div className="piano-keys">
          {noteRange.map((midi) => {
            const isWhite = isWhiteKey(midi);
            const pClass = midiToPitchClass(midi);
            const isC = pClass === "C";
            const noteName = midiToNoteName(midi);
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
                {!isWhite ? "" : isC || isActive || noteRange.length <= 24 ? noteName : ""}
              </div>
            );
          })}
        </div>

        {/* RIGHT NOTE GRID */}
        <div className="roll-grid">
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
                    onSelectChord?.(isSelected ? null : colIdx);
                    setSelectedNote(null);
                  }}
                  title={`${chord.romanNumeral} \u2014 ${chord.symbol}`}
                >
                  <div className="col-chord-name flex items-center gap-1">
                    {chord.symbol}
                    {sourceType && sourceType !== "generated" && (
                      <span className={`inline-block px-1 py-0 rounded text-[8px] font-semibold ${SOURCE_BADGE_COLORS[sourceType]}`}>
                        {SOURCE_BADGE_LABELS[sourceType]}
                      </span>
                    )}
                  </div>
                </div>

                <div className="roll-col-cells">
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
                          isDragTarget && "cursor-ns-resize",
                          !hasNote && isSelected && "hover:ring-1 hover:ring-accent/20 hover:bg-accent/5"
                        )}
                        data-note={pClass}
                        onClick={() => handleNoteClick(midi, colIdx, hasNote)}
                        onDoubleClick={() => handleDoubleClick(midi, colIdx, hasNote)}
                        onMouseDown={() => handleMouseDown(midi, colIdx, hasNote)}
                        onMouseEnter={() => handleMouseEnterCell(midi, colIdx)}
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
                        className={clsx("melody-overlay-bar", mn.isChordTone && "chord-tone")}
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
