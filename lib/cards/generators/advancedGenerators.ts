/**
 * Advanced Card Generators
 * 
 * Generates CardTemplateSeed objects for advanced flashcard kinds.
 * These generators produce consistent meta definitions that can be used
 * to seed CardTemplate records in the database.
 */

import type { PitchClass } from "../../theory/midiUtils";
import type { ScaleType } from "../../theory/types";
import type { AdvancedCardKind } from "../cardKinds";
import type {
  ScaleSpellingMeta,
  DiatonicChordIdMeta,
  DegreeToChordMeta,
  ChordToDegreeMeta,
  ModeCharacterMeta,
  ProgressionPredictionMeta,
  TensionSelectionMeta,
} from "../advancedCardMeta";

import {
  getScaleDefinition,
} from "../../theory/scale";
import {
  getDiatonicChords,
  formatChordSymbol,
} from "../../theory/chord";

/**
 * Seed data structure for card templates
 * This represents the data needed to create a CardTemplate record
 */
export type CardTemplateSeed = {
  kind: AdvancedCardKind;
  milestoneKey: string;
  prompt: string; // The question text
  meta:
    | ScaleSpellingMeta
    | DiatonicChordIdMeta
    | DegreeToChordMeta
    | ChordToDegreeMeta
    | ModeCharacterMeta
    | ProgressionPredictionMeta
    | TensionSelectionMeta;
};

// Common pitch classes for generating cards
const COMMON_ROOTS: PitchClass[] = [
  "C",
  "D",
  "E",
  "F",
  "G",
  "A",
  "B",
  "C#",
  "D#",
  "F#",
  "G#",
  "A#",
];


/**
 * Format pitch classes as a readable string
 * @param notes - Array of pitch classes
 * @returns Formatted string like "C – E – G"
 */
function formatNotes(notes: PitchClass[]): string {
  return notes.join(" – ");
}

/**
 * Format scale type for display
 * @param type - Scale type
 * @returns Human-readable scale name
 */
function formatScaleType(type: ScaleType): string {
  switch (type) {
    case "major":
      return "major";
    case "natural_minor":
      return "natural minor";
    case "dorian":
      return "Dorian";
    case "mixolydian":
      return "Mixolydian";
    case "phrygian":
      return "Phrygian";
  }
}

/**
 * Format key name for display
 * @param root - Key root
 * @param type - Key type
 * @returns Formatted key name like "C major" or "A minor"
 */
function formatKeyName(root: PitchClass, type: "major" | "natural_minor"): string {
  const typeName = type === "major" ? "major" : "minor";
  return `${root} ${typeName}`;
}

/**
 * Generate scale spelling card templates
 * Question: "What are the notes of [root] [type] scale?"
 * Options: Different note sequences
 */
export function generateScaleSpellingTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  const scaleTypes: ScaleType[] = ["major", "natural_minor", "dorian", "mixolydian", "phrygian"];

  for (const root of COMMON_ROOTS) {
    for (const scaleType of scaleTypes) {
      // Determine milestone key based on scale type
      let milestoneKey: string;
      if (scaleType === "major") {
        milestoneKey = "FOUNDATION";
      } else if (scaleType === "natural_minor") {
        milestoneKey = "NATURAL_MINOR";
      } else {
        milestoneKey = "MODES";
      }

      templates.push({
        kind: "scale_spelling",
        milestoneKey,
        prompt: `What are the notes of the ${root} ${formatScaleType(scaleType)} scale?`,
        meta: {
          root,
          type: scaleType,
          keyRoot: root,
          keyType: scaleType,
        } as ScaleSpellingMeta,
      });
    }
  }

  return templates;
}

/**
 * Generate diatonic chord ID card templates
 * Question: "Which diatonic chord in [key] is [notes]?"
 * Options: Roman numerals like "I", "ii", "iii", "IV", "V", "vi", "vii°"
 */
export function generateDiatonicChordIdTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  const keyTypes: ("major" | "natural_minor")[] = ["major", "natural_minor"];

  for (const keyRoot of COMMON_ROOTS) {
    for (const keyType of keyTypes) {
      const diatonicSet = getDiatonicChords(keyRoot, keyType);

      for (const diatonicTriad of diatonicSet.triads) {
        templates.push({
          kind: "diatonic_chord_id",
          milestoneKey: "DIATONIC_TRIADS",
          prompt: `In the key of ${formatKeyName(keyRoot, keyType)}, which chord is ${formatNotes(diatonicTriad.triad.pitchClasses)}?`,
          meta: {
            keyRoot,
            keyType,
            degree: diatonicTriad.degree,
            notes: diatonicTriad.triad.pitchClasses,
          } as DiatonicChordIdMeta,
        });
      }
    }
  }

  return templates;
}

/**
 * Generate degree to chord card templates
 * Question: "What chord is [degree] in [key]?"
 * Options: Chord names like "C major", "D minor", etc.
 */
export function generateDegreeToChordTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  const keyTypes: ("major" | "natural_minor")[] = ["major", "natural_minor"];

  for (const keyRoot of COMMON_ROOTS) {
    for (const keyType of keyTypes) {
      const diatonicSet = getDiatonicChords(keyRoot, keyType);

      for (const diatonicTriad of diatonicSet.triads) {
        const chordSymbol = formatChordSymbol(
          diatonicTriad.triad.root,
          diatonicTriad.triad.quality
        );
        
        // Format chord name (e.g., "C major", "D minor")
        const qualityName = diatonicTriad.triad.quality === "maj" ? "major" : 
                           diatonicTriad.triad.quality === "min" ? "minor" :
                           diatonicTriad.triad.quality === "dim" ? "diminished" : "augmented";
        const chordName = `${diatonicTriad.triad.root} ${qualityName}`;

        templates.push({
          kind: "degree_to_chord",
          milestoneKey: "DIATONIC_TRIADS",
          prompt: `What chord is ${diatonicTriad.degree} in the key of ${formatKeyName(keyRoot, keyType)}?`,
          meta: {
            keyRoot,
            keyType,
            degree: diatonicTriad.degree,
            correctChord: chordName,
          } as DegreeToChordMeta,
        });
      }
    }
  }

  return templates;
}

/**
 * Generate chord to degree card templates
 * Question: "What is [chord] in [key]?"
 * Options: Roman numerals like "I", "ii", "iii", "IV", "V", "vi", "vii°"
 */
export function generateChordToDegreeTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  const keyTypes: ("major" | "natural_minor")[] = ["major", "natural_minor"];

  for (const keyRoot of COMMON_ROOTS) {
    for (const keyType of keyTypes) {
      const diatonicSet = getDiatonicChords(keyRoot, keyType);

      for (const diatonicTriad of diatonicSet.triads) {
        const qualityName = diatonicTriad.triad.quality === "maj" ? "major" : 
                           diatonicTriad.triad.quality === "min" ? "minor" :
                           diatonicTriad.triad.quality === "dim" ? "diminished" : "augmented";
        const chordName = `${diatonicTriad.triad.root} ${qualityName}`;

        templates.push({
          kind: "chord_to_degree",
          milestoneKey: "DIATONIC_TRIADS",
          prompt: `What is ${chordName} in the key of ${formatKeyName(keyRoot, keyType)}?`,
          meta: {
            keyRoot,
            keyType,
            chord: chordName,
            correctDegree: diatonicTriad.degree,
          } as ChordToDegreeMeta,
        });
      }
    }
  }

  return templates;
}

/**
 * Generate mode character card templates
 * Question: "What is the characteristic note/interval of [mode]?"
 * Options: Descriptions like "Raised 6th", "Lowered 7th", "Lowered 2nd", etc.
 */
export function generateModeCharacterTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  
  // Mode characteristics compared to natural minor
  const modeCharacteristics: Array<{
    mode: ScaleType;
    root: PitchClass;
    characteristic: string;
  }> = [
    { mode: "dorian", root: "D", characteristic: "Raised 6th" },
    { mode: "mixolydian", root: "G", characteristic: "Lowered 7th" },
    { mode: "phrygian", root: "E", characteristic: "Lowered 2nd" },
  ];

  // Also generate for other common roots
  const additionalRoots: PitchClass[] = ["A", "C", "F"];
  
  for (const char of modeCharacteristics) {
    templates.push({
      kind: "mode_character",
      milestoneKey: "MODES",
      prompt: `What is the characteristic feature of the ${formatScaleType(char.mode)} mode?`,
      meta: {
        mode: char.mode,
        root: char.root,
        characteristic: char.characteristic,
        keyRoot: char.root,
        keyType: char.mode,
      } as ModeCharacterMeta,
    });

    // Generate for additional roots
    for (const root of additionalRoots) {
      templates.push({
        kind: "mode_character",
        milestoneKey: "MODES",
        prompt: `What is the characteristic feature of the ${root} ${formatScaleType(char.mode)} mode?`,
        meta: {
          mode: char.mode,
          root,
          characteristic: char.characteristic,
          keyRoot: root,
          keyType: char.mode,
        } as ModeCharacterMeta,
      });
    }
  }

  return templates;
}

/**
 * Generate progression prediction card templates
 * Question: "In [key], after [currentChords], what chord typically comes next?"
 * Options: Roman numerals like "I", "ii", "iii", "IV", "V", "vi", "vii°"
 */
export function generateProgressionPredictionTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  const keyTypes: ("major" | "natural_minor")[] = ["major", "natural_minor"];

  // Common progression patterns: [current chords] -> next chord
  const progressionPatterns: Array<{
    current: string[];
    next: string;
    description?: string;
  }> = [
    { current: ["I", "vi"], next: "IV" }, // I-vi-IV-V
    { current: ["ii", "V"], next: "I" }, // ii-V-I
    { current: ["I", "V"], next: "vi" }, // I-V-vi-IV
    { current: ["vi", "IV"], next: "I" }, // vi-IV-I-V
    { current: ["I", "V", "vi"], next: "IV" }, // I-V-vi-IV
    { current: ["IV", "V"], next: "I" }, // IV-V-I
    { current: ["I", "IV"], next: "V" }, // I-IV-V
    { current: ["vi", "V"], next: "I" }, // vi-V-I
  ];

  for (const keyRoot of COMMON_ROOTS) {
    for (const keyType of keyTypes) {
      for (const pattern of progressionPatterns) {
        const currentChordsStr = pattern.current.join(" – ");
        
        templates.push({
          kind: "progression_prediction",
          milestoneKey: "DIATONIC_TRIADS",
          prompt: `In the key of ${formatKeyName(keyRoot, keyType)}, after ${currentChordsStr}, what chord typically comes next?`,
          meta: {
            keyRoot,
            keyType,
            currentChords: pattern.current,
            correctNext: pattern.next,
          } as ProgressionPredictionMeta,
        });
      }
    }
  }

  return templates;
}

/**
 * Generate tension selection card templates
 * Question: "Which tension works best over [chord] in [key]?"
 * Options: Tension descriptions like "9th", "11th", "13th", "b9", "#11", etc.
 */
export function generateTensionSelectionTemplates(): CardTemplateSeed[] {
  const templates: CardTemplateSeed[] = [];
  const keyTypes: ("major" | "natural_minor")[] = ["major", "natural_minor"];

  // Common tensions for different chord types
  // This is a simplified mapping - in reality, tensions depend on chord function
  const tensionMap: Record<string, string> = {
    "I": "9th", // Major tonic often takes 9th
    "IV": "9th", // Subdominant often takes 9th
    "V": "b9", // Dominant often takes b9 or #11
    "vi": "9th", // Minor submediant often takes 9th
    "ii": "9th", // Minor supertonic often takes 9th
  };

  for (const keyRoot of COMMON_ROOTS) {
    for (const keyType of keyTypes) {
      const diatonicSet = getDiatonicChords(keyRoot, keyType);

      for (const diatonicTriad of diatonicSet.triads) {
        // Skip diminished chords for now (they have more complex tension rules)
        if (diatonicTriad.triad.quality === "dim") {
          continue;
        }

        const qualityName = diatonicTriad.triad.quality === "maj" ? "major" : "minor";
        const chordName = `${diatonicTriad.triad.root} ${qualityName}`;
        
        // Get appropriate tension (default to 9th if not in map)
        const tension = tensionMap[diatonicTriad.degree] || "9th";

        templates.push({
          kind: "tension_selection",
          milestoneKey: "SEVENTH_CHORDS", // Tensions are advanced, so use SEVENTH_CHORDS milestone
          prompt: `Which tension works best over ${chordName} (${diatonicTriad.degree}) in the key of ${formatKeyName(keyRoot, keyType)}?`,
          meta: {
            keyRoot,
            keyType,
            chord: chordName,
            degree: diatonicTriad.degree,
            correctTension: tension,
          } as TensionSelectionMeta,
        });
      }
    }
  }

  return templates;
}

/**
 * Generate all advanced card templates
 * @returns Array of all CardTemplateSeed objects for advanced card kinds
 */
export function generateAllAdvancedTemplates(): CardTemplateSeed[] {
  return [
    ...generateScaleSpellingTemplates(),
    ...generateDiatonicChordIdTemplates(),
    ...generateDegreeToChordTemplates(),
    ...generateChordToDegreeTemplates(),
    ...generateModeCharacterTemplates(),
    ...generateProgressionPredictionTemplates(),
    ...generateTensionSelectionTemplates(),
  ];
}

