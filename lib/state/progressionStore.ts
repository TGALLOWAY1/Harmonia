import { create } from "zustand";
import { Progression, Chord } from "../theory/progressionTypes";
import { generateProgression, Mode, Mood, Depth, Degree } from "../theory/harmonyEngine";
import { formatChordSymbol, buildTriadFromRoot, TriadQuality } from "../theory/chord";
import { normalizeToPitchClass, pitchClassesToMidi } from "../theory/midiUtils";
import { getScaleDefinition } from "../theory/scale";
import { ScaleType } from "../theory/types";
import { progressionToMidi } from "../progressionMidiExport";

interface ProgressionState {
    currentProgression: Progression | null;
    history: Progression[];
    isPlaying: boolean;
    bpm: number;

    // Settings
    rootKey: string;
    mode: Mode;
    mood: Mood;
    depth: Depth;
    numChords: number;

    setSettings: (settings: Partial<Pick<ProgressionState, "rootKey" | "mode" | "mood" | "depth" | "numChords" | "bpm">>) => void;
    generateNew: () => void;
    setIsPlaying: (playing: boolean) => void;
    addToHistory: (progression: Progression) => void;
    exportMidi: () => void;
}

const DEGREE_MAP: Record<Degree, number> = {
    "I": 0, "ii": 1, "iii": 2, "IV": 3, "V": 4, "vi": 5, "vii°": 6,
    "i": 0, "ii°": 1, "III": 2, "iv": 3, "v": 4, "bVI": 5, "bVII": 6,
    "bII": 1, "bIII": 2, "II": 1,
};

export const useProgressionStore = create<ProgressionState>((set, get) => ({
    currentProgression: null,
    history: [],
    isPlaying: false,
    bpm: 120,

    rootKey: "C",
    mode: "ionian",
    mood: "happy",
    depth: 0,
    numChords: 4,

    setSettings: (settings) => {
        set((state) => ({ ...state, ...settings }));
    },

    generateNew: () => {
        const { rootKey, mode, mood, depth, numChords } = get();
        const rootPC = normalizeToPitchClass(rootKey) || "C";

        const generated = generateProgression({
            rootKey: rootPC,
            mode,
            mood,
            depth,
            numChords,
        });

        // Map engine modes to scale types for definition lookup
        const modeToScaleType: Record<Mode, ScaleType> = {
            ionian: "major",
            aeolian: "natural_minor",
            dorian: "dorian",
            mixolydian: "mixolydian",
            phrygian: "phrygian",
        };

        const scale = getScaleDefinition(rootPC, modeToScaleType[mode]);

        const chords: Chord[] = generated.map((gc) => {
            const degreeIndex = DEGREE_MAP[gc.degree] ?? 0;
            const rootOfChord = scale.pitchClasses[degreeIndex];

            const triad = buildTriadFromRoot(rootOfChord, gc.quality);
            const symbol = formatChordSymbol(rootOfChord, gc.quality);

            return {
                symbol,
                notes: triad.pitchClasses,
                romanNumeral: gc.degree,
                root: rootOfChord,
                quality: gc.quality as any,
            };
        });

        const progression: Progression = {
            id: `prog-${Date.now()}`,
            chords,
            timestamp: Date.now(),
        };

        set({ currentProgression: progression });
        get().addToHistory(progression);
    },

    setIsPlaying: (playing: boolean) => {
        set({ isPlaying: playing });
    },

    addToHistory: (progression: Progression) => {
        set((state) => ({
            history: [progression, ...state.history].slice(0, 10), // Keep last 10
        }));
    },

    exportMidi: () => {
        const { currentProgression, bpm } = get();
        if (!currentProgression) return;

        const midiChords = currentProgression.chords.map(c => ({
            symbol: c.symbol,
            notesWithOctave: c.notes.map(n => `${n}3`)
        }));

        const blob = progressionToMidi(midiChords, bpm);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `progression-${Date.now()}.mid`;
        a.click();
        URL.revokeObjectURL(url);
    },
}));
