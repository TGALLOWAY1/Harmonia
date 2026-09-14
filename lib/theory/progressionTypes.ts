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
     * Pitch class sounding in the bass (sharp-canonical), and which inversion
     * that makes: 0 root position, 1/2/3 for the third/fifth/seventh in the
     * bass, −1 when the bass is not a chord tone. Kept in step with
     * `midiNotes` by the store so a slash label can always be derived.
     */
    bass?: PitchClass;
    inversion?: number;
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
