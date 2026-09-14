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
 * chord, and in which octave — as a small dynamic programme over the whole
 * progression, and the voicing stage then realises it.
 *
 * The plan is made in concrete MIDI pitches inside the bass register of the
 * requested range, not in pitch classes: a "step down" from C to B♭ at the
 * bottom of the range would otherwise be realised an octave up, as a leap of
 * a seventh, because no lower B♭ exists to voice.
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
  /** The exact MIDI pitch the bass should sound at. */
  pitch: number;
  /** 0 root, 1 third, 2 fifth, 3 seventh. */
  inversion: number;
  /** Why this bass was chosen — for debugging and the assessment doc. */
  reason: string;
};

export type BassRange = { low: number; high: number };

/** The range the app ships with, used when a caller gives none. */
const DEFAULT_RANGE: BassRange = { low: 48, high: 79 };

type BassTone = { pc: number; inversion: number; interval: number };

type BassOption = BassTone & { pitch: number };

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
export function bassOptionsFor(chord: PlannedAdvancedChord): BassTone[] {
  const rootIndex = PITCH_CLASSES.indexOf(chord.root);
  const intervals = new Set(intervalsFromRoot(chord));
  const hasSeventh = intervals.has(10) || intervals.has(11);
  const options: BassTone[] = [{ pc: rootIndex, inversion: 0, interval: 0 }];

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

/**
 * The pitches a bass note may take: the bottom of the range up to an octave
 * and a fourth above it, leaving room for the upper voices underneath the
 * ceiling. For the app's C3-G5 range that is C3-E4.
 */
export function bassRegister(range: BassRange): { floor: number; ceiling: number } {
  const floor = Math.min(range.low, range.high);
  const top = Math.max(range.low, range.high);
  const ceiling = Math.max(floor, Math.min(floor + 16, top - 7));
  return { floor, ceiling };
}

/**
 * Every pitch in the bass register carrying one of the chord's bass tones.
 *
 * When the caller says which bass pitches its voicings can actually produce,
 * the plan is restricted to those, so a planned step is never realised an
 * octave away because the exact pitch had no voicing (a close voicing with
 * its bass on C3 fails the low-register spacing rule, for instance). Pitches
 * outside the register are accepted only when nothing inside it is voiceable.
 */
function bassPitchOptions(
  chord: PlannedAdvancedChord,
  range: BassRange,
  available?: ReadonlySet<number>
): BassOption[] {
  const { floor, ceiling } = bassRegister(range);
  const tones = bassOptionsFor(chord);
  const inRegister: BassOption[] = [];
  for (const tone of tones) {
    for (let pitch = floor; pitch <= ceiling; pitch++) {
      if (((pitch % 12) + 12) % 12 === tone.pc) inRegister.push({ ...tone, pitch });
    }
  }
  if (!available || available.size === 0) return inRegister;

  const voiceable = inRegister.filter((option) => available.has(option.pitch));
  if (voiceable.length > 0) return voiceable;

  const anywhere: BassOption[] = [];
  for (const pitch of [...available].sort((a, b) => a - b)) {
    const tone = tones.find((t) => t.pc === ((pitch % 12) + 12) % 12);
    if (tone) anywhere.push({ ...tone, pitch });
  }
  return anywhere.length > 0 ? anywhere : inRegister;
}

export function planBassLine(
  planned: PlannedAdvancedChord[],
  params: {
    tonic: PitchClass;
    cadence: CadenceMode;
    rhythm?: HarmonicRhythmProfile;
    /** The voicing range; the bass is planned inside its lower part. */
    range?: BassRange;
    /** Per chord, the bass pitches the voicer can actually realise. */
    availableBassPitches?: ReadonlySet<number>[];
    /**
     * MIDI pitch the bass should gravitate to, so a low, dark mood and a high,
     * airy one plan different bass registers. Clamped into the bass register.
     */
    registerCentre?: number;
    /** Seeded source for breaking near-ties, so equally good plans vary by seed. */
    random?: () => number;
  }
): BassPlanEntry[] {
  const n = planned.length;
  if (n === 0) return [];
  const tonicIndex = PITCH_CLASSES.indexOf(params.tonic);
  const range = params.range ?? DEFAULT_RANGE;
  const { floor, ceiling } = bassRegister(range);
  // The bass sits most naturally in the lower half of its register, unless
  // the mood asks for somewhere else.
  const registerCentre = Math.max(
    floor,
    Math.min(ceiling, params.registerCentre ?? floor + Math.min(5, ceiling - floor))
  );
  const jitter = () => (params.random ? (params.random() - 0.5) * 0.4 : 0);

  const emission = (index: number, chord: PlannedAdvancedChord, option: BassOption): number => {
    const register = Math.abs(option.pitch - registerCentre) * 0.05;
    if (chord.kind === "passing") return 0.5 + register;
    let cost = (INVERSION_COST[option.inversion] ?? 2) + register;
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
    // Real semitones between the two pitches, so a step is a step and a
    // seventh is a seventh whatever the pitch classes suggest.
    const delta = option.pitch - previous.option.pitch;
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
    } else if (size === 12) {
      cost += 0.3; // an octave is idiomatic for a bass, if not a line
      reason = "octave";
    } else if (size > 12) {
      cost += 2.0;
      reason = "leap";
    } else {
      cost += 0.8; // sixths and sevenths: disjunct
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
      } else if (flanksStable && size === 0 && beforePrevious && beforePrevious.pitch === previous.option.pitch) {
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
  const availableFor = (index: number) => params.availableBassPitches?.[index];
  let states: State[] = bassPitchOptions(planned[0], range, availableFor(0)).map((option) => ({
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

    for (const option of bassPitchOptions(chord, range, availableFor(index))) {
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
      pitch: cursor.option.pitch,
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
