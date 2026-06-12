/**
 * Shared Synth Presets & Effects Chain
 *
 * Centralised audio setup used by the main progression page and the Sketchpad
 * workspace. Each instrument in the registry describes up to two
 * *realizations* of the same musical identity:
 *
 * - `lightweight` — pure Tone.js synthesis: zero downloads, instant start,
 *   works offline. Every instrument has one; it doubles as the fallback when
 *   sample loading fails, so degradation keeps the timbre family.
 * - `high` — a `Tone.Sampler` realization streaming real instrument samples.
 *   Loaded lazily; `useInstrument` plays the lightweight twin until the
 *   sampler's `onload` fires, then hot-swaps.
 *
 * Instrument metadata (ids, labels, categories) lives in
 * `instrumentCatalog.ts`, which is Tone-free so UI code can import it without
 * pulling Tone.js into its module graph.
 */

import * as Tone from "tone";
import type { SustainMode } from "./humanization";
import {
  INSTRUMENT_CATALOG,
  resolvePresetId,
  type AudioQuality,
  type InstrumentCatalogEntry,
  type SoundPresetId,
} from "./instrumentCatalog";

export type { AudioQuality, SoundPresetId } from "./instrumentCatalog";
export { SOUND_PRESETS, presetHasHighQuality } from "./instrumentCatalog";

/* ─── Types ─── */

export type Synth = Tone.PolySynth | Tone.Sampler;
export type MelodySynth = Tone.Synth | Tone.FMSynth | Tone.Sampler;

/** Options passed when building a chord instrument. */
export interface CreateSynthOptions {
  /** Controls how long notes ring after release. Defaults to "natural". */
  sustainMode?: SustainMode;
  /** Called once the instrument is ready (immediately for synths). */
  onLoaded?: () => void;
  /** Called if sample loading fails (sample-based instruments only). */
  onError?: (err: Error) => void;
}

/** Options passed when building a melody instrument. */
export interface CreateMelodySynthOptions {
  onLoaded?: () => void;
  /** Called if sample loading fails (sample-based instruments only). */
  onError?: (err: Error) => void;
}

/** One playable rendering of an instrument at a given quality tier. */
export interface InstrumentRealization {
  /** Whether this realization downloads samples (show a loading state). */
  needsLoading: boolean;
  create: (opts: CreateSynthOptions) => Synth;
  createMelody: (opts: CreateMelodySynthOptions) => MelodySynth;
}

/**
 * A self-contained description of a playable instrument. Adding a new
 * instrument means one catalog entry plus one registry entry — call sites
 * stay unchanged.
 */
export interface InstrumentDefinition extends InstrumentCatalogEntry {
  realizations: {
    lightweight: InstrumentRealization;
    high?: InstrumentRealization;
  };
}

/* ─── Release tuning ─── */

/** Map a sustain mode to a release time (seconds) for a given instrument. */
function pianoRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.25 : 1;
}
function epRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.2 : 0.8;
}
function padRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.3 : 1.4;
}

/* ─── Effects Chain (lazy singletons) ─── */

let masterReverb: Tone.Reverb | null = null;
let masterCompressor: Tone.Compressor | null = null;
let masterLimiter: Tone.Limiter | null = null;
let pianoReverbNode: Tone.Reverb | null = null;
let epChorusNode: Tone.Chorus | null = null;
let padChorusNode: Tone.Chorus | null = null;
let sawFilterNode: Tone.Filter | null = null;

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

/** Slow, wide chorus shared by the pad-style voices (Soft Keys, Filtered Saw). */
function getPadChorus(): Tone.Chorus {
  if (!padChorusNode) {
    const { compressor } = getEffectsChain();
    padChorusNode = new Tone.Chorus({ frequency: 0.6, delayTime: 4.5, depth: 0.5, wet: 0.3 })
      .connect(compressor)
      .start();
  }
  return padChorusNode;
}

/** Mellow lowpass that takes the edge off the Filtered Saw voice. */
function getSawFilter(): Tone.Filter {
  if (!sawFilterNode) {
    sawFilterNode = new Tone.Filter({
      frequency: 1100,
      type: "lowpass",
      rolloff: -24,
      Q: 0.8,
    }).connect(getPadChorus());
  }
  return sawFilterNode;
}

/* ─── Sample maps (shared between chord & melody samplers) ─── */

const SALAMANDER_URLS = {
  A1: "A1.mp3", A2: "A2.mp3", A3: "A3.mp3", A4: "A4.mp3", A5: "A5.mp3",
  C2: "C2.mp3", C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3", C6: "C6.mp3",
  "D#2": "Ds2.mp3", "D#3": "Ds3.mp3", "D#4": "Ds4.mp3", "D#5": "Ds5.mp3",
  "F#2": "Fs2.mp3", "F#3": "Fs3.mp3", "F#4": "Fs4.mp3", "F#5": "Fs5.mp3",
} as const;

/**
 * Electric Piano (Casio) sample map. The casio folder only ships the two
 * samples used by the canonical Tone.js Sampler demo — `Tone.Sampler`
 * pitch-shifts these to cover the full keyboard. Earlier code reused
 * SALAMANDER_URLS here, which requested ~16 nonexistent casio files; the failed
 * requests meant the Sampler's `onload` never fired and the UI hung forever on
 * "Loading Electric Piano…". Keep this map to files that actually exist.
 */
const CASIO_URLS = {
  A1: "A1.mp3",
  A2: "A2.mp3",
} as const;

/* ─── Lightweight synth voices ─── */

/** Percussive, mellow synth-piano: the lightweight twin of the sampled piano. */
function createSynthPiano(sustainMode: SustainMode | undefined): Tone.PolySynth {
  const { compressor } = getEffectsChain();
  const synth = new Tone.PolySynth(Tone.Synth, {
    volume: -10,
    oscillator: { type: "triangle8" },
    envelope: { attack: 0.004, decay: 1.6, sustain: 0.18, release: pianoRelease(sustainMode) },
  });
  synth.connect(compressor);
  synth.connect(getPianoReverb());
  return synth;
}

function createSynthPianoMelody(): Tone.Synth {
  const { compressor } = getEffectsChain();
  const synth = new Tone.Synth({
    volume: -8,
    oscillator: { type: "triangle8" },
    envelope: { attack: 0.004, decay: 1.6, sustain: 0.18, release: 1 },
  });
  synth.connect(compressor);
  synth.connect(getPianoReverb());
  return synth;
}

/** Classic FM electric piano: the lightweight twin of the sampled EP. */
function epFmOptions(sustainMode: SustainMode | undefined) {
  return {
    harmonicity: 2,
    modulationIndex: 1.4,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: {
      attack: 0.004,
      decay: 1.1,
      sustain: 0.25,
      release: epRelease(sustainMode),
    },
    modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.08, release: 0.3 },
  };
}

/* ─── Instrument Registry ─── */

const catalogEntry = (id: SoundPresetId): InstrumentCatalogEntry =>
  INSTRUMENT_CATALOG.find((e) => e.id === id)!;

export const INSTRUMENTS: Record<SoundPresetId, InstrumentDefinition> = {
  /* ── Lush Piano: Salamander Grand samples (HQ) / mellow synth piano (LW) ── */
  piano: {
    ...catalogEntry("piano"),
    realizations: {
      lightweight: {
        needsLoading: false,
        create: ({ sustainMode, onLoaded }) => {
          onLoaded?.();
          return createSynthPiano(sustainMode);
        },
        createMelody: ({ onLoaded }) => {
          onLoaded?.();
          return createSynthPianoMelody();
        },
      },
      high: {
        needsLoading: true,
        create: ({ sustainMode, onLoaded, onError }) => {
          const { compressor } = getEffectsChain();
          const sampler = new Tone.Sampler({
            urls: SALAMANDER_URLS,
            baseUrl: "https://tonejs.github.io/audio/salamander/",
            release: pianoRelease(sustainMode),
            volume: -6,
            onload: () => onLoaded?.(),
            onerror: (err) => onError?.(err),
          });
          sampler.connect(compressor);
          sampler.connect(getPianoReverb());
          return sampler;
        },
        createMelody: ({ onLoaded, onError }) => {
          const { compressor } = getEffectsChain();
          const sampler = new Tone.Sampler({
            urls: SALAMANDER_URLS,
            baseUrl: "https://tonejs.github.io/audio/salamander/",
            release: 1,
            volume: -4,
            onload: () => onLoaded?.(),
            onerror: (err) => onError?.(err),
          });
          sampler.connect(compressor);
          sampler.connect(getPianoReverb());
          return sampler;
        },
      },
    },
  },

  /* ── Electric Piano: Casio samples (HQ) / FM tine piano (LW) ── */
  "electric-piano": {
    ...catalogEntry("electric-piano"),
    realizations: {
      lightweight: {
        needsLoading: false,
        create: ({ sustainMode, onLoaded }) => {
          onLoaded?.();
          return new Tone.PolySynth(Tone.FMSynth, {
            volume: -12,
            ...epFmOptions(sustainMode),
          }).connect(getEPChorus());
        },
        createMelody: ({ onLoaded }) => {
          onLoaded?.();
          return new Tone.FMSynth({ volume: -10, ...epFmOptions(undefined) }).connect(
            getEPChorus(),
          );
        },
      },
      high: {
        needsLoading: true,
        create: ({ sustainMode, onLoaded, onError }) => {
          const sampler = new Tone.Sampler({
            urls: CASIO_URLS,
            baseUrl: "https://tonejs.github.io/audio/casio/",
            release: epRelease(sustainMode),
            volume: -8,
            onload: () => onLoaded?.(),
            onerror: (err) => onError?.(err),
          });
          sampler.connect(getEPChorus());
          return sampler;
        },
        createMelody: ({ onLoaded, onError }) => {
          const sampler = new Tone.Sampler({
            urls: CASIO_URLS,
            baseUrl: "https://tonejs.github.io/audio/casio/",
            release: 0.8,
            volume: -6,
            onload: () => onLoaded?.(),
            onerror: (err) => onError?.(err),
          });
          sampler.connect(getEPChorus());
          return sampler;
        },
      },
    },
  },

  /* ── Soft Keys: gentle detuned triangles through slow chorus ── */
  "soft-keys": {
    ...catalogEntry("soft-keys"),
    realizations: {
      lightweight: {
        needsLoading: false,
        create: ({ sustainMode, onLoaded }) => {
          onLoaded?.();
          return new Tone.PolySynth(Tone.Synth, {
            volume: -11,
            oscillator: { type: "fattriangle", count: 3, spread: 16 },
            envelope: {
              attack: 0.025,
              decay: 0.4,
              sustain: 0.65,
              release: padRelease(sustainMode),
            },
          }).connect(getPadChorus());
        },
        createMelody: ({ onLoaded }) => {
          onLoaded?.();
          return new Tone.Synth({
            volume: -9,
            oscillator: { type: "fattriangle", count: 3, spread: 16 },
            envelope: { attack: 0.02, decay: 0.4, sustain: 0.65, release: 1.2 },
          }).connect(getPadChorus());
        },
      },
    },
  },

  /* ── Filtered Saw: mellow polysynth pad, fat saws into a dark lowpass ── */
  "filtered-saw": {
    ...catalogEntry("filtered-saw"),
    realizations: {
      lightweight: {
        needsLoading: false,
        create: ({ sustainMode, onLoaded }) => {
          onLoaded?.();
          return new Tone.PolySynth(Tone.Synth, {
            volume: -14,
            oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
            envelope: {
              attack: 0.05,
              decay: 0.35,
              sustain: 0.75,
              release: padRelease(sustainMode),
            },
          }).connect(getSawFilter());
        },
        createMelody: ({ onLoaded }) => {
          onLoaded?.();
          return new Tone.Synth({
            volume: -12,
            oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
            envelope: { attack: 0.04, decay: 0.35, sustain: 0.75, release: 1.3 },
          }).connect(getSawFilter());
        },
      },
    },
  },

  /* ── Organ: FM synthesis with drawbar-style harmonics ── */
  organ: {
    ...catalogEntry("organ"),
    realizations: {
      lightweight: {
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
    },
  },
};

/* ─── Public factory API (thin lookups over the registry) ─── */

function resolveRealization(
  preset: SoundPresetId,
  quality: AudioQuality,
): InstrumentRealization {
  const def = INSTRUMENTS[resolvePresetId(preset)];
  if (quality === "high" && def.realizations.high) return def.realizations.high;
  return def.realizations.lightweight;
}

export function createSynthForPreset(
  preset: SoundPresetId,
  quality: AudioQuality,
  opts: CreateSynthOptions = {},
): Synth {
  return resolveRealization(preset, quality).create(opts);
}

export function createMelodySynthForPreset(
  preset: SoundPresetId,
  quality: AudioQuality,
  opts: CreateMelodySynthOptions = {},
): MelodySynth {
  return resolveRealization(preset, quality).createMelody(opts);
}

/**
 * Returns true when the given preset at the given quality needs async loading
 * (sample-based). Useful for showing a loading state while samples download.
 */
export function presetNeedsLoading(preset: SoundPresetId, quality: AudioQuality): boolean {
  return resolveRealization(preset, quality).needsLoading;
}
