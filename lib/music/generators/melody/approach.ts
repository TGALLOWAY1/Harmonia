/**
 * Approach patterns into chord changes, and the per-phrase surprise budget.
 *
 * Two ideas from the research list live here, plus the measurements that keep
 * them honest.
 *
 *   - **Approach patterns.** A line arrives at a new chord the way players
 *     actually get there: by step into a chord tone of the chord that is
 *     coming, not by landing on it from nowhere. Three devices, in the jazz
 *     pedagogy's terms (and Impro-Visor's note categories, which the engine
 *     already speaks): a *diatonic* approach — a step from above or below; a
 *     *chromatic* approach — the semitone below the target, a "chromatic"
 *     category note that exists only because it resolves by semitone on the
 *     very next onset; and an *enclosure* — the two notes before the change
 *     straddling the target, upper neighbour then lower or the reverse.
 *     Which changes get one, and which device, is drawn per candidate from
 *     the mood's rates, so it is deterministic per seed.
 *
 *   - **The surprise budget.** One surprise per phrase: a rare interval (a
 *     sixth or wider) or a chromatic tone that is *not* an approach — i.e.
 *     one that fails to resolve by semitone. A second costs, a third costs
 *     more. A fourth or a fifth is not a surprise but is rationed too, at one
 *     per phrase before the price rises: Essen puts only 12 % of intervals at
 *     a fourth or wider and the engine was running at 17–21 %.
 *
 * The planner runs after the rhythm is laid out, because whether an approach
 * is even possible is a question about onsets: something has to sound in the
 * beat before the change and end exactly on it. The realization stage then
 * spends the plan as a term in its beam-search objective (realizePitches.ts),
 * so an approach is a preference the harmony can still outvote, never a pitch
 * forced into the line.
 */

import { chordIndexAtBeat } from "./helpers";
import { midiPc, type HarmonicContext } from "./harmonicContext";
import type { MoodProfile } from "./moods";
import type { PlacedEvent } from "./motif";
import type { MelodyHarmony } from "./types";

export type ApproachKind = "diatonic" | "chromatic" | "enclosure";

/** The device planned into each arrival note, keyed by the arriving event. */
export type ApproachPlan = Map<PlacedEvent, ApproachKind>;

/** An interval of a minor sixth or more: the "rare interval" of the budget. */
export const SURPRISE_INTERVAL = 8;
/** A fourth or wider — rationed, but not a surprise. */
export const WIDE_INTERVAL = 5;
/** Surprises a phrase may spend before the penalty starts growing. */
export const SURPRISE_BUDGET = 1;
/** Wide leaps a phrase may spend before the penalty starts growing. */
export const WIDE_BUDGET = 1;

const EPS = 1e-9;

/** A note or event, as far as the approach window is concerned. */
type Slot = { startBeat: number; durationBeats: number };

const endsAt = (a: Slot, beat: number): boolean => Math.abs(a.startBeat + a.durationBeats - beat) < EPS;

/**
 * The window an approach tone may sound in: the last one or two half-beat
 * slots before the change, running right up to it with no rest.
 */
function inApproachWindow(prev: Slot, change: number, beats = 1): boolean {
  return endsAt(prev, change) && prev.startBeat >= change - beats - EPS && prev.startBeat < change - EPS;
}

/* ─── Planning ─── */

export type ApproachRates = { total: number; chromatic: number; enclosure: number };

/** How often this mood, as the style modulates it, approaches a chord change. */
export function approachRates(profile: MoodProfile): ApproachRates {
  return {
    total: profile.approachRate,
    chromatic: profile.chromaticApproachShare,
    enclosure: profile.enclosureShare,
  };
}

/**
 * Choose which chord changes get an approach figure, and which one.
 *
 * Only changes the rhythm can carry are eligible: a note has to end exactly on
 * the change and the new chord has to start with an onset of its own. The
 * phrase's own pinned notes are left alone — the peak has its leap and the
 * cadence has its planned degree, and neither is an approach target.
 */
export function planApproaches(
  events: PlacedEvent[],
  chordStartBeats: number[],
  profile: MoodProfile,
  harmonyMode: MelodyHarmony,
  rng: () => number,
  hc?: HarmonicContext,
): ApproachPlan {
  const out: ApproachPlan = new Map();
  if (events.length === 0) return out;
  const rates = approachRates(profile);
  const sorted = [...events].sort((a, b) => a.startBeat - b.startBeat);

  for (let ci = 1; ci < chordStartBeats.length; ci++) {
    const change = chordStartBeats[ci];
    const arrivalIdx = sorted.findIndex((e) => e.startBeat >= change - EPS);
    if (arrivalIdx <= 0) continue;
    const arrival = sorted[arrivalIdx];
    if (Math.abs(arrival.startBeat - change) > EPS) continue;
    if (arrival.isPeak || arrival.isPhraseFinal || arrival.isPickup) continue;

    const prev = sorted[arrivalIdx - 1];
    if (prev.isPhraseFinal || !inApproachWindow(prev, change)) continue;

    if (rng() >= rates.total) continue;

    // A chromatic approach tone has to be short, weak and outside strict
    // harmony — the same gate the realization stage applies to a chromatic
    // candidate standing before a planned approach, checked here so the plan
    // never asks for the impossible.
    const chromaticPossible =
      harmonyMode === "expressive" && prev.durationBeats <= 1 + EPS && prev.weight <= 2 && !prev.isPeak;
    const before = sorted[arrivalIdx - 2];
    const enclosurePossible =
      before !== undefined &&
      !before.isPhraseFinal &&
      !before.isPeak &&
      endsAt(before, prev.startBeat) &&
      before.startBeat >= change - 2 - EPS;

    // Where the harmony brings its own approach — a dominant whose leading
    // tone or seventh resolves into this chord — the melody does not invent
    // one. Open Music Theory puts that resolution above other principles, and
    // a chromatic tone or an enclosure in the same slot would displace the
    // very note that wants to move.
    const owed = hc?.chords[ci - 1]?.tendencies.some((t) => t.strength >= 0.9 && t.to.length > 0) ?? false;

    const r = rng();
    let kind: ApproachKind = "diatonic";
    if (!owed && r < rates.chromatic && chromaticPossible) kind = "chromatic";
    else if (!owed && r < rates.chromatic + rates.enclosure && enclosurePossible) kind = "enclosure";
    out.set(arrival, kind);
  }
  return out;
}

/* ─── Measurement ─── */

export type ApproachObservation = {
  /** The chord being approached. */
  chordIndex: number;
  changeBeat: number;
  kind: ApproachKind | "none";
};

/**
 * Classify the motion into every chord change the melody could have
 * approached: one where a note ends exactly on the change, inside the last
 * beat, and the new chord begins with an onset. Used by the analysis script
 * and the tests, so the measurement and the generator agree on what the
 * figure is.
 */
export function observeApproaches(
  notes: ReadonlyArray<Slot & { midi: number }>,
  hc: HarmonicContext,
  chordStartBeats: number[],
): ApproachObservation[] {
  const out: ApproachObservation[] = [];
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const chordOf = (beat: number) => chordIndexAtBeat(chordStartBeats, beat);

  for (let ci = 1; ci < chordStartBeats.length; ci++) {
    const change = chordStartBeats[ci];
    const arrivalIdx = sorted.findIndex((n) => n.startBeat >= change - EPS);
    if (arrivalIdx <= 0) continue;
    const arrival = sorted[arrivalIdx];
    if (Math.abs(arrival.startBeat - change) > EPS) continue;
    const prev = sorted[arrivalIdx - 1];
    if (!inApproachWindow(prev, change)) continue;

    const chord = hc.chords[ci];
    if (!chord) continue;
    out.push({ chordIndex: ci, changeBeat: change, kind: classify(sorted, arrivalIdx, hc, chordOf, change) });
  }
  return out;
}

function classify(
  sorted: ReadonlyArray<Slot & { midi: number }>,
  arrivalIdx: number,
  hc: HarmonicContext,
  chordOf: (beat: number) => number,
  change: number,
): ApproachKind | "none" {
  const arrival = sorted[arrivalIdx];
  const prev = sorted[arrivalIdx - 1];
  const chord = hc.chords[chordOf(arrival.startBeat)];
  if (!chord || chord.categories[midiPc(arrival.midi)] !== "chord") return "none";

  const r = arrival.midi - prev.midi;
  const before = sorted[arrivalIdx - 2];
  if (
    before !== undefined &&
    endsAt(before, prev.startBeat) &&
    before.startBeat >= change - 2 - EPS &&
    straddles(before.midi, prev.midi, arrival.midi)
  ) {
    return "enclosure";
  }

  const prevChord = hc.chords[chordOf(prev.startBeat)];
  const prevCategory = prevChord ? prevChord.categories[midiPc(prev.midi)] : "chord";
  if (prevCategory === "chromatic" && Math.abs(r) === 1) return "chromatic";
  if (Math.abs(r) === 1 || Math.abs(r) === 2) return "diatonic";
  return "none";
}

/** Two notes on opposite sides of a target, each a step away, neither on it. */
export function straddles(first: number, second: number, target: number): boolean {
  const a = first - target;
  const b = second - target;
  return a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b) && Math.abs(a) <= 2 && Math.abs(b) <= 2;
}

export type SurpriseCount = {
  /** Surprises in each phrase, in phrase order. */
  perPhrase: number[];
  total: number;
  /** Phrases holding more than the budget of one. */
  overBudget: number;
};

/**
 * Count the melody's surprises phrase by phrase, on the generator's own
 * definition: an interval of a sixth or more, or a chromatic tone that never
 * resolves by semitone. An interval belongs to the phrase of the note it
 * arrives on, which is where the beam search charges it; intervals across a
 * rest or a phrase boundary are register, not leaps, and are not counted.
 */
export function countSurprises(
  notes: ReadonlyArray<Slot & { midi: number }>,
  hc: HarmonicContext,
  chordStartBeats: number[],
  phrases: ReadonlyArray<{ startBeat: number; endBeat: number }>,
): SurpriseCount {
  const bounds = phrases.length > 0 ? phrases : [{ startBeat: 0, endBeat: Infinity }];
  const perPhrase = bounds.map(() => 0);
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const phraseOf = (beat: number) => {
    for (let i = bounds.length - 1; i >= 0; i--) if (beat >= bounds[i].startBeat - EPS) return i;
    return 0;
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const note = sorted[i];
    const phrase = phraseOf(note.startBeat);
    if (phraseOf(prev.startBeat) !== phrase) continue;
    if (!endsAt(prev, note.startBeat)) continue;
    const interval = Math.abs(note.midi - prev.midi);
    const prevChord = hc.chords[chordIndexAtBeat(chordStartBeats, prev.startBeat)];
    const prevCategory = prevChord ? prevChord.categories[midiPc(prev.midi)] : "chord";
    const unresolvedChromatic = prevCategory === "chromatic" && interval !== 1;
    if (interval >= SURPRISE_INTERVAL || unresolvedChromatic) perPhrase[phrase]++;
  }

  return {
    perPhrase,
    total: perPhrase.reduce((s, v) => s + v, 0),
    overBudget: perPhrase.filter((v) => v > SURPRISE_BUDGET).length,
  };
}

/** Running chord start beats for a progression, in beats from its start. */
export function chordStartBeatsOf(beatsPerChord: number[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const beats of beatsPerChord) {
    out.push(cursor);
    cursor += beats;
  }
  return out;
}
