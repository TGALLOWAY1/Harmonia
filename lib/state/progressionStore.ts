import { create } from "zustand";
import type { Progression, Chord } from "../theory/progressionTypes";
import type { Mode } from "../theory/harmonyEngine";
import { midiToPitchClass, normalizeToPitchClass } from "../theory/midiUtils";
import { progressionToMidi } from "../progressionMidiExport";
import { generateAdvancedProgression } from "../music/generators/advanced/generateAdvancedProgression";
import type { AdvancedProgressionOptions } from "../music/generators/advanced/types";

export type ComplexityLevel = 1 | 2 | 3 | 4;

export const COMPLEXITY_LABELS: Record<ComplexityLevel, string> = {
    1: "Simple",
    2: "Rich",
    3: "Extended",
    4: "Altered",
};

interface ProgressionState {
    currentProgression: Progression | null;
    history: Progression[];
    isPlaying: boolean;
    bpm: number;

    // Settings
    rootKey: string;
    mode: Mode;
    complexity: ComplexityLevel;
    numChords: number;

    setSettings: (settings: Partial<Pick<ProgressionState, "rootKey" | "mode" | "complexity" | "numChords" | "bpm">>) => void;
    generateNew: () => void;
    toggleLock: (index: number) => void;
    deleteChord: (index: number) => void;
    shiftNote: (chordIndex: number, midiNote: number, direction: "up" | "down") => void;
    setIsPlaying: (playing: boolean) => void;
    addToHistory: (progression: Progression) => void;
    exportMidi: () => void;
}

type ComplexityOptions = Pick<
    AdvancedProgressionOptions,
    "complexity" | "useSecondaryDominants" | "usePassingChords" | "useSuspensions" | "useTritoneSubstitution"
>;

function complexityToOptions(complexity: ComplexityLevel): ComplexityOptions {
    switch (complexity) {
        case 1:
            return {
                complexity: 1,
                useSecondaryDominants: false,
                usePassingChords: false,
                useSuspensions: false,
                useTritoneSubstitution: false,
            };
        case 2:
            return {
                complexity: 2,
                useSecondaryDominants: true,
                usePassingChords: false,
                useSuspensions: false,
                useTritoneSubstitution: false,
            };
        case 3:
            return {
                complexity: 3,
                useSecondaryDominants: true,
                usePassingChords: true,
                useSuspensions: true,
                useTritoneSubstitution: false,
            };
        case 4:
            return {
                complexity: 4,
                useSecondaryDominants: true,
                usePassingChords: true,
                useSuspensions: true,
                useTritoneSubstitution: true,
            };
    }
}

export const useProgressionStore = create<ProgressionState>((set, get) => ({
    currentProgression: null,
    history: [],
    isPlaying: false,
    bpm: 120,

    rootKey: "C",
    mode: "ionian",
    complexity: 2,
    numChords: 4,

    setSettings: (settings) => {
        set((state) => ({ ...state, ...settings }));
    },

    generateNew: () => {
        const { rootKey, mode, complexity, numChords, currentProgression } = get();
        const rootPC = normalizeToPitchClass(rootKey) || "C";

        // Collect locked chords from the current progression (by position)
        const lockedByIndex = new Map<number, Chord>();
        if (currentProgression) {
            currentProgression.chords.forEach((chord, i) => {
                if (chord.isLocked) lockedByIndex.set(i, chord);
            });
        }

        const result = generateAdvancedProgression({
            rootKey: rootPC,
            mode,
            numChords,
            voicingStyle: "auto",
            voiceCount: 4,
            rangeLow: 48,
            rangeHigh: 79,
            ...complexityToOptions(complexity),
        });

        const newChords: Chord[] = result.chords.map((voiced) => {
            const pitchClasses = Array.from(new Set(voiced.midi.map((midi) => midiToPitchClass(midi))));
            const root = pitchClasses[0];

            return {
                symbol: voiced.symbol,
                notes: pitchClasses,
                romanNumeral: voiced.degreeLabel,
                notesWithOctave: voiced.notes,
                midiNotes: voiced.midi,
                root,
                durationClass: voiced.durationClass,
            };
        });

        // Merge: keep locked chords in their positions, fill others from generated
        const chords = newChords.map((chord, i) => {
            const locked = lockedByIndex.get(i);
            return locked ? { ...locked } : chord;
        });

        const progression: Progression = {
            id: `prog-${Date.now()}`,
            chords,
            timestamp: Date.now(),
        };

        set({ currentProgression: progression });
        get().addToHistory(progression);
    },

    toggleLock: (index: number) => {
        const { currentProgression } = get();
        if (!currentProgression) return;

        const chords = currentProgression.chords.map((chord, i) =>
            i === index ? { ...chord, isLocked: !chord.isLocked } : chord
        );

        set({
            currentProgression: {
                ...currentProgression,
                chords,
            },
        });
    },

    deleteChord: (index: number) => {
        const { currentProgression } = get();
        if (!currentProgression || currentProgression.chords.length <= 1) return;

        const chords = currentProgression.chords.filter((_, i) => i !== index);
        set({
            currentProgression: {
                ...currentProgression,
                chords,
            },
        });
    },

    shiftNote: (chordIndex: number, midiNote: number, direction: "up" | "down") => {
        const { currentProgression } = get();
        if (!currentProgression) return;

        const chord = currentProgression.chords[chordIndex];
        if (!chord || !chord.midiNotes) return;

        const shift = direction === "up" ? 12 : -12;
        const noteIdx = chord.midiNotes.indexOf(midiNote);
        if (noteIdx === -1) return;

        const newMidiNotes = [...chord.midiNotes];
        newMidiNotes[noteIdx] = midiNote + shift;

        const newNotesWithOctave = chord.notesWithOctave ? [...chord.notesWithOctave] : undefined;
        if (newNotesWithOctave && newNotesWithOctave[noteIdx]) {
            const match = newNotesWithOctave[noteIdx].match(/^([A-G]#?)(\d+)$/);
            if (match) {
                const [, pc, oct] = match;
                newNotesWithOctave[noteIdx] = `${pc}${Number(oct) + (direction === "up" ? 1 : -1)}`;
            }
        }

        const chords = currentProgression.chords.map((c, i) =>
            i === chordIndex
                ? { ...c, midiNotes: newMidiNotes, notesWithOctave: newNotesWithOctave }
                : c
        );

        set({
            currentProgression: {
                ...currentProgression,
                chords,
            },
        });
    },

    setIsPlaying: (playing: boolean) => {
        set({ isPlaying: playing });
    },

    addToHistory: (progression: Progression) => {
        set((state) => ({
            history: [progression, ...state.history].slice(0, 10),
        }));
    },

    exportMidi: () => {
        const { currentProgression, bpm, rootKey, mode } = get();
        if (!currentProgression) return;

        const midiChords = currentProgression.chords.map(c => ({
            symbol: c.symbol,
            notesWithOctave: c.notesWithOctave && c.notesWithOctave.length > 0
                ? c.notesWithOctave
                : c.notes.map(n => `${n}3`),
            durationClass: c.durationClass,
        }));

        const blob = progressionToMidi(midiChords, bpm);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `harmonia-${rootKey}-${mode}-${Date.now()}.mid`;
        a.click();
        URL.revokeObjectURL(url);
    },
}));
