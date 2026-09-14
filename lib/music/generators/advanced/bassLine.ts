import { PITCH_CLASSES, type PitchClass } from "@/lib/theory/midiUtils";

import type { HarmonicRhythmProfile } from "./chordMoods";
import type { CadenceMode, PlannedAdvancedChord } from "./types";

/**
 * Bass-line planning.
 *
 * The bass is the voice listeners track hardest for direction, and until now
 * it was whatever fell out of the voicing search: the lowest note of the
 * cheapest candidate, chosen chord by chord with no notion of inversion. This
 * layer decides the bass *first* — which chord tone sits underneath each
 * chord — as a small dynamic programme over the whole progression, and the
 * voicing stage then realises it.
 *
 * Rules encoded (the standard ones from any harmony text):
 * - root position at structural arrivals — the opening chord, the cadence,
 *   and the dominant that prepares it;
 * - first inversion when it buys stepwise bass motion; a run of steps in one
 *   direction is rewarded further;
 * - second inversion only as a cadential, passing or pedal 6-4 — never as a
 *   free choice;
 * - a seventh in the bass must resolve down by step.
 */

export type BassPlanEntry = {
  /** Pitch class chosen for the bass. */
  bass: PitchClass;
  /** 0 root, 1 third, 2 fifth, 3 seventh. */
  inversion: number;
  /** Why this bass was chosen — for debugging and the assessment doc. */
  reason: string;
};

type BassOption = { pc: number; inversion: number; interval: number };

type State = {
  option: BassOption;
  /** Direction of the step that arrived here, or 0 if the arrival was not a step. */
  stepDirection: number;
  total: number;
  back: State | null;
  reason: string;
};

const INVERSION_COST = [0, 0.8, 3.5, 2.0];

function intervalsFromRoot(chord: PlannedAdvancedChord): number[] {
  const rootIndex = PITCH_CLASSES.indexOf(chord.root);
  return chord.pitchClasses.map((pc) => (PITCH_CLASSES.indexOf(pc) - rootIndex + 12) % 12);
}

/** Which chord tones may sit in the bass, and which inversion each implies. */
export function bassOptionsFor(chord: PlannedAdvancedChord): BassOption[] {
  const rootIndex = PITCH_CLASSES.indexOf(chord.root);
  const intervals = new Set(intervalsFromRoot(chord));
  const hasSeventh = intervals.has(10) || intervals.has(11);
  const options: BassOption[] = [{ pc: rootIndex, inversion: 0, interval: 0 }];

  for (const interval of intervals) {
    let inversion = -1;
    if (interval === 3 || interval === 4) inversion = 1;
    else if (interval === 6 || interval === 7 || interval === 8) inversion = 2;
    else if (interval === 10 || interval === 11) inversion = 3;
    // A ninth chord's 13th is not a bass tone; a dim7's diminished seventh is.
    else if (interval === 9 && !hasSeventh && intervals.has(6)) inversion = 3;
    if (inversion === -1) continue;
    // Suspended chords keep the root under the suspension.
    if (chord.kind === "suspension" && inversion !== 0) continue;
    options.push({ pc: (rootIndex + interval) % 12, inversion, interval });
  }

  return options;
}

/** Shortest signed distance between two pitch classes, in −6..6. */
function signedInterval(from: number, to: number): number {
  const up = (to - from + 12) % 12;
  return up <= 6 ? up : up - 12;
}

export function planBassLine(
  planned: PlannedAdvancedChord[],
  params: {
    tonic: PitchClass;
    cadence: CadenceMode;
    rhythm?: HarmonicRhythmProfile;
    /** Seeded source for breaking near-ties, so equally good plans vary by seed. */
    random?: () => number;
  }
): BassPlanEntry[] {
  const n = planned.length;
  if (n === 0) return [];
  const tonicIndex = PITCH_CLASSES.indexOf(params.tonic);
  const jitter = () => (params.random ? (params.random() - 0.5) * 0.4 : 0);

  const emission = (index: number, chord: PlannedAdvancedChord, option: BassOption): number => {
    if (chord.kind === "passing") return 0.5;
    let cost = INVERSION_COST[option.inversion] ?? 2;
    const isArrival = index === 0 || index === n - 1;
    if (option.inversion !== 0) {
      if (isArrival) cost += 6;
      if (index === n - 1 && params.cadence === "resolve") cost += 10;
      if (chord.isDominant && index === n - 2) cost += 3;
      if (chord.kind === "suspension") cost += 2;
    }
    return cost;
  };

  const transition = (
    index: number,
    previous: State,
    previousChord: PlannedAdvancedChord,
    chord: PlannedAdvancedChord,
    option: BassOption
  ): { cost: number; stepDirection: number; reason: string } => {
    const delta = signedInterval(previous.option.pc, option.pc);
    const size = Math.abs(delta);
    const direction = Math.sign(delta);
    let cost = 0;
    let reason = "";
    let stepDirection = 0;

    let scaleLine = false;
    if (size === 0) {
      const pedalAllowed = params.rhythm === "pedal-opening" && index === 1;
      cost += pedalAllowed ? 0 : 0.8;
      reason = pedalAllowed ? "pedal" : "static";
    } else if (size <= 2) {
      cost -= 1.2;
      stepDirection = direction;
      reason = "step";
      scaleLine = previous.stepDirection === direction;
    } else if (size === 5 || size === 7) {
      cost -= 0.8;
      reason = size === 5 ? "fourth" : "fifth";
    } else if (size === 3 || size === 4) {
      cost -= 0.3;
      reason = "third";
    } else if (size === 6) {
      cost += 2.0;
      reason = "tritone";
    } else {
      cost += 0.5;
      reason = "leap";
    }

    // Second inversions must be motivated by a 6-4 idiom, and each idiom is a
    // single 6-4 flanked by stable chords — never two in a row.
    let passingSixFour = false;
    if (previous.option.inversion === 2) {
      const beforePrevious = previous.back?.option;
      const flanksStable = (beforePrevious?.inversion ?? 0) <= 1 && option.inversion <= 1;
      const previousIsTonic = PITCH_CLASSES.indexOf(previousChord.root) === tonicIndex;
      if (
        previousIsTonic && chord.isDominant && index === n - 2 && size === 0 && option.inversion === 0
      ) {
        cost -= 5.0; // cadential 6-4: I6/4 over the dominant bass, then V
        reason = "cadential 6-4";
      } else if (
        flanksStable && previous.stepDirection !== 0 && size > 0 && size <= 2 && direction === previous.stepDirection
      ) {
        cost -= 2.4; // passing 6-4 on a stepwise line
        reason = "passing 6-4";
        passingSixFour = true;
      } else if (flanksStable && size === 0 && beforePrevious && beforePrevious.pc === previous.option.pc) {
        cost -= 2.5; // pedal 6-4: the bass holds under a neighbour chord
        reason = "pedal 6-4";
      } else {
        cost += 1.5;
      }
    }

    // A run of steps in one direction is a bass line, not just motion — but the
    // passing 6-4 already pays for its own line.
    if (scaleLine && !passingSixFour) {
      cost -= 0.6;
      reason = "scale line";
    }

    // A seventh in the bass resolves down by step.
    if (previous.option.inversion === 3) {
      if (delta === -1 || delta === -2) {
        cost -= 1.5;
        reason = "seventh resolves";
      } else {
        cost += 2.5;
      }
    }

    return { cost, stepDirection, reason };
  };

  // Dynamic programme, chord by chord.
  let states: State[] = bassOptionsFor(planned[0]).map((option) => ({
    option,
    stepDirection: 0,
    total: emission(0, planned[0], option) + jitter(),
    back: null,
    reason: option.inversion === 0 ? "root position" : `inversion ${option.inversion}`,
  }));

  for (let index = 1; index < n; index++) {
    const chord = planned[index];
    const previousChord = planned[index - 1];
    const next: State[] = [];

    for (const option of bassOptionsFor(chord)) {
      const emit = emission(index, chord, option) + jitter();
      let best: State | null = null;
      for (const previous of states) {
        const step = transition(index, previous, previousChord, chord, option);
        const total = previous.total + step.cost + emit;
        if (!best || total < best.total) {
          best = {
            option,
            stepDirection: step.stepDirection,
            total,
            back: previous,
            reason: option.inversion === 0 ? `root (${step.reason})` : `inv ${option.inversion} (${step.reason})`,
          };
        }
      }
      if (best) next.push(best);
    }

    states = next;
  }

  let cursor: State | null = states.reduce((best, state) => (state.total < best.total ? state : best), states[0]);
  const plan: BassPlanEntry[] = [];
  while (cursor) {
    plan.unshift({
      bass: PITCH_CLASSES[cursor.option.pc],
      inversion: cursor.option.inversion,
      reason: cursor.reason,
    });
    cursor = cursor.back;
  }
  return plan;
}

/**
 * Describe the bass that actually sounds in a voicing: which pitch class it is
 * and which inversion that makes. −1 when the bass is not a chord tone at all.
 */
export function inversionOfVoicing(midi: number[], root: PitchClass): { bass: PitchClass; inversion: number } {
  if (midi.length === 0) return { bass: root, inversion: 0 };
  const lowest = Math.min(...midi);
  const bassIndex = ((lowest % 12) + 12) % 12;
  const interval = (bassIndex - PITCH_CLASSES.indexOf(root) + 12) % 12;
  let inversion = -1;
  if (interval === 0) inversion = 0;
  else if (interval === 3 || interval === 4) inversion = 1;
  else if (interval === 6 || interval === 7 || interval === 8) inversion = 2;
  else if (interval === 9 || interval === 10 || interval === 11) inversion = 3;
  return { bass: PITCH_CLASSES[bassIndex], inversion };
}
