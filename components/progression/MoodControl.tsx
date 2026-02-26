"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProgressionStore } from "../../lib/state/progressionStore";
import { Mood } from "../../lib/theory/harmonyEngine";
import { cn } from "../../lib/utils";

const MOODS: Mood[] = ["melancholic", "dark", "moody", "bright", "happy", "optimistic"];

const MOOD_INFO: Record<Mood, { label: string; description: string }> = {
    melancholic: { label: "Melancholic", description: "Soft minor, plagal" },
    dark: { label: "Dark", description: "Phrygian, tension" },
    moody: { label: "Moody", description: "Dorian, drifting" },
    bright: { label: "Bright", description: "Mixolydian, lift" },
    happy: { label: "Happy", description: "Ionian, pop" },
    optimistic: { label: "Optimistic", description: "Major, bright" },
};

export default function MoodControl() {
    const { mood, setSettings } = useProgressionStore();
    const [showInfo, setShowInfo] = useState(false);

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-1.5">
                <div className="text-xs font-medium text-muted uppercase tracking-wider">
                    Mood
                </div>
                <button
                    onClick={() => setShowInfo(!showInfo)}
                    className="text-muted hover:text-foreground transition-colors"
                    aria-label={showInfo ? "Hide mood descriptions" : "Show mood descriptions"}
                >
                    <ChevronDown
                        className={cn(
                            "w-3 h-3 transition-transform duration-200",
                            showInfo && "rotate-180"
                        )}
                    />
                </button>
            </div>
            <div className="relative flex p-1 bg-surface-muted rounded-full overflow-x-auto max-w-full">
                {MOODS.map((m) => (
                    <button
                        key={m}
                        onClick={() => setSettings({ mood: m })}
                        className={cn(
                            "relative z-10 px-4 py-1.5 text-xs md:text-sm font-medium rounded-full capitalize transition-all duration-200 whitespace-nowrap",
                            mood === m
                                ? "text-foreground bg-surface shadow-sm"
                                : "text-muted hover:text-foreground"
                        )}
                    >
                        {m}
                    </button>
                ))}
            </div>
            <AnimatePresence>
                {showInfo && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="text-xs text-muted mt-1 space-y-1 text-center">
                            {MOODS.map((m) => (
                                <div key={m}>
                                    <strong>{MOOD_INFO[m].label}:</strong> {MOOD_INFO[m].description}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
