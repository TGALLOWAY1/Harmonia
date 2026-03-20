import { create } from "zustand";
import type { Progression, Chord } from "../theory/progressionTypes";
import type { Mode } from "../theory/harmonyEngine";
import { midiToPitchClass, midiToNoteName, normalizeToPitchClass, type PitchClass } from "../theory/midiUtils";
import { progressionToMidi, melodyToMidi } from "../progressionMidiExport";
import { generateAdvancedProgression } from "../music/generators/advanced/generateAdvancedProgression";
import type { AdvancedProgressionOptions, VoicingStyle, VoiceCount } from "../music/generators/advanced/types";
import type { ChordSourceType, SubstitutionOption } from "../creative/types";
import { getSubstitutions } from "../creative/substitutionEngine";
import { interpretChord } from "../creative/chordInterpreter";
import { generateMelody } from "../music/generators/melody/generateMelody";
import type { Melody, MelodyNote, MelodyStyle } from "../music/generators/melody/types";
import { getScaleDefinition } from "../theory/scale";
import type { ScaleType } from "../theory/types";

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

    // Voicing settings
    voicingStyle: VoicingStyle;
    voiceCount: VoiceCount;

    // Creative iteration state
    chordSourceTypes: ChordSourceType[];
    originalChords: Map<number, Chord>;     // Original chord data for revert, keyed by index
    substitutionTarget: number | null;       // Index of chord being substituted
    substitutionOptions: SubstitutionOption[];
    // Melody state
    melody: Melody | null;
    melodyEnabled: boolean;
    melodyStyle: MelodyStyle;

    setSettings: (settings: Partial<Pick<ProgressionState, "rootKey" | "mode" | "complexity" | "numChords" | "bpm" | "voicingStyle" | "voiceCount">>) => void;
    generateNew: () => void;
    toggleLock: (index: number) => void;
    deleteChord: (index: number) => void;
    shiftNote: (chordIndex: number, midiNote: number, direction: "up" | "down") => void;
    setIsPlaying: (playing: boolean) => void;
    addToHistory: (progression: Progression) => void;
    exportMidi: () => void;
    exportMelodyMidi: () => void;
    loadProgression: (progression: Progression) => void;

    // Creative iteration actions
    openSubstitution: (chordIndex: number) => void;
    closeSubstitution: () => void;
    applySubstitution: (option: SubstitutionOption, chordIndex: number) => void;
    revertChord: (chordIndex: number) => void;
    addNote: (chordIndex: number, midi: number) => void;
    removeNote: (chordIndex: number, midi: number) => void;
    moveNote: (chordIndex: number, fromMidi: number, toMidi: number) => void;
    resetChord: (chordIndex: number) => void;

    // Melody actions
    setMelodyEnabled: (enabled: boolean) => void;
    setMelodyStyle: (style: MelodyStyle) => void;
    generateMelodyForProgression: () => void;
    clearMelody: () => void;
    addMelodyNote: (note: MelodyNote) => void;
    moveMelodyNote: (noteId: string, newMidi: number, newStartBeat: number) => void;
    resizeMelodyNote: (noteId: string, newDurationBeats: number) => void;
    deleteMelodyNote: (noteId: string) => void;
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

    // Voicing defaults
    voicingStyle: "auto",
    voiceCount: 4,

    // Creative iteration initial state
    chordSourceTypes: [],
    originalChords: new Map(),
    substitutionTarget: null,
    substitutionOptions: [],
    // Melody initial state
    melody: null,
    melodyEnabled: false,
    melodyStyle: "lyrical",

    setSettings: (settings) => {
        set((state) => ({ ...state, ...settings }));
    },

    generateNew: () => {
        const { rootKey, mode, complexity, numChords, voicingStyle, voiceCount, currentProgression } = get();
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
            voicingStyle,
            voiceCount,
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

        const sourceTypes: ChordSourceType[] = chords.map((c, i) =>
            lockedByIndex.has(i) ? (get().chordSourceTypes[i] ?? "generated") : "generated"
        );

        set({
            currentProgression: progression,
            chordSourceTypes: sourceTypes,
            originalChords: new Map(),
            substitutionTarget: null,
            substitutionOptions: [],
            melody: null,
        });
        get().addToHistory(progression);
        if (get().melodyEnabled) {
            get().generateMelodyForProgression();
        }
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

    exportMelodyMidi: () => {
        const { melody, bpm, rootKey, mode } = get();
        if (!melody || melody.notes.length === 0) return;

        const blob = melodyToMidi(melody.notes, bpm);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `harmonia-melody-${rootKey}-${mode}-${Date.now()}.mid`;
        a.click();
        URL.revokeObjectURL(url);
    },

    loadProgression: (progression: Progression) => {
        const sourceTypes: ChordSourceType[] = progression.chords.map(() => "generated");
        set({
            currentProgression: progression,
            chordSourceTypes: sourceTypes,
            originalChords: new Map(),
            substitutionTarget: null,
            substitutionOptions: [],
            melody: null,
        });
        if (get().melodyEnabled) {
            get().generateMelodyForProgression();
        }
    },

    // ─── Creative Iteration Actions ───

    openSubstitution: (chordIndex: number) => {
        const { currentProgression, rootKey, mode } = get();
        if (!currentProgression) return;

        const chord = currentProgression.chords[chordIndex];
        if (!chord) return;

        const rootPC = (normalizeToPitchClass(rootKey) || "C") as PitchClass;
        const options = getSubstitutions(chord, chordIndex, currentProgression.chords, rootPC, mode);

        set({
            substitutionTarget: chordIndex,
            substitutionOptions: options,
        });
    },

    closeSubstitution: () => {
        set({
            substitutionTarget: null,
            substitutionOptions: [],
        });
    },

    applySubstitution: (option: SubstitutionOption, chordIndex: number) => {
        const { currentProgression, chordSourceTypes, originalChords } = get();
        if (!currentProgression) return;

        // Save original chord for revert
        const newOriginals = new Map(originalChords);
        if (!newOriginals.has(chordIndex)) {
            newOriginals.set(chordIndex, { ...currentProgression.chords[chordIndex] });
        }

        const newChord: Chord = {
            symbol: option.candidateSymbol,
            root: option.candidateRoot,
            quality: option.candidateQuality as Chord["quality"],
            notes: option.candidateNotes,
            romanNumeral: option.candidateRomanNumeral,
            midiNotes: option.candidateMidiNotes,
            notesWithOctave: option.candidateNotesWithOctave,
            isLocked: currentProgression.chords[chordIndex].isLocked,
            durationClass: currentProgression.chords[chordIndex].durationClass,
        };

        const chords = currentProgression.chords.map((c, i) =>
            i === chordIndex ? newChord : c
        );

        const newSourceTypes = [...chordSourceTypes];
        while (newSourceTypes.length < chords.length) newSourceTypes.push("generated");
        newSourceTypes[chordIndex] = "substituted";

        set({
            currentProgression: { ...currentProgression, chords },
            chordSourceTypes: newSourceTypes,
            originalChords: newOriginals,
            substitutionTarget: null,
            substitutionOptions: [],
        });
    },

    revertChord: (chordIndex: number) => {
        const { currentProgression, originalChords, chordSourceTypes } = get();
        if (!currentProgression) return;

        const original = originalChords.get(chordIndex);
        if (!original) return;

        const chords = currentProgression.chords.map((c, i) =>
            i === chordIndex ? { ...original } : c
        );

        const newOriginals = new Map(originalChords);
        newOriginals.delete(chordIndex);

        const newSourceTypes = [...chordSourceTypes];
        newSourceTypes[chordIndex] = "generated";

        set({
            currentProgression: { ...currentProgression, chords },
            originalChords: newOriginals,
            chordSourceTypes: newSourceTypes,
        });
    },

    addNote: (chordIndex: number, midi: number) => {
        const { currentProgression, chordSourceTypes } = get();
        if (!currentProgression) return;

        const chord = currentProgression.chords[chordIndex];
        if (!chord || !chord.midiNotes) return;

        // Don't add if already exists
        if (chord.midiNotes.includes(midi)) return;

        const newMidiNotes = [...chord.midiNotes, midi].sort((a, b) => a - b);
        const newNotesWithOctave = newMidiNotes.map(m => midiToNoteName(m));
        const newNotes = [...new Set(newMidiNotes.map(m => midiToPitchClass(m)))];

        // Re-interpret chord
        const interpretation = interpretChord(newMidiNotes);

        const updatedChord: Chord = {
            ...chord,
            midiNotes: newMidiNotes,
            notesWithOctave: newNotesWithOctave,
            notes: newNotes,
            symbol: interpretation.isCustomVoicing && interpretation.customLabel
                ? interpretation.customLabel
                : interpretation.symbol,
        };

        const chords = currentProgression.chords.map((c, i) =>
            i === chordIndex ? updatedChord : c
        );

        const newSourceTypes = [...chordSourceTypes];
        while (newSourceTypes.length < chords.length) newSourceTypes.push("generated");
        newSourceTypes[chordIndex] = "manual";

        set({
            currentProgression: { ...currentProgression, chords },
            chordSourceTypes: newSourceTypes,
        });
    },

    removeNote: (chordIndex: number, midi: number) => {
        const { currentProgression, chordSourceTypes } = get();
        if (!currentProgression) return;

        const chord = currentProgression.chords[chordIndex];
        if (!chord || !chord.midiNotes) return;

        const newMidiNotes = chord.midiNotes.filter(m => m !== midi);
        if (newMidiNotes.length === 0) return; // Don't remove last note

        const newNotesWithOctave = newMidiNotes.map(m => midiToNoteName(m));
        const newNotes = [...new Set(newMidiNotes.map(m => midiToPitchClass(m)))];

        const interpretation = interpretChord(newMidiNotes);

        const updatedChord: Chord = {
            ...chord,
            midiNotes: newMidiNotes,
            notesWithOctave: newNotesWithOctave,
            notes: newNotes,
            symbol: interpretation.isCustomVoicing && interpretation.customLabel
                ? interpretation.customLabel
                : interpretation.symbol,
        };

        const chords = currentProgression.chords.map((c, i) =>
            i === chordIndex ? updatedChord : c
        );

        const newSourceTypes = [...chordSourceTypes];
        while (newSourceTypes.length < chords.length) newSourceTypes.push("generated");
        newSourceTypes[chordIndex] = "manual";

        set({
            currentProgression: { ...currentProgression, chords },
            chordSourceTypes: newSourceTypes,
        });
    },

    moveNote: (chordIndex: number, fromMidi: number, toMidi: number) => {
        const { currentProgression, chordSourceTypes } = get();
        if (!currentProgression) return;

        const chord = currentProgression.chords[chordIndex];
        if (!chord || !chord.midiNotes) return;

        const noteIdx = chord.midiNotes.indexOf(fromMidi);
        if (noteIdx === -1) return;

        // Don't move to a position that already has a note
        if (chord.midiNotes.includes(toMidi)) return;

        const newMidiNotes = [...chord.midiNotes];
        newMidiNotes[noteIdx] = toMidi;
        newMidiNotes.sort((a, b) => a - b);

        const newNotesWithOctave = newMidiNotes.map(m => midiToNoteName(m));
        const newNotes = [...new Set(newMidiNotes.map(m => midiToPitchClass(m)))];

        const interpretation = interpretChord(newMidiNotes);

        const updatedChord: Chord = {
            ...chord,
            midiNotes: newMidiNotes,
            notesWithOctave: newNotesWithOctave,
            notes: newNotes,
            symbol: interpretation.isCustomVoicing && interpretation.customLabel
                ? interpretation.customLabel
                : interpretation.symbol,
        };

        const chords = currentProgression.chords.map((c, i) =>
            i === chordIndex ? updatedChord : c
        );

        const newSourceTypes = [...chordSourceTypes];
        while (newSourceTypes.length < chords.length) newSourceTypes.push("generated");
        newSourceTypes[chordIndex] = "manual";

        set({
            currentProgression: { ...currentProgression, chords },
            chordSourceTypes: newSourceTypes,
        });
    },

    resetChord: (chordIndex: number) => {
        const { originalChords } = get();
        const original = originalChords.get(chordIndex);
        if (original) {
            get().revertChord(chordIndex);
        }
    },

    // ─── Melody Actions ───

    setMelodyEnabled: (enabled: boolean) => {
        set({ melodyEnabled: enabled });
        if (enabled && !get().melody && get().currentProgression) {
            get().generateMelodyForProgression();
        }
        if (!enabled) {
            set({ melody: null });
        }
    },

    setMelodyStyle: (style: MelodyStyle) => {
        set({ melodyStyle: style });
        if (get().melodyEnabled && get().currentProgression) {
            get().generateMelodyForProgression();
        }
    },

    generateMelodyForProgression: () => {
        const { currentProgression, rootKey, mode, melodyStyle } = get();
        if (!currentProgression) return;

        const rootPC = (normalizeToPitchClass(rootKey) || "C") as PitchClass;
        const MODE_TO_SCALE: Record<Mode, ScaleType> = {
            ionian: "major",
            aeolian: "natural_minor",
            dorian: "dorian",
            mixolydian: "mixolydian",
            phrygian: "phrygian",
        };
        const scaleType = MODE_TO_SCALE[mode] ?? "major";
        const scale = getScaleDefinition(rootPC, scaleType);

        const chords = currentProgression.chords.map((c) => ({
            midiNotes: c.midiNotes ?? [],
            pitchClasses: (c.notes ?? []) as PitchClass[],
            root: (c.root ?? c.notes[0] ?? "C") as PitchClass,
            durationClass: c.durationClass,
        }));

        const melody = generateMelody({
            scalePitchClasses: scale.pitchClasses,
            chords,
            style: melodyStyle,
            octave: 5,
        });

        set({ melody });
    },

    clearMelody: () => {
        set({ melody: null, melodyEnabled: false });
    },

    addMelodyNote: (note: MelodyNote) => {
        const { melody } = get();
        if (!melody) {
            set({ melody: { notes: [note], octave: 5 } });
            return;
        }
        set({ melody: { ...melody, notes: [...melody.notes, note] } });
    },

    moveMelodyNote: (noteId: string, newMidi: number, newStartBeat: number) => {
        const { melody } = get();
        if (!melody) return;
        const notes = melody.notes.map((n) => {
            if (n.id !== noteId) return n;
            const noteWithOctave = midiToNoteName(newMidi);
            const pitchClass = midiToPitchClass(newMidi);
            return { ...n, midi: newMidi, noteWithOctave, pitchClass, startBeat: newStartBeat };
        });
        set({ melody: { ...melody, notes } });
    },

    resizeMelodyNote: (noteId: string, newDurationBeats: number) => {
        const { melody } = get();
        if (!melody) return;
        const clamped = Math.max(0.25, newDurationBeats);
        const notes = melody.notes.map((n) =>
            n.id === noteId ? { ...n, durationBeats: clamped } : n
        );
        set({ melody: { ...melody, notes } });
    },

    deleteMelodyNote: (noteId: string) => {
        const { melody } = get();
        if (!melody) return;
        const notes = melody.notes.filter((n) => n.id !== noteId);
        set({ melody: { ...melody, notes } });
    },
}));
