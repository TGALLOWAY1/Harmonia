"use client";

import { useProgressionStore } from "../../lib/state/progressionStore";
import { cn } from "../../lib/utils";

interface ChordInspectorProps {
    selectedIndex: number | null;
}

const QUALITY_OPTIONS = [
    { label: "Triad", value: "maj", minorValue: "min", diminishedValue: "dim" },
    { label: "7th", value: "maj7", minorValue: "m7", diminishedValue: "dim7" },
    { label: "Dominant 7", value: "7", minorValue: "7", diminishedValue: "dim7" },
    { label: "Add 9", value: "add9", minorValue: "m(add9)", diminishedValue: "dim" },
    { label: "Sus 2", value: "sus2", minorValue: "sus2", diminishedValue: "dim" },
    { label: "Sus 4", value: "sus4", minorValue: "sus4", diminishedValue: "dim" },
];

export default function ChordInspector({ selectedIndex }: ChordInspectorProps) {
    const { currentProgression, setChordQuality } = useProgressionStore();

    if (selectedIndex === null || !currentProgression || !currentProgression.chords[selectedIndex]) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                    Chord Inspector
                </div>
                <p className="text-sm text-muted opacity-70">
                    Click a chord in the progression to modify its complexity.
                </p>
            </div>
        );
    }

    const chord = currentProgression.chords[selectedIndex];

    // Determine base flavor to map the correct quality value
    let flavor: "major" | "minor" | "diminished" = "major";
    if (chord.romanNumeral.includes("°")) flavor = "diminished";
    else if (chord.romanNumeral === chord.romanNumeral.toLowerCase()) flavor = "minor";

    return (
        <div className="flex flex-col items-center gap-4 w-full">
            <div className="text-xs font-medium text-muted uppercase tracking-wider">
                Modify Chord #{selectedIndex + 1}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
                {QUALITY_OPTIONS.map((opt) => {
                    let targetQuality = opt.value;
                    if (flavor === "minor") targetQuality = opt.minorValue;
                    if (flavor === "diminished") targetQuality = opt.diminishedValue;

                    // "maj" and "min" are used internally to build standard major/minor triads,
                    // but they appear as empty strings "" or "m" in standard naming.
                    // The generic buildTriadFromRoot function handles both "maj"/"min" and ""/"m".

                    return (
                        <button
                            key={opt.label}
                            onClick={() => setChordQuality(selectedIndex, targetQuality)}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border",
                                chord.quality === targetQuality ||
                                    (chord.quality === "" && targetQuality === "maj") ||
                                    (chord.quality === "m" && targetQuality === "min")
                                    ? "bg-accent text-white border-accent"
                                    : "bg-surface border-border-subtle text-foreground hover:border-accent/50 hover:bg-surface-muted"
                            )}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
