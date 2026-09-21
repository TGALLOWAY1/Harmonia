/**
 * Audition analysis — pure measurement helpers for rendered audio.
 *
 * Nobody can listen to Harmonia in CI, so every claim about how an instrument
 * sounds has to be a number. These helpers turn a rendered stereo buffer into
 * the handful of figures that actually describe a musical note: how loud it is,
 * how bright it is, how fast it speaks, and how long it rings.
 *
 * The module is dependency-free (no Tone, no DOM) so it can run inside the
 * browser bundle *and* be unit-tested in node.
 */

/** A rendered take: de-interleaved channels plus the sample rate. */
export interface RenderedAudio {
  channels: Float32Array[];
  sampleRate: number;
}

/** Where the note sits inside the render (seconds). */
export interface RenderTiming {
  /** When `triggerAttack` happened. */
  onset: number;
  /** When the release was triggered (onset + held duration). */
  release: number;
  /** Start of the sustained-loudness window. */
  sustainStart: number;
  /** End of the sustained-loudness window. */
  sustainEnd: number;
  /** How much audio after the onset feeds the brightness FFT. */
  spectrumWindow: number;
}

export interface RenderMetrics {
  /** Highest absolute sample in either channel, in dBFS. */
  peakDb: number;
  /** Loudness over the sustained window, in dBFS. */
  rmsDb: number;
  /**
   * Loudness over the whole held note (onset → release), in dBFS.
   *
   * The sustained window alone cannot balance a struck instrument against a
   * sustaining one — a vibraphone has almost all of its energy in the first
   * 200ms by design. This is the figure the instruments are gain-staged on.
   */
  noteRmsDb: number;
  /** Spectral centroid (brightness) in Hz over the post-onset window. */
  centroidHz: number;
  /** Onset → first sample at 90% of peak, in milliseconds. */
  attackMs: number;
  /** Release → envelope below −60 dBFS, in seconds (Infinity if it never does). */
  tailS: number;
  /** True when the render never rises above −80 dBFS. */
  silent: boolean;
  /** True when any sample is NaN/Infinity. */
  nan: boolean;
  /** True when the peak exceeds −0.1 dBFS. */
  clipping: boolean;
}

export const SILENCE_DB = -80;
export const TAIL_FLOOR_DB = -60;
export const CLIP_DB = -0.1;

/** Amplitude (0–1) → dBFS, with a finite floor so tables stay readable. */
export function toDb(amplitude: number): number {
  if (!(amplitude > 0)) return -Infinity;
  return 20 * Math.log10(amplitude);
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(length, Math.round(value)));
}

/** Largest absolute sample across every channel. */
export function peakAmplitude(audio: RenderedAudio): number {
  let peak = 0;
  for (const channel of audio.channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * RMS across a time window, averaging *power* over channels rather than
 * summing them to mono — a wide stereo voice must not measure quiet because
 * its sides cancel.
 */
export function windowRms(audio: RenderedAudio, startSec: number, endSec: number): number {
  const { channels, sampleRate } = audio;
  if (channels.length === 0) return 0;
  const length = channels[0].length;
  const from = clampIndex(startSec * sampleRate, length);
  const to = clampIndex(endSec * sampleRate, length);
  if (to <= from) return 0;
  let sum = 0;
  for (const channel of channels) {
    for (let i = from; i < to; i++) sum += channel[i] * channel[i];
  }
  return Math.sqrt(sum / ((to - from) * channels.length));
}

/* ─── FFT ─── */

/**
 * In-place iterative radix-2 FFT. `re`/`im` must have a power-of-two length.
 * Small and plain on purpose: this runs once per render, not per sample.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Fraction of the analysis window given over to the trailing taper. */
const WINDOW_TAPER = 0.25;
/** Fraction of the window given over to the (deliberately tiny) leading taper. */
const WINDOW_LEAD_TAPER = 0.01;

/**
 * Asymmetric (Tukey-style) analysis window: essentially flat over the onset,
 * cosine taper at the end.
 *
 * A symmetric Hann would fade out exactly the first 100ms of the window — the
 * attack transient, which is precisely where a hard-struck note's brightness
 * lives. The leading taper here is ~5ms, short enough to leave any real attack
 * intact but long enough to stop the window edge itself from smearing energy
 * across the spectrum.
 */
export function onsetWindow(index: number, length: number): number {
  const lead = Math.max(1, Math.floor(length * WINDOW_LEAD_TAPER));
  if (index < lead) return 0.5 - 0.5 * Math.cos((Math.PI * index) / lead);
  const taper = Math.max(1, Math.floor(length * WINDOW_TAPER));
  const fromEnd = length - 1 - index;
  if (fromEnd >= taper) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * fromEnd) / taper);
}

/**
 * Bins quieter than this (relative to the loudest bin) are left out of the
 * centroid. Window leakage leaves a low, wide skirt of energy across the whole
 * spectrum, and because the centroid weights every bin by its frequency, that
 * skirt would drag the reported brightness upwards by 20% or more.
 */
const CENTROID_FLOOR = Math.pow(10, -60 / 20);

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Magnitude-weighted mean frequency of a window, in Hz — the standard
 * "brightness" proxy. Channels are analysed separately and their spectra
 * averaged, so stereo width never hides upper partials.
 */
export function spectralCentroid(
  audio: RenderedAudio,
  startSec: number,
  endSec: number,
): number {
  const { channels, sampleRate } = audio;
  if (channels.length === 0) return 0;
  const length = channels[0].length;
  const from = clampIndex(startSec * sampleRate, length);
  const to = clampIndex(endSec * sampleRate, length);
  const count = to - from;
  if (count < 64) return 0;

  const size = nextPowerOfTwo(count);
  const bins = size / 2;
  const magnitude = new Float64Array(bins);

  for (const channel of channels) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < count; i++) {
      re[i] = channel[from + i] * onsetWindow(i, count);
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      magnitude[k] += Math.hypot(re[k], im[k]);
    }
  }

  let loudest = 0;
  for (let k = 1; k < bins; k++) loudest = Math.max(loudest, magnitude[k]);
  const floor = loudest * CENTROID_FLOOR;

  let weighted = 0;
  let total = 0;
  const binHz = sampleRate / size;
  // Skip DC (k = 0): a tiny offset there would drag the centroid to zero.
  for (let k = 1; k < bins; k++) {
    if (magnitude[k] < floor) continue;
    weighted += k * binHz * magnitude[k];
    total += magnitude[k];
  }
  return total > 0 ? weighted / total : 0;
}

/* ─── Envelope-derived figures ─── */

/** Onset → first sample reaching 90% of the render's peak, in milliseconds. */
export function attackMs(audio: RenderedAudio, onsetSec: number): number {
  const peak = peakAmplitude(audio);
  if (peak <= 0) return 0;
  const target = peak * 0.9;
  const { channels, sampleRate } = audio;
  const length = channels[0].length;
  const from = clampIndex(onsetSec * sampleRate, length);
  for (let i = from; i < length; i++) {
    for (const channel of channels) {
      if (Math.abs(channel[i]) >= target) {
        return ((i - from) / sampleRate) * 1000;
      }
    }
  }
  return ((length - from) / sampleRate) * 1000;
}

/**
 * Release → the moment the short-window envelope drops below −60 dBFS and
 * stays there. Scanning backwards means a tremolo dip mid-note can never be
 * mistaken for the end of the tail.
 *
 * Returns Infinity when the render ends while the voice is still audible.
 */
export function tailSeconds(audio: RenderedAudio, releaseSec: number): number {
  const { channels, sampleRate } = audio;
  const length = channels[0].length;
  const hop = Math.max(1, Math.round(0.01 * sampleRate));
  const win = Math.max(hop, Math.round(0.03 * sampleRate));
  const floor = Math.pow(10, TAIL_FLOOR_DB / 20);
  const releaseIdx = clampIndex(releaseSec * sampleRate, length);

  let lastAudible = -1;
  for (let start = releaseIdx; start < length; start += hop) {
    const end = Math.min(length, start + win);
    let sum = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) sum += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sum / Math.max(1, (end - start) * channels.length));
    if (rms >= floor) lastAudible = start;
  }

  if (lastAudible < 0) return 0;
  const decayedAt = (lastAudible + hop) / sampleRate;
  if (decayedAt >= length / sampleRate) return Infinity;
  return Math.max(0, decayedAt - releaseSec);
}

export function hasNonFinite(audio: RenderedAudio): boolean {
  for (const channel of audio.channels) {
    for (let i = 0; i < channel.length; i++) {
      if (!Number.isFinite(channel[i])) return true;
    }
  }
  return false;
}

/** Every measurement for one render. */
export function analyzeRender(audio: RenderedAudio, timing: RenderTiming): RenderMetrics {
  const nan = hasNonFinite(audio);
  const peak = nan ? 0 : peakAmplitude(audio);
  const rms = nan ? 0 : windowRms(audio, timing.sustainStart, timing.sustainEnd);
  const noteRms = nan ? 0 : windowRms(audio, timing.onset, timing.release);
  const centroid = nan
    ? 0
    : spectralCentroid(audio, timing.onset, timing.onset + timing.spectrumWindow);
  const peakDb = toDb(peak);

  return {
    peakDb,
    rmsDb: toDb(rms),
    noteRmsDb: toDb(noteRms),
    centroidHz: centroid,
    attackMs: nan ? 0 : attackMs(audio, timing.onset),
    tailS: nan ? 0 : tailSeconds(audio, timing.release),
    silent: !nan && peakDb < SILENCE_DB,
    nan,
    clipping: !nan && peakDb > CLIP_DB,
  };
}
