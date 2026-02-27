"use client";

import { useProgressionStore } from "../../lib/state/progressionStore";
import ChordCard from "./ChordCard";
import { useState } from "react";
import { Chord } from "../../lib/theory/progressionTypes";

interface ProgressionDisplayProps {
    activeIndex?: number | null;
    selectedIndex?: number | null;
    onSelectChord?: (index: number) => void;
    onPlayChord?: (notesWithOctave: string[], index: number) => void;
}

export default function ProgressionDisplay({ activeIndex = null, selectedIndex = null, onSelectChord, onPlayChord }: ProgressionDisplayProps) {
    const { currentProgression, addChordToProgression, removeChord, reorderChords, toggleChordLock, refreshChord } = useProgressionStore();
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        setDragOverIndex(index);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverIndex(null);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
        e.preventDefault();
        setDragOverIndex(null);

        try {
            const dataString = e.dataTransfer.getData("application/json");
            if (!dataString) return;

            const data = JSON.parse(dataString);

            if (data.source === "chordCard") {
                // If it's a reorder operation from within the display
                if (data.index !== undefined && currentProgression && data.index < currentProgression.chords.length) {
                    // simple protection against dropping on itself
                    if (data.index !== dropIndex) {
                        // Adjust index if dragging forward
                        const adjustedDropIndex = data.index < dropIndex ? dropIndex - 1 : dropIndex;
                        reorderChords(data.index, adjustedDropIndex);
                    }
                } else {
                    // It's a new chord from the palette
                    addChordToProgression(data.chord, dropIndex);
                }
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    };

    const handleEmptyDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOverIndex(null);

        try {
            const dataString = e.dataTransfer.getData("application/json");
            if (!dataString) return;

            const data = JSON.parse(dataString);
            if (data.source === "chordCard") {
                if (data.index !== undefined && currentProgression && data.index < currentProgression.chords.length) {
                    // Reorder to the very end
                    reorderChords(data.index, currentProgression.chords.length - 1);
                } else {
                    // Append new chord to the end
                    addChordToProgression(data.chord);
                }
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    };

    if (!currentProgression || currentProgression.chords.length === 0) {
        return (
            <div
                className={`w-full min-h-48 border-2 border-dashed rounded-3xl flex items-center justify-center transition-colors
                    ${dragOverIndex === 0 ? "border-accent bg-accent/5 text-foreground" : "border-border-subtle text-muted bg-surface/50"}
                `}
                onDragOver={(e) => handleDragOver(e, 0)}
                onDragLeave={handleDragLeave}
                onDrop={handleEmptyDrop}
            >
                Generate a progression or drag triads here to build your own
            </div>
        );
    }

    return (
        <div
            className="flex flex-wrap justify-center gap-4 w-full p-6 border-2 border-dashed border-transparent hover:border-border-subtle rounded-3xl transition-colors min-h-64"
            onDragOver={(e) => { e.preventDefault(); /* Allow drops into the general container */ }}
            onDrop={handleEmptyDrop}
        >
            {currentProgression.chords.map((chord, index) => (
                <div key={`${chord.romanNumeral}-${index}`} className="flex items-center">
                    {/* Drop zone before the card */}
                    <div
                        className={`w-4 h-full rounded-full transition-all duration-200 
                            ${dragOverIndex === index ? "w-8 bg-accent/20" : "w-2 opacity-0"}
                        `}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                    />

                    <ChordCard
                        chord={chord}
                        index={index}
                        isDraggable={true}
                        isActive={index === activeIndex}
                        isSelected={index === selectedIndex}
                        onClick={(idx) => {
                            onSelectChord?.(idx);
                            onPlayChord?.(chord.notes.map(n => `${n}3`), idx);
                        }}
                        onRemove={removeChord}
                        onLock={toggleChordLock}
                        onRefresh={refreshChord}
                    />
                </div>
            ))}

            {/* Final drop zone at the end */}
            <div
                className={`flex-grow min-w-16 h-full rounded-2xl transition-all duration-200 
                    ${dragOverIndex === currentProgression.chords.length ? "bg-accent/10 border-2 border-dashed border-accent" : "opacity-0"}
                `}
                onDragOver={(e) => handleDragOver(e, currentProgression.chords.length)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, currentProgression.chords.length)}
            />
        </div>
    );
}
