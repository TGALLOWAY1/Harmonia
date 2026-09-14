import type { CadenceMode, DurationClass } from "./types";

/**
 * Mood model for chord generation.
 *
 * The melody engine has had a mood system since its phrase-based refactor; the
 * harmony under it had none, so a user could ask for a dreamy melody over
 * chords that knew nothing about the request. These profiles give the chord
 * pipeline the same control surface, parameterising the stages that actually
 * carry affect: tension shape, register, density, harmonic rhythm, cadence and
 * chromatic appetite.
 *
 * The four names match `MelodyMood` so the two engines can be driven together.
 *
 * Values are grounded in the empirical literature surveyed in
 * CHORD_PROGRESSION_ASSESSMENT.md §5.2 — principally the arousal/valence cue
 * mappings (register and density track arousal; mode and cadence track
 * valence), Smit et al. on cadence affect, and Eerola/Friberg on the linear,
 * additive contribution of primary musical cues.
 */
export type ChordMood = "dark" | "emotional" | "dreamy" | "energetic";

/** Named shapes for how long each chord is held. */
export type HarmonicRhythmProfile =
  | "even"
  | "anchored"
  | "accelerating"
  | "pedal-opening";

export type ChordMoodProfile = {
  /** Multiplier on the phrase tension curve. >1 bites harder at the peak. */
  tensionScale: number;
  /** MIDI centre the voicing stage aims at. */
  registerCenter: number;
  /** Half-width, in semitones, of the register band around that centre. */
  registerSpan: number;
  /**
   * −1..1. Shifts effective voice count: negative thins the texture toward
   * shells, positive thickens it. Applied on top of the user's voice count.
   */
  densityBias: number;
  /** How chord lengths are allocated across the phrase. */
  harmonicRhythm: HarmonicRhythmProfile;
  /** Which ending this mood wants when the caller has not specified one. */
  cadence: CadenceMode;
  /** 0..1 multiplier on how readily chromatic substitutions are accepted. */
  chromaticism: number;
  /**
   * −1..1 preference between darker and brighter degrees of the chosen scale.
   * Positive favours the major-quality degrees, negative the minor ones. This
   * colours within the mode rather than overriding the user's mode choice.
   */
  brightness: number;
};

export const CHORD_MOOD_PROFILES: Record<ChordMood, ChordMoodProfile> = {
  // Low, close, slow and heavy: minimal arousal cues, negative valence cues.
  dark: {
    tensionScale: 1.2,
    registerCenter: 52,
    registerSpan: 12,
    densityBias: -0.2,
    harmonicRhythm: "anchored",
    cadence: "resolve",
    chromaticism: 0.6,
    brightness: -0.8,
  },
  // The default: a full arch, mid register, moderate everything.
  emotional: {
    tensionScale: 1.0,
    registerCenter: 60,
    registerSpan: 16,
    densityBias: 0,
    harmonicRhythm: "even",
    cadence: "resolve",
    chromaticism: 0.5,
    brightness: -0.2,
  },
  // Wide, high and static — low arousal, unhurried, and happy to hang
  // unresolved, which is what "open" buys.
  dreamy: {
    tensionScale: 0.6,
    registerCenter: 64,
    registerSpan: 20,
    densityBias: 0.2,
    harmonicRhythm: "pedal-opening",
    cadence: "open",
    chromaticism: 0.3,
    brightness: 0.4,
  },
  // High arousal: driving harmonic rhythm, dense, bright, chromatically busy.
  energetic: {
    tensionScale: 1.1,
    registerCenter: 62,
    registerSpan: 14,
    densityBias: 0.3,
    harmonicRhythm: "accelerating",
    cadence: "resolve",
    chromaticism: 0.8,
    brightness: 0.6,
  },
};

export const DEFAULT_CHORD_MOOD: ChordMood = "emotional";

export function chordMoodProfile(mood: ChordMood | undefined): ChordMoodProfile {
  return CHORD_MOOD_PROFILES[mood ?? DEFAULT_CHORD_MOOD];
}

/**
 * Allocate a duration to every chord slot.
 *
 * Every diatonic chord used to be hardcoded to a full bar, so the harmony
 * moved on a metronomic one-per-bar grid and could never linger or push. These
 * profiles are the time dimension of the mood.
 *
 * `structuralOnly` positions (chords the substitution passes inserted) keep
 * whatever shorter duration they were given — those are passing events and
 * lengthening them would defeat the point.
 */
export function harmonicRhythmFor(
  profile: HarmonicRhythmProfile,
  numChords: number
): DurationClass[] {
  if (numChords <= 0) return [];
  if (numChords === 1) return ["full"];

  const last = numChords - 1;

  switch (profile) {
    // Every chord a bar. The historical behaviour, kept as an explicit choice.
    case "even":
      return Array.from({ length: numChords }, () => "full");

    // Weight the opening and the cadence, hurry the middle: the phrase settles,
    // moves, then settles again.
    case "anchored":
      return Array.from({ length: numChords }, (_, i) =>
        i === 0 || i === last ? "full" : "half"
      );

    // Shorten toward the cadence, then broaden on arrival. Harmonic
    // acceleration into a resolution is a primary driver of felt intensity.
    case "accelerating":
      return Array.from({ length: numChords }, (_, i) => {
        if (i === last) return "full";
        const position = i / Math.max(1, last);
        if (position < 0.4) return "full";
        if (position < 0.75) return "half";
        return "quarter";
      });

    // Hold the opening harmony, then move. The cheapest way to make a
    // progression feel like it starts somewhere rather than just starting.
    case "pedal-opening":
      return Array.from({ length: numChords }, (_, i) => {
        if (i === 0) return "full";
        if (i === last) return "full";
        return i === 1 ? "half" : "full";
      });

    default:
      return Array.from({ length: numChords }, () => "full");
  }
}
