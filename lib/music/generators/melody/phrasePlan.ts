/**
 * Form planning.
 *
 * Before any note is placed, the progression is cut into phrases the way a
 * songwriter hears it: two-bar units with a question-and-answer relation
 * (the period of Open Music Theory — an antecedent closing on a weak cadence,
 * a consequent that restates the opening and closes strongly), stacked for
 * longer forms as statement / restatement / departure / conclusion. Every
 * phrase knows how it ends (a half cadence on 2̂, 7̂ or 5̂ over a dominant; an
 * imperfect close on 3̂ or 5̂; the final phrase on 1̂ approached by step),
 * where its one local peak falls (about a third of the way in, the Essen
 * median), how high it may reach (only the climax phrase touches the top of
 * the register, so the melody has a single highest note), whether it begins
 * with a pickup and ends with a breath, and how dense it is.
 *
 * The climax phrase is chosen where the harmony is tense: tension comes from
 * the chord engine's own formula (see harmonicContext.ts), or from the curve
 * the caller supplies, not from a table keyed to position.
 *
 * Calibration: Essen Folksong Collection (6,059 songs, 35,043 phrases) — 62 %
 * of phrases are two bars, 62 % begin with a pickup of ½ or 1 beat, the final
 * note is 1.5× the phrase mean, non-final phrases end on 5̂/1̂/3̂/2̂ and final
 * phrases on 1̂ 84 % of the time; POP909 — the opening phrase is restated
 * immediately in 70 % of songs.
 */

import { buildHarmonicContext, type HarmonicContext, mod12 } from "./harmonicContext";
import { chordIndexAtBeat, durationClassToBeats } from "./helpers";
import { pickContour } from "./contour";
import { moodRegister, type MoodProfile } from "./moods";
import type { ContourShape, MelodyGenerationOptions, MelodyForm } from "./types";

export type PhraseSegmentRole = "intro" | "development" | "climax" | "resolution";

/** Legacy view of a phrase, kept for the ornament and scoring stages. */
export type PhraseSegment = {
  role: PhraseSegmentRole;
  startBeat: number;
  endBeat: number;
  motifSlot: "A" | "A'" | "climax" | "cadence";
  tension: number;
  isPhraseEnd: boolean;
};

export type CadenceType = "half" | "imperfect" | "authentic";
export type PhraseMaterial = "A" | "A'" | "B" | "A''";

export type PhraseSpec = {
  index: number;
  startBeat: number;
  endBeat: number;
  material: PhraseMaterial;
  /** Index of the phrase whose opening this one restates, or null. */
  restates: number | null;
  /**
   * The restated phrase sits over the same harmony, so the hook may return at
   * its own pitches. Otherwise only the rhythm is reused and the pitches are
   * re-composed against the new chords.
   */
  replaysPitches: boolean;
  cadence: CadenceType;
  isFinal: boolean;
  endChordIndex: number;
  /** Pitch class the phrase should end on, and ranked fallbacks. */
  endPc: number;
  endPcOptions: number[];
  isClimax: boolean;
  /** Absolute beat of the phrase's local peak. */
  peakBeat: number;
  /** Highest MIDI pitch the phrase may reach. */
  ceiling: number;
  /** MIDI pitch the phrase's opening gravitates to. */
  anchor: number;
  /** Beats of pickup the phrase begins with (carved from the previous phrase). */
  pickupBeats: number;
  /** Rest carved before the next phrase's pickup. */
  breathBeats: number;
  /** Minimum length of the phrase's final note. */
  finalNoteBeats: number;
  /** Relative note density (1 = the mood's own). */
  density: number;
  /** Mean chord tension across the phrase, 0–1. */
  tension: number;
};

export type PhrasePlan = {
  segments: PhraseSegment[];
  phrases: PhraseSpec[];
  totalBeats: number;
  contour: ContourShape;
  /** Beat of the melody's single highest note. */
  climaxBeat: number;
  chordStartBeats: number[];
  chordBeats: number[];
  tensionCurve: number[];
  harmony: HarmonicContext;
  form: "single" | "period" | "ternary" | "srdc" | "cycles";
  low: number;
  high: number;
};

export type PhrasePlanOptions = {
  octave?: number;
  tensionCurve?: number[];
  form?: MelodyForm;
  harmony?: HarmonicContext;
};

function weightedPick<T>(options: [T, number][], rng: () => number): T {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of options) {
    r -= w;
    if (r <= 0) return value;
  }
  return options[options.length - 1][0];
}

/** Snap a target beat to a chord start strictly inside (0, totalBeats). */
function nearestInteriorChordStart(target: number, chordStartBeats: number[], totalBeats: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const b of chordStartBeats) {
    if (b <= 0 || b >= totalBeats) continue;
    const d = Math.abs(b - target);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function phraseCount(totalBeats: number, chordCount: number, form: MelodyForm): number {
  if (chordCount <= 1 || totalBeats < 12) return 1;
  if (form === "single") return 1;
  if (form === "period") return 2;
  const auto = Math.max(2, Math.round(totalBeats / 8));
  // "cycles" asks for the four-part statement / restatement / departure /
  // conclusion shape, so it never collapses into a period the way the
  // length-driven default would on a short progression.
  const wanted = form === "cycles" ? Math.max(4, auto) : auto;
  return Math.min(wanted, chordCount);
}

/** Lift of phrase i (0–1) under a contour shape — where its register sits. */
function contourLift(shape: ContourShape, i: number, n: number): number {
  if (n <= 1) return 0.5;
  const t = i / (n - 1);
  switch (shape) {
    case "rising": return t;
    case "falling": return 1 - t;
    case "arch": return Math.sin(Math.PI * (i + 0.5) / n);
    case "inverted-arch": return 1 - Math.sin(Math.PI * (i + 0.5) / n);
    case "wave": return i % 2 === 0 ? 0.3 : 0.8;
    case "stair-step": return Math.min(1, Math.floor(t * 3 + 1e-9) / 2);
  }
}

export function buildPhrasePlan(
  chords: MelodyGenerationOptions["chords"],
  profile: MoodProfile,
  rng: () => number,
  options: PhrasePlanOptions = {},
): PhrasePlan {
  const octave = options.octave ?? 5;
  const form = options.form ?? "auto";
  const chordBeats = chords.map((c) => durationClassToBeats(c.durationClass));
  const chordStartBeats: number[] = [];
  let cursor = 0;
  for (const beats of chordBeats) {
    chordStartBeats.push(cursor);
    cursor += beats;
  }
  const totalBeats = cursor;
  const { low, high } = moodRegister(profile, octave);
  const span = high - low;

  const contour = pickContour(profile, rng);
  const harmony =
    options.harmony ??
    buildHarmonicContext(chords, chords.length ? scaleFromChords(chords) : [], { tensionCurve: options.tensionCurve });
  const scaleTension = (t: number) => Math.max(0, Math.min(1, t * profile.tensionScale));
  const tensionCurve = harmony.tensionCurve.map(scaleTension);
  const tonic = harmony.tonicPc;

  /* ── Phrase boundaries ── */
  const n = phraseCount(totalBeats, chords.length, form);
  const boundaries: number[] = [0];
  for (let k = 1; k < n; k++) {
    const snapped = nearestInteriorChordStart((totalBeats * k) / n, chordStartBeats, totalBeats);
    if (snapped !== null && snapped > boundaries[boundaries.length - 1] + 2) boundaries.push(snapped);
  }
  boundaries.push(totalBeats);
  const count = boundaries.length - 1;

  /* ── Materials: an idea returns where its harmony returns ── */
  const harmonicSignature = (i: number): string => {
    const parts: string[] = [];
    for (let c = 0; c < chords.length; c++) {
      const cs = chordStartBeats[c];
      if (cs + chordBeats[c] > boundaries[i] && cs < boundaries[i + 1]) {
        const ctx = harmony.chords[c];
        parts.push(`${ctx.rootPc}:${ctx.quality}`);
      }
    }
    return parts.join("|");
  };

  const materials: PhraseMaterial[] = [];
  const restatesOf: (number | null)[] = [];
  const replays: boolean[] = [];
  const bySignature = new Map<string, number>();
  let lastNew = 0;
  for (let i = 0; i < count; i++) {
    const signature = harmonicSignature(i);
    const match = bySignature.get(signature);
    if (i === 0) {
      bySignature.set(signature, 0);
      materials.push("A");
      restatesOf.push(null);
      replays.push(false);
    } else if (match !== undefined) {
      // Same chords underneath: the hook can come back as it was.
      materials.push(i === count - 1 ? "A''" : "A'");
      restatesOf.push(match);
      replays.push(true);
    } else {
      bySignature.set(signature, i);
      // New harmony. Alternate phrases keep the idea's rhythm with fresh
      // pitches ("same head, different tail" — the commonest real relation);
      // the rest depart.
      // A two-phrase form is a period: the consequent always answers the
      // antecedent with its idea.
      const reuseRhythm = i % 2 === 1;
      materials.push(reuseRhythm ? (i === count - 1 ? "A''" : "A'") : "B");
      restatesOf.push(reuseRhythm ? lastNew : null);
      // In a period the consequent opens with the basic idea itself, even
      // though the harmony under it has moved on; the realization bends the
      // notes that clash. In longer forms a phrase over new chords keeps only
      // the rhythm.
      replays.push(reuseRhythm && count === 2);
      if (!reuseRhythm) lastNew = i;
    }
  }

  // The climax goes where the harmony is tense. Each phrase is scored by the
  // tensest chord under it, with a preference for the classical position
  // (about two thirds of the way through) and away from the opening
  // statement, then the highest score wins.
  const phraseTension: number[] = [];
  for (let i = 0; i < count; i++) {
    let peak = 0;
    for (let c = 0; c < chords.length; c++) {
      const cs = chordStartBeats[c];
      if (cs + chordBeats[c] > boundaries[i] && cs < boundaries[i + 1]) peak = Math.max(peak, tensionCurve[c]);
    }
    phraseTension.push(peak);
  }
  let climaxIndex = 0;
  if (count > 1) {
    let bestScore = -Infinity;
    for (let i = 0; i < count; i++) {
      const position = count > 1 ? i / (count - 1) : 0;
      const prior = 1 - Math.abs(position - 0.62);
      const score = phraseTension[i] + 0.4 * prior - (i === 0 ? 0.35 : 0);
      if (score > bestScore) {
        bestScore = score;
        climaxIndex = i;
      }
    }
  }

  const phrases: PhraseSpec[] = [];
  for (let i = 0; i < count; i++) {
    const startBeat = boundaries[i];
    const endBeat = boundaries[i + 1];
    const length = endBeat - startBeat;
    const isFinal = i === count - 1;
    const material = materials[i];
    const restates = restatesOf[i];
    const replaysPitches = replays[i];

    const endChordIndex = chordIndexAtBeat(chordStartBeats, endBeat - 0.5);
    const endChord = harmony.chords[endChordIndex];
    const chordSet = new Set(endChord.pcs);
    const deg = (d: number) => mod12(tonic + d);
    const third = harmony.isMinorKey ? 3 : 4;

    let cadence: CadenceType;
    let endPcOptions: number[];
    if (isFinal) {
      cadence = "authentic";
      endPcOptions = rankBy([[deg(0), 0.8], [deg(third), 0.15], [deg(7), 0.05]], chordSet, rng);
    } else if (endChord.isDominantFunction) {
      cadence = "half";
      endPcOptions = rankBy([[deg(2), 0.5], [deg(11), 0.25], [deg(7), 0.25]], chordSet, rng);
    } else if (endChord.functionTag === "tonic") {
      cadence = "imperfect";
      endPcOptions = rankBy([[deg(third), 0.5], [deg(7), 0.35], [deg(0), 0.15]], chordSet, rng);
    } else {
      cadence = "half";
      const preferred = [deg(2), deg(7), deg(9), deg(third), deg(5)];
      const ranked = preferred.filter((pc) => chordSet.has(pc));
      endPcOptions = ranked.length ? ranked : endChord.pcs.filter((pc) => pc !== deg(0));
      if (rng() < 0.5 && endPcOptions.length > 1) endPcOptions = [endPcOptions[1], endPcOptions[0], ...endPcOptions.slice(2)];
    }
    if (endPcOptions.length === 0) endPcOptions = [...endChord.pcs];
    for (const pc of endChord.pcs) if (!endPcOptions.includes(pc)) endPcOptions.push(pc);

    const isClimax = i === climaxIndex;
    const lift = contourLift(contour, i, count);
    // A restatement sits where the idea it restates sat: a hook returns at
    // its own pitch. Other phrases follow the contour shape.
    const restated = restates !== null ? phrases[restates] : null;
    // A returning idea comes back in its own register — except at the close,
    // where the phrase still restates the idea but settles, so the melody can
    // resolve downward instead of ending stranded at the top of its range.
    const inheritsRegister = restated !== null && replaysPitches && !isFinal;
    const anchor = inheritsRegister
      ? restated!.anchor
      : Math.round(low + span * (0.25 + 0.35 * (isFinal ? Math.min(lift, 0.4) : lift))) + (isClimax ? 2 : 0);
    // How far above its home register the phrase reaches. Real phrases span
    // about a fifth (Essen and Rolling Stone both put the median phrase range
    // at 6–7 semitones), so the peak is a leap away from the line, not an
    // octave: a wider reach is what made every phrase lurch to its top note
    // and back. The reach is fixed per role rather than drawn, so a
    // restatement returns to exactly the register it had.
    const ceiling = Math.min(high, anchor + (isClimax ? 8 : 5));

    // Local peak about a third of the way in, on a beat; a restatement peaks
    // where its model peaked.
    let peakBeat: number;
    if (restated && inheritsRegister) {
      const rel = restated.peakBeat - restated.startBeat;
      // A restated head replays at its own pitch, so a climax that restates
      // rises in its contrasting tail instead of inside the hook.
      peakBeat = isClimax && rel < 4 ? startBeat + 4 + (rng() < 0.5 ? 0 : 1) : startBeat + rel;
    } else if (isClimax) {
      // Put the melody's high point over the chord that carries the most
      // tension, so the peak and the harmony arrive together.
      let tensest = startBeat;
      let best = -Infinity;
      for (let c = 0; c < chords.length; c++) {
        const cs = chordStartBeats[c];
        if (cs + chordBeats[c] <= startBeat || cs >= endBeat) continue;
        if (tensionCurve[c] > best) {
          best = tensionCurve[c];
          tensest = Math.max(startBeat, cs);
        }
      }
      peakBeat = Math.round(tensest + (rng() < 0.5 ? 0 : 1));
    } else {
      // Phrases peak about a third of the way in (Essen median 0.33, POP909
      // 0.28); the closing phrase peaks earlier still and then descends.
      const frac = isFinal ? 0.15 + rng() * 0.2 : 0.2 + rng() * 0.25;
      peakBeat = Math.round(startBeat + frac * length);
    }
    peakBeat = Math.min(endBeat - 2, Math.max(startBeat + 1, peakBeat));

    const pickupBeats =
      i === 0 || length < 6 ? 0 : rng() < profile.pickupChance ? (rng() < 0.6 || length < 10 ? 0.5 : 1) : 0;
    const finalNoteBeats = length >= 8 ? 2 : length >= 6 ? 1.5 : 1;

    let tensionSum = 0;
    let tensionCount = 0;
    for (let c = 0; c < chords.length; c++) {
      const cs = chordStartBeats[c];
      const ce = cs + chordBeats[c];
      if (ce > startBeat && cs < endBeat) {
        tensionSum += tensionCurve[c];
        tensionCount++;
      }
    }
    const tension = tensionCount ? tensionSum / tensionCount : 0.3;
    const density = isClimax ? 1.15 : material === "B" ? 1.05 : isFinal ? 0.9 : 1;

    phrases.push({
      index: i,
      startBeat,
      endBeat,
      material,
      restates,
      replaysPitches,
      cadence,
      isFinal,
      endChordIndex,
      endPc: endPcOptions[0],
      endPcOptions,
      isClimax,
      peakBeat,
      ceiling,
      anchor,
      pickupBeats,
      breathBeats: 0,
      finalNoteBeats,
      density,
      tension,
    });
  }

  // Breaths: a rest carved before the next phrase's pickup, longer for slow moods.
  for (let i = 0; i < phrases.length - 1; i++) {
    const next = phrases[i + 1];
    const length = phrases[i].endBeat - phrases[i].startBeat;
    const room = length - phrases[i].finalNoteBeats - next.pickupBeats - 2;
    let breath: number;
    if (profile.rhythmDensity >= 0.7) breath = rng() < 0.5 ? 0.5 : 0;
    else if (length >= 12 && rng() < 0.35) breath = 1;
    else breath = rng() < 0.7 ? 0.5 : 0;
    if (breath > room) breath = Math.max(0, Math.min(breath, room));
    phrases[i].breathBeats = breath;
  }

  // One high point: the climax phrase is lifted clear of the tallest of the
  // others, so nothing else can reach its note.
  if (phrases.length > 1) {
    const climax = phrases[climaxIndex];
    const tallestOther = Math.max(...phrases.filter((p) => !p.isClimax).map((p) => p.ceiling));
    const wanted = Math.min(high, Math.max(climax.ceiling, tallestOther + 3));
    if (wanted > climax.ceiling) climax.ceiling = wanted;
    // If the register has no room above the others, lower them instead.
    if (climax.ceiling <= tallestOther) {
      const cap = Math.max(climax.anchor, climax.ceiling - 3);
      for (const p of phrases) {
        if (p.isClimax) continue;
        // Never below the phrase's own home register: its line has to have
        // somewhere to rise to.
        p.ceiling = Math.max(p.anchor + 2, Math.min(p.ceiling, cap));
      }
    }
  }

  // The peak needs room: once breaths and pickups are fixed, keep every peak
  // clear of the phrase's final note so the rhythm can give it an onset.
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    const next = phrases[i + 1];
    const bodyEnd = p.endBeat - p.breathBeats - (next?.pickupBeats ?? 0);
    // `layoutOf` in rhythm.ts may pull the final note a half-beat earlier to
    // start it on a beat, so leave a full beat of room and snap downward.
    const latest = bodyEnd - p.finalNoteBeats - 1;
    if (p.peakBeat > latest) p.peakBeat = Math.max(Math.min(p.startBeat + 1, latest), Math.floor(latest));
  }

  /* ── Legacy segments ── */
  const segments: PhraseSegment[] = phrases.map((p, i) => {
    const role: PhraseSegmentRole =
      p.isFinal ? "resolution" : p.isClimax ? "climax" : i === 0 ? "intro" : "development";
    return {
      role,
      startBeat: p.startBeat,
      endBeat: p.endBeat,
      motifSlot: p.isFinal ? "cadence" : p.isClimax ? "climax" : i === 0 ? "A" : "A'",
      tension: p.tension,
      isPhraseEnd: p.isFinal,
    };
  });

  const formName: PhrasePlan["form"] =
    count === 1 ? "single" : count === 2 ? "period" : count === 3 ? "ternary" : count === 4 ? "srdc" : "cycles";

  return {
    segments,
    phrases,
    totalBeats,
    contour,
    climaxBeat: phrases[climaxIndex].peakBeat,
    chordStartBeats,
    chordBeats,
    tensionCurve,
    harmony,
    form: formName,
    low,
    high,
  };
}

/** Rank weighted degree options that the chord actually contains, by a seeded draw. */
function rankBy(options: [number, number][], chordSet: Set<number>, rng: () => number): number[] {
  const present = options.filter(([pc]) => chordSet.has(pc));
  const ranked: number[] = [];
  const pool = [...present];
  while (pool.length > 0) {
    const pick = weightedPick(pool, rng);
    ranked.push(pick);
    pool.splice(pool.findIndex(([pc]) => pc === pick), 1);
  }
  return ranked;
}

/** When a caller builds a plan without a scale, infer one from the chords' tones. */
function scaleFromChords(chords: MelodyGenerationOptions["chords"]) {
  const seen = new Set<string>();
  const out: MelodyGenerationOptions["scalePitchClasses"] = [];
  for (const c of chords) {
    for (const pc of c.pitchClasses) {
      if (!seen.has(pc)) {
        seen.add(pc);
        out.push(pc);
      }
    }
  }
  return out;
}

/** The phrase sounding at an absolute beat (pickups belong to the phrase they lead into). */
export function phraseAtBeat(plan: PhrasePlan, beat: number): PhraseSpec {
  // Searched from the end so a pickup, which sounds inside the previous
  // phrase's span, belongs to the phrase it leads into.
  for (let i = plan.phrases.length - 1; i >= 0; i--) {
    const p = plan.phrases[i];
    if (beat >= p.startBeat - p.pickupBeats && beat < p.endBeat) return p;
  }
  return plan.phrases[0];
}

/**
 * Register target for a beat: rises from the phrase's anchor to its ceiling at
 * the local peak and settles back toward the anchor by the end. Realization
 * treats it as gravity; scoring measures adherence to it.
 */
export function planTargetAt(plan: PhrasePlan, beat: number): number {
  const p = phraseAtBeat(plan, beat);
  const start = p.startBeat - p.pickupBeats;
  const settle = Math.max(p.anchor - 2, plan.low);
  if (beat <= p.peakBeat) {
    const t = p.peakBeat > start ? (beat - start) / (p.peakBeat - start) : 1;
    return p.anchor + (p.ceiling - p.anchor) * Math.max(0, Math.min(1, t));
  }
  const t = p.endBeat > p.peakBeat ? (beat - p.peakBeat) / (p.endBeat - p.peakBeat) : 1;
  return p.ceiling + (settle - p.ceiling) * Math.max(0, Math.min(1, t));
}
