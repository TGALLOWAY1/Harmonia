/**
 * Tension and release: intentional non-chord tones.
 *
 * After pitches are realized, this pass adds classical NCT devices — passing
 * tones, neighbor tones, suspensions, anticipations, appoggiaturas — at a
 * mood-controlled rate scaled by the local phrase tension. Every device is
 * inserted with its resolution: an NCT only exists here because the next
 * note resolves it by step. The final melody note is never ornamented.
 */

import { type PitchClass } from "@/lib/theory/midiUtils";
import {
  isChordTone,
  isSemitoneClash,
  isStrongBeat,
} from "./helpers";
import type { MoodProfile, OrnamentKind } from "./moods";
import type { NoteEvent } from "./realizePitches";
import type { PhrasePlan } from "./phrasePlan";
import type { MelodyGenerationOptions, MelodyHarmony } from "./types";

const GRID = 0.5;

export type OrnamentContext = {
  chords: MelodyGenerationOptions["chords"];
  scaleMidi: number[];
  harmony: MelodyHarmony;
  profile: MoodProfile;
  /** Register bounds — ornaments may not escape the melody's range. */
  registerLow: number;
  registerHigh: number;
};

function tensionAt(plan: PhrasePlan, beat: number): number {
  for (const seg of plan.segments) {
    if (beat >= seg.startBeat && beat < seg.endBeat) return seg.tension;
  }
  return 0.3;
}

/** Scale tone strictly between two pitches, nearest the midpoint. */
function scaleToneBetween(a: number, b: number, scaleMidi: number[]): number | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const inside = scaleMidi.filter((m) => m > lo && m < hi);
  if (inside.length === 0) return null;
  const mid = (lo + hi) / 2;
  return inside.reduce((best, m) => (Math.abs(m - mid) < Math.abs(best - mid) ? m : best));
}

/** Nearest scale neighbor above/below a pitch (1–2 semitones). */
function scaleNeighbor(midi: number, scaleMidi: number[], above: boolean): number | null {
  const candidates = scaleMidi.filter((m) =>
    above ? m > midi && m - midi <= 2 : m < midi && midi - m <= 2,
  );
  if (candidates.length === 0) return null;
  return above ? Math.min(...candidates) : Math.max(...candidates);
}

export function applyOrnaments(
  notes: NoteEvent[],
  plan: PhrasePlan,
  ctx: OrnamentContext,
  rng: () => number,
): NoteEvent[] {
  const { chords, scaleMidi, harmony, profile, registerLow, registerHigh } = ctx;
  const has = (k: OrnamentKind) => profile.nctPalette.includes(k);
  const pcsOf = (idx: number): PitchClass[] => chords[idx]?.pitchClasses ?? [];
  const rate = (beat: number) => profile.nctDensity * (0.4 + 0.6 * tensionAt(plan, beat));
  const inRegister = (midi: number) => midi >= registerLow && midi <= registerHigh;

  const out: NoteEvent[] = notes.map((n) => ({ ...n }));
  // Budget keeps ornamentation from overwhelming the motif material.
  let budget = Math.max(1, Math.ceil(out.length * profile.nctDensity * 0.5));

  /* ── Suspensions & anticipations: live at chord boundaries ── */
  for (let i = 0; i < out.length - 1 && budget > 0; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a.chordIndex === b.chordIndex) continue;
    const boundary = plan.chordStartBeats[b.chordIndex];
    if (a.startBeat + a.durationBeats !== boundary || b.startBeat !== boundary) continue;
    const nextPCs = pcsOf(b.chordIndex);

    // Suspension: hold a chord tone of the old chord over the change, then
    // resolve it down by step. (Strict mode keeps strong beats pure, so the
    // device is reserved for expressive mode.)
    if (
      has("suspension") &&
      harmony === "expressive" &&
      i + 1 < out.length - 1 && // never displace the final note
      b.durationBeats >= 1 &&
      isChordTone(a.midi, pcsOf(a.chordIndex)) &&
      !isChordTone(a.midi, nextPCs) &&
      rng() < rate(boundary)
    ) {
      const resolution = [a.midi - 1, a.midi - 2].find(
        (m) => isChordTone(m, nextPCs) && inRegister(m),
      );
      if (resolution !== undefined) {
        a.durationBeats += GRID;
        a.suspended = true;
        b.startBeat += GRID;
        b.durationBeats -= GRID;
        b.midi = resolution;
        budget--;
        continue;
      }
    }

    // Anticipation: sound the next note's pitch on the last half-beat
    // before the change.
    if (
      has("anticipation") &&
      a.durationBeats >= 1 &&
      a.midi !== b.midi &&
      Math.abs(a.midi - b.midi) <= profile.maxLeap &&
      isChordTone(b.midi, nextPCs) &&
      rng() < rate(boundary)
    ) {
      a.durationBeats -= GRID;
      out.splice(i + 1, 0, {
        midi: b.midi,
        startBeat: boundary - GRID,
        durationBeats: GRID,
        chordIndex: a.chordIndex,
      });
      budget--;
      i++; // skip the inserted note
    }
  }

  /* ── Passing tones: fill thirds with a stepwise connection ── */
  for (let i = 0; i < out.length - 1 && budget > 0; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a.startBeat + a.durationBeats !== b.startBeat) continue;
    if (a.durationBeats < 1) continue;
    const interval = Math.abs(b.midi - a.midi);
    if (interval < 3 || interval > 4) continue;
    if (!has("passing") || rng() >= rate(a.startBeat)) continue;

    const between = scaleToneBetween(a.midi, b.midi, scaleMidi);
    if (between === null || !inRegister(between)) continue;
    const passStart = a.startBeat + a.durationBeats - GRID;
    const passPCs = pcsOf(a.chordIndex);
    // Keep strong beats clean: a passing tone may not clash on a downbeat.
    if (isStrongBeat(passStart) && (harmony === "strict" || isSemitoneClash(between, passPCs))) continue;

    a.durationBeats -= GRID;
    out.splice(i + 1, 0, {
      midi: between,
      startBeat: passStart,
      durationBeats: GRID,
      chordIndex: a.chordIndex,
    });
    budget--;
    i++;
  }

  /* ── Neighbor tones: decorate sustained notes (note–neighbor–note) ── */
  for (let i = 0; i < out.length - 1 && budget > 0; i++) {
    const a = out[i];
    if (a.durationBeats < 2 || a.suspended) continue;
    if (!has("neighbor") || rng() >= rate(a.startBeat)) continue;

    const neighborStart = a.startBeat + a.durationBeats - 1;
    const pcs = pcsOf(a.chordIndex);
    const neighbor = scaleNeighbor(a.midi, scaleMidi, rng() < 0.5);
    if (neighbor === null || !inRegister(neighbor)) continue;
    if (isStrongBeat(neighborStart) && (harmony === "strict" || isSemitoneClash(neighbor, pcs))) continue;

    const originalDur = a.durationBeats;
    a.durationBeats = originalDur - 1;
    out.splice(
      i + 1, 0,
      { midi: neighbor, startBeat: neighborStart, durationBeats: GRID, chordIndex: a.chordIndex },
      { midi: a.midi, startBeat: neighborStart + GRID, durationBeats: GRID, chordIndex: a.chordIndex },
    );
    budget--;
    i += 2;
  }

  /* ── Appoggiaturas: leaned-into strong beats, resolving down by step ── */
  if (harmony === "expressive" && has("appoggiatura")) {
    for (let i = 1; i < out.length - 1 && budget > 0; i++) {
      const a = out[i];
      const prevNote = out[i - 1];
      if (!isStrongBeat(a.startBeat) || a.durationBeats < 1 || a.suspended) continue;
      if (!isChordTone(a.midi, pcsOf(a.chordIndex))) continue;
      if (Math.abs(a.midi - prevNote.midi) < 3) continue; // wants a leap into it
      if (rng() >= rate(a.startBeat)) continue;

      const app = scaleNeighbor(a.midi, scaleMidi, true);
      if (app === null || !inRegister(app) || isSemitoneClash(app, pcsOf(a.chordIndex))) continue;

      out.splice(i, 0, {
        midi: app,
        startBeat: a.startBeat,
        durationBeats: GRID,
        chordIndex: a.chordIndex,
      });
      a.startBeat += GRID;
      a.durationBeats -= GRID;
      budget--;
      i++;
    }
  }

  out.sort((x, y) => x.startBeat - y.startBeat);
  return out;
}
