/**
 * Shared Synth Presets & Effects Chain
 *
 * Centralised audio setup used by the main progression page (and available to
 * the Sketchpad workspace). Instruments are described by a small registry so
 * new instruments (Strings, Pad, …) can be added as a single entry without
 * touching call sites.
 */

import * as Tone from "tone";
import type { SustainMode } from "./humanization";

/* ─── Types ─── */

export type SoundPresetId = "piano" | "electric-piano" | "organ";
export type Synth = Tone.PolySynth | Tone.Sampler;
export type MelodySynth = Tone.Synth | Tone.FMSynth | Tone.Sampler;

/** Options passed when building a chord instrument. */
export interface CreateSynthOptions {
  /** Controls how long notes ring after release. Defaults to "natural". */
  sustainMode?: SustainMode;
  /** Called once the instrument is ready (immediately for synths). */
  onLoaded?: () => void;
}

/** Options passed when building a melody instrument. */
export interface CreateMelodySynthOptions {
  onLoaded?: () => void;
}

/**
 * A self-contained description of a playable instrument. Adding a new
 * instrument means adding one entry to {@link INSTRUMENTS} — call sites stay
 * unchanged.
 */
export interface InstrumentDefinition {
  id: SoundPresetId;
  label: string;
  category: "keys" | "synth";
  /** Whether the instrument downloads samples (show a loading state). */
  needsLoading: boolean;
  create: (opts: CreateSynthOptions) => Synth;
  createMelody: (opts: CreateMelodySynthOptions) => MelodySynth;
}

/* ─── Release tuning ─── */

/** Map a sustain mode to a release time (seconds) for a given instrument. */
function pianoRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.25 : 1;
}
function epRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.2 : 0.8;
}

/* ─── Effects Chain (lazy singletons) ─── */

let masterReverb: Tone.Reverb | null = null;
let masterCompressor: Tone.Compressor | null = null;
let masterLimiter: Tone.Limiter | null = null;
let pianoReverbNode: Tone.Reverb | null = null;
let epChorusNode: Tone.Chorus | null = null;

export function getEffectsChain(): {
  reverb: Tone.Reverb;
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
} {
  if (!masterLimiter) {
    masterLimiter = new Tone.Limiter(-3).toDestination();
  }
  if (!masterReverb) {
    masterReverb = new Tone.Reverb({ decay: 1.8, wet: 0.2 }).connect(masterLimiter);
  }
  if (!masterCompressor) {
    masterCompressor = new Tone.Compressor({
      threshold: -18,
      ratio: 4,
      attack: 0.003,
      release: 0.15,
    }).connect(masterReverb);
  }
  return { reverb: masterReverb, compressor: masterCompressor, limiter: masterLimiter };
}

function getPianoReverb(): Tone.Reverb {
  if (!pianoReverbNode) {
    const { limiter } = getEffectsChain();
    pianoReverbNode = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(limiter);
  }
  return pianoReverbNode;
}

function getEPChorus(): Tone.Chorus {
  if (!epChorusNode) {
    const { compressor } = getEffectsChain();
    epChorusNode = new Tone.Chorus({ frequency: 1.2, delayTime: 3.5, depth: 0.6, wet: 0.35 })
      .connect(compressor)
      .start();
  }
  return epChorusNode;
}

/* ─── Sample maps (shared between chord & melody samplers) ─── */

const SALAMANDER_URLS = {
  A1: "A1.mp3", A2: "A2.mp3", A3: "A3.mp3", A4: "A4.mp3", A5: "A5.mp3",
  C2: "C2.mp3", C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3", C6: "C6.mp3",
  "D#2": "Ds2.mp3", "D#3": "Ds3.mp3", "D#4": "Ds4.mp3", "D#5": "Ds5.mp3",
  "F#2": "Fs2.mp3", "F#3": "Fs3.mp3", "F#4": "Fs4.mp3", "F#5": "Fs5.mp3",
} as const;

/* ─── Instrument Registry ─── */

export const INSTRUMENTS: Record<SoundPresetId, InstrumentDefinition> = {
  /* ── Piano: Salamander Grand Piano samples ── */
  piano: {
    id: "piano",
    label: "Piano",
    category: "keys",
    needsLoading: true,
    create: ({ sustainMode, onLoaded }) => {
      const { compressor } = getEffectsChain();
      const sampler = new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        release: pianoRelease(sustainMode),
        volume: -6,
        onload: () => onLoaded?.(),
      });
      sampler.connect(compressor);
      sampler.connect(getPianoReverb());
      return sampler;
    },
    createMelody: ({ onLoaded }) => {
      const { compressor } = getEffectsChain();
      const sampler = new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        release: 1,
        volume: -4,
        onload: () => onLoaded?.(),
      });
      sampler.connect(compressor);
      sampler.connect(getPianoReverb());
      return sampler;
    },
  },

  /* ── Electric Piano: Casio samples ── */
  "electric-piano": {
    id: "electric-piano",
    label: "Electric Piano",
    category: "keys",
    needsLoading: true,
    create: ({ sustainMode, onLoaded }) => {
      const sampler = new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: "https://tonejs.github.io/audio/casio/",
        release: epRelease(sustainMode),
        volume: -8,
        onload: () => onLoaded?.(),
      });
      sampler.connect(getEPChorus());
      return sampler;
    },
    createMelody: ({ onLoaded }) => {
      const sampler = new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: "https://tonejs.github.io/audio/casio/",
        release: 0.8,
        volume: -6,
        onload: () => onLoaded?.(),
      });
      sampler.connect(getEPChorus());
      return sampler;
    },
  },

  /* ── Organ: FM synthesis with drawbar-style harmonics ── */
  organ: {
    id: "organ",
    label: "Organ",
    category: "synth",
    needsLoading: false,
    create: ({ onLoaded }) => {
      const { compressor } = getEffectsChain();
      onLoaded?.();
      return new Tone.PolySynth(Tone.FMSynth, {
        volume: -14,
        harmonicity: 1,
        modulationIndex: 0.5,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.04, decay: 0.1, sustain: 0.9, release: 0.3 },
        modulationEnvelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.3 },
      }).connect(compressor);
    },
    createMelody: ({ onLoaded }) => {
      const { compressor } = getEffectsChain();
      onLoaded?.();
      return new Tone.FMSynth({
        volume: -12,
        harmonicity: 1,
        modulationIndex: 0.5,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.04, decay: 0.1, sustain: 0.9, release: 0.3 },
        modulationEnvelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.3 },
      }).connect(compressor);
    },
  },
};

/** Ordered list of selectable instruments (for UI menus). */
export const SOUND_PRESETS: ReadonlyArray<{ id: SoundPresetId; label: string }> =
  Object.values(INSTRUMENTS).map(({ id, label }) => ({ id, label }));

/* ─── Public factory API (thin lookups over the registry) ─── */

function resolveInstrument(preset: SoundPresetId): InstrumentDefinition {
  return INSTRUMENTS[preset] ?? INSTRUMENTS.piano;
}

export function createSynthForPreset(
  preset: SoundPresetId,
  opts: CreateSynthOptions = {},
): Synth {
  return resolveInstrument(preset).create(opts);
}

export function createMelodySynthForPreset(
  preset: SoundPresetId,
  opts: CreateMelodySynthOptions = {},
): MelodySynth {
  return resolveInstrument(preset).createMelody(opts);
}

/**
 * Returns true when the given preset needs async loading (sample-based).
 * Useful for showing a loading spinner while samples download.
 */
export function presetNeedsLoading(preset: SoundPresetId): boolean {
  return resolveInstrument(preset).needsLoading;
}
