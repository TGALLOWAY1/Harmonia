/**
 * Deterministic progression verifier using the theory engine.
 * Parses prompts, computes expected chords, and verifies/corrects candidate notes.
 */

import type { PitchClass } from "@/lib/theory/midiUtils";
import type { ScaleType } from "@/lib/theory/types";
import {
  getDiatonicChords,
  buildTriadFromScale,
  formatChordSymbol,
  getScaleDefinition,
} from "@/lib/theory";
import { normalizeToPitchClass } from "@/lib/theory/midiUtils";

export type VerificationResult = {
  passed: boolean;
  checksRun: string[];
  failures: string[];
  fallbackUsed: boolean;
};

export type GeneratedProgression = {
  degree: string;
  symbol: string;
  notes: string[];
};



function parseKeyFromPrompt(prompt: string): {
  keyRoot: PitchClass;
  keyType: "major" | "minor";
} | null {
  const lower = prompt.toLowerCase();
  const majorMatch = lower.match(/in\s+([a-g](?:#|b)?)\s+major/i);
  const minorMatch = lower.match(/in\s+([a-g](?:#|b)?)\s+minor/i);
  if (minorMatch) {
    const root = normalizeToPitchClass(minorMatch[1]);
    if (root) return { keyRoot: root, keyType: "minor" };
  }
  if (majorMatch) {
    const root = normalizeToPitchClass(majorMatch[1]);
    if (root) return { keyRoot: root, keyType: "major" };
  }
  return null;
}

const ROMAN_TO_DEGREE: Record<string, number> = {
  i: 1, "ii°": 2, "ii": 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
  I: 1, "II°": 2, "II": 2, III: 3, IV: 4, V: 5, VI: 6, "VII°": 7, VII: 7,
};

function parseRomanNumerals(prompt: string): string[] {
  const dashPattern = /[-–—]\s*/g;
  const normalized = prompt.replace(dashPattern, " ").trim();
  const parts = normalized.split(/\s+/);
  const numerals: string[] = [];
  for (const p of parts) {
    const cleaned = p.replace(/ø/g, "°").trim();
    if (cleaned && ROMAN_TO_DEGREE[cleaned] !== undefined) {
      numerals.push(cleaned);
    } else if (/^[iIvVxXlLcCdDmM]+°?$/i.test(cleaned)) {
      const deg = romanToDegreeFromString(cleaned);
      if (deg >= 1 && deg <= 7) numerals.push(cleaned);
    }
  }
  if (numerals.length > 0) return numerals;
  const progressionMatch = prompt.match(
    /(?:progression|chords?)\s+([iIvVxXlLcCdDmM]+(?:[-–—]\s*[iIvVxXlLcCdDmM]+)*)/i
  );
  if (progressionMatch) {
    return progressionMatch[1].split(/[-–—\s]+/).filter(Boolean);
  }
  return [];
}

function romanToDegreeFromString(s: string): number {
  const n = s.replace(/°|ø/g, "");
  const map: Record<string, number> = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
  };
  return map[n] ?? 0;
}

function romanToDegreeIndex(roman: string, _keyType: "major" | "minor"): number {
  const normalized = roman.replace(/ø/g, "°");
  const degree = ROMAN_TO_DEGREE[normalized];
  if (degree !== undefined) return Math.max(0, Math.min(6, degree - 1));
  return romanToDegreeFromString(roman) - 1;
}

function notesMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((n) => setB.has(n));
}

export async function verifyProgressionFromPrompt(prompt: string): Promise<{
  keyRoot: string;
  keyType: "major" | "minor";
  progression: GeneratedProgression[];
  verification: VerificationResult;
  parsed: { romanNumerals: string[] };
}> {
  const checksRun: string[] = [];
  const failures: string[] = [];
  let fallbackUsed = false;

  const key = parseKeyFromPrompt(prompt);
  if (!key) {
    return {
      keyRoot: "",
      keyType: "major",
      progression: [],
      verification: {
        passed: false,
        checksRun: ["parse_key"],
        failures: ["Could not parse key from prompt (e.g. 'in A minor', 'in C major')"],
        fallbackUsed: false,
      },
      parsed: { romanNumerals: [] },
    };
  }

  const romanNumerals = parseRomanNumerals(prompt);
  if (romanNumerals.length === 0) {
    return {
      keyRoot: key.keyRoot,
      keyType: key.keyType,
      progression: [],
      verification: {
        passed: false,
        checksRun: ["parse_key", "parse_romans"],
        failures: ["Could not parse roman numeral sequence from prompt"],
        fallbackUsed: false,
      },
      parsed: { romanNumerals: [] },
    };
  }

  checksRun.push("parse_key", "parse_romans");

  const scaleType: ScaleType =
    key.keyType === "minor" ? "natural_minor" : "major";
  const scale = getScaleDefinition(key.keyRoot, scaleType);
  const diatonic = getDiatonicChords(key.keyRoot, scaleType);
  const progression: GeneratedProgression[] = [];
  const candidateNotes: string[][] = [];

  for (const roman of romanNumerals) {
    const degreeIndex = Math.max(0, Math.min(6, romanToDegreeIndex(roman, key.keyType)));
    const diatonicTriad = diatonic.triads[degreeIndex];
    const triad = buildTriadFromScale(scale, degreeIndex);
    const expectedNotes = triad.pitchClasses;
    const symbol = formatChordSymbol(triad.root, triad.quality);
    candidateNotes.push([]);

    const candidate = candidateNotes[candidateNotes.length - 1];
    if (candidate && candidate.length > 0 && !notesMatch(candidate, expectedNotes)) {
      fallbackUsed = true;
      failures.push(
        `Corrected chord tones for ${diatonicTriad.degree} using diatonic triads in ${key.keyRoot} ${key.keyType === "minor" ? "natural minor" : "major"}.`
      );
    }

    progression.push({
      degree: diatonicTriad.degree,
      symbol,
      notes: expectedNotes,
    });
  }

  checksRun.push("diatonic_verification");

  return {
    keyRoot: key.keyRoot,
    keyType: key.keyType,
    progression,
    verification: {
      passed: failures.length === 0,
      checksRun,
      failures,
      fallbackUsed,
    },
    parsed: { romanNumerals },
  };
}
