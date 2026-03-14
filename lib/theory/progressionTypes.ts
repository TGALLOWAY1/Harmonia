import { PitchClass } from "../theory/midiUtils";
import { ChordQuality, RomanNumeral } from "../theory/chord";
import type { DurationClass } from "../music/generators/advanced/types";

export interface Chord {
    symbol: string;
    notes: string[];
    romanNumeral: string;
    notesWithOctave?: string[];
    midiNotes?: number[];
    root?: PitchClass;
    quality?: ChordQuality;
    isLocked?: boolean;
    durationClass?: DurationClass;
}

export interface Progression {
    id: string;
    chords: Chord[];
    timestamp: number;
}
