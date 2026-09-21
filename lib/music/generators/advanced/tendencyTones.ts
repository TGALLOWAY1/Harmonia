import { PITCH_CLASSES } from "@/lib/theory/midiUtils";

import { harmonicFunctionOf } from "./tensionCurve";
import type { ChordKind, HarmonicFunction, PlannedAdvancedChord } from "./types";

/**
 * Tendency-tone resolution, as a cost the voicing search can pay.
 *
 * Until now the transition cost saw two bare MIDI arrays. It could tell that a
 * voice moved two semitones, never that the voice it moved was the leading
 * tone of a dominant seventh — so a `V7 - I` whose leading tone fell to the
 * fifth scored better than one where it rose, whenever the geometry happened
 * to favour it. The bass-line planner already enforces the one tendency rule
 * that lives in the bass ("a seventh in the bass resolves down by step"); this
 * module is the same idea for the upper voices, and it is what §4.2 of the
 * assessment means by "the cost function cannot see chord identity".
 *
 * Four rules, all of them soft:
 *
 * 1. **The leading tone rises.** In a dominant-function chord — V, V7, vii°,
 *    an applied dominant, a tritone substitution, the raised seventh of a
 *    minor key — the tone a semitone below the root of the chord it resolves
 *    to moves up to that root. Two exceptions survive. The classical one: in
 *    an inner voice of a complete dominant seventh the leading tone may fall
 *    to the fifth of the tonic instead ("frustrated"), so the tonic triad is
 *    complete; in the top voice it should rise. And the idiomatic one: when
 *    the chord of resolution contains the leading tone itself — `V7` into a
 *    `Imaj7`, where the leading tone *is* the major seventh — holding it is
 *    correct, and at four voices it is the only thing the voice can do.
 * 2. **The seventh falls.** A chordal seventh resolves down by a semitone or a
 *    whole tone to a tone of the next chord. A seventh that is simply held is
 *    fine: if the next chord contains it, it was never a dissonance against it.
 * 3. **The tritone resolves in contrary motion.** The third and seventh of a
 *    dominant seventh move apart (or together) by step — and in a tritone
 *    substitution the same two pitch classes do the same thing, with the roles
 *    swapped: there the spelled seventh is the leading tone and the spelled
 *    third is the falling voice.
 * 4. **Suspensions resolve down by step.**
 *
 * Every rule is gated on the resolution being *available*: a tone is only
 * charged for failing to resolve when the pitch class it should resolve to is
 * actually in the next chord. That is what keeps deceptive motion honest —
 * `V - vi` still wants its leading tone to rise (vi contains the tonic), while
 * a dominant that goes somewhere else entirely is not penalised for a
 * resolution that was never on offer.
 *
 * The bass is excluded throughout: the bass-line planner decides it, as a hard
 * constraint, before the voicer runs.
 */

export type TendencyKind = "leadingTone" | "seventh" | "suspension";

export type TendencyTone = {
  /** Pitch class (0-11) of the tone that owes a resolution. */
  pc: number;
  /** +1 when the tone must rise, −1 when it must fall. */
  direction: 1 | -1;
  /** Step sizes, in semitones, that count as a resolution. */
  steps: number[];
  kind: TendencyKind;
};

/**
 * What the voicing search needs to know about a chord in order to price the
 * resolutions it owes. Derived once per chord from the plan.
 */
export type ChordIdentity = {
  /** Root pitch class, 0-11. */
  root: number;
  /** Every pitch class in the chord, 0-11. */
  pitchClasses: number[];
  /** Harmonic function, as the tension model tags it. */
  functionTag: HarmonicFunction;
  kind: ChordKind;
  /** Whether the chord carries dominant pull (a leading tone into its target). */
  isDominant: boolean;
  /** Root of the chord this one is expected to resolve to, 0-11. */
  resolutionRoot?: number;
  /** Pitch class of the chordal seventh, when the chord has one. */
  seventh?: number;
  /** The dominant tritone: the pitch class that rises and the one that falls. */
  tritone?: { rising: number; falling: number };
  /** The resolutions this chord owes the next one. */
  tendencies: TendencyTone[];
};

export type TendencyContext = {
  /** The chord being left — it owns the tendency tones. */
  from?: ChordIdentity;
  /** The chord being arrived at — it says which resolutions exist. */
  to?: ChordIdentity;
};

/**
 * Relative cost of each unresolved tendency, on the scale of
 * `calculateVoiceLeadingCost` before the caller's weight is applied. The shape
 * matters more than the absolute size: a leading tone left hanging in the top
 * voice is the most audible failure, the classical frustrated leading tone is
 * barely a failure at all.
 */
export const TENDENCY_COSTS = {
  /** A leading tone in the top voice that does not rise. */
  leadingToneSoprano: 1.6,
  /** A leading tone in an inner voice that does not rise. */
  leadingToneInner: 1.0,
  /**
   * A leading tone the chord of resolution contains in its own right — the
   * major seventh of a `Imaj7`. Holding it is idiomatic rather than lazy, so
   * this is a nudge toward the rise where one is reachable, not a charge for
   * failing to take it.
   */
  leadingToneAbsorbed: 0.25,
  /** An inner-voice leading tone that falls to the fifth of its resolution. */
  frustratedLeadingTone: 0.15,
  /** A chordal seventh that neither falls by step nor is held. */
  seventh: 1.0,
  /** A suspension that does not fall to its resolution. */
  suspension: 1.2,
  /** A dominant tritone whose two voices do not resolve in contrary motion. */
  tritone: 0.6,
} as const;

const pitchClassOf = (midi: number) => ((midi % 12) + 12) % 12;

/** Descriptive outcome for one voice carrying one tendency tone. */
export type TendencyOutcome = {
  tone: TendencyTone;
  /** MIDI pitch of the voice carrying it. */
  pitch: number;
  /** Whether that voice is the top of the chord. */
  soprano: boolean;
  /** Whether the next chord contains the pitch class the tone resolves to. */
  possible: boolean;
  /** Whether the voice actually took the resolution. */
  resolved: boolean;
  /** Whether the tone was held at pitch into the next chord. */
  held: boolean;
  /** Whether an inner-voice leading tone fell to the fifth of its resolution. */
  frustrated: boolean;
  /**
   * Whether the chord of resolution contains this tone in its own right, so
   * holding it is a legitimate outcome rather than a failure (the leading tone
   * of a `V7` running into the major seventh of a `Imaj7`).
   */
  absorbed: boolean;
  /** Cost charged for this voice. */
  penalty: number;
};

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Which chord tones may sit in the bass is the bass planner's question; this
 * is the other half — what the chord *is*, in the terms the resolution rules
 * are written in.
 */
export function chordIdentity(chord: PlannedAdvancedChord): ChordIdentity {
  const root = PITCH_CLASSES.indexOf(chord.root);
  const pitchClasses = chord.pitchClasses.map((pc) => PITCH_CLASSES.indexOf(pc));
  const present = new Set(pitchClasses);
  const intervals = new Set(pitchClasses.map((pc) => (pc - root + 12) % 12));
  const functionTag = harmonicFunctionOf(chord);

  // The chordal seventh. A 13th (interval 9) is only a seventh when the chord
  // is a fully diminished one, where it is the diminished seventh.
  let seventh: number | undefined;
  if (intervals.has(11)) seventh = (root + 11) % 12;
  else if (intervals.has(10)) seventh = (root + 10) % 12;
  else if (intervals.has(9) && intervals.has(3) && intervals.has(6)) seventh = (root + 9) % 12;

  // A diminished chord standing in for a dominant — vii°, vii°7, the borrowed
  // #iv°, an inserted passing diminished — resolves up a semitone, not down a
  // fifth. A diminished chord doing pre-dominant duty (ii° in a minor key) is
  // not one of these.
  const isDiminished = intervals.has(3) && intervals.has(6);
  const isLeadingToneChord =
    isDiminished &&
    (chord.kind === "passing" || functionTag === "dominant" || functionTag === "applied");

  let resolutionRoot: number | undefined;
  if (chord.kind === "tritone-substitution") resolutionRoot = (root + 11) % 12;
  else if (isLeadingToneChord) resolutionRoot = (root + 1) % 12;
  else if (chord.isDominant) resolutionRoot = (root + 5) % 12;

  const isDominant = (chord.isDominant ?? false) || isLeadingToneChord;

  const tendencies: TendencyTone[] = [];
  const claimed = new Set<number>();
  let tritone: ChordIdentity["tritone"];

  if (isDominant && resolutionRoot !== undefined) {
    // Named by where they are going, not by which chord member they are: in a
    // tritone substitution the spelled seventh is the tone that rises.
    const rising = (resolutionRoot + 11) % 12;
    const falling = (resolutionRoot + 5) % 12;
    if (present.has(rising)) {
      tendencies.push({ pc: rising, direction: 1, steps: [1], kind: "leadingTone" });
      claimed.add(rising);
    }
    if (present.has(falling)) {
      tendencies.push({ pc: falling, direction: -1, steps: [1, 2], kind: "seventh" });
      claimed.add(falling);
    }
    if (present.has(rising) && present.has(falling)) tritone = { rising, falling };
  }

  if (seventh !== undefined && !claimed.has(seventh)) {
    tendencies.push({ pc: seventh, direction: -1, steps: [1, 2], kind: "seventh" });
    claimed.add(seventh);
  }

  const suspended = (root + 5) % 12;
  if (
    (chord.kind === "suspension" || chord.role === "suspension") &&
    present.has(suspended) &&
    !claimed.has(suspended)
  ) {
    tendencies.push({ pc: suspended, direction: -1, steps: [1, 2], kind: "suspension" });
  }

  return {
    root,
    pitchClasses,
    functionTag,
    kind: chord.kind,
    isDominant,
    resolutionRoot,
    seventh,
    tritone,
    tendencies,
  };
}

/** Identities for a whole plan, in order. */
export function chordIdentities(planned: PlannedAdvancedChord[]): ChordIdentity[] {
  return planned.map(chordIdentity);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Every tendency tone of `from` that sounds in a non-bass voice of `previous`,
 * with what became of it in `next`.
 */
export function evaluateTendencies(
  previous: number[],
  next: number[],
  context: TendencyContext
): TendencyOutcome[] {
  const { from, to } = context;
  if (!from || !to || from.tendencies.length === 0) return [];
  if (previous.length < 2 || next.length === 0) return [];

  const voices = [...previous].sort((a, b) => a - b);
  const targetPitchClasses = new Set(to.pitchClasses);
  const arrivals = new Set(next);
  const outcomes: TendencyOutcome[] = [];

  for (const tone of from.tendencies) {
    // Voice 0 is the bass, which the bass-line planner owns outright.
    for (let voice = 1; voice < voices.length; voice++) {
      const pitch = voices[voice];
      if (pitchClassOf(pitch) !== tone.pc) continue;

      let possible = false;
      let resolved = false;
      for (const step of tone.steps) {
        const destination = pitch + step * tone.direction;
        if (targetPitchClasses.has(pitchClassOf(destination))) possible = true;
        if (arrivals.has(destination)) resolved = true;
      }
      const held = arrivals.has(pitch);
      const soprano = voice === voices.length - 1;
      const absorbed = targetPitchClasses.has(tone.pc);

      let frustrated = false;
      let penalty = 0;
      if (resolved || !possible) {
        penalty = 0;
      } else if (tone.kind === "seventh" && held) {
        // It is a chord tone of the next chord, so it never was a dissonance
        // against it — nothing to resolve.
        penalty = 0;
      } else if (tone.kind === "leadingTone") {
        if (absorbed) {
          // The chord it resolves to owns this note in its own right
          // (V7 → Imaj7), so holding it is idiomatic rather than lazy.
          penalty = TENDENCY_COSTS.leadingToneAbsorbed;
        } else {
          frustrated = !soprano && fallsToFifthOfResolution(pitch, next, from, to);
          penalty = frustrated
            ? TENDENCY_COSTS.frustratedLeadingTone
            : soprano
              ? TENDENCY_COSTS.leadingToneSoprano
              : TENDENCY_COSTS.leadingToneInner;
        }
      } else if (tone.kind === "suspension") {
        penalty = TENDENCY_COSTS.suspension;
      } else {
        penalty = TENDENCY_COSTS.seventh;
      }

      outcomes.push({ tone, pitch, soprano, possible, resolved, held, frustrated, absorbed, penalty });
    }
  }

  return outcomes;
}

/**
 * The frustrated leading tone: in an inner voice of a complete dominant
 * seventh arriving at its own resolution, the leading tone may fall to the
 * fifth of that chord rather than rise, so the resolution is a complete triad
 * rather than a tripled root. Only a genuine resolution earns it.
 */
function fallsToFifthOfResolution(
  pitch: number,
  next: number[],
  from: ChordIdentity,
  to: ChordIdentity
): boolean {
  if (from.seventh === undefined || from.resolutionRoot === undefined) return false;
  if (to.root !== from.resolutionRoot) return false;
  const fifth = (from.resolutionRoot + 7) % 12;
  return next.some((note) => note < pitch && pitch - note <= 5 && pitchClassOf(note) === fifth);
}

/** What became of a dominant tritone sounding in the upper voices. */
export type TritoneOutcome = {
  /** The rising tone went up a semitone. */
  rose: boolean;
  /** The falling tone went down a semitone or a whole tone. */
  fell: boolean;
  /** Both, which is the contrary motion the rule asks for. */
  contrary: boolean;
  /** The chord of resolution contains the rising tone itself (V7 → Imaj7). */
  absorbed: boolean;
};

/**
 * What the dominant tritone in `previous` did on the way to `next`. Returns
 * `null` when the chord has no tritone sounding in its upper voices, or when
 * the next chord offers neither resolution.
 */
export function tritoneResolution(
  previous: number[],
  next: number[],
  context: TendencyContext
): TritoneOutcome | null {
  const { from, to } = context;
  if (!from?.tritone || !to) return null;
  if (previous.length < 2 || next.length === 0) return null;

  const voices = [...previous].sort((a, b) => a - b);
  const upper = voices.slice(1);
  const rising = upper.filter((pitch) => pitchClassOf(pitch) === from.tritone!.rising);
  const falling = upper.filter((pitch) => pitchClassOf(pitch) === from.tritone!.falling);
  if (rising.length === 0 || falling.length === 0) return null;

  const targetPitchClasses = new Set(to.pitchClasses);
  const risingPossible = rising.some((pitch) => targetPitchClasses.has(pitchClassOf(pitch + 1)));
  const fallingPossible = falling.some(
    (pitch) => targetPitchClasses.has(pitchClassOf(pitch - 1)) || targetPitchClasses.has(pitchClassOf(pitch - 2))
  );
  if (!risingPossible || !fallingPossible) return null;

  const arrivals = new Set(next);
  const rose = rising.some((pitch) => arrivals.has(pitch + 1));
  const fell = falling.some((pitch) => arrivals.has(pitch - 1) || arrivals.has(pitch - 2));
  return {
    rose,
    fell,
    contrary: rose && fell,
    absorbed: targetPitchClasses.has(from.tritone.rising),
  };
}

/**
 * Total cost of the resolutions `previous` owed `next` and did not take.
 *
 * A pure function of the two voicings and the two chord identities: the same
 * inputs always give the same number, so the search stays deterministic.
 */
export function tendencyPenalty(
  previous: number[],
  next: number[],
  context: TendencyContext
): number {
  const outcomes = evaluateTendencies(previous, next, context);
  let total = 0;
  let frustratedLeadingTone = false;
  let seventhResolved = false;
  for (const outcome of outcomes) {
    total += outcome.penalty;
    if (outcome.tone.kind === "leadingTone" && outcome.frustrated) frustratedLeadingTone = true;
    if (outcome.tone.kind === "seventh" && outcome.resolved) seventhResolved = true;
  }

  // The tritone is charged jointly, on top of the two voices' own costs: a
  // dominant seventh that resolves one half of its tritone and strands the
  // other has not resolved. Two idioms are exempt — the frustrated leading
  // tone over a seventh that did fall, and the leading tone the chord of
  // resolution absorbs as its own major seventh.
  const tritone = tritoneResolution(previous, next, context);
  if (
    tritone &&
    !tritone.contrary &&
    !tritone.absorbed &&
    !(frustratedLeadingTone && seventhResolved)
  ) {
    total += TENDENCY_COSTS.tritone;
  }

  return total;
}
