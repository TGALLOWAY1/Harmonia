"use client";

import { useProgressionStore } from "../../lib/state/progressionStore";
import { Depth } from "../../lib/theory/harmonyEngine";
import { cn } from "../../lib/utils";

const COMPLEXITY_LABELS: Record<Depth, string> = {
    0: "Basic",
    1: "Standard",
    2: "Advanced",
};

export default function ComplexitySlider() {
    const { depth, setSettings } = useProgressionStore();

    return (
        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            <div className="text-xs font-medium text-muted uppercase tracking-wider">
                Complexity
            </div>

            <div className="relative w-full">
                {/* Slider Track */}
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="1"
                    value={depth}
                    onChange={(e) => setSettings({ depth: Number(e.target.value) as Depth })}
                    className="
            w-full h-2 bg-surface-muted rounded-lg appearance-none cursor-pointer
            focus:outline-none focus:ring-2 focus:ring-border-subtle
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-5
            [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:bg-accent
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110
          "
                />

                {/* Labels below slider */}
                <div className="flex justify-between mt-2 px-1">
                    {[0, 1, 2].map((level) => (
                        <button
                            key={level}
                            onClick={() => setSettings({ depth: level as Depth })}
                            className={cn(
                                "text-xs font-medium transition-colors duration-200",
                                depth === level
                                    ? "text-foreground"
                                    : "text-muted hover:text-foreground"
                            )}
                        >
                            {COMPLEXITY_LABELS[level as Depth]}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
