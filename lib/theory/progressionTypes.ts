import { PitchClass } from "../theory/midiUtils";
import { ChordQuality, RomanNumeral } from "../theory/chord";
import type { DurationClass } from "../music/generators/advanced/types";
import type { ChordExpression } from "../expression/types";

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
    /**
     * Optional MPE expression data (pitch bends, and future lanes), keyed by the
     * note's MIDI number. Absent unless the user has authored expression in the
     * MPE Editor; stored/visualized independently of playback.
     */
    expressions?: ChordExpression;
}

export interface Progression {
    id: string;
    chords: Chord[];
    timestamp: number;
}
