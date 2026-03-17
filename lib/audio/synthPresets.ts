/**
 * Shared Synth Presets & Effects Chain
 *
 * Centralised audio setup used by both the main progression page
 * and the Sketchpad workspace.
 */

import * as Tone from "tone";

/* ─── Types ─── */

export type SoundPresetId = "piano" | "electric-piano" | "organ";
export type Synth = Tone.PolySynth | Tone.Sampler;

export const SOUND_PRESETS: ReadonlyArray<{ id: SoundPresetId; label: string }> = [
  { id: "piano", label: "Piano" },
  { id: "electric-piano", label: "Electric Piano" },
  { id: "organ", label: "Organ" },
];

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

/* ─── Preset Factory ─── */

export function createSynthForPreset(
  preset: SoundPresetId,
  onLoaded?: () => void,
): Synth {
  const { compressor } = getEffectsChain();

  switch (preset) {
    /* ── Piano: Salamander Grand Piano samples ── */
    case "piano": {
      const sampler = new Tone.Sampler({
        urls: {
          A1: "A1.mp3",
          A2: "A2.mp3",
          A3: "A3.mp3",
          A4: "A4.mp3",
          A5: "A5.mp3",
          C2: "C2.mp3",
          C3: "C3.mp3",
          C4: "C4.mp3",
          C5: "C5.mp3",
          C6: "C6.mp3",
          "D#2": "Ds2.mp3",
          "D#3": "Ds3.mp3",
          "D#4": "Ds4.mp3",
          "D#5": "Ds5.mp3",
          "F#2": "Fs2.mp3",
          "F#3": "Fs3.mp3",
          "F#4": "Fs4.mp3",
          "F#5": "Fs5.mp3",
        },
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        release: 1,
        volume: -6,
        onload: () => onLoaded?.(),
      });
      sampler.connect(compressor);
      sampler.connect(getPianoReverb());
      return sampler;
    }

    /* ── Electric Piano: Casio samples ── */
    case "electric-piano": {
      const sampler = new Tone.Sampler({
        urls: {
          A1: "A1.mp3",
          A2: "A2.mp3",
          A3: "A3.mp3",
          A4: "A4.mp3",
          A5: "A5.mp3",
          C2: "C2.mp3",
          C3: "C3.mp3",
          C4: "C4.mp3",
          C5: "C5.mp3",
          C6: "C6.mp3",
          "D#2": "Ds2.mp3",
          "D#3": "Ds3.mp3",
          "D#4": "Ds4.mp3",
          "D#5": "Ds5.mp3",
          "F#2": "Fs2.mp3",
          "F#3": "Fs3.mp3",
          "F#4": "Fs4.mp3",
          "F#5": "Fs5.mp3",
        },
        baseUrl: "https://tonejs.github.io/audio/casio/",
        release: 0.8,
        volume: -8,
        onload: () => onLoaded?.(),
      });
      sampler.connect(getEPChorus());
      return sampler;
    }

    /* ── Organ: FM synthesis with drawbar-style harmonics ── */
    case "organ": {
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
    }

    default: {
      onLoaded?.();
      return new Tone.PolySynth(Tone.Synth, {
        volume: -14,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.8 },
      }).connect(compressor);
    }
  }
}

/**
 * Returns true when the given preset needs async loading (sample-based).
 * Useful for showing a loading spinner while samples download.
 */
export function presetNeedsLoading(preset: SoundPresetId): boolean {
  return preset === "piano" || preset === "electric-piano";
}
