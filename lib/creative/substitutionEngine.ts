/**
 * Chord Substitution Engine
 *
 * Generates theory-approved substitution options for a selected chord
 * based on its harmonic role, the current key, and music theory rules.
 */

import { PITCH_CLASSES, type PitchClass, pitchClassToMidi, midiToNoteName } from "../theory/midiUtils";
import { buildTriadFromRoot, buildSeventhFromRoot, formatChordSymbol, getDiatonicChords } from "../theory/chord";
import type { ScaleType } from "../theory/types";
import type { Mode } from "../theory/harmonyEngine";
import type { SubstitutionOption, SubstitutionCategory } from "./types";
import type { Chord } from "../theory/progressionTypes";

function transposePitchClass(root: PitchClass, semitones: number): PitchClass {
  const index = PITCH_CLASSES.indexOf(root);
  return PITCH_CLASSES[(index + semitones + 120) % 12];
}

function semitonesBetween(from: PitchClass, to: PitchClass): number {
  return (PITCH_CLASSES.indexOf(to) - PITCH_CLASSES.indexOf(from) + 12) % 12;
}

function modeToScaleType(mode: Mode): ScaleType {
  switch (mode) {
    case "ionian": return "major";
    case "aeolian": return "natural_minor";
    case "dorian": return "dorian";
    case "mixolydian": return "mixolydian";
    case "phrygian": return "phrygian";
    default: return "major";
  }
}

/** Voice the candidate chord's pitch classes into MIDI in a similar register to the source chord. */
function voiceNearSource(candidatePcs: PitchClass[], sourceMidiNotes: number[]): { midi: number[]; notesWithOctave: string[] } {
  if (!sourceMidiNotes || sourceMidiNotes.length === 0) {
    const midi = candidatePcs.map(pc => pitchClassToMidi(pc, 3));
    return { midi, notesWithOctave: midi.map(m => midiToNoteName(m)) };
  }

  const avgSourceMidi = sourceMidiNotes.reduce((s, n) => s + n, 0) / sourceMidiNotes.length;
  const targetOctave = Math.round(avgSourceMidi / 12) - 1;

  const midi = candidatePcs.map(pc => {
    const base = pitchClassToMidi(pc, targetOctave);
    // Keep within reasonable range of the source
    if (base < avgSourceMidi - 12) return base + 12;
    if (base > avgSourceMidi + 12) return base - 12;
    return base;
  });

  midi.sort((a, b) => a - b);
  return { midi, notesWithOctave: midi.map(m => midiToNoteName(m)) };
}

let subIdCounter = 0;
function makeSubId(): string {
  return `sub-${++subIdCounter}-${Date.now()}`;
}

/**
 * Find the diatonic degree index (0-6) of a chord root within a scale.
 * Returns -1 if the root is not diatonic.
 */
function findDegreeIndex(root: PitchClass, keyRoot: PitchClass, mode: Mode): number {
  const scaleType = modeToScaleType(mode);
  const chordSet = getDiatonicChords(keyRoot, scaleType);
  for (let i = 0; i < chordSet.triads.length; i++) {
    if (chordSet.triads[i].triad.root === root) return i;
  }
  return -1;
}

/**
 * Determine if a chord is likely functioning as a dominant.
 */
function isDominantFunction(chord: Chord, keyRoot: PitchClass, mode: Mode): boolean {
  const degree = findDegreeIndex(chord.root ?? chord.notes[0] as PitchClass, keyRoot, mode);
  // V chord in major, or any dom7 chord
  if (degree === 4) return true;
  if (chord.quality === "dom7" || chord.quality === "7") return true;
  if (chord.symbol.endsWith("7") && !chord.symbol.includes("maj7") && !chord.symbol.includes("m7")) return true;
  return false;
}

/**
 * Generate substitution options for a given chord within its progression context.
 */
export function getSubstitutions(
  chord: Chord,
  chordIndex: number,
  allChords: Chord[],
  keyRoot: PitchClass,
  mode: Mode,
): SubstitutionOption[] {
  const chordRoot = (chord.root ?? chord.notes[0]) as PitchClass;
  const chordId = `chord-${chordIndex}`;
  const sourceMidi = chord.midiNotes ?? [];
  const scaleType = modeToScaleType(mode);
  const diatonicSet = getDiatonicChords(keyRoot, scaleType);

  const options: SubstitutionOption[] = [];

  // ── 1. Diatonic alternatives ──
  // All diatonic chords that share at least one pitch class with the selected chord
  const chordPcs = new Set(chord.notes.map(n => n as PitchClass));

  for (let i = 0; i < diatonicSet.triads.length; i++) {
    const triad = diatonicSet.triads[i];
    const seventh = diatonicSet.sevenths[i];

    // Skip if it's the same root
    if (triad.triad.root === chordRoot) continue;

    const triadSym = formatChordSymbol(triad.triad.root, triad.triad.quality);
    const sharedNotes = triad.triad.pitchClasses.filter(pc => chordPcs.has(pc));
    if (sharedNotes.length >= 1) {
      const voiced = voiceNearSource(triad.triad.pitchClasses, sourceMidi);

      options.push({
        id: makeSubId(),
        sourceChordId: chordId,
        candidateSymbol: triadSym,
        candidateRoot: triad.triad.root,
        candidateQuality: triad.triad.quality,
        candidateNotes: triad.triad.pitchClasses,
        candidateMidiNotes: voiced.midi,
        candidateNotesWithOctave: voiced.notesWithOctave,
        candidateRomanNumeral: triad.degree,
        category: "diatonic",
        reason: `Shares ${sharedNotes.length} note${sharedNotes.length > 1 ? "s" : ""} (${sharedNotes.join(", ")}) — diatonic ${triad.degree} in ${keyRoot} ${mode}`,
        confidenceScore: 0.5 + sharedNotes.length * 0.15,
      });
    }

    // Also offer seventh chord version if different
    const seventhSym = formatChordSymbol(seventh.seventh.root, seventh.seventh.quality);
    if (seventhSym !== triadSym) {
      const sharedSeventh = seventh.seventh.pitchClasses.filter(pc => chordPcs.has(pc));
      if (sharedSeventh.length >= 1) {
        const voiced7 = voiceNearSource(seventh.seventh.pitchClasses, sourceMidi);
        options.push({
          id: makeSubId(),
          sourceChordId: chordId,
          candidateSymbol: seventhSym,
          candidateRoot: seventh.seventh.root,
          candidateQuality: seventh.seventh.quality,
          candidateNotes: seventh.seventh.pitchClasses,
          candidateMidiNotes: voiced7.midi,
          candidateNotesWithOctave: voiced7.notesWithOctave,
          candidateRomanNumeral: `${seventh.degree}7`,
          category: "diatonic",
          reason: `${seventh.degree} seventh chord — adds color while staying diatonic`,
          confidenceScore: 0.45 + sharedSeventh.length * 0.12,
        });
      }
    }
  }

  // ── 2. Relative major/minor substitution ──
  {
    const relativeInterval = (mode === "aeolian" || mode === "dorian" || mode === "phrygian") ? 3 : 9;
    const relativeRoot = transposePitchClass(chordRoot, relativeInterval);
    const relativeQuality = (mode === "aeolian" || mode === "dorian" || mode === "phrygian") ? "maj" : "min";
    const builtChord = buildTriadFromRoot(relativeRoot, relativeQuality);
    const sym = formatChordSymbol(relativeRoot, relativeQuality);
    const voiced = voiceNearSource(builtChord.pitchClasses, sourceMidi);

    options.push({
      id: makeSubId(),
      sourceChordId: chordId,
      candidateSymbol: sym,
      candidateRoot: relativeRoot,
      candidateQuality: relativeQuality,
      candidateNotes: builtChord.pitchClasses,
      candidateMidiNotes: voiced.midi,
      candidateNotesWithOctave: voiced.notesWithOctave,
      candidateRomanNumeral: relativeQuality === "maj" ? "III" : "vi",
      category: "relative",
      reason: `Relative ${relativeQuality === "maj" ? "major" : "minor"} — shares the same key signature`,
      confidenceScore: 0.65,
    });
  }

  // ── 3. Dominant-function substitutions ──
  // If chord is on degree V, offer ii-V replacements or other dominant function options
  const degreeIdx = findDegreeIndex(chordRoot, keyRoot, mode);

  if (degreeIdx === 4 || isDominantFunction(chord, keyRoot, mode)) {
    // Offer the ii chord as pre-dominant approach
    const iiRoot = diatonicSet.triads[1].triad.root;
    const iiChord = buildTriadFromRoot(iiRoot, diatonicSet.triads[1].triad.quality);
    const iiSym = formatChordSymbol(iiRoot, diatonicSet.triads[1].triad.quality);
    const iiVoiced = voiceNearSource(iiChord.pitchClasses, sourceMidi);

    options.push({
      id: makeSubId(),
      sourceChordId: chordId,
      candidateSymbol: iiSym,
      candidateRoot: iiRoot,
      candidateQuality: diatonicSet.triads[1].triad.quality,
      candidateNotes: iiChord.pitchClasses,
      candidateMidiNotes: iiVoiced.midi,
      candidateNotesWithOctave: iiVoiced.notesWithOctave,
      candidateRomanNumeral: diatonicSet.triads[1].degree,
      category: "dominant-function",
      reason: `${diatonicSet.triads[1].degree} — pre-dominant substitution for dominant function`,
      confidenceScore: 0.7,
    });

    // Offer IV as a subdominant alternative
    const ivRoot = diatonicSet.triads[3].triad.root;
    const ivChord = buildTriadFromRoot(ivRoot, diatonicSet.triads[3].triad.quality);
    const ivSym = formatChordSymbol(ivRoot, diatonicSet.triads[3].triad.quality);
    const ivVoiced = voiceNearSource(ivChord.pitchClasses, sourceMidi);

    options.push({
      id: makeSubId(),
      sourceChordId: chordId,
      candidateSymbol: ivSym,
      candidateRoot: ivRoot,
      candidateQuality: diatonicSet.triads[3].triad.quality,
      candidateNotes: ivChord.pitchClasses,
      candidateMidiNotes: ivVoiced.midi,
      candidateNotesWithOctave: ivVoiced.notesWithOctave,
      candidateRomanNumeral: diatonicSet.triads[3].degree,
      category: "dominant-function",
      reason: `${diatonicSet.triads[3].degree} — plagal alternative to dominant resolution`,
      confidenceScore: 0.6,
    });
  }

  // ── 4. Tritone substitution (only for dominant chords) ──
  if (isDominantFunction(chord, keyRoot, mode)) {
    const tritoneRoot = transposePitchClass(chordRoot, 6);
    const tritoneChord = buildSeventhFromRoot(tritoneRoot, "dom7");
    const tritoneSym = formatChordSymbol(tritoneRoot, "dom7");
    const tritoneVoiced = voiceNearSource(tritoneChord.pitchClasses, sourceMidi);

    options.push({
      id: makeSubId(),
      sourceChordId: chordId,
      candidateSymbol: tritoneSym,
      candidateRoot: tritoneRoot,
      candidateQuality: "dom7",
      candidateNotes: tritoneChord.pitchClasses,
      candidateMidiNotes: tritoneVoiced.midi,
      candidateNotesWithOctave: tritoneVoiced.notesWithOctave,
      candidateRomanNumeral: `bII7`,
      category: "tritone",
      reason: `Tritone substitution — shares the same tritone interval (guide tones) as the original dominant`,
      confidenceScore: 0.75,
    });
  }

  // ── 5. Modal mixture / borrowed chords ──
  {
    // Borrow from parallel major/minor
    const parallelScaleType: ScaleType = (mode === "ionian" || mode === "mixolydian") ? "natural_minor" : "major";
    const parallelSet = getDiatonicChords(keyRoot, parallelScaleType);

    for (let i = 0; i < parallelSet.triads.length; i++) {
      const borrowed = parallelSet.triads[i];
      // Only include if it's different from the diatonic set
      const isDuplicate = diatonicSet.triads.some(
        dt => dt.triad.root === borrowed.triad.root && dt.triad.quality === borrowed.triad.quality
      );
      if (isDuplicate) continue;

      // Check if it shares notes with the source chord
      const sharedNotes = borrowed.triad.pitchClasses.filter(pc => chordPcs.has(pc));
      if (sharedNotes.length === 0) continue;

      const sym = formatChordSymbol(borrowed.triad.root, borrowed.triad.quality);
      const voiced = voiceNearSource(borrowed.triad.pitchClasses, sourceMidi);

      options.push({
        id: makeSubId(),
        sourceChordId: chordId,
        candidateSymbol: sym,
        candidateRoot: borrowed.triad.root,
        candidateQuality: borrowed.triad.quality,
        candidateNotes: borrowed.triad.pitchClasses,
        candidateMidiNotes: voiced.midi,
        candidateNotesWithOctave: voiced.notesWithOctave,
        candidateRomanNumeral: borrowed.degree,
        category: "modal-mixture",
        reason: `Borrowed from parallel ${parallelScaleType === "major" ? "major" : "minor"} — adds harmonic color`,
        confidenceScore: 0.5 + sharedNotes.length * 0.1,
      });
    }
  }

  // ── 6. Inversion variants ──
  if (sourceMidi.length >= 3) {
    for (let inv = 1; inv < Math.min(sourceMidi.length, 3); inv++) {
      const rotatedMidi = [...sourceMidi];
      // Move bottom notes up an octave
      for (let j = 0; j < inv; j++) {
        const lowest = Math.min(...rotatedMidi);
        const idx = rotatedMidi.indexOf(lowest);
        rotatedMidi[idx] = lowest + 12;
      }
      rotatedMidi.sort((a, b) => a - b);

      const inversionNames = ["", "1st inversion", "2nd inversion"];
      const notesWithOctave = rotatedMidi.map(m => midiToNoteName(m));

      options.push({
        id: makeSubId(),
        sourceChordId: chordId,
        candidateSymbol: `${chord.symbol} (${inversionNames[inv]})`,
        candidateRoot: chordRoot,
        candidateQuality: chord.quality ?? "",
        candidateNotes: chord.notes.map(n => n as PitchClass),
        candidateMidiNotes: rotatedMidi,
        candidateNotesWithOctave: notesWithOctave,
        candidateRomanNumeral: chord.romanNumeral,
        category: "inversion",
        reason: `${inversionNames[inv]} — same chord with ${inv === 1 ? "third" : "fifth"} in the bass`,
        confidenceScore: 0.6,
      });
    }
  }

  // Sort by confidence score descending, then deduplicate by symbol
  const seen = new Set<string>();
  return options
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .filter(opt => {
      const key = `${opt.candidateSymbol}-${opt.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12); // Limit to 12 best options
}
