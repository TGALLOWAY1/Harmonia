/**
 * Motif-based composition.
 *
 * Melodies are built from a basic idea — one bar of rhythm plus a scale-degree
 * contour — that is stated, restated and developed across the phrases the
 * form plan laid out: a period restates the idea and changes its ending, a
 * departure fragments it and sequences the fragment (Open Music Theory's
 * continuation function: fragmentation, sequential repetition, faster
 * rhythm), and the conclusion brings it back and liquidates it into a
 * stepwise close. "Same head, different tail" is the relation real melodies
 * use (POP909: 91 % of restated phrases keep their opening and change their
 * ending), so every restatement keeps the head's rhythm and pattern key and
 * the realization stage replays the head's pitches.
 */

import { GRID, metricWeight, snapToGrid } from "./meter";
import type { MoodProfile } from "./moods";
import type { PhrasePlan, PhraseSegment, PhraseSpec } from "./phrasePlan";
import { pickVocabulary, planPhraseRhythm, type RhythmEvent } from "./rhythm";
import type { MelodyStyle } from "./types";

/** A rhythmic onset within a motif, relative to the motif start. */
export type MotifEvent = {
  offsetBeats: number;
  durationBeats: number;
  accent: boolean;
};

export type MotifSpec = {
  events: MotifEvent[];
  /** Cumulative scale-degree offset from the motif anchor, per event. */
  degreeOffsets: number[];
  lengthBeats: number;
  label: string;
};

export type MotifVariation = "transpose" | "invert" | "rhythmShift";

/** A motif event placed at an absolute position in the melody. */
export type PlacedEvent = {
  startBeat: number;
  durationBeats: number;
  accent: boolean;
  /** Metric weight 1–4. */
  weight: number;
  /** Scale-degree offset from the phrase anchor. */
  degreeOffset: number;
  /** Identifies the motif pattern, for memoized (repeatable) realization. */
  patternKey: string;
  /** Groups events that belong to one motif statement. */
  instanceId: number;
  indexInInstance: number;
  segmentRole: PhraseSegment["role"] | "pickup";
  /** The final resolving note of the melody. */
  isCadenceFinal: boolean;
  phraseIndex: number;
  /** Last note of its phrase — pinned to the phrase's cadence degree. */
  isPhraseFinal: boolean;
  /** The phrase's single highest note. */
  isPeak: boolean;
  isPickup: boolean;
};

function snap(beats: number): number {
  return snapToGrid(beats);
}

/* ─── Motif generation ─── */

/**
 * Generate a one-bar (or shorter) basic idea: onsets drawn by metric weight
 * — the stronger the position the likelier an onset, flattened as the mood
 * syncopates — and a degree contour shaped like the folk corpora: steps most
 * of the time, thirds next, a rare larger leap that then reverses.
 */
export function generateMotif(
  profile: MoodProfile,
  lengthBeats: number,
  rng: () => number,
  label: string,
): MotifSpec {
  const length = Math.max(GRID, snap(lengthBeats));
  const notesPerBeat = 0.5 + profile.rhythmDensity * 1.5;
  const maxOnsets = Math.round(length / GRID);
  const count = Math.max(1, Math.min(maxOnsets, Math.round(length * notesPerBeat)));

  const chosen = new Set<number>([0]);
  const exponent = 2.2 - 2 * profile.syncopationChance;
  const positions: number[] = [];
  for (let p = GRID; p < length; p += GRID) positions.push(p);
  while (chosen.size < count && positions.some((p) => !chosen.has(p))) {
    const pool = positions.filter((p) => !chosen.has(p));
    const weights = pool.map((p) => Math.pow(metricWeight(p), exponent));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    let pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = pool[i];
        break;
      }
    }
    chosen.add(pick);
  }

  // Straight syncopation (Open Music Theory): halve the first note and pull
  // the rest a half-beat early.
  let onsets = Array.from(chosen).sort((a, b) => a - b);
  if (onsets.length >= 3 && rng() < profile.syncopationChance * 0.6) {
    const shifted = onsets.map((p, i) => (i === 0 ? p : p - GRID)).filter((p, i, arr) => p >= 0 && arr.indexOf(p) === i);
    if (shifted.length === onsets.length) onsets = shifted;
  }

  // Long-note bias: clear late onsets so the cell ends with a sustained note.
  if (onsets.length > 2 && rng() < profile.longNoteBias) {
    const trimmed = onsets.filter((p) => p <= length - 1);
    if (trimmed.length >= 2) onsets = trimmed;
  }

  const events: MotifEvent[] = onsets.map((p, i) => ({
    offsetBeats: p,
    durationBeats: (i + 1 < onsets.length ? onsets[i + 1] : length) - p,
    accent: metricWeight(p) >= 2,
  }));

  if (events.length >= 3 && rng() < profile.restChance) {
    const idx = 1 + Math.floor(rng() * (events.length - 2));
    const ev = events[idx];
    if (ev.durationBeats >= 1) ev.durationBeats = snap(ev.durationBeats / 2);
  }

  return { events, degreeOffsets: walkDegrees(events.length, profile, rng), lengthBeats: length, label };
}

/**
 * A degree contour with the corpora's interval mix: ~55 % steps, ~15 %
 * repeats, ~20 % thirds, a few fourths; steps lean downward, leaps upward;
 * a leap of a fourth or more reverses by step; never three repeats.
 */
export function walkDegrees(
  count: number,
  profile: MoodProfile,
  rng: () => number,
  start = 0,
  bounds: [number, number] = [-4, 4],
): number[] {
  const degrees: number[] = [start];
  let cum = start;
  let lastStep = 0;
  let repeats = 0;
  const leapBias = profile.leapChance;
  for (let i = 1; i < count; i++) {
    let step: number;
    const r = rng();
    if (Math.abs(lastStep) >= 3) {
      // Post-leap reversal by step (corpora: 75–90 %).
      step = rng() < 0.85 ? -Math.sign(lastStep) : Math.sign(lastStep);
    } else if (r < 0.18 && repeats < 1 && i > 1) {
      step = 0;
    } else if (r < 0.82 - leapBias * 0.25) {
      // Steps carry the line, and they lean downward (Essen: 60 % descend).
      step = rng() < 0.56 ? -1 : 1;
    } else if (r < 0.95) {
      step = (rng() < 0.6 ? 1 : -1) * 2;
    } else {
      step = (rng() < 0.65 ? 1 : -1) * 3;
    }
    if (cum + step > bounds[1]) step = -Math.abs(step) || -1;
    if (cum + step < bounds[0]) step = Math.abs(step) || 1;
    repeats = step === 0 ? repeats + 1 : 0;
    lastStep = step;
    cum += step;
    degrees.push(cum);
  }
  return degrees;
}

/* ─── Motif variation operators ─── */

export function varyMotif(motif: MotifSpec, variation: MotifVariation, rng: () => number): MotifSpec {
  switch (variation) {
    case "transpose": {
      const shift = (rng() < 0.5 ? 1 : 2) * (rng() < 0.5 ? 1 : -1);
      return {
        ...motif,
        degreeOffsets: motif.degreeOffsets.map((d) => d + shift),
        label: `${motif.label}-t${shift}`,
      };
    }
    case "invert":
      return {
        ...motif,
        degreeOffsets: motif.degreeOffsets.map((d) => -d),
        label: `${motif.label}-inv`,
      };
    case "rhythmShift": {
      let longest = 0;
      for (let i = 1; i < motif.events.length; i++) {
        if (motif.events[i].durationBeats > motif.events[longest].durationBeats) longest = i;
      }
      const ev = motif.events[longest];
      if (ev.durationBeats < 1) return { ...motif, label: `${motif.label}-r` };
      const half = snap(ev.durationBeats / 2);
      const events = [...motif.events];
      const degreeOffsets = [...motif.degreeOffsets];
      events.splice(longest, 1,
        { ...ev, durationBeats: half },
        { offsetBeats: ev.offsetBeats + half, durationBeats: ev.durationBeats - half, accent: false },
      );
      degreeOffsets.splice(longest + 1, 0, degreeOffsets[longest]);
      return { events, degreeOffsets, lengthBeats: motif.lengthBeats, label: `${motif.label}-r` };
    }
  }
}

/** Truncate a motif to fit a shorter window, extending the last kept note. */
export function truncateMotif(motif: MotifSpec, lengthBeats: number): MotifSpec {
  const length = Math.max(GRID, snap(lengthBeats));
  if (length >= motif.lengthBeats) return motif;
  const keep = motif.events.filter((e) => e.offsetBeats < length);
  const events = keep.map((e, i) => ({
    ...e,
    durationBeats: i === keep.length - 1
      ? Math.min(e.durationBeats, length - e.offsetBeats)
      : e.durationBeats,
  }));
  return {
    events,
    degreeOffsets: motif.degreeOffsets.slice(0, events.length),
    lengthBeats: length,
    label: `${motif.label}-cut${length}`,
  };
}

/* ─── Layout: phrases → placed events ─── */

/** Degree of the pickup relative to the note it leads into (Essen pickup intervals). */
function pickupDegree(target: number, rng: () => number): number {
  const r = rng();
  if (r < 0.2) return target;        // repeated
  if (r < 0.48) return target - 1;   // step below
  if (r < 0.7) return target - 3;    // a fourth below (5̂ → 1̂)
  if (r < 0.88) return target + 1;   // step above
  return target - 2;                 // a third below
}

/**
 * Degree contour for a phrase body: the head window reuses the basic idea,
 * the rest walks on from it toward the cadence, rising into the local peak
 * and settling afterwards. Restatements copy the head degrees; departures
 * sequence the head fragment downward (the Fonte); conclusions liquidate.
 */
function phraseDegrees(
  phrase: PhraseSpec,
  events: RhythmEvent[],
  motifA: MotifSpec,
  headDegrees: number[] | null,
  profile: MoodProfile,
  rng: () => number,
): number[] {
  const body = events.filter((e) => !e.isPickup);
  const degrees: number[] = new Array(body.length).fill(0);
  const headEnd = phrase.startBeat + 4;
  const headIdx = body.map((e, i) => (e.startBeat < headEnd ? i : -1)).filter((i) => i >= 0);

  // Head: the basic idea's contour mapped by nearest onset.
  const source = headDegrees ?? motifA.degreeOffsets;
  const sourceOnsets = motifA.events.map((e) => e.offsetBeats);
  for (const i of headIdx) {
    const rel = body[i].startBeat - phrase.startBeat;
    let best = 0;
    for (let k = 1; k < sourceOnsets.length; k++) {
      if (Math.abs(sourceOnsets[k] - rel) < Math.abs(sourceOnsets[best] - rel)) best = k;
    }
    degrees[i] = source[Math.min(best, source.length - 1)] ?? 0;
  }

  // Tail: continue the walk from the head's last degree.
  const tailStart = headIdx.length;
  if (tailStart < body.length) {
    const from = degrees[Math.max(0, tailStart - 1)];
    let tail: number[];
    if (phrase.material === "B") {
      // Fragment of the head, sequenced a step lower each time, then a rise.
      const frag = source.slice(0, Math.max(2, Math.ceil(source.length / 2)));
      tail = [];
      let shift = 0;
      while (tail.length < body.length - tailStart) {
        for (const d of frag) {
          if (tail.length >= body.length - tailStart) break;
          tail.push(d + shift);
        }
        shift -= 1;
      }
    } else {
      tail = walkDegrees(body.length - tailStart + 1, profile, rng, from).slice(1);
    }
    for (let i = 0; i < tail.length; i++) degrees[tailStart + i] = tail[i];
  }

  // The local peak is the phrase's highest degree, approached from below.
  const peakIdx = body.findIndex((e) => e.isPeak);
  if (peakIdx >= 0) {
    const max = Math.max(...degrees.filter((_, i) => i !== peakIdx));
    degrees[peakIdx] = max + 1;
    if (peakIdx > 0 && degrees[peakIdx - 1] >= degrees[peakIdx]) {
      degrees[peakIdx - 1] = degrees[peakIdx] - (rng() < 0.6 ? 2 : 1);
    }
    for (let i = peakIdx + 1; i < degrees.length; i++) {
      if (degrees[i] >= degrees[peakIdx]) degrees[i] = degrees[peakIdx] - 1 - (i - peakIdx > 1 ? 1 : 0);
    }
  }

  // Liquidation toward the cadence: the last few notes descend by step.
  if (phrase.material === "A''" || phrase.isFinal) {
    const n = degrees.length;
    const tailLen = Math.min(3, n - 1);
    for (let k = 1; k <= tailLen; k++) {
      const i = n - 1 - k;
      if (i <= (peakIdx >= 0 ? peakIdx : 0)) break;
      degrees[i] = degrees[n - 1] + k;
    }
  }

  return degrees;
}

/**
 * Lay the basic idea out across the phrase plan. Each phrase gets its rhythm
 * from the vocabulary (restatements copy the phrase they restate), a degree
 * contour, pattern keys that make the realization replay restated heads, and
 * flags for its pickup, peak and cadence notes.
 */
export function layoutMotifs(
  plan: PhrasePlan,
  motifA: MotifSpec,
  profile: MoodProfile,
  rng: () => number,
  style: MelodyStyle = "lyrical",
): PlacedEvent[] {
  const headCell = motifA.lengthBeats >= 4 ? motifA.events.map((e) => e.offsetBeats) : null;
  const vocab = pickVocabulary(profile, style, headCell, rng);
  const rhythms: RhythmEvent[][] = [];
  const events: PlacedEvent[] = [];
  let nextInstance = 0;
  const headDegreesByPhrase = new Map<number, number[]>();

  for (const phrase of plan.phrases) {
    const restated = phrase.restates !== null ? rhythms[phrase.restates] : null;
    const template = restated
      ? restated.filter((e) => !e.isPickup && !e.isFinal).map((e) => e.startBeat - plan.phrases[phrase.restates!].startBeat)
      : null;
    const rhythm = planPhraseRhythm(phrase, plan, profile, style, vocab, rng, template);
    rhythms.push(rhythm);
    if (rhythm.length === 0) continue;

    const headSource = phrase.restates !== null ? headDegreesByPhrase.get(phrase.restates) ?? null : null;
    const headOwner = phrase.restates !== null && phrase.replaysPitches ? phrase.restates : phrase.index;
    const degrees = phraseDegrees(phrase, rhythm, motifA, headSource, profile, rng);
    const body = rhythm.filter((e) => !e.isPickup);
    const headEnd = phrase.startBeat + 4;
    headDegreesByPhrase.set(phrase.index, body.filter((e) => e.startBeat < headEnd).map((_, i) => degrees[i]));

    const segmentRole = plan.segments[phrase.index]?.role ?? "development";
    const headKey = `head:${headOwner}`;
    const headInstance = nextInstance++;
    const tailInstance = nextInstance++;
    const pickupInstance = nextInstance++;

    // Pickups lead into the head: a step or a fourth below its first note.
    const pickups = rhythm.filter((e) => e.isPickup);
    const firstDegree = degrees[0] ?? 0;
    pickups.forEach((e, i) => {
      events.push({
        startBeat: e.startBeat,
        durationBeats: e.durationBeats,
        accent: false,
        weight: e.weight,
        degreeOffset: i === pickups.length - 1 ? pickupDegree(firstDegree, rng) : firstDegree - 2,
        patternKey: `pickup:${phrase.index}`,
        instanceId: pickupInstance,
        indexInInstance: i,
        segmentRole: "pickup",
        isCadenceFinal: false,
        phraseIndex: phrase.index,
        isPhraseFinal: false,
        isPeak: false,
        isPickup: true,
      });
    });

    let headIndex = 0;
    let tailIndex = 0;
    body.forEach((e, i) => {
      const inHead = e.startBeat < headEnd && !e.isFinal;
      events.push({
        startBeat: e.startBeat,
        durationBeats: e.durationBeats,
        accent: e.weight >= 2,
        weight: e.weight,
        degreeOffset: degrees[i],
        patternKey: inHead ? headKey : `tail:${phrase.index}`,
        instanceId: inHead ? headInstance : tailInstance,
        indexInInstance: inHead ? headIndex++ : tailIndex++,
        segmentRole,
        isCadenceFinal: phrase.isFinal && e.isFinal,
        phraseIndex: phrase.index,
        isPhraseFinal: e.isFinal,
        isPeak: e.isPeak,
        isPickup: false,
      });
    });
  }

  events.sort((a, b) => a.startBeat - b.startBeat);
  return events;
}
