/**
 * Catchiness scoring, calibrated against real melodies.
 *
 * Every candidate melody is scored on what memorable lines have in common,
 * with targets taken from the Essen Folksong Collection (293k intervals) and
 * the Rolling Stone 200 pop melodies (59k notes): an interval mix of about
 * half steps and a fifth to a quarter repeated notes, leaps of a fifth or more
 * reversed three times in four, one highest note reached once by leap and
 * left by step, chord tones on the long and strong notes rather than
 * everywhere, phrases that end on the planned degree with a long note and a
 * breath, and rhythm that recurs without becoming a machine. The orchestrator
 * generates several candidates and keeps one of the best.
 */

import { isChordTone } from "./helpers";
import { midiPc, tendencyOf } from "./harmonicContext";
import { metricWeight } from "./meter";
import type { MoodProfile } from "./moods";
import { planTargetAt, type PhrasePlan } from "./phrasePlan";
import { syncopationPerBar } from "./rhythm";
import type { MelodyGenerationOptions, MelodyNote } from "./types";

export type MelodyScore = {
  total: number;
  breakdown: {
    motifRepetition: number;
    contour: number;
    chordAlignment: number;
    voiceLeading: number;
    expectation: number;
    phraseEnding: number;
    cadences: number;
    climax: number;
    rhythmicInterest: number;
    tendency: number;
    breath: number;
    range: number;
    penalties: number;
  };
};

/* ── Motif repetition: repeated (interval, duration) n-grams ── */

/**
 * Fraction of the melody covered by 3-event patterns that occur at least
 * twice. Matching is transposition-invariant (intervals, not pitches) and
 * tolerates ±1 semitone so harmony snapping doesn't erase repetition credit.
 */
export function motifRepetitionCoverage(notes: MelodyNote[]): number {
  if (notes.length < 6) return 0;
  const grams: { intervals: number[]; durations: number[] }[] = [];
  for (let i = 0; i + 3 < notes.length; i++) {
    grams.push({
      intervals: [
        notes[i + 1].midi - notes[i].midi,
        notes[i + 2].midi - notes[i + 1].midi,
        notes[i + 3].midi - notes[i + 2].midi,
      ],
      durations: [
        notes[i].durationBeats,
        notes[i + 1].durationBeats,
        notes[i + 2].durationBeats,
      ],
    });
  }

  const matches = (a: typeof grams[number], b: typeof grams[number]) =>
    a.intervals.every((v, k) => Math.abs(v - b.intervals[k]) <= 1) &&
    a.durations.every((v, k) => v === b.durations[k]);

  const covered = new Set<number>();
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 4; j < grams.length; j++) {
      if (matches(grams[i], grams[j])) {
        for (let k = 0; k < 4; k++) {
          covered.add(i + k);
          covered.add(j + k);
        }
      }
    }
  }
  return covered.size / notes.length;
}

/* ── Helpers ── */

/** Credit `w` in full inside [lo, hi], falling linearly to 0 over `tol` outside it. */
function band(x: number, lo: number, hi: number, tol: number, w: number): number {
  if (x >= lo && x <= hi) return w;
  const dist = x < lo ? lo - x : x - hi;
  return Math.max(0, w * (1 - dist / tol));
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

function contourCorrelation(notes: MelodyNote[], plan: PhrasePlan): number {
  if (notes.length < 3 || plan.totalBeats <= 0) return 0;
  const realized: number[] = [];
  const planned: number[] = [];
  let ni = 0;
  for (let beat = 0; beat < plan.totalBeats; beat += 1) {
    while (ni + 1 < notes.length && notes[ni + 1].startBeat <= beat) ni++;
    realized.push(notes[ni].midi);
    planned.push(planTargetAt(plan, beat));
  }
  return pearson(realized, planned);
}

/* ── Main scorer ── */

export function scoreMelody(
  notes: MelodyNote[],
  plan: PhrasePlan,
  chords: MelodyGenerationOptions["chords"],
  profile: MoodProfile,
  octave: number,
): MelodyScore {
  void octave;
  const breakdown: MelodyScore["breakdown"] = {
    motifRepetition: 0,
    contour: 0,
    chordAlignment: 0,
    voiceLeading: 0,
    expectation: 0,
    phraseEnding: 0,
    cadences: 0,
    climax: 0,
    rhythmicInterest: 0,
    tendency: 0,
    breath: 0,
    range: 0,
    penalties: 0,
  };

  const n = notes.length;
  if (n === 0) return { total: -100, breakdown };
  const hc = plan.harmony;
  const pcsOf = (i: number) => chords[i]?.pitchClasses ?? [];

  // Motif repetition (+20): a band, not a maximum — wall-to-wall repetition is
  // monotony (Essen phrase-level coverage averages 0.65).
  const coverage = motifRepetitionCoverage(notes);
  breakdown.motifRepetition = band(coverage, 0.35, 0.8, 0.35, 20);
  if (n >= 8 && coverage === 0) breakdown.penalties -= 15;

  // Contour adherence (+10).
  breakdown.contour = Math.max(0, contourCorrelation(notes, plan)) * 10;

  // Harmony (+15): chord tones on the long, strong notes; less strictly elsewhere.
  {
    let strongTotal = 0;
    let strongCT = 0;
    let weakTotal = 0;
    let weakCT = 0;
    for (const x of notes) {
      const w = metricWeight(x.startBeat);
      const ct = isChordTone(x.midi, pcsOf(x.chordIndex));
      if (w >= 3 || x.durationBeats >= 1.5) {
        strongTotal++;
        if (ct) strongCT++;
      } else {
        weakTotal++;
        if (ct) weakCT++;
      }
    }
    const strongRate = strongTotal ? strongCT / strongTotal : 1;
    const weakRate = weakTotal ? weakCT / weakTotal : 0.6;
    breakdown.chordAlignment = band(strongRate, 0.8, 1, 0.4, 10) + band(weakRate, 0.45, 0.85, 0.35, 5);
  }

  // Interval mix (+10): Essen/RS200 — steps 40–55 %, repeats 15–32 %, mean |interval| ≈ 2.
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) intervals.push(notes[i].midi - notes[i - 1].midi);
  if (intervals.length > 0) {
    const steps = intervals.filter((v) => Math.abs(v) >= 1 && Math.abs(v) <= 2).length / intervals.length;
    const unisons = intervals.filter((v) => v === 0).length / intervals.length;
    const meanAbs = intervals.reduce((s, v) => s + Math.abs(v), 0) / intervals.length;
    breakdown.voiceLeading =
      band(steps, 0.38, 0.58, 0.25, 4) +
      band(unisons, 0.1, 0.32, 0.2, 3) +
      band(meanAbs, 1.7, 2.6, 1.2, 3);
  }

  // Expectation (+10): leaps of a fourth or more reverse (75–90 %); same-direction
  // leap chains are rare; after a step, a step in the same direction is common.
  {
    let leaps = 0;
    let reversed = 0;
    let chains = 0;
    for (let i = 1; i < intervals.length; i++) {
      const I = intervals[i - 1];
      const R = intervals[i];
      if (Math.abs(I) >= 5) {
        leaps++;
        if (R === 0 || Math.sign(R) !== Math.sign(I)) reversed++;
        if (Math.sign(R) === Math.sign(I) && Math.abs(R) >= 3) chains++;
      }
    }
    const reversal = leaps ? reversed / leaps : 0.85;
    const chainRate = leaps ? chains / leaps : 0;
    breakdown.expectation = band(reversal, 0.7, 1, 0.5, 7) + band(chainRate, 0, 0.1, 0.3, 3);
  }

  // Phrase ending (+15): long final note, on a stable tone of the last chord, by step.
  const last = notes[n - 1];
  const lastChord = chords[chords.length - 1];
  {
    let ending = 0;
    if (last.durationBeats >= 2) ending += 6;
    else if (last.durationBeats >= 1) ending += 3;
    if (lastChord && isChordTone(last.midi, lastChord.pitchClasses)) ending += 6;
    if (n > 1 && Math.abs(last.midi - notes[n - 2].midi) <= 2) ending += 3;
    breakdown.phraseEnding = Math.min(15, ending);
  }

  // Cadences (+8): every phrase ends on its planned degree with a lengthened note.
  {
    let credit = 0;
    for (const p of plan.phrases) {
      const inPhrase = notes.filter((x) => x.startBeat >= p.startBeat - p.pickupBeats && x.startBeat < p.endBeat);
      if (inPhrase.length === 0) continue;
      const fin = inPhrase[inPhrase.length - 1];
      let c = 0;
      if (midiPc(fin.midi) === p.endPc) c += 0.6;
      else if (p.endPcOptions.includes(midiPc(fin.midi))) c += 0.35;
      const mean = inPhrase.reduce((s, x) => s + x.durationBeats, 0) / inPhrase.length;
      if (fin.durationBeats >= Math.max(1, 1.5 * mean)) c += 0.4;
      credit += c;
    }
    breakdown.cadences = (credit / plan.phrases.length) * 8;
  }

  // Climax (+10): one highest note, in the climax phrase, reached by leap, left by step.
  {
    const peak = Math.max(...notes.map((x) => x.midi));
    const peakNotes = notes.filter((x) => x.midi === peak);
    const first = peakNotes[0];
    const idx = notes.indexOf(first);
    let c = 0;
    if (peakNotes.length === 1) c += 4;
    else if (peakNotes.length === 2) c += 1.5;
    const climaxPhrase = plan.phrases.find((p) => p.isClimax);
    if (climaxPhrase && first.startBeat >= climaxPhrase.startBeat - climaxPhrase.pickupBeats && first.startBeat < climaxPhrase.endBeat) c += 3;
    if (idx > 0 && first.midi - notes[idx - 1].midi >= 3) c += 1.5;
    else if (idx > 0 && first.midi - notes[idx - 1].midi > 0) c += 0.75;
    if (idx + 1 < n) {
      const leave = notes[idx + 1].midi - first.midi;
      if (leave < 0 && leave >= -2) c += 1.5;
      else if (leave < 0) c += 0.5;
    }
    breakdown.climax = Math.min(10, c);
  }

  // Rhythm (+10): a few distinct durations, syncopation near the mood's taste,
  // and a line that thins toward its ends.
  {
    const durCounts = new Map<number, number>();
    for (const x of notes) durCounts.set(x.durationBeats, (durCounts.get(x.durationBeats) ?? 0) + 1);
    const distinct = durCounts.size;
    let c = distinct >= 2 && distinct <= 5 ? 4 : distinct === 1 ? 1 : 2.5;
    const sync = syncopationPerBar(notes, plan.totalBeats);
    const targetSync = 0.3 + profile.syncopationChance * 3;
    c += band(sync, targetSync * 0.5, targetSync * 1.6, targetSync + 0.5, 3);
    // Density arc: the last quarter of each phrase sparser than its first.
    let arcs = 0;
    let arcCredit = 0;
    for (const p of plan.phrases) {
      const len = p.endBeat - p.startBeat;
      if (len < 4) continue;
      const head = notes.filter((x) => x.startBeat >= p.startBeat && x.startBeat < p.startBeat + len / 2).length;
      const tail = notes.filter((x) => x.startBeat >= p.startBeat + len / 2 && x.startBeat < p.endBeat).length;
      arcs++;
      if (tail <= head) arcCredit++;
    }
    c += arcs ? (arcCredit / arcs) * 3 : 3;
    breakdown.rhythmicInterest = Math.min(10, c);
  }

  // Tendency tones (+5): leading tones rise, sevenths fall, when the function changes.
  {
    let total = 0;
    let resolved = 0;
    // A note that closes a phrase, or is followed by a rest, has resolved by
    // coming to rest; only tendencies inside a continuing line are owed one.
    const boundaries = plan.phrases.map((p) => p.endBeat);
    const atRest = (x: MelodyNote, y: MelodyNote) =>
      y.startBeat > x.startBeat + x.durationBeats ||
      boundaries.some((b) => x.startBeat < b && y.startBeat >= b);
    for (let i = 0; i < n - 1; i++) {
      const x = notes[i];
      const y = notes[i + 1];
      if (atRest(x, y)) continue;
      const chord = hc.chords[x.chordIndex];
      if (!chord) continue;
      const t = tendencyOf(chord, x.midi);
      if (!t || t.strength < 0.6) continue;
      const functionChanged = y.chordIndex !== x.chordIndex && hc.chords[y.chordIndex]?.functionTag !== chord.functionTag;
      if (!functionChanged && t.kind !== "fa-mi") continue;
      total++;
      if (t.to.includes(midiPc(y.midi))) resolved++;
    }
    breakdown.tendency = total === 0 ? 4 : band(resolved / total, 0.65, 1, 0.5, 5);
  }

  // Breath (+5): a rest or a long note at every phrase boundary.
  {
    let boundaries = 0;
    let breathed = 0;
    for (let k = 0; k + 1 < plan.phrases.length; k++) {
      boundaries++;
      const boundary = plan.phrases[k + 1].startBeat;
      const before = notes.filter((x) => x.startBeat < boundary).slice(-1)[0];
      if (!before) continue;
      const gap = boundary - (before.startBeat + before.durationBeats);
      if (gap >= 0.5 || before.durationBeats >= 2) breathed++;
    }
    breakdown.breath = boundaries === 0 ? 5 : (breathed / boundaries) * 5;
  }

  // Range sanity (+5): inside the keyboard, and a singable span (RS200 phrases 4–9, songs 12–19).
  {
    const inRange = notes.every((x) => x.midi >= 36 && x.midi <= 96);
    const span = Math.max(...notes.map((x) => x.midi)) - Math.min(...notes.map((x) => x.midi));
    breakdown.range = inRange ? band(span, 5, 19, 8, 5) : 0;
  }

  // Penalties.
  let directionChanges = 0;
  let prevDir = 0;
  for (let i = 1; i < n; i++) {
    const interval = notes[i].midi - notes[i - 1].midi;
    const dir = Math.sign(interval);
    if (Math.abs(interval) > 9) breakdown.penalties -= 2;
    if (dir !== 0 && prevDir !== 0 && dir !== prevDir) directionChanges++;
    if (dir !== 0) prevDir = dir;
  }
  if (n > 4) {
    const changeRate = directionChanges / (n - 2);
    if (changeRate > 0.7) breakdown.penalties -= Math.min(10, (changeRate - 0.7) * 30);
  }
  if (plan.totalBeats > 0 && n / plan.totalBeats > 2) breakdown.penalties -= 5;
  for (let i = 0; i < n - 1; i++) {
    const x = notes[i];
    if (!x.isChordTone && Math.abs(notes[i + 1].midi - x.midi) > 2) breakdown.penalties -= 3;
  }
  // Repeated-pitch runs: three in a row is a rhythmic device, four is a drone.
  {
    let run = 1;
    for (let i = 1; i < n; i++) {
      run = notes[i].midi === notes[i - 1].midi ? run + 1 : 1;
      if (run === 4) breakdown.penalties -= 3;
      if (run > 4) breakdown.penalties -= 1.5;
    }
  }
  // Sustained avoid tones.
  for (const x of notes) {
    const chord = hc.chords[x.chordIndex];
    if (!chord) continue;
    const cat = chord.categories[midiPc(x.midi)];
    if ((cat === "avoid" || cat === "chromatic") && x.durationBeats >= 1.5) breakdown.penalties -= 3;
  }

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { total, breakdown };
}
