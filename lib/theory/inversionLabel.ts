import { midiToPitchClass, type PitchClass } from "./midiUtils";

/**
 * Determine the inversion label for a chord given its MIDI notes and root.
 * Returns "Root", "1st inv", "2nd inv", or "3rd inv".
 */
export function getInversionLabel(midiNotes: number[], root: PitchClass): string {
  if (!midiNotes || midiNotes.length === 0) return "";

  const sorted = [...midiNotes].sort((a, b) => a - b);
  const bassPC = midiToPitchClass(sorted[0]);

  if (bassPC === root) return "Root";

  // Determine which chord tone is in the bass
  const rootIndex = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(root);
  const bassIndex = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(bassPC);

  if (rootIndex === -1 || bassIndex === -1) return "";

  const interval = ((bassIndex - rootIndex) + 12) % 12;

  // 3rd in bass (3 or 4 semitones) = 1st inversion
  if (interval === 3 || interval === 4) return "1st inv";
  // 5th in bass (7 semitones) = 2nd inversion
  if (interval === 7) return "2nd inv";
  // 7th in bass (10 or 11 semitones) = 3rd inversion
  if (interval === 10 || interval === 11) return "3rd inv";

  // Other bass notes (e.g., extensions)
  return "Slash";
}

/**
 * The bass that actually sounds and the inversion it implies, for keeping a
 * chord's `bass`/`inversion` fields in step with its notes after edits.
 * Inversion is −1 when the lowest note is not a chord tone (a pedal or an
 * extension in the bass).
 */
export function describeInversion(
  midiNotes: number[] | undefined,
  root: PitchClass | undefined
): { bass?: PitchClass; inversion?: number } {
  if (!midiNotes || midiNotes.length === 0 || !root) return {};
  const lowest = Math.min(...midiNotes);
  const bass = midiToPitchClass(lowest);
  const label = getInversionLabel(midiNotes, root);
  const inversion =
    label === "Root" ? 0 : label === "1st inv" ? 1 : label === "2nd inv" ? 2 : label === "3rd inv" ? 3 : -1;
  return { bass, inversion };
}
