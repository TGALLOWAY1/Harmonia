"use client";

import React, { useMemo, useState, useEffect } from "react";
import clsx from "clsx";
import {
    isWhiteKey,
    midiToNoteName,
    midiToPitchClass,
    pitchClassToMidi,
    generateMidiRange,
    PitchClass,
} from "@/lib/theory/midiUtils";
import { Chord } from "@/lib/theory/progressionTypes";

export type VerticalPianoRollProps = {
    chords: Chord[];
    playingIndex: number | null;
    onPlayNote?: (note: string) => void;
};

export function VerticalPianoRoll({
    chords,
    playingIndex,
    onPlayNote,
}: VerticalPianoRollProps) {
    const [octaveBase, setOctaveBase] = useState<number>(3);
    const [octaveCount, setOctaveCount] = useState<number>(2); // 1 or 2 octaves

    // Hover state for columns to highlight piano keys
    const [hoveredColumnIdx, setHoveredColumnIdx] = useState<number | null>(null);

    // Generate the descending range of MIDI notes for the Y-axis
    const noteRange = useMemo(() => {
        // E.g. low=C3 (48), high=C5 (72) if base=3 and count=2
        const lowMidi = pitchClassToMidi("C", octaveBase);
        const highMidi = pitchClassToMidi("C", octaveBase + octaveCount);
        // We want inclusive of the top C, so generate up to highMidi
        const range = generateMidiRange(lowMidi, highMidi);
        return range.reverse(); // high pitch at top, low at bottom
    }, [octaveBase, octaveCount]);

    // Which notes are "active" on the left keyboard?
    // Either from the globally playing chord, or the hovered column
    const activeChord = useMemo(() => {
        if (hoveredColumnIdx !== null && chords[hoveredColumnIdx]) {
            return chords[hoveredColumnIdx];
        }
        if (playingIndex !== null && chords[playingIndex]) {
            return chords[playingIndex];
        }
        return null;
    }, [chords, playingIndex, hoveredColumnIdx]);

    const activePitchClasses = useMemo(() => {
        if (!activeChord) return new Set<PitchClass>();
        return new Set(activeChord.notes);
    }, [activeChord]);

    // Temporary local flash state when a note cell is clicked
    const [flashingNote, setFlashingNote] = useState<number | null>(null);

    const handleNoteClick = (midi: number) => {
        if (onPlayNote) {
            const noteNameWithOctave = midiToNoteName(midi);
            onPlayNote(noteNameWithOctave);
            setFlashingNote(midi);
            setTimeout(() => {
                setFlashingNote(null);
            }, 250);
        }
    };

    const increaseRange = () => {
        if (octaveCount < 3) setOctaveCount((c) => c + 1);
    };

    const decreaseRange = () => {
        if (octaveCount > 1) setOctaveCount((c) => c - 1);
    };

    return (
        <div className="piano-roll-section">
            <div className="flex items-center justify-between mb-2.5">
                <div className="piano-roll-label">Piano Roll</div>
                <div className="range-toggle">
                    C{octaveBase}–C{octaveBase + octaveCount}
                    <button className="range-btn" title="Contract range" onClick={decreaseRange}>−</button>
                    <button className="range-btn" title="Expand range" onClick={increaseRange}>+</button>
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
                        const isActive = activePitchClasses.has(pClass) || flashingNote === midi;

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
                        const chordPcs = new Set(chord.notes);
                        const rootPc = chord.notes.length > 0 ? chord.notes[0] : null;

                        return (
                            <div
                                key={`${colIdx}-${chord.romanNumeral}`}
                                className={clsx("roll-column", isPlaying && "playing")}
                                onMouseEnter={() => setHoveredColumnIdx(colIdx)}
                                onMouseLeave={() => setHoveredColumnIdx(null)}
                            >
                                <div className="roll-col-header">
                                    <div className="col-numeral">{chord.romanNumeral}</div>
                                    <div className="col-chord-name">{chord.symbol}</div>
                                </div>

                                {noteRange.map((midi) => {
                                    const isWhite = isWhiteKey(midi);
                                    const pClass = midiToPitchClass(midi);
                                    const hasNote = chordPcs.has(pClass);
                                    const isRoot = pClass === rootPc;
                                    const isFlashing = flashingNote === midi && hoveredColumnIdx === colIdx;

                                    return (
                                        <div
                                            key={midi}
                                            className={clsx(
                                                "note-cell",
                                                !isWhite && "black-row",
                                                hasNote && "has-note",
                                                isRoot && "is-root",
                                                isFlashing && "triggered"
                                            )}
                                            data-note={pClass}
                                            onClick={() => handleNoteClick(midi)}
                                        ></div>
                                    );
                                })}
                            </div>
                        );
                    })}

                    {/* Placeholder column if arrangement is empty to keep structure */}
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
