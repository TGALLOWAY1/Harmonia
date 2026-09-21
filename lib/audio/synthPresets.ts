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
 * Every lightweight voice is a {@link LayeredInstrument}: a stack of Tone
 * voices with a velocity curve each, so playing harder changes the *timbre*
 * (a bright layer blooms, a transient speaks) instead of only turning the
 * level up. `scripts/auditionInstruments.ts` renders and measures all of them.
 *
 * Signal flow:
 *
 *   layers → insert fx (chorus / tremolo / widener) → voice bus ┐
 *                                                               ├→ compressor ┐
 *                                            bus → reverb send ─┤             ├→ master volume → limiter → out
 *                                                               └→ space reverb ┘
 *
 * The master volume and the space (reverb size + per-bus send) come from
 * `audioSettingsStore` and are applied live by {@link applyAudioSettings}.
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
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_SPACE,
  clampMasterVolume,
  getSpace,
  masterVolumeToGain,
  resolveSpaceId,
  type SpaceId,
} from "./audioSpace";
import { LayeredInstrument, type InstrumentLayer } from "./layeredInstrument";
import { useAudioSettingsStore } from "../state/audioSettingsStore";

export type { AudioQuality, SoundPresetId } from "./instrumentCatalog";
export {
  SOUND_PRESETS,
  presetHasHighQuality,
  resolveMelodyInstrument,
} from "./instrumentCatalog";
export { LayeredInstrument } from "./layeredInstrument";

/* ─── Types ─── */

export type Synth = Tone.PolySynth | Tone.Sampler | LayeredInstrument;
export type MelodySynth = Tone.Synth | Tone.FMSynth | Tone.Sampler | LayeredInstrument;

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
function stringRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.45 : 1.9;
}
function malletRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.3 : 1.2;
}
function pluckRelease(mode: SustainMode | undefined): number {
  return mode === "off" ? 0.15 : 0.4;
}

/* ─── Effects Chain (lazy singletons) ─── */

/**
 * Voice buses. Instruments of similar character share one, which is also
 * where their reverb send lives — a string ensemble wants far more room than
 * an electric piano, and the space setting scales all of them together.
 */
type BusId = "keys" | "epiano" | "pad" | "strings" | "mallet" | "plucked" | "organ";

/** Reverb send per bus at space "room" (0–1). */
const BUS_SEND: Record<BusId, number> = {
  keys: 0.22,
  epiano: 0.16,
  pad: 0.26,
  strings: 0.42,
  mallet: 0.3,
  plucked: 0.24,
  organ: 0.12,
};

interface VoiceBus {
  input: Tone.Gain;
  send: Tone.Gain;
}

let masterReverb: Tone.Reverb | null = null;
let masterCompressor: Tone.Compressor | null = null;
let masterLimiter: Tone.Limiter | null = null;
let masterVolumeNode: Tone.Gain | null = null;
let reverbReturn: Tone.Gain | null = null;
let buses: Map<BusId, VoiceBus> | null = null;
let epChorusNode: Tone.Chorus | null = null;
let epTremoloNode: Tone.Tremolo | null = null;
let padChorusNode: Tone.Chorus | null = null;
let keysWidenerNode: Tone.StereoWidener | null = null;
let softKeysWidenerNode: Tone.StereoWidener | null = null;
let stringChorusNode: Tone.Chorus | null = null;
let stringToneNode: Tone.Filter | null = null;
let vibraTremoloNode: Tone.Tremolo | null = null;
let organChorusNode: Tone.Chorus | null = null;
let pluckToneNode: Tone.Filter | null = null;

/** The space the live chain is currently built for. */
let activeSpace: SpaceId | null = null;
let unsubscribeSettings: (() => void) | null = null;

/** Read persisted settings defensively: audio must never depend on storage. */
function currentSettings(): { masterVolume: number; space: SpaceId } {
  try {
    const state = useAudioSettingsStore.getState();
    return {
      masterVolume: clampMasterVolume(state.masterVolume),
      space: resolveSpaceId(state.space),
    };
  } catch {
    return { masterVolume: DEFAULT_MASTER_VOLUME, space: DEFAULT_SPACE };
  }
}

export function getEffectsChain(): {
  reverb: Tone.Reverb;
  compressor: Tone.Compressor;
  limiter: Tone.Limiter;
} {
  if (!masterLimiter) {
    // The limiter is always last: whatever happens upstream, the output is safe.
    masterLimiter = new Tone.Limiter(-3).toDestination();
  }
  if (!masterVolumeNode) {
    const { masterVolume } = currentSettings();
    masterVolumeNode = new Tone.Gain(masterVolumeToGain(masterVolume)).connect(masterLimiter);
  }
  if (!masterCompressor) {
    masterCompressor = new Tone.Compressor({
      threshold: -16,
      ratio: 2.5,
      attack: 0.009,
      release: 0.2,
    }).connect(masterVolumeNode);
  }
  if (!reverbReturn) {
    // The reverb returns *after* the compressor so tails are never pumped by
    // the next chord.
    reverbReturn = new Tone.Gain(1).connect(masterVolumeNode);
  }
  if (!masterReverb) {
    const space = getSpace(currentSettings().space);
    activeSpace = space.id;
    masterReverb = new Tone.Reverb({
      decay: space.decay,
      preDelay: space.preDelay,
      wet: 1, // a send, not an insert: the dry path is the compressor branch
    }).connect(reverbReturn);
  }
  ensureSettingsSubscription();
  return { reverb: masterReverb, compressor: masterCompressor, limiter: masterLimiter };
}

function getBus(id: BusId): Tone.Gain {
  const { compressor, reverb } = getEffectsChain();
  if (!buses) buses = new Map();
  let bus = buses.get(id);
  if (!bus) {
    const space = getSpace(activeSpace ?? currentSettings().space);
    const input = new Tone.Gain(1).connect(compressor);
    const send = new Tone.Gain(BUS_SEND[id] * space.sendScale).connect(reverb);
    input.connect(send);
    bus = { input, send };
    buses.set(id, bus);
  }
  return bus.input;
}

/* ─── Live settings ─── */

const RAMP_SEC = 0.06;

/**
 * Push the current (or supplied) audio settings onto the live chain.
 *
 * Gain changes are ramped rather than jumped, so dragging a volume slider
 * cannot produce zipper noise. Changing the space regenerates the reverb's
 * impulse response, which is why it is only done when it actually changed.
 */
export function applyAudioSettings(settings?: {
  masterVolume?: number;
  space?: SpaceId;
}): void {
  const current = currentSettings();
  const masterVolume = clampMasterVolume(settings?.masterVolume ?? current.masterVolume);
  const space = getSpace(resolveSpaceId(settings?.space ?? current.space));

  if (masterVolumeNode) {
    masterVolumeNode.gain.rampTo(masterVolumeToGain(masterVolume), RAMP_SEC);
  }
  if (masterReverb && space.id !== activeSpace) {
    masterReverb.decay = space.decay;
    masterReverb.preDelay = space.preDelay;
  }
  activeSpace = space.id;
  if (buses) {
    for (const [id, bus] of buses) {
      bus.send.gain.rampTo(BUS_SEND[id] * space.sendScale, RAMP_SEC);
    }
  }
}

/**
 * Subscribe the audio chain to the settings store, lazily and only on the
 * client (this module is also evaluated during SSR). Set up when the chain is
 * first built, torn down by {@link resetEffectsChain}.
 */
function ensureSettingsSubscription(): void {
  if (unsubscribeSettings || typeof window === "undefined") return;
  try {
    unsubscribeSettings = useAudioSettingsStore.subscribe((state, previous) => {
      if (
        state.masterVolume === previous.masterVolume &&
        state.space === previous.space
      ) {
        return;
      }
      applyAudioSettings({ masterVolume: state.masterVolume, space: state.space });
    });
  } catch {
    // No store (or no window): settings simply stay at their defaults.
  }
}

/* ─── Insert effects (lazy singletons) ─── */

function getEPChorus(): Tone.Chorus {
  if (!epChorusNode) {
    epChorusNode = new Tone.Chorus({ frequency: 1.2, delayTime: 3.5, depth: 0.6, wet: 0.35 })
      .connect(getBus("epiano"))
      .start();
  }
  return epChorusNode;
}

/** The slow amplitude wobble an electric piano's vibrato circuit produces. */
function getEPTremolo(): Tone.Tremolo {
  if (!epTremoloNode) {
    epTremoloNode = new Tone.Tremolo({
      frequency: 4.2,
      depth: 0.22,
      spread: 140,
      wet: 1,
    })
      .connect(getEPChorus())
      .start();
  }
  return epTremoloNode;
}

/** Slow, wide chorus shared by the pad-style voices (Soft Keys, Filtered Saw). */
function getPadChorus(): Tone.Chorus {
  if (!padChorusNode) {
    padChorusNode = new Tone.Chorus({ frequency: 0.6, delayTime: 4.5, depth: 0.5, wet: 0.3 })
      .connect(getBus("pad"))
      .start();
  }
  return padChorusNode;
}

/**
 * A little stereo spread for the piano voices, short of a full chorus — a
 * chorus on a piano is exactly what makes a synth piano sound like a synth.
 */
function getKeysWidener(): Tone.StereoWidener {
  if (!keysWidenerNode) {
    keysWidenerNode = new Tone.StereoWidener({ width: 0.62 }).connect(getBus("keys"));
  }
  return keysWidenerNode;
}

/** Soft Keys keeps its pad character: widened, then through the slow chorus. */
function getSoftKeysWidener(): Tone.StereoWidener {
  if (!softKeysWidenerNode) {
    softKeysWidenerNode = new Tone.StereoWidener({ width: 0.7 }).connect(getPadChorus());
  }
  return softKeysWidenerNode;
}

/** Section-sized ensemble movement: slow, deep, and wide. */
function getStringChorus(): Tone.Chorus {
  if (!stringChorusNode) {
    stringChorusNode = new Tone.Chorus({
      frequency: 0.35,
      delayTime: 6,
      depth: 0.7,
      spread: 180,
      wet: 0.5,
    })
      .connect(getBus("strings"))
      .start();
  }
  return stringChorusNode;
}

/** Takes the synthetic edge off the string ensemble before the chorus. */
function getStringTone(): Tone.Filter {
  if (!stringToneNode) {
    stringToneNode = new Tone.Filter({
      frequency: 3200,
      type: "lowpass",
      rolloff: -12,
      Q: 0.5,
    }).connect(getStringChorus());
  }
  return stringToneNode;
}

/** The vibraphone's motor: the tremolo that gives the instrument its name. */
function getVibraTremolo(): Tone.Tremolo {
  if (!vibraTremoloNode) {
    vibraTremoloNode = new Tone.Tremolo({
      frequency: 4.6,
      depth: 0.42,
      spread: 180,
      wet: 1,
    })
      .connect(getBus("mallet"))
      .start();
  }
  return vibraTremoloNode;
}

/** Rotary-speaker style motion so the organ is never a static tone. */
function getOrganChorus(): Tone.Chorus {
  if (!organChorusNode) {
    organChorusNode = new Tone.Chorus({
      frequency: 5.4,
      delayTime: 2.5,
      depth: 0.45,
      spread: 180,
      wet: 0.5,
    })
      .connect(getBus("organ"))
      .start();
  }
  return organChorusNode;
}

/** Rounds the plucked voice so the attack reads as nylon rather than buzz. */
function getPluckTone(): Tone.Filter {
  if (!pluckToneNode) {
    pluckToneNode = new Tone.Filter({
      frequency: 4200,
      type: "lowpass",
      rolloff: -12,
      Q: 0.4,
    }).connect(getBus("plucked"));
  }
  return pluckToneNode;
}

/* ─── Offline rendering support ─── */

function disposeNode(node: { dispose: () => unknown } | null): void {
  if (!node) return;
  try {
    node.dispose();
  } catch {
    // Already disposed, or its AudioContext is gone (offline renders).
  }
}

/**
 * Dispose and forget every effects singleton.
 *
 * The chain binds to whichever Tone context existed when it was built, so an
 * offline render (`Tone.Offline` swaps the global context) must start from a
 * clean slate or it would feed nodes belonging to a dead context. The audition
 * harness calls this between renders; the app never needs it.
 */
export function resetEffectsChain(): void {
  if (unsubscribeSettings) {
    unsubscribeSettings();
    unsubscribeSettings = null;
  }
  disposeNode(pluckToneNode);
  disposeNode(organChorusNode);
  disposeNode(vibraTremoloNode);
  disposeNode(stringToneNode);
  disposeNode(stringChorusNode);
  disposeNode(softKeysWidenerNode);
  disposeNode(keysWidenerNode);
  disposeNode(padChorusNode);
  disposeNode(epTremoloNode);
  disposeNode(epChorusNode);
  if (buses) {
    for (const bus of buses.values()) {
      disposeNode(bus.send);
      disposeNode(bus.input);
    }
  }
  disposeNode(masterCompressor);
  disposeNode(masterReverb);
  disposeNode(reverbReturn);
  disposeNode(masterVolumeNode);
  disposeNode(masterLimiter);

  pluckToneNode = null;
  organChorusNode = null;
  vibraTremoloNode = null;
  stringToneNode = null;
  stringChorusNode = null;
  softKeysWidenerNode = null;
  keysWidenerNode = null;
  padChorusNode = null;
  epTremoloNode = null;
  epChorusNode = null;
  buses = null;
  masterCompressor = null;
  masterReverb = null;
  reverbReturn = null;
  masterVolumeNode = null;
  masterLimiter = null;
  activeSpace = null;
}

/**
 * Resolves once every convolution reverb in the chain has generated its
 * impulse response. Offline renders must await this: a Reverb whose IR has not
 * landed passes only its dry path, which would measure as a different sound.
 */
export async function effectsChainReady(): Promise<void> {
  const pending = [masterReverb?.ready].filter(Boolean);
  await Promise.all(pending);
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

/* ─── Velocity curves ─── */

/**
 * The three recurring shapes. A body layer is compressive so the note still
 * speaks at pianissimo; a bright layer is expansive so colour only arrives
 * under the fingers; a transient is gated so soft playing has no click at all.
 */
const BODY_CURVE = { exponent: 0.7, min: 0.1 } as const;
const BRIGHT_CURVE = { exponent: 2 } as const;
const TRANSIENT_CURVE = { exponent: 1.5, gate: 0.06 } as const;

/* ─── Lightweight voices ─── */

/**
 * Lush Piano — three layers.
 *
 * A triangle-based **body** that rings for a couple of seconds, an FM
 * **bright** layer (v²) that decays twice as fast as the body so hard notes
 * bloom and then settle the way a real string does, and a short inharmonic
 * **hammer** click that only appears once you are actually playing.
 */
function pianoBodyOptions(release: number) {
  return {
    oscillator: { type: "triangle8" as const },
    envelope: { attack: 0.005, decay: 2.2, sustain: 0.09, release },
  };
}
/**
 * The bright layer is a filtered saw rather than FM: a filter envelope gives
 * direct, measurable control over how far up the spectrum a hard note reaches
 * (here ~4.5kHz) and how fast it closes back down (~0.55s, well ahead of the
 * body's 2.2s decay), which is what "bloom, then settle" actually means.
 */
function pianoBrightOptions(release: number) {
  return {
    oscillator: { type: "sawtooth" as const },
    filter: { type: "lowpass" as const, rolloff: -12 as const, Q: 0.6 },
    filterEnvelope: {
      attack: 0.004,
      decay: 0.55,
      sustain: 0.07,
      release: 0.4,
      baseFrequency: 520,
      octaves: 3.1,
      exponent: 1.6,
    },
    envelope: { attack: 0.004, decay: 1.05, sustain: 0.02, release: Math.min(release, 0.6) },
  };
}
const PIANO_HAMMER_OPTIONS = {
  harmonicity: 7.4,
  modulationIndex: 13,
  oscillator: { type: "sine" as const },
  modulation: { type: "sine" as const },
  envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
  modulationEnvelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
};

function createPiano(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = pianoRelease(sustainMode);
  const out = getKeysWidener();
  const layers: InstrumentLayer[] = [
    {
      name: "body",
      node: new Tone.PolySynth(Tone.Synth, { volume: -13, ...pianoBodyOptions(release) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "bright",
      node: new Tone.PolySynth(Tone.MonoSynth, { volume: -12, ...pianoBrightOptions(release) }).connect(out),
      velocity: BRIGHT_CURVE,
    },
    {
      name: "hammer",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -21, ...PIANO_HAMMER_OPTIONS }).connect(out),
      velocity: TRANSIENT_CURVE,
      fixedDuration: 0.06,
    },
  ];
  return new LayeredInstrument(layers);
}

function createPianoMelody(): LayeredInstrument {
  const out = getKeysWidener();
  const layers: InstrumentLayer[] = [
    {
      name: "body",
      node: new Tone.Synth({ volume: -9, ...pianoBodyOptions(1) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "bright",
      node: new Tone.MonoSynth({ volume: -9, ...pianoBrightOptions(1) }).connect(out),
      velocity: BRIGHT_CURVE,
    },
    {
      name: "hammer",
      node: new Tone.FMSynth({ volume: -18, ...PIANO_HAMMER_OPTIONS }).connect(out),
      velocity: TRANSIENT_CURVE,
      fixedDuration: 0.06,
    },
  ];
  return new LayeredInstrument(layers);
}

/**
 * Electric Piano — DX-style tine.
 *
 * The **tine** carries the note; a high-index **bark** layer (v²·²) is what
 * makes a Rhodes snarl when struck hard; a metallic **bell** click sits on the
 * attack. Through the tremolo and chorus that define the instrument.
 */
function epTineOptions(release: number) {
  return {
    harmonicity: 1,
    modulationIndex: 3.2,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: { attack: 0.003, decay: 1.7, sustain: 0.1, release },
    modulationEnvelope: { attack: 0.002, decay: 0.45, sustain: 0.04, release: 0.25 },
  };
}
function epBarkOptions(release: number) {
  return {
    harmonicity: 1,
    modulationIndex: 9.5,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: { attack: 0.002, decay: 0.7, sustain: 0.01, release: Math.min(release, 0.4) },
    modulationEnvelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.12 },
  };
}
const EP_BELL_OPTIONS = {
  harmonicity: 9.6,
  modulationIndex: 7,
  oscillator: { type: "sine" as const },
  modulation: { type: "sine" as const },
  envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
  modulationEnvelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.03 },
};

function createElectricPiano(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = epRelease(sustainMode);
  const out = getEPTremolo();
  const layers: InstrumentLayer[] = [
    {
      name: "tine",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: 1, ...epTineOptions(release) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "bark",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -9, ...epBarkOptions(release) }).connect(out),
      velocity: { exponent: 2.2 },
    },
    {
      name: "bell",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -16, ...EP_BELL_OPTIONS }).connect(out),
      velocity: { exponent: 1.4, gate: 0.08 },
      fixedDuration: 0.07,
    },
  ];
  return new LayeredInstrument(layers);
}

function createElectricPianoMelody(): LayeredInstrument {
  const out = getEPTremolo();
  const layers: InstrumentLayer[] = [
    {
      name: "tine",
      node: new Tone.FMSynth({ volume: 4, ...epTineOptions(0.8) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "bark",
      node: new Tone.FMSynth({ volume: -5, ...epBarkOptions(0.8) }).connect(out),
      velocity: { exponent: 2.2 },
    },
    {
      name: "bell",
      node: new Tone.FMSynth({ volume: -13, ...EP_BELL_OPTIONS }).connect(out),
      velocity: { exponent: 1.4, gate: 0.08 },
      fixedDuration: 0.07,
    },
  ];
  return new LayeredInstrument(layers);
}

/**
 * Soft Keys — the gentle detuned-triangle voice it always was, plus a filtered
 * saw **air** layer that only opens up under harder playing, through a stereo
 * widener and the slow pad chorus.
 */
function softBodyOptions(release: number) {
  return {
    oscillator: { type: "fattriangle" as const, count: 3, spread: 16 },
    envelope: { attack: 0.025, decay: 0.45, sustain: 0.62, release },
  };
}
function softAirOptions(release: number, baseFrequency: number) {
  return {
    oscillator: { type: "fatsawtooth" as const, count: 2, spread: 24 },
    filter: { type: "lowpass" as const, rolloff: -12 as const, Q: 0.7 },
    filterEnvelope: {
      attack: 0.05,
      decay: 0.7,
      sustain: 0.35,
      release: 1,
      baseFrequency,
      octaves: 2.4,
    },
    envelope: { attack: 0.04, decay: 0.6, sustain: 0.45, release },
  };
}

function createSoftKeys(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = padRelease(sustainMode);
  const out = getSoftKeysWidener();
  return new LayeredInstrument([
    {
      name: "body",
      node: new Tone.PolySynth(Tone.Synth, { volume: -13, ...softBodyOptions(release) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "air",
      node: new Tone.PolySynth(Tone.MonoSynth, { volume: -20, ...softAirOptions(release, 700) }).connect(out),
      velocity: { exponent: 2.1 },
    },
  ]);
}

function createSoftKeysMelody(): LayeredInstrument {
  const out = getSoftKeysWidener();
  return new LayeredInstrument([
    {
      name: "body",
      node: new Tone.Synth({ volume: -11, ...softBodyOptions(1.2) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "air",
      node: new Tone.MonoSynth({ volume: -17, ...softAirOptions(1.2, 950) }).connect(out),
      velocity: { exponent: 2.1 },
    },
  ]);
}

/**
 * Filtered Saw — two `MonoSynth` layers with real filter envelopes. Tone's
 * filter envelope ignores velocity, so brightness comes from the second layer:
 * a wider-sweeping, faster-closing filter that only sounds when played hard.
 */
function sawDarkOptions(release: number, baseFrequency: number) {
  return {
    oscillator: { type: "fatsawtooth" as const, count: 3, spread: 20 },
    filter: { type: "lowpass" as const, rolloff: -24 as const, Q: 1.1 },
    filterEnvelope: {
      attack: 0.03,
      decay: 0.65,
      sustain: 0.3,
      release: 0.9,
      baseFrequency,
      octaves: 2.6,
      exponent: 2,
    },
    envelope: { attack: 0.04, decay: 0.4, sustain: 0.72, release },
  };
}
function sawBrightOptions(release: number, baseFrequency: number) {
  return {
    oscillator: { type: "fatsawtooth" as const, count: 3, spread: 28 },
    filter: { type: "lowpass" as const, rolloff: -24 as const, Q: 1.4 },
    filterEnvelope: {
      attack: 0.012,
      decay: 0.38,
      sustain: 0.16,
      release: 0.7,
      baseFrequency,
      octaves: 3.2,
      exponent: 2,
    },
    envelope: { attack: 0.02, decay: 0.45, sustain: 0.5, release },
  };
}

function createFilteredSaw(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = padRelease(sustainMode);
  const out = getPadChorus();
  return new LayeredInstrument([
    {
      name: "dark",
      node: new Tone.PolySynth(Tone.MonoSynth, { volume: -16, ...sawDarkOptions(release, 190) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "bright",
      node: new Tone.PolySynth(Tone.MonoSynth, { volume: -20, ...sawBrightOptions(release, 460) }).connect(out),
      velocity: { exponent: 2.2 },
    },
  ]);
}

function createFilteredSawMelody(): LayeredInstrument {
  const out = getPadChorus();
  return new LayeredInstrument([
    {
      name: "dark",
      node: new Tone.MonoSynth({ volume: -12, ...sawDarkOptions(1.3, 420) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "bright",
      node: new Tone.MonoSynth({ volume: -16, ...sawBrightOptions(1.3, 900) }).connect(out),
      velocity: { exponent: 2.2 },
    },
  ]);
}

/**
 * Organ — drawbar partials plus the percussive key click of a tonewheel
 * instrument, through a rotary-style chorus so the tone always moves.
 */
function organDrawbarOptions(release: number) {
  return {
    // Drawbar registration: 8', 4', 2⅔', 2', and a touch of the upper mutations.
    oscillator: { type: "custom" as const, partials: [1, 0.55, 0.32, 0.18, 0.1, 0.06] },
    envelope: { attack: 0.012, decay: 0.06, sustain: 0.92, release },
  };
}

/**
 * The upper drawbars, pulled out as you lean on the keys. A real tonewheel
 * organ has no velocity response at all — but a fixed registration makes a
 * lifeless lead voice, so harder playing adds the upper mutations rather than
 * changing the timbre of the wheels themselves.
 */
function organUpperOptions(release: number) {
  return {
    oscillator: { type: "custom" as const, partials: [0, 0, 0.6, 0.4, 0.3, 0.22, 0.15] },
    envelope: { attack: 0.014, decay: 0.07, sustain: 0.88, release },
  };
}
/**
 * Tonewheel key click: the contact transient as the key closes, which is
 * broadband rather than pitched — hence high-index FM on a square modulator
 * rather than a note-shaped oscillator.
 */
const ORGAN_CLICK_OPTIONS = {
  harmonicity: 6.2,
  modulationIndex: 11,
  oscillator: { type: "square" as const },
  modulation: { type: "square" as const },
  envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
  modulationEnvelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.015 },
};

function createOrgan(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = sustainMode === "off" ? 0.12 : 0.3;
  const out = getOrganChorus();
  return new LayeredInstrument([
    {
      name: "drawbars",
      node: new Tone.PolySynth(Tone.Synth, { volume: -24, ...organDrawbarOptions(release) }).connect(out),
      velocity: { exponent: 0.6, min: 0.12 },
    },
    {
      name: "upper",
      node: new Tone.PolySynth(Tone.Synth, { volume: -26, ...organUpperOptions(release) }).connect(out),
      velocity: { exponent: 2 },
    },
    {
      name: "click",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -15, ...ORGAN_CLICK_OPTIONS }).connect(out),
      velocity: { exponent: 1.8, gate: 0.04 },
      fixedDuration: 0.04,
    },
  ]);
}

function createOrganMelody(): LayeredInstrument {
  const out = getOrganChorus();
  return new LayeredInstrument([
    {
      name: "drawbars",
      node: new Tone.Synth({ volume: -23, ...organDrawbarOptions(0.3) }).connect(out),
      velocity: { exponent: 0.6, min: 0.12 },
    },
    {
      name: "upper",
      node: new Tone.Synth({ volume: -23, ...organUpperOptions(0.3) }).connect(out),
      velocity: { exponent: 2 },
    },
    {
      name: "click",
      node: new Tone.FMSynth({ volume: -13, ...ORGAN_CLICK_OPTIONS }).connect(out),
      velocity: { exponent: 1.8, gate: 0.04 },
      fixedDuration: 0.04,
    },
  ]);
}

/**
 * Warm Strings — a slow, detuned saw ensemble behind a lowpass, with a second
 * **air** layer for bow pressure, through a deep slow chorus and the largest
 * reverb send in the registry. Built for sustained chords, not for runs.
 */
function stringEnsembleOptions(release: number, baseFrequency: number) {
  return {
    oscillator: { type: "fatsawtooth" as const, count: 4, spread: 36 },
    filter: { type: "lowpass" as const, rolloff: -24 as const, Q: 0.6 },
    filterEnvelope: {
      attack: 0.5,
      decay: 1.4,
      sustain: 0.5,
      release: 1.5,
      baseFrequency,
      octaves: 2.5,
      exponent: 2,
    },
    envelope: { attack: 0.3, decay: 0.9, sustain: 0.85, release },
  };
}
function stringAirOptions(release: number, baseFrequency: number) {
  return {
    oscillator: { type: "fatsawtooth" as const, count: 3, spread: 26 },
    filter: { type: "lowpass" as const, rolloff: -12 as const, Q: 0.6 },
    filterEnvelope: {
      attack: 0.45,
      decay: 1.2,
      sustain: 0.45,
      release: 1.4,
      baseFrequency,
      octaves: 2.2,
    },
    envelope: { attack: 0.42, decay: 1.1, sustain: 0.6, release },
  };
}

function createWarmStrings(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = stringRelease(sustainMode);
  const out = getStringTone();
  return new LayeredInstrument([
    {
      name: "ensemble",
      node: new Tone.PolySynth(Tone.MonoSynth, { volume: -16, ...stringEnsembleOptions(release, 240) }).connect(out),
      velocity: { exponent: 0.7, min: 0.12 },
    },
    {
      name: "air",
      node: new Tone.PolySynth(Tone.MonoSynth, { volume: -21, ...stringAirOptions(release, 800) }).connect(out),
      velocity: { exponent: 1.9 },
    },
  ]);
}

function createWarmStringsMelody(): LayeredInstrument {
  const out = getStringTone();
  return new LayeredInstrument([
    {
      name: "ensemble",
      node: new Tone.MonoSynth({ volume: -14, ...stringEnsembleOptions(1.9, 430) }).connect(out),
      velocity: { exponent: 0.7, min: 0.12 },
    },
    {
      name: "air",
      node: new Tone.MonoSynth({ volume: -19, ...stringAirOptions(1.9, 1100) }).connect(out),
      velocity: { exponent: 1.9 },
    },
  ]);
}

/**
 * Vibraphone — an FM **bar** tuned to the bar's strong fourth partial with no
 * sustain (it rings down like a struck bar), a **shimmer** of higher partials
 * under harder mallets, and the mallet contact itself. The motor tremolo is
 * the shared insert.
 */
function vibraBarOptions(release: number) {
  return {
    harmonicity: 4,
    modulationIndex: 1.5,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: { attack: 0.002, decay: 2.6, sustain: 0.02, release },
    modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.3 },
  };
}
function vibraShimmerOptions(release: number) {
  return {
    harmonicity: 9.2,
    modulationIndex: 2.4,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: Math.min(release, 0.5) },
    modulationEnvelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
  };
}
const VIBRA_MALLET_OPTIONS = {
  harmonicity: 3.1,
  modulationIndex: 5.5,
  oscillator: { type: "sine" as const },
  modulation: { type: "sine" as const },
  envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.03 },
  modulationEnvelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
};

function createVibraphone(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = malletRelease(sustainMode);
  const out = getVibraTremolo();
  return new LayeredInstrument([
    {
      name: "bar",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -3, ...vibraBarOptions(release) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "shimmer",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -5, ...vibraShimmerOptions(release) }).connect(out),
      velocity: { exponent: 2 },
    },
    {
      name: "mallet",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -10, ...VIBRA_MALLET_OPTIONS }).connect(out),
      velocity: TRANSIENT_CURVE,
      fixedDuration: 0.05,
    },
  ]);
}

function createVibraphoneMelody(): LayeredInstrument {
  const out = getVibraTremolo();
  return new LayeredInstrument([
    {
      name: "bar",
      node: new Tone.FMSynth({ volume: -1, ...vibraBarOptions(1.2) }).connect(out),
      velocity: BODY_CURVE,
    },
    {
      name: "shimmer",
      node: new Tone.FMSynth({ volume: -3, ...vibraShimmerOptions(1.2) }).connect(out),
      velocity: { exponent: 2 },
    },
    {
      name: "mallet",
      node: new Tone.FMSynth({ volume: -8, ...VIBRA_MALLET_OPTIONS }).connect(out),
      velocity: TRANSIENT_CURVE,
      fixedDuration: 0.05,
    },
  ]);
}

/**
 * Pluck — harp/nylon character. `Tone.PluckSynth` is not `Monophonic`, so it
 * cannot be a PolySynth voice; FM voices with fast, sustain-free envelopes get
 * the same gesture with far more control over the attack.
 */
function pluckStringOptions(release: number) {
  return {
    harmonicity: 2.01,
    modulationIndex: 3.4,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: { attack: 0.002, decay: 1.3, sustain: 0, release },
    modulationEnvelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.15 },
  };
}
function pluckNailOptions(release: number) {
  return {
    harmonicity: 5.5,
    modulationIndex: 6,
    oscillator: { type: "sine" as const },
    modulation: { type: "sine" as const },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: Math.min(release, 0.2) },
    modulationEnvelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.06 },
  };
}

function createPluck(sustainMode: SustainMode | undefined): LayeredInstrument {
  const release = pluckRelease(sustainMode);
  const out = getPluckTone();
  return new LayeredInstrument([
    {
      name: "string",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -5, ...pluckStringOptions(release) }).connect(out),
      velocity: { exponent: 0.75, min: 0.1 },
    },
    {
      name: "nail",
      node: new Tone.PolySynth(Tone.FMSynth, { volume: -9, ...pluckNailOptions(release) }).connect(out),
      velocity: { exponent: 2.2 },
    },
  ]);
}

function createPluckMelody(): LayeredInstrument {
  const out = getPluckTone();
  return new LayeredInstrument([
    {
      name: "string",
      node: new Tone.FMSynth({ volume: -2, ...pluckStringOptions(0.4) }).connect(out),
      velocity: { exponent: 0.75, min: 0.1 },
    },
    {
      name: "nail",
      node: new Tone.FMSynth({ volume: -7, ...pluckNailOptions(0.4) }).connect(out),
      velocity: { exponent: 2.2 },
    },
  ]);
}

/* ─── Instrument Registry ─── */

const catalogEntry = (id: SoundPresetId): InstrumentCatalogEntry =>
  INSTRUMENT_CATALOG.find((e) => e.id === id)!;

/** Wrap a synth factory in the realization shape (synths are ready at once). */
function synthRealization(
  create: (sustainMode: SustainMode | undefined) => LayeredInstrument,
  createMelody: () => LayeredInstrument,
): InstrumentRealization {
  return {
    needsLoading: false,
    create: ({ sustainMode, onLoaded }) => {
      onLoaded?.();
      return create(sustainMode);
    },
    createMelody: ({ onLoaded }) => {
      onLoaded?.();
      return createMelody();
    },
  };
}

export const INSTRUMENTS: Record<SoundPresetId, InstrumentDefinition> = {
  /* ── Lush Piano: Salamander Grand samples (HQ) / layered synth piano (LW) ── */
  piano: {
    ...catalogEntry("piano"),
    realizations: {
      lightweight: synthRealization(createPiano, createPianoMelody),
      high: {
        needsLoading: true,
        create: ({ sustainMode, onLoaded, onError }) => {
          const sampler = new Tone.Sampler({
            urls: SALAMANDER_URLS,
            baseUrl: "https://tonejs.github.io/audio/salamander/",
            release: pianoRelease(sustainMode),
            volume: -8,
            onload: () => onLoaded?.(),
            onerror: (err) => onError?.(err),
          });
          sampler.connect(getKeysWidener());
          return sampler;
        },
        createMelody: ({ onLoaded, onError }) => {
          const sampler = new Tone.Sampler({
            urls: SALAMANDER_URLS,
            baseUrl: "https://tonejs.github.io/audio/salamander/",
            release: 1,
            volume: -6,
            onload: () => onLoaded?.(),
            onerror: (err) => onError?.(err),
          });
          sampler.connect(getKeysWidener());
          return sampler;
        },
      },
    },
  },

  /* ── Electric Piano: Casio samples (HQ) / layered FM tine piano (LW) ── */
  "electric-piano": {
    ...catalogEntry("electric-piano"),
    realizations: {
      lightweight: synthRealization(createElectricPiano, createElectricPianoMelody),
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

  /* ── Soft Keys: detuned triangles + velocity air, wide ── */
  "soft-keys": {
    ...catalogEntry("soft-keys"),
    realizations: { lightweight: synthRealization(createSoftKeys, createSoftKeysMelody) },
  },

  /* ── Filtered Saw: two filter-envelope layers, dark → bright with velocity ── */
  "filtered-saw": {
    ...catalogEntry("filtered-saw"),
    realizations: { lightweight: synthRealization(createFilteredSaw, createFilteredSawMelody) },
  },

  /* ── Organ: drawbar partials + key click through a rotary chorus ── */
  organ: {
    ...catalogEntry("organ"),
    realizations: { lightweight: synthRealization(createOrgan, createOrganMelody) },
  },

  /* ── Warm Strings: slow detuned-saw ensemble, wide, big send ── */
  "warm-strings": {
    ...catalogEntry("warm-strings"),
    realizations: { lightweight: synthRealization(createWarmStrings, createWarmStringsMelody) },
  },

  /* ── Vibraphone: FM bar + motor tremolo ── */
  vibraphone: {
    ...catalogEntry("vibraphone"),
    realizations: { lightweight: synthRealization(createVibraphone, createVibraphoneMelody) },
  },

  /* ── Pluck: harp/nylon-like fast decay ── */
  pluck: {
    ...catalogEntry("pluck"),
    realizations: { lightweight: synthRealization(createPluck, createPluckMelody) },
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
