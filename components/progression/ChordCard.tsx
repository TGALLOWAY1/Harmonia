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
                "relative flex flex-col items-center justify-center rounded-2xl px-6 py-8 border transition-all duration-200",
                isActive ? "bg-accent/10 border-accent" : "bg-surface border-border-subtle",
                isSelected && !isActive ? "ring-2 ring-accent border-transparent" : "",
                isDraggable ? "cursor-grab active:cursor-grabbing hover:border-accent" : ""
            )}
        >
            {/* Top Action Buttons */}
            <div className="absolute top-2 right-2 flex items-center gap-1">
                {onRefresh && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRefresh(index); }}
                        className="text-muted hover:text-foreground p-1.5 rounded-full hover:bg-surface-muted transition-colors"
                        title="Regenerate this chord"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                )}
                {onLock && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onLock(index); }}
                        className="text-muted hover:text-foreground p-1.5 rounded-full hover:bg-surface-muted transition-colors"
                        title={chord.isLocked ? "Unlock chord" : "Lock chord"}
                    >
                        {chord.isLocked ? <Lock className="w-3.5 h-3.5 text-accent" /> : <Unlock className="w-3.5 h-3.5 opacity-60" />}
                    </button>
                )}
                {onRemove && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                        className="text-muted hover:text-foreground p-1.5 rounded-full hover:bg-surface-muted transition-colors"
                        title="Remove chord"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            <div className="flex w-full justify-between items-start mb-2 mt-2">
                <div className="text-sm font-medium text-muted opacity-70">{chord.romanNumeral}</div>
                <div className="text-xs text-muted">#{index + 1}</div>
            </div>
            <div className="text-3xl font-medium mb-1">{chord.symbol}</div>
            <div className="text-xs text-muted mt-2 opacity-70">
                {chord.notes.join(" ")}
            </div>
        </div>
    );
}
