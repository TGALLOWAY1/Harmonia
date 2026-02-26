"use client";

import { useProgressionStore } from "../../lib/state/progressionStore";
import { Mode } from "../../lib/theory/harmonyEngine";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES: { value: Mode; label: string }[] = [
    { value: "ionian", label: "Major" },
    { value: "aeolian", label: "Minor" },
    { value: "dorian", label: "Dorian" },
    { value: "mixolydian", label: "Mixolydian" },
    { value: "phrygian", label: "Phrygian" },
];

export default function ScaleSelector() {
    const { rootKey, mode, setSettings } = useProgressionStore();

    return (
        <div className="flex items-center gap-4 bg-surface-muted px-4 py-2 rounded-xl border border-border-subtle backdrop-blur-sm">
            {/* Root Note Selector */}
            <div className="relative">
                <select
                    value={rootKey}
                    onChange={(e) => setSettings({ rootKey: e.target.value })}
                    className="
            appearance-none
            bg-transparent
            text-foreground font-medium
            px-3 py-1.5 rounded-lg
            cursor-pointer
            hover:bg-surface
            transition-colors duration-200
            outline-none focus:ring-2 focus:ring-border-subtle
            text-center
            w-16
          "
                >
                    {NOTES.map((note) => (
                        <option key={note} value={note}>
                            {note}
                        </option>
                    ))}
                </select>
            </div>

            <span className="text-border-subtle">|</span>

            {/* Scale Mode Selector */}
            <div className="relative">
                <select
                    value={mode}
                    onChange={(e) => setSettings({ mode: e.target.value as Mode })}
                    className="
            appearance-none
            bg-transparent
            text-foreground font-medium
            px-3 py-1.5 rounded-lg
            cursor-pointer
            hover:bg-surface
            transition-colors duration-200
            outline-none focus:ring-2 focus:ring-border-subtle
            capitalize
            w-32
            text-center
          "
                >
                    {MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}
