import { create } from "zustand";
import { Progression, Chord } from "../theory/progressionTypes";
import { generateProgression, Mode, Depth, Degree } from "../theory/harmonyEngine";
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
    depth: Depth;
    numChords: number;

    // Palette State
    primaryTriads: Chord[];

    setSettings: (settings: Partial<Pick<ProgressionState, "rootKey" | "mode" | "depth" | "numChords" | "bpm">>) => void;
    generateNew: () => void;
    setIsPlaying: (playing: boolean) => void;
    addToHistory: (progression: Progression) => void;
    exportMidi: () => void;

    // Manual Arrangement Actions
    updatePrimaryTriads: () => void;
    addChordToProgression: (chord: Chord, insertIndex?: number) => void;
    removeChord: (index: number) => void;
    reorderChords: (startIndex: number, endIndex: number) => void;
    toggleChordLock: (index: number) => void;
    refreshChord: (index: number) => void;
    setChordQuality: (index: number, quality: string) => void;
}

const DEGREE_MAP: Record<Degree, number> = {
    "I": 0, "ii": 1, "iii": 2, "IV": 3, "V": 4, "vi": 5, "vii°": 6,
    "i": 0, "ii°": 1, "III": 2, "iv": 3, "v": 4, "bVI": 5, "bVII": 6,
};

export const useProgressionStore = create<ProgressionState>((set, get) => ({
    currentProgression: null,
    history: [],
    isPlaying: false,
    bpm: 120,

    rootKey: "C",
    mode: "ionian",
    depth: 0,
    numChords: 4,

    primaryTriads: [],

    setSettings: (settings) => {
        set((state) => ({ ...state, ...settings }));
        if (settings.rootKey !== undefined || settings.mode !== undefined) {
            get().updatePrimaryTriads();
        }
    },

    updatePrimaryTriads: () => {
        const { rootKey, mode } = get();
        const rootPC = normalizeToPitchClass(rootKey) || "C";

        const modeToScaleType: Record<Mode, ScaleType> = {
            ionian: "major",
            aeolian: "natural_minor",
            dorian: "dorian",
            mixolydian: "mixolydian",
            phrygian: "phrygian",
        };

        const scale = getScaleDefinition(rootPC, modeToScaleType[mode]);
        const primaryChords: Chord[] = [];

        // Build the 7 diatonic chords
        for (let i = 0; i < 7; i++) {
            // Find quality string generically based on scale degrees to match existing format
            const rootOfChord = scale.pitchClasses[i];
            const third = scale.pitchClasses[(i + 2) % 7];
            const fifth = scale.pitchClasses[(i + 4) % 7];

            // Re-calc semitones to safely derive qualities generically
            const tDist = pitchClassesToMidi([rootOfChord, third], 3)[1] - pitchClassesToMidi([rootOfChord, third], 3)[0];
            const fDist = pitchClassesToMidi([rootOfChord, fifth], 3)[1] - pitchClassesToMidi([rootOfChord, fifth], 3)[0];

            const minorThird = tDist % 12 === 3 || tDist % 12 === -9;
            const diminishedFifth = fDist % 12 === 6 || fDist % 12 === -6;

            let qualityStr = "maj";
            if (minorThird && diminishedFifth) qualityStr = "dim";
            else if (minorThird) qualityStr = "min";

            const triad = buildTriadFromRoot(rootOfChord, qualityStr);
            const symbol = formatChordSymbol(rootOfChord, qualityStr);

            // Standard mapping matching DEGREE_MAP bounds
            const romanNumeralsMajor = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
            const romanNumeralsMinor = ["i", "ii°", "III", "iv", "v", "bVI", "bVII"];
            const isMinorKey = mode !== "ionian"; // Approximation for roman numerals in palette

            primaryChords.push({
                symbol,
                notes: triad.pitchClasses,
                romanNumeral: isMinorKey ? romanNumeralsMinor[i] : romanNumeralsMajor[i],
                root: rootOfChord,
                quality: qualityStr as any,
            });
        }

        set({ primaryTriads: primaryChords });
    },

    addChordToProgression: (chord: Chord, insertIndex?: number) => {
        const current = get().currentProgression;
        if (!current) {
            set({
                currentProgression: {
                    id: `prog-manual-${Date.now()}`,
                    chords: [chord],
                    timestamp: Date.now()
                }
            });
            return;
        }

        const newChords = [...current.chords];
        if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= newChords.length) {
            newChords.splice(insertIndex, 0, chord);
        } else {
            newChords.push(chord);
        }

        set({
            currentProgression: {
                ...current,
                chords: newChords
            }
        });
    },

    removeChord: (index: number) => {
        const current = get().currentProgression;
        if (!current) return;

        const newChords = [...current.chords];
        newChords.splice(index, 1);

        set({
            currentProgression: {
                ...current,
                chords: newChords
            }
        });
    },

    reorderChords: (startIndex: number, endIndex: number) => {
        const current = get().currentProgression;
        if (!current) return;

        const newChords = Array.from(current.chords);
        const [reorderedItem] = newChords.splice(startIndex, 1);
        newChords.splice(endIndex, 0, reorderedItem);

        set({
            currentProgression: {
                ...current,
                chords: newChords
            }
        });
    },

    toggleChordLock: (index: number) => {
        const current = get().currentProgression;
        if (!current || !current.chords[index]) return;

        const newChords = [...current.chords];
        newChords[index] = {
            ...newChords[index],
            isLocked: !newChords[index].isLocked
        };

        set({
            currentProgression: {
                ...current,
                chords: newChords
            }
        });
    },

    refreshChord: (index: number) => {
        const { rootKey, mode, depth, currentProgression } = get();
        if (!currentProgression || !currentProgression.chords[index]) return;
        const rootPC = normalizeToPitchClass(rootKey) || "C";

        // Generate a small batch and pick a random new chord (skipping the first tonic one)
        const generated = generateProgression({
            rootKey: rootPC,
            mode,
            depth,
            numChords: 5,
        });
        const gc = generated[Math.floor(Math.random() * 4) + 1];

        const modeToScaleType: Record<Mode, ScaleType> = {
            ionian: "major",
            aeolian: "natural_minor",
            dorian: "dorian",
            mixolydian: "mixolydian",
            phrygian: "phrygian",
        };
        const scale = getScaleDefinition(rootPC, modeToScaleType[mode]);
        const degreeIndex = DEGREE_MAP[gc.degree] ?? 0;
        const rootOfChord = scale.pitchClasses[degreeIndex];
        const triad = buildTriadFromRoot(rootOfChord, gc.quality);
        const symbol = formatChordSymbol(rootOfChord, gc.quality);

        const newChord: Chord = {
            symbol,
            notes: triad.pitchClasses,
            romanNumeral: gc.degree,
            root: rootOfChord,
            quality: gc.quality as any,
            isLocked: false,
        };

        const newChords = [...currentProgression.chords];
        newChords[index] = newChord;

        set({
            currentProgression: {
                ...currentProgression,
                chords: newChords
            }
        });
    },

    setChordQuality: (index: number, quality: string) => {
        const { currentProgression } = get();
        if (!currentProgression || !currentProgression.chords[index]) return;

        const chord = currentProgression.chords[index];
        if (!chord.root) return; // Only diatonic chords with rooted properties can be modified easily

        // Validate generic compatibility to reconstruct the note arrays without calling full AI API
        const triad = buildTriadFromRoot(chord.root, quality);
        const symbol = formatChordSymbol(chord.root, quality);

        const newChords = [...currentProgression.chords];
        newChords[index] = {
            ...chord,
            symbol,
            quality: quality as any,
            notes: triad.pitchClasses
        };

        set({
            currentProgression: {
                ...currentProgression,
                chords: newChords
            }
        });
    },

    generateNew: () => {
        const { rootKey, mode, depth, numChords } = get();
        const rootPC = normalizeToPitchClass(rootKey) || "C";

        const generated = generateProgression({
            rootKey: rootPC,
            mode,
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
        const current = get().currentProgression;

        const chords: Chord[] = generated.map((gc, i) => {
            // Keep locked chords from the old progression at the same index
            if (current && current.chords[i] && current.chords[i].isLocked) {
                return current.chords[i];
            }

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
