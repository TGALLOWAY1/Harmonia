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
 *     below it) and its cadence pitch (pinned to the planned degree).
 */

import { type PitchClass } from "@/lib/theory/midiUtils";
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
  memo: Map<string, number>;
};

const BEAM_WIDTH = 8;

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
    prevChord: -1, prevWasPeak: false, prevWasPhraseFinal: false, memo: new Map(),
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

    let beam: Path[] = [{ ...carry, pitches: [], cost: 0, memo: new Map(carry.memo) }];

    for (let ei = 0; ei < phraseEvents.length; ei++) {
      const e = phraseEvents[ei];
      const chordIdx = chordAt(e.startBeat);
      const chord = hc.chords[chordIdx];
      const firstOfChord = ei === 0 || chordAt(phraseEvents[ei - 1].startBeat) !== chordIdx;
      const memoKey = `${e.patternKey}#${e.indexInInstance}`;
      const gravity = planTargetAt(plan, e.startBeat);
      const nextBeam: Path[] = [];

      for (const path of beam) {
        // Target pitch: memoized head pitch (re-anchored), else the planned degree.
        let target: number;
        const local = path.memo.get(memoKey);
        const remembered = globalMemo.get(memoKey);
        if (local !== undefined) target = local;
        else if (remembered) target = remembered.midi + (anchor - remembered.anchor);
        else target = stepByDegrees(anchor, e.degreeOffset, scaleMidi);

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
          });
          const memo = new Map(path.memo);
          if (e.patternKey.startsWith("head:") && !path.memo.has(memoKey)) memo.set(memoKey, m);
          nextBeam.push({
            pitches: [...path.pitches, m],
            cost: path.cost + cost,
            p1: m,
            p2: path.p1,
            prevCategory: chord.categories[midiPc(m)],
            prevChord: chordIdx,
            prevWasPeak: e.isPeak,
            prevWasPhraseFinal: e.isPhraseFinal,
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
};

function candidatePitches(
  e: PlacedEvent,
  path: Path,
  chord: ChordContext,
  target: number,
  o: CandidateOptions,
): number[] {
  const prev = path.p1;
  const allowChromatic = o.harmonyMode === "expressive" && e.durationBeats <= 0.5 && e.weight <= 1 && !e.isPhraseFinal && !e.isPeak;
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
    if (o.nextIsPeak && m < o.peakPitch - o.maxLeap) return false;
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
};

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
    const fidelity = e.patternKey.startsWith("head:") ? 1.8 : 1.2;
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
      else if (Math.sign(R) === Math.sign(I) && Math.abs(R) <= 2) cost += 0.3;
    } else if (Math.abs(I) >= 3 && Math.sign(R) === Math.sign(I) && Math.abs(R) >= 3) {
      cost += 0.6;
    }
    // Registral return: landing back near where the leap started.
    if (Math.abs(I) >= 3 && R * I < 0 && Math.abs(I + R) <= 2) cost -= 0.3;
    // Regression to the mean: drifting further from the phrase centre costs.
    if (Math.abs(m - o.anchor) > Math.abs(p1 - o.anchor)) cost += 0.25 * Math.max(0, Math.abs(m - o.anchor) - 6);

    // A non-chord tone must be left by step.
    if (path.prevCategory && path.prevCategory !== "chord") {
      if (Math.abs(R) > 2) cost += path.prevCategory === "color" ? 3 : 5;
      if (R === 0) cost += 3;
    }

    // Tendency tones (leading tone up, sevenths down, fa→mi, le→sol).
    if (pull) {
      const scale = o.isCadenceZone ? 2 : 1;
      cost += (pull.resolves ? -3.5 : 3.5) * pull.strength * scale;
    }

    // The peak is approached from below, ideally by leap, and left by step.
    if (e.isPeak) {
      if (R >= 3) cost -= 1.0;
      else if (R <= 0) cost += 2.0;
    }
    if (path.prevWasPeak) {
      if (R < 0 && Math.abs(R) <= 2) cost -= 0.8;
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
    case "chromatic":
      cost += 2 * w + 3 + (d > 0.5 ? 6 : 0);
      break;
  }
  if (o.harmonyMode === "strict" && category !== "chord" && w >= 2 && d >= 1) cost += 6;

  // Chord changes: the guide-tone line and the chord's characteristic tones.
  if (o.firstOfChord) {
    if (m === o.guide) cost -= 2.0;
    else if (chord.priority.slice(0, 2).includes(midiPc(m))) cost -= 0.8;
  }

  // Arpeggiated style leans on chord tones everywhere.
  if (o.style === "arpeggiated" && category === "chord") cost -= 1.0;

  return cost;
}
