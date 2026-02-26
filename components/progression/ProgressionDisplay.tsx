"use client";

import { useProgressionStore } from "../../lib/state/progressionStore";
import ChordCard from "./ChordCard";

export default function ProgressionDisplay() {
    const { currentProgression } = useProgressionStore();

    if (!currentProgression) {
        return (
            <div className="text-center text-muted py-16">
                Generate a progression to get started
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
            {currentProgression.chords.map((chord, index) => (
                <ChordCard key={index} chord={chord} index={index} />
            ))}
        </div>
    );
}
