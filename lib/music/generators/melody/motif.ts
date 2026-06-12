/**
 * Motif-based composition.
 *
 * Melodies are built from small reusable cells: a rhythmic pattern plus a
 * scale-degree contour. Motif A is stated in the intro, varied (transposed /
 * inverted / rhythm-shifted) in the development, densified and lifted at the
 * climax, and dissolved into a pickup + long resolving note at the cadence.
 * Repetition with variation is what makes the result hummable.
 */

import type { MoodProfile } from "./moods";
import type { PhrasePlan, PhraseSegment } from "./phrasePlan";

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
  /** Scale-degree offset from the instance anchor pitch. */
  degreeOffset: number;
  /** Identifies the motif pattern, for memoized (repeatable) realization. */
  patternKey: string;
  /** Groups events that belong to one motif statement. */
  instanceId: number;
  indexInInstance: number;
  segmentRole: PhraseSegment["role"] | "pickup";
  /** The final resolving note of the melody. */
  isCadenceFinal: boolean;
};

const GRID = 0.5;

function snapToGrid(beats: number): number {
  return Math.round(beats / GRID) * GRID;
}

/* ─── Motif generation ─── */

/**
 * Generate a rhythmic cell + degree contour of the given length.
 * Onsets sit on a 0.5-beat grid; density, syncopation, rests, and the
 * closing long note are all mood-driven.
 */
export function generateMotif(
  profile: MoodProfile,
  lengthBeats: number,
  rng: () => number,
  label: string,
): MotifSpec {
  const length = Math.max(GRID, snapToGrid(lengthBeats));

  // Decide how many onsets this cell gets.
  const notesPerBeat = 0.5 + profile.rhythmDensity * 1.5;
  const maxOnsets = Math.round(length / GRID);
  const count = Math.max(1, Math.min(maxOnsets, Math.round(length * notesPerBeat)));

  // Choose onset positions: always start on the downbeat, then draw from
  // on-beat positions (or off-beat ones when syncopating).
  const onBeats: number[] = [];
  const offBeats: number[] = [];
  for (let p = GRID; p < length; p += GRID) {
    if (p % 1 === 0) onBeats.push(p);
    else offBeats.push(p);
  }
  const chosen = new Set<number>([0]);
  while (chosen.size < count) {
    const wantOff = rng() < profile.syncopationChance;
    const primary = wantOff ? offBeats : onBeats;
    const fallback = wantOff ? onBeats : offBeats;
    const pool = primary.filter((p) => !chosen.has(p));
    const alt = fallback.filter((p) => !chosen.has(p));
    const source = pool.length > 0 ? pool : alt;
    if (source.length === 0) break;
    chosen.add(source[Math.floor(rng() * source.length)]);
  }

  // Long-note bias: clear late onsets so the cell ends with a sustained note.
  let onsets = Array.from(chosen).sort((a, b) => a - b);
  if (onsets.length > 2 && rng() < profile.longNoteBias) {
    const lastAllowed = length - 1;
    const trimmed = onsets.filter((p) => p <= lastAllowed);
    if (trimmed.length >= 2) onsets = trimmed;
  }

  // Durations: each note lasts until the next onset (or the cell end).
  const events: MotifEvent[] = onsets.map((p, i) => ({
    offsetBeats: p,
    durationBeats: (i + 1 < onsets.length ? onsets[i + 1] : length) - p,
    accent: p % 1 === 0,
  }));

  // Breathing room: shorten one middle note to carve a rest.
  if (events.length >= 3 && rng() < profile.restChance) {
    const idx = 1 + Math.floor(rng() * (events.length - 2));
    const ev = events[idx];
    if (ev.durationBeats >= 1) {
      ev.durationBeats = snapToGrid(ev.durationBeats / 2);
    }
  }

  // Degree contour: mostly steps, occasional mood-gated leaps, gently pulled
  // back toward the anchor so the cell stays singable.
  const degreeOffsets: number[] = [0];
  let cum = 0;
  for (let i = 1; i < events.length; i++) {
    let step: number;
    if (rng() < profile.leapChance) {
      step = (rng() < 0.5 ? -1 : 1) * (rng() < 0.3 ? 3 : 2);
    } else {
      step = rng() < 0.25 ? 0 : rng() < 0.5 ? -1 : 1;
    }
    if (cum >= 3 && step > 0) step = -step;
    if (cum <= -3 && step < 0) step = -step;
    cum = Math.max(-4, Math.min(4, cum + step));
    degreeOffsets.push(cum);
  }

  return { events, degreeOffsets, lengthBeats: length, label };
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
      // Split the longest note into two halves, repeating its degree —
      // same pitches, new rhythm.
      let longest = 0;
      for (let i = 1; i < motif.events.length; i++) {
        if (motif.events[i].durationBeats > motif.events[longest].durationBeats) longest = i;
      }
      const ev = motif.events[longest];
      if (ev.durationBeats < 1) return { ...motif, label: `${motif.label}-r` };
      const half = snapToGrid(ev.durationBeats / 2);
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
  const length = Math.max(GRID, snapToGrid(lengthBeats));
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

/** Climax treatment: split sustained notes so the peak gains momentum. */
function densifyMotif(motif: MotifSpec): MotifSpec {
  const events: MotifEvent[] = [];
  const degreeOffsets: number[] = [];
  for (let i = 0; i < motif.events.length; i++) {
    const ev = motif.events[i];
    if (ev.durationBeats >= 2) {
      const half = snapToGrid(ev.durationBeats / 2);
      events.push({ ...ev, durationBeats: half });
      degreeOffsets.push(motif.degreeOffsets[i]);
      events.push({ offsetBeats: ev.offsetBeats + half, durationBeats: ev.durationBeats - half, accent: false });
      degreeOffsets.push(motif.degreeOffsets[i] + 1);
    } else {
      events.push(ev);
      degreeOffsets.push(motif.degreeOffsets[i]);
    }
  }
  return { events, degreeOffsets, lengthBeats: motif.lengthBeats, label: `${motif.label}-clx` };
}

/* ─── Layout: tile motifs into the phrase plan ─── */

const VARIATIONS: MotifVariation[] = ["transpose", "invert", "rhythmShift"];

function placeInstance(
  motif: MotifSpec,
  startBeat: number,
  windowBeats: number,
  segmentRole: PlacedEvent["segmentRole"],
  instanceId: number,
): PlacedEvent[] {
  const fitted = truncateMotif(motif, windowBeats);
  return fitted.events.map((ev, i) => ({
    startBeat: startBeat + ev.offsetBeats,
    durationBeats: ev.durationBeats,
    accent: ev.accent,
    degreeOffset: fitted.degreeOffsets[i],
    patternKey: fitted.label,
    instanceId,
    indexInInstance: i,
    segmentRole,
    isCadenceFinal: false,
  }));
}

/**
 * Build the cadence cell: optional lead-in material from motif A, then a
 * long resolving note (≥ 2 beats where space allows).
 */
function placeCadence(
  segment: PhraseSegment,
  motifA: MotifSpec,
  instanceId: () => number,
): PlacedEvent[] {
  const segLen = segment.endBeat - segment.startBeat;
  const events: PlacedEvent[] = [];

  let finalDur: number;
  if (segLen <= 2.5) {
    finalDur = segLen;
  } else {
    finalDur = segLen >= 6 ? 4 : 2;
  }
  const leadLen = segLen - finalDur;

  if (leadLen >= 1) {
    events.push(...placeInstance(motifA, segment.startBeat, leadLen, "resolution", instanceId()));
  } else if (leadLen > 0) {
    // Fold a sub-beat remainder into the final note instead.
    finalDur = segLen;
  }

  events.push({
    startBeat: segment.endBeat - finalDur,
    durationBeats: finalDur,
    accent: true,
    degreeOffset: 0,
    patternKey: "cadence-final",
    instanceId: instanceId(),
    indexInInstance: 0,
    segmentRole: "resolution",
    isCadenceFinal: true,
  });

  return events;
}

/**
 * Fill every phrase segment with motif statements:
 * intro = A (repeated), development = A′ alternating with a response motif B
 * (call and response), climax = densified A, resolution = cadence cell.
 * Then add pickups into segment downbeats per the mood.
 */
export function layoutMotifs(
  plan: PhrasePlan,
  motifA: MotifSpec,
  profile: MoodProfile,
  rng: () => number,
): PlacedEvent[] {
  const variation = VARIATIONS[Math.floor(rng() * VARIATIONS.length)];
  const motifAPrime = varyMotif(motifA, variation, rng);
  const motifB = generateMotif(profile, motifA.lengthBeats, rng, "B");
  const motifClimax = densifyMotif(motifA);

  let nextInstance = 0;
  const instanceId = () => nextInstance++;
  const events: PlacedEvent[] = [];

  for (const segment of plan.segments) {
    if (segment.motifSlot === "cadence") {
      events.push(...placeCadence(segment, motifA, instanceId));
      continue;
    }

    const motifs: MotifSpec[] =
      segment.motifSlot === "A" ? [motifA]
      : segment.motifSlot === "A'" ? [motifAPrime, motifB]
      : [motifClimax];

    let cursor = segment.startBeat;
    let tile = 0;
    while (cursor < segment.endBeat - 1e-9) {
      const motif = motifs[tile % motifs.length];
      const window = Math.min(motif.lengthBeats, segment.endBeat - cursor);
      if (window < 1) {
        // Sub-beat remainder: extend the previous event to fill it.
        const last = events[events.length - 1];
        if (last) last.durationBeats += window;
        break;
      }
      events.push(...placeInstance(motif, cursor, window, segment.role, instanceId()));
      cursor += window;
      tile++;
    }
  }

  events.sort((a, b) => a.startBeat - b.startBeat);

  // Pickups: steal the last half-beat before a segment downbeat for a
  // lead-in note targeting the segment's opening.
  for (let s = 1; s < plan.segments.length; s++) {
    if (rng() >= profile.pickupChance) continue;
    const boundary = plan.segments[s].startBeat;
    const prevIdx = events.findIndex(
      (e) => !e.isCadenceFinal && e.startBeat < boundary && e.startBeat + e.durationBeats === boundary,
    );
    const firstNext = events.find((e) => e.startBeat >= boundary);
    if (prevIdx === -1 || !firstNext) continue;
    const prev = events[prevIdx];
    if (prev.durationBeats < 1) continue;
    prev.durationBeats -= GRID;
    events.push({
      startBeat: boundary - GRID,
      durationBeats: GRID,
      accent: false,
      degreeOffset: firstNext.degreeOffset - 1,
      patternKey: "pickup",
      instanceId: instanceId(),
      indexInInstance: 0,
      segmentRole: "pickup",
      isCadenceFinal: false,
    });
  }

  events.sort((a, b) => a.startBeat - b.startBeat);
  return events;
}
