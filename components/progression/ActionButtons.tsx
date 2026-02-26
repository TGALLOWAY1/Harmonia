"use client";

import { useProgressionStore } from "../../lib/state/progressionStore";

export default function ActionButtons() {
    const { generateNew, isPlaying, setIsPlaying } = useProgressionStore();

    return (
        <div className="flex gap-3">
            <button
                onClick={generateNew}
                className="
          px-8 py-3 rounded-full
          bg-accent text-white
          font-medium
          transition-opacity duration-200
          hover:opacity-90
          active:opacity-75
        "
            >
                Generate
            </button>
            <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`
          px-8 py-3 rounded-full
          border border-border-subtle
          font-medium
          transition-colors duration-200
          ${isPlaying
                        ? "bg-surface-muted"
                        : "bg-surface hover:bg-surface-muted"
                    }
        `}
            >
                {isPlaying ? "Stop" : "Play"}
            </button>
        </div>
    );
}
