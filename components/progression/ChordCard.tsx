import { Chord } from "../../lib/theory/progressionTypes";
import React from "react";
import { Lock, Unlock, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChordCardProps {
    chord: Chord;
    index: number;
    isActive?: boolean;
    isSelected?: boolean;
    isDraggable?: boolean;
    onClick?: (index: number) => void;
    onDragStart?: (e: React.DragEvent<HTMLDivElement>, chord: Chord, index: number) => void;
    onRemove?: (index: number) => void;
    onLock?: (index: number) => void;
    onRefresh?: (index: number) => void;
}

export default function ChordCard({
    chord,
    index,
    isActive = false,
    isSelected = false,
    isDraggable = false,
    onClick,
    onDragStart,
    onRemove,
    onLock,
    onRefresh
}: ChordCardProps) {
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isDraggable) return;

        // Ensure the drag payload is set
        e.dataTransfer.setData("application/json", JSON.stringify({
            source: "chordCard",
            index,
            chord
        }));

        // Custom visual drag effect could go here
        e.dataTransfer.effectAllowed = "copyMove";

        if (onDragStart) {
            onDragStart(e, chord, index);
        }
    };
    return (
        <div
            draggable={isDraggable}
            onDragStart={handleDragStart}
            onClick={() => onClick?.(index)}
            className={cn(
                "relative flex flex-col items-center justify-center rounded-2xl px-8 py-10 min-w-[140px] border transition-all duration-200",
                isActive ? "bg-accent/10 border-accent" : "bg-surface border-border-subtle",
                isSelected && !isActive ? "ring-2 ring-accent border-transparent" : "",
                isDraggable ? "cursor-grab active:cursor-grabbing hover:border-accent" : ""
            )}
        >
            {/* Top Action Buttons */}
            <div className="absolute top-2 left-0 w-full px-3 flex items-center justify-between mt-1">
                <div className="flex-1 flex justify-start">
                    {onRefresh && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onRefresh(index); }}
                            className="text-muted hover:text-foreground p-1 rounded-full hover:bg-surface-muted transition-colors"
                            title="Regenerate this chord"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <div className="flex-1 flex justify-center">
                    {onLock && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onLock(index); }}
                            className="text-muted hover:text-foreground p-1 rounded-full hover:bg-surface-muted transition-colors"
                            title={chord.isLocked ? "Unlock chord" : "Lock chord"}
                        >
                            {chord.isLocked ? <Lock className="w-4 h-4 text-accent" /> : <Unlock className="w-4 h-4 opacity-60" />}
                        </button>
                    )}
                </div>

                <div className="flex-1 flex justify-end">
                    {onRemove && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                            className="text-muted hover:text-foreground p-1 rounded-full hover:bg-surface-muted transition-colors"
                            title="Remove chord"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex w-full justify-between items-start mb-3 mt-4">
                <div className="text-base font-medium text-muted opacity-70">{chord.romanNumeral}</div>
                <div className="text-sm text-muted">#{index + 1}</div>
            </div>
            <div className="text-4xl font-semibold mb-2">{chord.symbol}</div>
            <div className="text-sm text-muted mt-2 opacity-70">
                {chord.notes.join(" ")}
            </div>
        </div>
    );
}
