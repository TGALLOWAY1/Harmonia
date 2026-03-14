"use client";

import React, { useMemo, useState, useEffect } from "react";
import clsx from "clsx";
import {
    isWhiteKey,
    midiToNoteName,
    midiToPitchClass,
    generateMidiRange,
    PitchClass,
} from "@/lib/theory/midiUtils";
import { Chord } from "@/lib/theory/progressionTypes";

export type VerticalPianoRollProps = {
    chords: Chord[];
    playingIndex: number | null;
    selectedIndex: number | null;
    onPlayNote?: (note: string) => void;
    onDeleteChord?: (index: number) => void;
    onShiftNote?: (chordIndex: number, midiNote: number, direction: "up" | "down") => void;
    onSelectChord?: (index: number | null) => void;
};

/** Compute the MIDI range needed to display all notes, with 2-note padding. */
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

/** Map durationClass to a flex multiplier for column width. */
function durationFlex(dc?: string): number {
    switch (dc) {
        case "full": return 4;
        case "half": return 2;
        case "quarter": return 1;
        case "eighth": return 0.5;
        default: return 4;
    }
}

export function VerticalPianoRoll({
    chords,
    playingIndex,
    selectedIndex,
    onPlayNote,
    onDeleteChord,
    onShiftNote,
    onSelectChord,
}: VerticalPianoRollProps) {
    const [hoveredColumnIdx, setHoveredColumnIdx] = useState<number | null>(null);
    const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
    const [flashingNote, setFlashingNote] = useState<number | null>(null);

    // Clear note selection when chord selection changes
    useEffect(() => {
        if (selectedIndex === null) {
            setSelectedNote(null);
        }
    }, [selectedIndex]);

    const autoRange = useMemo(() => computeAutoRange(chords), [chords]);

    const noteRange = useMemo(() => {
        const range = generateMidiRange(autoRange.low, autoRange.high);
        return range.reverse();
    }, [autoRange]);

    const rangeLabel = useMemo(() => {
        const lowNote = midiToNoteName(autoRange.low);
        const highNote = midiToNoteName(autoRange.high);
        return `${lowNote}–${highNote}`;
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

    const handleNoteClick = (midi: number, colIdx: number, hasNote: boolean) => {
        if (hasNote) {
            // Select this specific note for octave shifting
            const alreadySelected = selectedNote?.chordIndex === colIdx && selectedNote?.midi === midi;
            if (alreadySelected) {
                setSelectedNote(null);
            } else {
                setSelectedNote({ chordIndex: colIdx, midi });
                onSelectChord?.(colIdx);
            }
        }
        // Always play the note on click
        if (onPlayNote) {
            const noteNameWithOctave = midiToNoteName(midi);
            onPlayNote(noteNameWithOctave);
            setFlashingNote(midi);
            setTimeout(() => setFlashingNote(null), 250);
        }
    };

    // Keyboard handler for delete and per-note octave shift
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedNote(null);
                onSelectChord?.(null);
                return;
            }

            if (e.key === "Delete" || e.key === "Backspace") {
                if (selectedIndex !== null) {
                    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
                    e.preventDefault();
                    onDeleteChord?.(selectedIndex);
                    onSelectChord?.(null);
                    setSelectedNote(null);
                }
                return;
            }

            // Per-note octave shift: Cmd/Ctrl + Arrow Up/Down
            if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                if (selectedNote) {
                    e.preventDefault();
                    const direction = e.key === "ArrowUp" ? "up" : "down";
                    const newMidi = selectedNote.midi + (direction === "up" ? 12 : -12);
                    onShiftNote?.(selectedNote.chordIndex, selectedNote.midi, direction);
                    // Update selection to track the shifted note
                    setSelectedNote({ chordIndex: selectedNote.chordIndex, midi: newMidi });
                }
                return;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedIndex, selectedNote, onDeleteChord, onShiftNote, onSelectChord]);

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
                            <span className="opacity-60">{typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"}+↑↓ octave</span>
                        </div>
                    )}
                    {selectedIndex !== null && !selectedNote && (
                        <div className="text-xs text-muted flex items-center gap-2">
                            <span className="opacity-60">{chords[selectedIndex]?.symbol}</span>
                            <span className="opacity-40">|</span>
                            <span className="opacity-60">Del to remove · Click a note to shift</span>
                        </div>
                    )}
                    <div className="range-toggle">
                        {rangeLabel}
                    </div>
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
                                {!isWhite ? "" : isC || isActive ? noteName : ""}
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
                                >
                                    <div className="col-numeral">
                                        {chord.romanNumeral}
                                        {chord.durationClass && chord.durationClass !== "full" && (
                                            <span className="ml-1 opacity-50">
                                                ({chord.durationClass === "half" ? "2" : chord.durationClass === "quarter" ? "1" : "½"}♩)
                                            </span>
                                        )}
                                    </div>
                                    <div className="col-chord-name">{chord.symbol}</div>
                                </div>

                                {noteRange.map((midi) => {
                                    const isWhite = isWhiteKey(midi);
                                    const pClass = midiToPitchClass(midi);
                                    const hasNote = midiSet
                                        ? midiSet.has(midi)
                                        : chordPcs!.has(pClass);
                                    const isRoot = midiSet
                                        ? hasNote && pClass === rootPc
                                        : pClass === rootPc;
                                    const isFlashing = flashingNote === midi && hoveredColumnIdx === colIdx;
                                    const isNoteSelected = selectedNote?.chordIndex === colIdx && selectedNote?.midi === midi;

                                    return (
                                        <div
                                            key={midi}
                                            className={clsx(
                                                "note-cell",
                                                !isWhite && "black-row",
                                                hasNote && "has-note",
                                                isRoot && "is-root",
                                                isFlashing && "triggered",
                                                isNoteSelected && "note-selected"
                                            )}
                                            data-note={pClass}
                                            onClick={() => handleNoteClick(midi, colIdx, hasNote)}
                                        ></div>
                                    );
                                })}
                            </div>
                        );
                    })}

                    {chords.length === 0 && (
                        <div className="roll-column flex-1 opacity-50 pointer-events-none">
                            <div className="roll-col-header">
                                <div className="col-numeral">—</div>
                                <div className="col-chord-name">Empty</div>
                            </div>
                            {noteRange.map((midi) => (
                                <div key={midi} className={clsx("note-cell", !isWhiteKey(midi) && "black-row")} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
