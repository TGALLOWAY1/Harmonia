import { Chord } from "../../lib/theory/progressionTypes";

interface ChordCardProps {
    chord: Chord;
    index: number;
    isActive?: boolean;
}

export default function ChordCard({ chord, index, isActive = false }: ChordCardProps) {
    return (
        <div
            className={`
        flex flex-col items-center justify-center
        rounded-2xl px-6 py-8
        bg-surface border border-border-subtle
        transition-colors duration-200
        ${isActive ? "bg-surface-muted" : ""}
      `}
        >
            <div className="text-sm text-muted mb-2">{index + 1}</div>
            <div className="text-3xl font-medium mb-2">{chord.symbol}</div>
            <div className="text-sm text-muted">{chord.romanNumeral}</div>
            <div className="text-xs text-muted mt-2 opacity-70">
                {chord.notes.join(" ")}
            </div>
        </div>
    );
}
