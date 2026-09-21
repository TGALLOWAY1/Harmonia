/**
 * Pitch realization — a beam search over each phrase.
 *
 * Placed events become pitches phrase by phrase. Instead of choosing each
 * note by a greedy argmin that can only see the note before it, the search
 * keeps the best few partial lines through the phrase and scores every
 * extension on what the corpora and the expectation literature say a line
 * does next:
 *
 *   - motif fidelity: stay close to the planned degree contour, and replay a
 *     restated head at the same relative pitches (re-anchored) so the hook is
 *     audible;
 *   - proximity and expectation (Narmour / Schellenberg / Huron, checked on
 *     the Essen corpus): steps are cheap, a leap of a fifth or more is
 *     followed by a reversal, steps like to continue, lines regress toward
 *     their centre, the tritone is rare;
 *   - harmony by category and metric weight (harmonicContext.ts): chord tones
 *     on strong, long notes; colour tones freely; avoid tones only short and
 *     weak; a non-chord tone must be left by step, so nothing is stranded for
 *     the safety pass to repair;
 *   - the guide-tone line at chord changes, tendency tones (the leading tone
 *     rises, sevenths fall), the phrase's single peak (pinned to the highest
 *     chord tone under its ceiling, every other note of the phrase kept
 *     below it) and its cadence pitch (pinned to the planned degree);
 *   - the approach figures planned into chord changes (approach.ts) — a step,
 *     a semitone or an enclosure into a tone of the chord that is coming —
 *     and, against them, a phrase's budget of one surprise: one interval of a
 *     sixth or more, or one chromatic tone that fails to resolve. A second
 *     costs, a third costs more, and fourths and fifths are rationed on the
 *     same principle one tier down.
 */

import { type PitchClass } from "@/lib/theory/midiUtils";
import {
  straddles,
  SURPRISE_BUDGET,
  SURPRISE_INTERVAL,
  WIDE_BUDGET,
  WIDE_INTERVAL,
  type ApproachKind,
  type ApproachPlan,
} from "./approach";
import {
  buildScaleMidiSet,
  chordIndexAtBeat,
  closestTone,
  stepByDegrees,
} from "./helpers";
import {
  guideToneLine,
  midiPc,
  tendencyOf,
  type ChordContext,
  type HarmonicContext,
  type NoteCategory,
} from "./harmonicContext";
import type { MoodProfile } from "./moods";
import type { PlacedEvent } from "./motif";
import { planTargetAt, type PhrasePlan, type PhraseSpec } from "./phrasePlan";
import type { MelodyGenerationOptions, MelodyHarmony, MelodyStyle } from "./types";

/** Internal pipeline note, before conversion to MelodyNote. */
export type NoteEvent = {
  midi: number;
  startBeat: number;
  durationBeats: number;
  chordIndex: number;
  /** Suspensions deliberately hold a tone across a chord change. */
  suspended?: boolean;
  phraseIndex?: number;
  isPeak?: boolean;
  isPhraseFinal?: boolean;
  isPickup?: boolean;
  /** Part of a restated head (the hook); ornaments leave these alone. */
  isHead?: boolean;
  weight?: number;
};

export type RealizationContext = {
  scalePitchClasses: PitchClass[];
  chords: MelodyGenerationOptions["chords"];
  style: MelodyStyle;
  harmony: MelodyHarmony;
  profile: MoodProfile;
  octave: number;
  /** Chord changes this candidate means to walk into, and how (approach.ts). */
  approaches?: ApproachPlan;
};

type Path = {
  pitches: number[];
  cost: number;
  p1: number | null;
  p2: number | null;
  /** Category of the previous note over its chord. */
  prevCategory: NoteCategory | null;
  prevChord: number;
  prevWasPeak: boolean;
  /** The previous note closed a phrase, so its tendency is already discharged. */
  prevWasPhraseFinal: boolean;
  /** Surprises spent in this phrase: sixths and wider, unresolved chromatics. */
  surprises: number;
  /** Fourths and fifths spent in this phrase. */
  wideLeaps: number;
  memo: Map<string, number>;
};

const BEAM_WIDTH = 8;

/**
 * What a phrase pays for going over its budget. The first surprise is free —
 * a phrase is meant to have one — and every one after it costs more, which in
 * a search where a whole transition rarely costs more than five points makes
 * the second a decision rather than a habit. The same shape one tier down
 * rations fourths and fifths: Essen puts 12 % of all intervals at a fourth or
 * wider and the engine was running at 21 %.
 */
const SURPRISE_PENALTY = 5;
const WIDE_PENALTY = 2.5;

/** What a well-formed approach into a chord change is worth. */
const APPROACH = {
  /** A step into a tone of the new chord. */
  diatonic: 2.5,
  /** The semitone below it — worth more, because the tone itself costs more. */
  chromaticBelow: 3.5,
  /** The semitone above: the same idiom, rarer. */
  chromaticAbove: 2,
  /** Both neighbours, in either order. */
  enclosure: 4,
  /**
   * Paid a note early, to the chromatic tone itself, so the beam keeps the
   * path that can play the figure at all: a chromatic note would otherwise be
   * pruned before the arrival could reward it. It comes on top of a refund of
   * the note's whole category cost — an approach tone is charged as the
   * motion it is, not as a foreign note, because it is gone by the next
   * onset. A tone held longer than a beat keeps its surcharge and stays out.
   */
  chromaticPreparation: 4.5,
  /** The same idea for a diatonic approach, whose tone is already cheap. */
  preparation: 1.2,
} as const;

/**
 * Cost by interval size, shaped like the interval distribution of real
 * melodies: steps are free, thirds cost a little, and anything beyond a fourth
 * has to earn its place (Essen: 49 % steps, 17 % thirds, 12 % of intervals a
 * fourth or wider; Rolling Stone pop is within a few points of that).
 */
const PROXIMITY: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 1.3, 4: 1.3, 5: 2.2, 6: 4.5, 7: 3.2, 8: 5, 9: 5, 10: 7, 11: 7, 12: 5.5 };
function proximityCost(interval: number): number {
  const a = Math.abs(interval);
  return PROXIMITY[a] ?? 10;
}

export function realizePitches(
  events: PlacedEvent[],
  plan: PhrasePlan,
  ctx: RealizationContext,
): NoteEvent[] {
  const { scalePitchClasses, style, harmony, profile, octave } = ctx;
  const hc: HarmonicContext = plan.harmony;
  const scaleMidi = buildScaleMidiSet(scalePitchClasses, octave);
  const low = plan.low;
  const high = plan.high;
  const guide = guideToneLine(hc, low, high);
  const chordAt = (beat: number) => chordIndexAtBeat(plan.chordStartBeats, beat);

  /* ── Per-phrase anchors, peak pitches and ceilings ── */
  const pitchesOfChord = (c: ChordContext, cat: NoteCategory[], lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) if (cat.includes(c.categories[midiPc(m)])) out.push(m);
    return out;
  };
  const anchors: number[] = [];
  const peakPitches: number[] = [];
  const ceilings: number[] = [];
  for (const phrase of plan.phrases) {
    const c = hc.chords[chordAt(phrase.startBeat)];
    const chordTones = pitchesOfChord(c, ["chord"], low, Math.max(low, phrase.ceiling - 2));
    anchors.push(chordTones.length ? closestTone(phrase.anchor, chordTones) : closestTone(phrase.anchor, scaleMidi));
    ceilings.push(phrase.ceiling);
  }
  for (const phrase of plan.phrases) {
    const c = hc.chords[chordAt(phrase.peakBeat)];
    const lo = Math.max(low, ceilings[phrase.index] - 4, anchors[phrase.index] + 2);
    let pool = pitchesOfChord(c, ["chord"], lo, ceilings[phrase.index]);
    if (pool.length === 0) pool = pitchesOfChord(c, ["chord", "color"], lo, ceilings[phrase.index]);
    if (pool.length === 0) pool = pitchesOfChord(c, ["chord", "color"], low, ceilings[phrase.index]);
    peakPitches.push(pool.length ? pool[pool.length - 1] : ceilings[phrase.index]);
  }
  // Where each phrase comes to rest. Deciding this before the line is built
  // lets the last notes funnel into it by step instead of discovering, at the
  // cadence, that the planned degree is an octave away.
  const cadencePitches: number[] = [];

  // The climax phrase owns the melody's highest note: every other phrase stays
  // at least two semitones under it.
  const climax = plan.phrases.find((p) => p.isClimax) ?? plan.phrases[plan.phrases.length - 1];
  const globalPeak = peakPitches[climax.index];
  for (const phrase of plan.phrases) {
    if (phrase.index === climax.index) continue;
    const cap = Math.max(anchors[phrase.index] + 2, globalPeak - 2);
    if (peakPitches[phrase.index] > cap) {
      const c = hc.chords[chordAt(phrase.peakBeat)];
      const pool = pitchesOfChord(c, ["chord", "color"], low, cap);
      peakPitches[phrase.index] = pool.length ? pool[pool.length - 1] : cap;
    }
    ceilings[phrase.index] = Math.min(ceilings[phrase.index], cap);
  }

  for (const phrase of plan.phrases) {
    const ceilingFor = peakPitches[phrase.index];
    // Phrase endings sit low in the phrase's span (both corpora put the last
    // note about a third of the way up it).
    const reference = anchors[phrase.index] - 2;
    let chosen: number | null = null;
    for (const pc of phrase.endPcOptions) {
      let best: number | null = null;
      for (let m = low; m <= high; m++) {
        if (midiPc(m) !== pc || m >= ceilingFor) continue;
        if (best === null || Math.abs(m - reference) < Math.abs(best - reference)) best = m;
      }
      if (best !== null) {
        chosen = best;
        break;
      }
    }
    cadencePitches.push(chosen ?? closestTone(reference, scaleMidi));
  }

  /* ── Beam search, phrase by phrase ── */
  const globalMemo = new Map<string, { midi: number; anchor: number }>();
  const notes: NoteEvent[] = [];
  let carry: Path = {
    pitches: [], cost: 0, p1: null, p2: null, prevCategory: null,
    prevChord: -1, prevWasPeak: false, prevWasPhraseFinal: false,
    surprises: 0, wideLeaps: 0, memo: new Map(),
  };
  const lastChordIndex = hc.chords.length - 1;

  for (const phrase of plan.phrases) {
    const phraseEvents = events.filter((e) => e.phraseIndex === phrase.index);
    if (phraseEvents.length === 0) continue;
    const anchor = anchors[phrase.index];
    let peakPitch = peakPitches[phrase.index];
    if (phrase.restates !== null && phrase.replaysPitches && !phrase.isClimax && !phrase.isFinal) {
      // A restatement that is not the climax replays its model's peak.
      const model = notes.filter((n) => n.phraseIndex === phrase.restates && !n.isPickup);
      if (model.length) peakPitch = Math.max(...model.map((n) => n.midi));
    }
    const ceiling = Math.max(anchor, Math.min(ceilings[phrase.index], peakPitch));

    // Each phrase gets its own budget: one surprise, one wide leap.
    let beam: Path[] = [{ ...carry, pitches: [], cost: 0, surprises: 0, wideLeaps: 0, memo: new Map(carry.memo) }];

    for (let ei = 0; ei < phraseEvents.length; ei++) {
      const e = phraseEvents[ei];
      const chordIdx = chordAt(e.startBeat);
      const chord = hc.chords[chordIdx];
      const firstOfChord = ei === 0 || chordAt(phraseEvents[ei - 1].startBeat) !== chordIdx;
      const memoKey = `${e.patternKey}#${e.indexInInstance}`;
      const gravity = planTargetAt(plan, e.startBeat);
      const nextBeam: Path[] = [];
      // The approach figure this note arrives with, and the one the note after
      // it arrives with — the latter is what makes room in the beam for an
      // approach tone that only pays off once it has resolved.
      const approach = ctx.approaches?.get(e);
      const after = phraseEvents[ei + 1];
      const nextApproach = after ? ctx.approaches?.get(after) : undefined;
      const nextChord = nextApproach && after ? hc.chords[chordAt(after.startBeat)] : null;
      const previous = ei > 0 ? phraseEvents[ei - 1] : undefined;
      const afterBreak =
        previous === undefined || previous.startBeat + previous.durationBeats < e.startBeat - 1e-9;
      const beforeBreak =
        after === undefined || after.startBeat > e.startBeat + e.durationBeats + 1e-9;

      for (const path of beam) {
        // Target pitch: memoized head pitch (re-anchored), else the planned degree.
        let target: number;
        const local = path.memo.get(memoKey);
        const remembered = globalMemo.get(memoKey);
        // This note is the hook coming back, not the hook being invented.
        const replayed = local !== undefined || remembered !== undefined;
        if (local !== undefined) target = local;
        else if (remembered) target = remembered.midi + (anchor - remembered.anchor);
        else {
          target = stepByDegrees(anchor, e.degreeOffset, scaleMidi);
          // The note before the peak aims within reach of the peak the phrase
          // will actually reach, not of where the degree walk imagined it:
          // the two are chosen independently — the peak is pinned to a chord
          // tone under the phrase's ceiling — and the gap between them is
          // what the line used to cross in one jump. A nudge of three
          // semitones, not a pin, so a tone that owes a resolution still
          // resolves.
          if (after?.isPeak) target = Math.max(target, Math.min(target + 3, peakPitch - 4));
        }

        const nextEvent = phraseEvents[ei + 1];
        const stepsToFinal = phraseEvents.length - 1 - ei;
        const candidates = candidatePitches(e, path, chord, target, {
          low,
          // A cadence may come to rest anywhere in the melody's register — the
          // phrase's reach limits where its line climbs, not where it lands —
          // but it never takes the phrase's own high note.
          ceiling: e.isPeak ? peakPitch : e.isPhraseFinal ? high : Math.min(ceiling, peakPitch - 1),
          peakPitch,
          nextIsPeak: nextEvent?.isPeak === true,
          stepsToFinal: phraseEvents[phraseEvents.length - 1].isPhraseFinal ? stepsToFinal : Infinity,
          cadencePitch: cadencePitches[phrase.index],
          phrase,
          maxLeap: profile.maxLeap,
          harmonyMode: harmony,
          scaleMidi,
          isChromaticApproach: nextApproach === "chromatic",
        });

        for (const m of candidates) {
          const cost = transitionCost(m, target, e, path, chord, {
            firstOfChord,
            guide: guide[chordIdx],
            gravity,
            anchor,
            style,
            harmonyMode: harmony,
            isCadenceZone: chordIdx >= lastChordIndex - 1,
            // A phrase ending discharges its own tendency: the leading tone of
            // a half cadence rests there, and the next phrase starts afresh.
            prevChordCtx: path.prevChord >= 0 && !path.prevWasPhraseFinal ? hc.chords[path.prevChord] : null,
            chordChanged: path.prevChord !== chordIdx,
            approach,
            nextApproach,
            nextChord,
            afterBreak,
            beforeBreak,
            replayed,
          });
          const memo = new Map(path.memo);
          if (e.patternKey.startsWith("head:") && !path.memo.has(memoKey)) memo.set(memoKey, m);
          const spent = budgetOf(m, path, afterBreak);
          nextBeam.push({
            pitches: [...path.pitches, m],
            cost: path.cost + cost,
            p1: m,
            p2: path.p1,
            prevCategory: chord.categories[midiPc(m)],
            prevChord: chordIdx,
            prevWasPeak: e.isPeak,
            prevWasPhraseFinal: e.isPhraseFinal,
            surprises: path.surprises + (spent.surprise ? 1 : 0),
            wideLeaps: path.wideLeaps + (spent.wide ? 1 : 0),
            memo,
          });
        }
      }

      // Keep the best few, one per (previous two pitches).
      nextBeam.sort((a, b) => a.cost - b.cost);
      const seen = new Set<string>();
      beam = [];
      for (const p of nextBeam) {
        const key = `${p.p2}|${p.p1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        beam.push(p);
        if (beam.length >= BEAM_WIDTH) break;
      }
      if (beam.length === 0) beam = nextBeam.slice(0, 1);
    }

    const best = beam[0];
    phraseEvents.forEach((e, i) => {
      const midi = best.pitches[i];
      notes.push({
        midi,
        startBeat: e.startBeat,
        durationBeats: e.durationBeats,
        chordIndex: chordAt(e.startBeat),
        phraseIndex: e.phraseIndex,
        isPeak: e.isPeak,
        isPhraseFinal: e.isPhraseFinal,
        isPickup: e.isPickup,
        isHead: e.patternKey.startsWith("head:"),
        weight: e.weight,
      });
      const memoKey = `${e.patternKey}#${e.indexInInstance}`;
      if (e.patternKey.startsWith("head:") && !globalMemo.has(memoKey)) globalMemo.set(memoKey, { midi, anchor });
    });
    carry = { ...best, pitches: [], cost: 0, memo: new Map() };
  }

  notes.sort((a, b) => a.startBeat - b.startBeat);
  return notes;
}

/* ─── Candidates ─── */

type CandidateOptions = {
  low: number;
  ceiling: number;
  peakPitch: number;
  /** The next event is the phrase's peak: this note must be within a leap of it. */
  nextIsPeak: boolean;
  /** Events left before the phrase-final note (Infinity when the phrase has none). */
  stepsToFinal: number;
  /** The pitch this phrase is planned to land on. */
  cadencePitch: number;
  phrase: PhraseSpec;
  maxLeap: number;
  harmonyMode: MelodyHarmony;
  scaleMidi: number[];
  /** This note is the chromatic approach tone of a planned figure. */
  isChromaticApproach: boolean;
};

function candidatePitches(
  e: PlacedEvent,
  path: Path,
  chord: ChordContext,
  target: number,
  o: CandidateOptions,
): number[] {
  const prev = path.p1;
  // A chromatic tone is admissible where it can only be heard as motion: off
  // the beat and short. A planned approach into a chord change buys it a
  // little more room — up to a beat, on a weak beat — because the approach
  // note of the idiom is often exactly that long, and it still never falls on
  // a position the harmony tests count as strong.
  const allowChromatic =
    o.harmonyMode === "expressive" && !e.isPhraseFinal && !e.isPeak &&
    (o.isChromaticApproach
      ? e.durationBeats <= 1 && e.weight <= 2
      : e.durationBeats <= 0.5 && e.weight <= 1);
  const strictStrong = o.harmonyMode === "strict" && e.weight >= 3;

  // The peak is pinned to the phrase's highest chord tone — or, when the
  // previous note cannot reach it, the highest chord tone it can reach.
  if (e.isPeak) {
    if (prev === null || Math.abs(o.peakPitch - prev) <= o.maxLeap) return [o.peakPitch];
    const reachable: number[] = [];
    for (let m = Math.max(o.low, prev - o.maxLeap); m <= Math.min(o.peakPitch, prev + o.maxLeap); m++) {
      if (chord.categories[midiPc(m)] === "chord") reachable.push(m);
    }
    return reachable.length ? [reachable[reachable.length - 1]] : [o.peakPitch];
  }

  const notThePeak = (m: number): boolean => m < o.peakPitch;

  // The cadence is approached by step: the two notes before the phrase-final
  // note close in on the pitch it will land on.
  let approachCentre: number | null = null;
  let approachWindow = 0;
  if (o.stepsToFinal >= 1 && o.stepsToFinal <= 3) {
    approachCentre = o.cadencePitch;
    approachWindow = o.stepsToFinal === 1 ? 2 : o.stepsToFinal === 2 ? 5 : 9;
  }

  const droning = prev !== null && path.p2 === prev;
  const allowed = (m: number): boolean => {
    const cat = chord.categories[midiPc(m)];
    if (cat === "chromatic" && !allowChromatic) return false;
    if (strictStrong && cat !== "chord") return false;
    // The note before the peak stands within a fifth of it. The corpora have
    // the peak approached by leap in 56–63 % of phrases, but their leaps are
    // thirds and fourths: letting the line stand a mood's whole maxLeap below
    // its high note is what made every phrase lurch a sixth or more into it.
    if (o.nextIsPeak && m < o.peakPitch - Math.min(o.maxLeap, 7)) return false;
    // Two of a pitch is a repeated note; three is a hook; four is a drone.
    if (droning && m === prev) return false;
    return true;
  };
  const nearFinal = (m: number): boolean =>
    approachCentre === null || (Math.abs(m - approachCentre) <= approachWindow && m !== approachCentre);

  // The phrase lands on the pitch the plan chose for it. When the line could
  // not get within reach, the nearest tone of the same degree is used instead.
  if (e.isPhraseFinal) {
    if (prev === null || Math.abs(o.cadencePitch - prev) <= o.maxLeap) return [o.cadencePitch];
    const pc = midiPc(o.cadencePitch);
    const pool: number[] = [];
    for (let m = Math.max(o.low, prev - o.maxLeap); m <= Math.min(o.ceiling, prev + o.maxLeap); m++) {
      if (midiPc(m) === pc && notThePeak(m)) pool.push(m);
    }
    if (pool.length) return [closestTone(o.cadencePitch, pool)];
    const fallback: number[] = [];
    for (let m = Math.max(o.low, prev - o.maxLeap); m <= Math.min(o.ceiling, prev + o.maxLeap); m++) {
      if (chord.categories[midiPc(m)] === "chord" && notThePeak(m)) fallback.push(m);
    }
    return fallback.length ? [closestTone(o.cadencePitch, fallback)] : [o.cadencePitch];
  }

  const gather = (window: number, leap: number, approach: boolean): number[] => {
    const out: number[] = [];
    for (let m = o.low; m <= o.ceiling; m++) {
      if (Math.abs(m - target) > window) continue;
      if (prev !== null && Math.abs(m - prev) > leap) continue;
      if (!allowed(m)) continue;
      if (approach && !nearFinal(m)) continue;
      out.push(m);
    }
    return out;
  };
  let candidates = gather(7, o.maxLeap, true);
  if (candidates.length === 0) candidates = gather(12, o.maxLeap, true);
  if (candidates.length === 0) candidates = gather(12, o.maxLeap, false);
  if (candidates.length === 0) candidates = gather(24, o.maxLeap, false);
  if (candidates.length === 0) {
    const pool: number[] = [];
    for (let m = o.low; m <= o.ceiling; m++) if (chord.categories[midiPc(m)] === "chord") pool.push(m);
    candidates = pool.length ? [closestTone(target, pool)] : [Math.max(o.low, Math.min(o.ceiling, target))];
  }
  return candidates;
}

/* ─── Transition cost ─── */

type CostOptions = {
  firstOfChord: boolean;
  guide: number;
  gravity: number;
  anchor: number;
  style: MelodyStyle;
  harmonyMode: MelodyHarmony;
  isCadenceZone: boolean;
  prevChordCtx: ChordContext | null;
  chordChanged: boolean;
  /** The figure this note is meant to arrive with. */
  approach: ApproachKind | undefined;
  /** The figure the *next* note arrives with: this note is its approach tone. */
  nextApproach: ApproachKind | undefined;
  /** The chord that next note lands on, when one is planned. */
  nextChord: ChordContext | null;
  /** A rest or a phrase boundary sits between this note and the one before. */
  afterBreak: boolean;
  /** The line stops after this note: nothing follows to resolve it. */
  beforeBreak: boolean;
  /** This note replays a head heard earlier, rather than stating it. */
  replayed: boolean;
};

/**
 * What this note spends of its phrase's budget: a surprise (an interval of a
 * sixth or more, or a chromatic tone left without its semitone resolution) or
 * a wide leap (a fourth or a fifth).
 *
 * Nothing is charged across a breath or a phrase boundary. The ear hears an
 * interval between two notes that belong to one line; where the line has
 * stopped and started again, the distance between them is register, not a
 * leap, and a phrase should not spend its one surprise on it.
 */
function budgetOf(m: number, path: Path, afterBreak: boolean): { surprise: boolean; wide: boolean } {
  if (path.p1 === null || afterBreak) return { surprise: false, wide: false };
  const interval = Math.abs(m - path.p1);
  const unresolvedChromatic = path.prevCategory === "chromatic" && interval !== 1;
  if (interval >= SURPRISE_INTERVAL || unresolvedChromatic) return { surprise: true, wide: false };
  return { surprise: false, wide: interval >= WIDE_INTERVAL };
}

function transitionCost(
  m: number,
  target: number,
  e: PlacedEvent,
  path: Path,
  chord: ChordContext,
  o: CostOptions,
): number {
  const p1 = path.p1;
  const p2 = path.p2;
  const category = chord.categories[midiPc(m)];
  const w = e.weight;
  const d = e.durationBeats;
  let cost = 0;

  // Does the previous note owe a resolution here? Open Music Theory is
  // explicit that a functional dissonance resolving "takes precedence over
  // other principles", so this is settled before motif fidelity is charged.
  let pull: { resolves: boolean; strength: number } | null = null;
  if (p1 !== null && o.prevChordCtx) {
    const t = tendencyOf(o.prevChordCtx, p1);
    if (t && t.strength > 0) {
      const functionChanged = o.chordChanged && o.prevChordCtx.functionTag !== chord.functionTag;
      const applies =
        functionChanged || t.kind === "fa-mi" || t.kind === "le-sol" || (o.chordChanged && t.kind !== "seventh");
      if (applies) {
        const R = m - p1;
        const I = p2 !== null ? p1 - p2 : 0;
        const inertia =
          p2 !== null && Math.abs(I) >= 1 && Math.abs(I) <= 2 &&
          Math.abs(R) >= 1 && Math.abs(R) <= 2 && Math.sign(R) === Math.sign(I);
        if (!inertia) pull = { resolves: t.to.includes(midiPc(m)), strength: t.strength };
      }
    }
  }

  // Motif fidelity — the planned shape wins unless harmony objects, and the
  // hook itself holds its shape hardest so a restatement is recognisable. A
  // note that owes a resolution bends to it instead.
  if (!e.isPeak && !e.isPhraseFinal) {
    // The hook holds its shape hardest, and hardest of all when it is coming
    // back: a restatement is only heard as one if the intervals return with
    // it (POP909: 65 % of consecutive same-type phrases share their opening).
    const fidelity = e.patternKey.startsWith("head:") ? (o.replayed ? 2.8 : 1.8) : 1.2;
    cost += (pull ? fidelity * 0.35 : fidelity) * Math.abs(m - target);
  }
  // Register gravity toward the phrase's arch.
  cost += 0.12 * Math.abs(m - o.gravity);

  if (p1 !== null) {
    const R = m - p1;
    const I = p2 !== null ? p1 - p2 : 0;
    cost += proximityCost(R);

    // Repetition: a device in rhythmic lines, monotony elsewhere.
    if (R === 0) {
      cost += o.style === "rhythmic" ? 0.1 : 0.8;
      if (p2 !== null && I === 0) cost += 4;
    }
    // Step inertia: steps like to continue in the same direction.
    if (Math.abs(I) >= 1 && Math.abs(I) <= 2 && Math.abs(R) >= 1 && Math.abs(R) <= 2 && Math.sign(R) === Math.sign(I)) cost -= 0.4;
    // Post-leap behaviour: a leap of a fourth or more reverses, preferably by step.
    if (Math.abs(I) >= 5) {
      if (Math.sign(R) === Math.sign(I) && Math.abs(R) >= 3) cost += 2.5;
      else if (Math.sign(R) === -Math.sign(I) && Math.abs(R) <= 2) cost -= 0.8;
      else if (Math.sign(R) === Math.sign(I) && Math.abs(R) <= 2) cost += 1.0;
    } else if (Math.abs(I) >= 3 && Math.sign(R) === Math.sign(I) && Math.abs(R) >= 3) {
      cost += 0.6;
    }
    // Registral return: landing back near where the leap started.
    if (Math.abs(I) >= 3 && R * I < 0 && Math.abs(I + R) <= 2) cost -= 0.3;
    // Regression to the mean: drifting further from the phrase centre costs.
    if (Math.abs(m - o.anchor) > Math.abs(p1 - o.anchor)) cost += 0.25 * Math.max(0, Math.abs(m - o.anchor) - 6);

    // A non-chord tone must be left by step, and a chromatic one owes a
    // semitone: it is an approach or it is nothing, so anything else — a whole
    // step, a repeat, a leap away — is charged for leaving it unresolved.
    if (path.prevCategory && path.prevCategory !== "chord") {
      if (Math.abs(R) > 2) cost += path.prevCategory === "color" ? 3 : 5;
      if (R === 0) cost += 3;
      if (path.prevCategory === "chromatic" && Math.abs(R) !== 1) cost += 6;
    }

    // The phrase's budget: one surprise, one wide leap, then a growing price.
    const spent = budgetOf(m, path, o.afterBreak);
    if (spent.surprise && path.surprises >= SURPRISE_BUDGET) {
      cost += SURPRISE_PENALTY * (path.surprises - SURPRISE_BUDGET + 1);
    }
    if (spent.wide && path.wideLeaps >= WIDE_BUDGET) {
      cost += WIDE_PENALTY * (path.wideLeaps - WIDE_BUDGET + 1);
    }

    // Approach figures into a chord change (approach.ts): a step into a tone
    // of the chord that is arriving, the semitone below it, or both its
    // neighbours in either order. Only ever a bonus — where the harmony or
    // the motif wants something else, it wins.
    if (o.approach && category === "chord") {
      let bonus = 0;
      const stepIn = Math.abs(R) === 1 || Math.abs(R) === 2;
      if (stepIn) bonus = APPROACH.diatonic;
      if (o.approach === "chromatic" && path.prevCategory === "chromatic" && Math.abs(R) === 1) {
        bonus = R > 0 ? APPROACH.chromaticBelow : APPROACH.chromaticAbove;
      } else if (o.approach === "enclosure" && p2 !== null && straddles(p2, p1, m)) {
        bonus = Math.max(bonus, APPROACH.enclosure);
      }
      cost -= bonus;
    }

    // Tendency tones (leading tone up, sevenths down, fa→mi, le→sol).
    if (pull) {
      const scale = o.isCadenceZone ? 2 : 1;
      cost += (pull.resolves ? -3.5 : 3.5) * pull.strength * scale;
    }

    // The peak is approached from below, ideally by leap — a third or a
    // fourth, the size the corpora's peak approaches actually are — ...
    if (e.isPeak) {
      if (R >= 3) cost -= 1.0;
      else if (R <= 0) cost += 2.0;
      cost += 0.7 * Math.max(0, R - 3);
    }
    // ...and left by step: both corpora put a step under the note after the
    // peak two thirds of the time (Essen 66 %, Rolling Stone 73 %), where the
    // engine used to fall away from its high note by a sixth or more. The
    // charge grows with the drop, so the line comes down off its peak instead
    // of falling off it.
    if (path.prevWasPeak) {
      if (R < 0 && Math.abs(R) <= 2) cost -= 1.5;
      else if (R < 0) cost += 0.6 * (Math.abs(R) - 2);
      else if (R > 0) cost += 1.0;
    }
    // The cadence note is approached by step, preferably from above, and sits
    // low in the phrase's range (both corpora put the last note at about a
    // third of the way up the phrase's span).
    if (e.isPhraseFinal) {
      cost += 0.5 * Math.max(0, m - o.anchor);
      if (Math.abs(R) <= 2 && R !== 0) cost -= 1.5;
      if (R < 0) cost -= 0.5;
      if (R === 0) cost += 0.5;
    }
  }

  // This note is the approach tone of the figure the *next* note arrives with.
  // The reward lands on the arrival, which is a note too late for a chromatic
  // tone — it would be pruned from the beam first — so the preparation is
  // paid here, to any note a semitone from a tone of the chord to come.
  // Never to a hook that is coming back: a restatement is only heard as one
  // if the idea returns at the pitches it had, and an approach is a device of
  // the line, not of the idea.
  if (o.nextChord && o.nextApproach && !o.replayed) {
    const leadsToChordTone =
      o.nextChord.categories[midiPc(m + 1)] === "chord" || o.nextChord.categories[midiPc(m - 1)] === "chord";
    if (leadsToChordTone) {
      cost -= o.nextApproach === "chromatic" && category === "chromatic"
        ? APPROACH.chromaticPreparation + 2 * w + 3
        : APPROACH.preparation;
    }
  }

  // Harmony by category, metric weight and duration.
  switch (category) {
    case "chord":
      cost -= 1.0 * w;
      break;
    case "color":
      cost += -0.4 * w + (d >= 2 ? 0.6 : 0);
      break;
    case "avoid":
      cost += 1.5 * w + (d >= 1 ? 3 : 0) + (w >= 3 && d >= 1 ? 6 : 0);
      break;
    case "chromatic": {
      // A chromatic tone may not be held: it is motion, not harmony. The
      // approach note of a planned figure is allowed a beat of it, which is
      // the length the idiom actually uses.
      const hold = o.nextApproach === "chromatic" ? 1 : 0.5;
      cost += 2 * w + 3 + (d > hold ? 6 : 0);
      break;
    }
  }
  if (o.harmonyMode === "strict" && category !== "chord" && w >= 2 && d >= 1) cost += 6;

  // A note the line rests after has to stand on its own: nothing comes to
  // resolve it. Left to the safety pass, such a note is pulled onto the
  // nearest chord tone afterwards, which opens a leap the search never saw.
  if (o.beforeBreak && category !== "chord") cost += category === "color" ? 2.5 : 5;

  // Chord changes: the guide-tone line and the chord's characteristic tones.
  if (o.firstOfChord) {
    if (m === o.guide) cost -= 2.0;
    else if (chord.priority.slice(0, 2).includes(midiPc(m))) cost -= 0.8;
  }

  // Arpeggiated style leans on chord tones everywhere.
  if (o.style === "arpeggiated" && category === "chord") cost -= 1.0;

  return cost;
}
