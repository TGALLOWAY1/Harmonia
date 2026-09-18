/**
 * Rhythm: from phrase plan to onsets.
 *
 * A melody's rhythm is built from a small vocabulary of one-bar cells that
 * recur (real songs run on three to six bar rhythms: 82 % of Essen bars and
 * 68 % of Rolling Stone bars repeat a rhythm heard elsewhere in the song).
 * Each phrase is laid out bar by bar: the head bar carries the basic idea's
 * cell, restatements copy the phrase they restate, the departure fragments
 * the head, and the last bar is bent toward the cadence so the final note is
 * long. On top of the cells sit the rules the corpora show: an onset at most
 * chord changes (sometimes a half-beat early — the anticipation that makes the
 * "and of four" the commonest onset position in pop), an onset at the phrase's
 * peak, a density that tapers across the phrase, an optional pickup into the
 * next phrase and a breath before it.
 */

import { GRID, metricWeight, snapToGrid, syncopationOf } from "./meter";
import type { MoodProfile } from "./moods";
import type { PhrasePlan, PhraseSpec } from "./phrasePlan";
import type { MelodyStyle } from "./types";

export type RhythmEvent = {
  startBeat: number;
  durationBeats: number;
  /** Metric weight 1–4 of the onset. */
  weight: number;
  isPickup: boolean;
  isPeak: boolean;
  isFinal: boolean;
  /** Index of the 4-beat window inside the phrase body (pickups: -1). */
  window: number;
};

/** One-bar onset cells (beats from the bar start, half-beat grid). */
const STRAIGHT_CELLS: number[][] = [
  [0, 1, 2, 3],
  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  [0, 1, 2],
  [0, 2, 3],
  [0, 1, 1.5, 2, 3],
  [0, 0.5, 1, 2, 3],
  [0, 1.5, 2, 3],
  [0, 2, 2.5, 3, 3.5],
  [0, 1, 2, 3, 3.5],
  [0, 1, 2, 2.5, 3],
  [0, 0.5, 1, 1.5, 2, 3],
  [0, 2, 3, 3.5],
];
const SYNCOPATED_CELLS: number[][] = [
  [0, 1.5, 2],
  [0, 1.5, 3],
  [0, 1.5, 2, 3.5],
  [0, 0.5, 1.5, 2.5, 3.5],
  [0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  [0, 1, 2.5, 3],
  [0, 0.5, 1.5, 2, 3.5],
  [0, 1.5, 2.5],
  [0, 2, 2.5, 3.5],
  [0, 1, 1.5, 2.5, 3.5],
  [0, 0.5, 1, 2, 2.5, 3.5],
];
const SPARSE_CELLS: number[][] = [[0], [0, 2], [0, 3], [0, 1], [0, 1.5], [0, 2.5]];

export type RhythmVocabulary = {
  head: number[];
  tail: number[];
  contrast: number[];
  cadence: number[];
};

function cellDensity(cell: number[]): number {
  return cell.length / 4;
}

/** Notes per beat the mood asks for before phrase shaping. */
export function baseNotesPerBeat(profile: MoodProfile): number {
  return 0.5 + profile.rhythmDensity * 1.5;
}

function pickCell(
  pool: number[][],
  targetDensity: number,
  rng: () => number,
  exclude: number[][] = [],
): number[] {
  const scored = pool
    .filter((c) => !exclude.some((e) => e.join(",") === c.join(",")))
    .map((c) => ({ c, d: Math.abs(cellDensity(c) - targetDensity) }))
    .sort((a, b) => a.d - b.d);
  const top = scored.slice(0, Math.min(4, scored.length));
  return top.length ? top[Math.floor(rng() * top.length)].c : pool[0];
}

/** Halve the head cell: its first two beats twice (the sentence's fragmentation). */
function fragmentCell(cell: number[]): number[] {
  const half = cell.filter((p) => p < 2);
  const out = new Set<number>([...half, ...half.map((p) => p + 2)]);
  if (out.size === 0) out.add(0);
  return Array.from(out).sort((a, b) => a - b);
}

export function pickVocabulary(
  profile: MoodProfile,
  style: MelodyStyle,
  headCell: number[] | null,
  rng: () => number,
): RhythmVocabulary {
  const density = baseNotesPerBeat(profile);
  const syncopated = rng() < profile.syncopationChance || style === "rhythmic";
  const pool = syncopated ? [...SYNCOPATED_CELLS, ...STRAIGHT_CELLS.slice(0, 4)] : [...STRAIGHT_CELLS, ...SYNCOPATED_CELLS.slice(0, 2)];
  const head = headCell && headCell.length > 0 ? headCell : pickCell(pool, density, rng);
  const tail = pickCell(pool, density * 0.95, rng, [head]);
  const contrast = fragmentCell(head);
  const cadence = pickCell([...SPARSE_CELLS, [0, 1, 2], [0, 1.5, 2], [0, 0.5, 1, 2], [0, 1, 2, 2.5]], Math.max(0.5, density * 0.7), rng);
  return { head, tail, contrast, cadence };
}

type Layout = {
  bodyStart: number;
  bodyEnd: number;
  finalStart: number;
};

function layoutOf(phrase: PhraseSpec, next: PhraseSpec | undefined): Layout {
  const bodyStart = phrase.startBeat;
  const bodyEnd = phrase.endBeat - phrase.breathBeats - (next?.pickupBeats ?? 0);
  let finalStart = snapToGrid(bodyEnd - phrase.finalNoteBeats);
  // A final note that begins on a beat reads as an arrival; extend it when the
  // grid put it on an off-beat and there is room.
  if (!Number.isInteger(finalStart) && finalStart - GRID > bodyStart) finalStart -= GRID;
  finalStart = Math.max(bodyStart, finalStart);
  return { bodyStart, bodyEnd, finalStart };
}

const ON_CHANGE: Record<MelodyStyle, [number, number]> = {
  lyrical: [0.65, 0.12],
  rhythmic: [0.5, 0.28],
  arpeggiated: [0.72, 0.1],
};

/**
 * Onsets for one phrase body. `template` (the restated phrase's onsets,
 * relative to its start) is copied where it fits so restatements keep the
 * rhythm of the idea they restate.
 */
export function planPhraseRhythm(
  phrase: PhraseSpec,
  plan: PhrasePlan,
  profile: MoodProfile,
  style: MelodyStyle,
  vocab: RhythmVocabulary,
  rng: () => number,
  template: number[] | null,
): RhythmEvent[] {
  const next = plan.phrases[phrase.index + 1];
  const { bodyStart, bodyEnd, finalStart } = layoutOf(phrase, next);
  const length = bodyEnd - bodyStart;
  if (length <= 0) return [];

  const onsets = new Set<number>();
  const protectedOnsets = new Set<number>();
  const windows = Math.max(1, Math.ceil((finalStart - bodyStart + 1e-9) / 4));

  if (template) {
    for (const rel of template) {
      const abs = bodyStart + rel;
      if (abs < finalStart) onsets.add(abs);
    }
  } else {
    for (let w = 0; w < windows; w++) {
      const winStart = bodyStart + 4 * w;
      const winEnd = Math.min(finalStart, winStart + 4);
      const isLast = w === windows - 1;
      let cell: number[];
      if (phrase.material === "B") cell = w % 2 === 0 ? vocab.contrast : vocab.tail;
      else if (w === 0) cell = vocab.head;
      else if (isLast && windows > 2) cell = vocab.cadence;
      else cell = w % 2 === 1 ? vocab.tail : vocab.head;
      for (const rel of cell) {
        const abs = winStart + rel;
        if (abs < winEnd) onsets.add(abs);
      }
    }
  }
  onsets.add(bodyStart);
  protectedOnsets.add(bodyStart);

  // The cadence: one final onset, nothing after it.
  for (const o of Array.from(onsets)) if (o >= finalStart) onsets.delete(o);
  onsets.add(finalStart);
  protectedOnsets.add(finalStart);

  // The local peak needs an onset to land on.
  if (phrase.peakBeat > bodyStart && phrase.peakBeat < finalStart) {
    onsets.add(phrase.peakBeat);
    protectedOnsets.add(phrase.peakBeat);
  }

  // Chord changes: move on the change, anticipate it, or hold across it.
  if (!template) {
    const [pOn, pAnt] = ON_CHANGE[style];
    for (const change of plan.chordStartBeats) {
      if (change <= bodyStart || change >= finalStart) continue;
      // The phrase's peak and cadence keep their own onsets: an anticipation
      // may not move them a half-beat earlier.
      if (protectedOnsets.has(change)) continue;
      const r = rng();
      if (r < pOn) {
        onsets.add(change);
        protectedOnsets.add(change);
      } else if (r < pOn + pAnt && change - GRID > bodyStart) {
        onsets.delete(change);
        onsets.add(change - GRID);
        protectedOnsets.add(change - GRID);
      }
    }
  }

  // Density: thin or fill each window toward the mood's target, tapering
  // across the phrase (durations lengthen 17–48 % over a phrase in every corpus).
  // A restatement keeps its model's rhythm untouched.
  const base = baseNotesPerBeat(profile) * phrase.density;
  for (let w = 0; w < windows && !template; w++) {
    const winStart = bodyStart + 4 * w;
    const winEnd = Math.min(finalStart, winStart + 4);
    const span = winEnd - winStart;
    if (span <= 0) continue;
    const taper = windows === 1 ? 1 : 1.15 - 0.35 * (w / (windows - 1));
    const target = Math.round(base * taper * span);
    const inWindow = () => Array.from(onsets).filter((o) => o >= winStart && o < winEnd).sort((a, b) => a - b);
    let current = inWindow();
    let guard = 0;
    while (current.length > target + 1 && guard++ < 16) {
      const removable = current.filter((o) => !protectedOnsets.has(o));
      if (removable.length === 0) break;
      removable.sort((a, b) => metricWeight(a) - metricWeight(b) || (rng() < 0.5 ? -1 : 1));
      onsets.delete(removable[0]);
      current = inWindow();
    }
    guard = 0;
    while (current.length < target - 1 && guard++ < 16) {
      const free: number[] = [];
      for (let p = winStart; p < winEnd - 1e-9; p += GRID) if (!onsets.has(p)) free.push(p);
      if (free.length === 0) break;
      free.sort((a, b) => metricWeight(b) - metricWeight(a) || a - b);
      const top = free.filter((p) => metricWeight(p) === metricWeight(free[0]));
      onsets.add(top[Math.floor(rng() * top.length)]);
      current = inWindow();
    }
  }

  // Durations run to the next onset; the final note runs to the body end.
  const sorted = Array.from(onsets).sort((a, b) => a - b);
  const events: RhythmEvent[] = sorted.map((o, i) => ({
    startBeat: o,
    durationBeats: (i + 1 < sorted.length ? sorted[i + 1] : bodyEnd) - o,
    weight: metricWeight(o),
    isPickup: false,
    isPeak: o === phrase.peakBeat,
    isFinal: i === sorted.length - 1,
    window: Math.floor((o - bodyStart) / 4),
  }));

  // Breathing room inside the phrase: shorten a sustained note before a strong
  // onset so a short rest precedes it.
  for (let i = 0; i < events.length - 1; i++) {
    const ev = events[i];
    if (ev.durationBeats >= 1.5 && events[i + 1].weight >= 3 && rng() < profile.restChance * 0.6) {
      ev.durationBeats -= GRID;
    }
  }

  // Pickup into this phrase, carved from the previous phrase's window.
  if (phrase.pickupBeats > 0) {
    const start = phrase.startBeat - phrase.pickupBeats;
    const pickups: RhythmEvent[] = [];
    if (phrase.pickupBeats === 1 && rng() < 0.5) {
      pickups.push({ startBeat: start, durationBeats: GRID, weight: metricWeight(start), isPickup: true, isPeak: false, isFinal: false, window: -1 });
      pickups.push({ startBeat: start + GRID, durationBeats: GRID, weight: metricWeight(start + GRID), isPickup: true, isPeak: false, isFinal: false, window: -1 });
    } else {
      pickups.push({ startBeat: start, durationBeats: phrase.pickupBeats, weight: metricWeight(start), isPickup: true, isPeak: false, isFinal: false, window: -1 });
    }
    return [...pickups, ...events];
  }
  return events;
}

/** Syncopation per bar of an event list, for scoring against the mood. */
export function syncopationPerBar(events: { startBeat: number }[], totalBeats: number): number {
  if (totalBeats <= 0) return 0;
  return syncopationOf(events.map((e) => e.startBeat), totalBeats) / (totalBeats / 4);
}
