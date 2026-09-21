/**
 * Tests for the audition measurements themselves.
 *
 * The harness is the only evidence anyone has about how the instruments sound,
 * so its maths is checked against signals whose answers are known by hand: a
 * sine of known amplitude and frequency, a known envelope, known silence.
 */

import { describe, expect, it } from "vitest";
import {
  analyzeRender,
  attackMs,
  onsetWindow,
  peakAmplitude,
  spectralCentroid,
  tailSeconds,
  toDb,
  windowRms,
  type RenderedAudio,
  type RenderTiming,
} from "../analysis";

const SR = 44100;

function sine(frequency: number, seconds: number, amplitude = 1): RenderedAudio {
  const length = Math.round(seconds * SR);
  const channel = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    channel[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SR);
  }
  return { channels: [channel, Float32Array.from(channel)], sampleRate: SR };
}

const timing: RenderTiming = {
  onset: 0.05,
  release: 1.25,
  sustainStart: 0.2,
  sustainEnd: 1,
  spectrumWindow: 0.5,
};

describe("levels", () => {
  it("converts amplitude to dBFS", () => {
    expect(toDb(1)).toBeCloseTo(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(toDb(0)).toBe(-Infinity);
  });

  it("finds the peak across channels", () => {
    const audio = sine(440, 0.5, 0.5);
    expect(peakAmplitude(audio)).toBeCloseTo(0.5, 2);
  });

  it("measures the RMS of a sine as amplitude / √2", () => {
    const audio = sine(440, 1.5, 0.8);
    expect(windowRms(audio, 0.2, 1)).toBeCloseTo(0.8 / Math.SQRT2, 2);
  });

  it("averages power across channels instead of summing to mono", () => {
    // A hard-panned (or out-of-phase) signal must not measure as silence.
    const length = SR;
    const left = new Float32Array(length).fill(0.5);
    const right = new Float32Array(length).fill(-0.5);
    const audio: RenderedAudio = { channels: [left, right], sampleRate: SR };
    expect(windowRms(audio, 0, 1)).toBeCloseTo(0.5, 3);
  });
});

describe("spectral centroid", () => {
  it("lands on the frequency of a pure tone", () => {
    const centroid = spectralCentroid(sine(1000, 1), 0.05, 0.55);
    expect(centroid).toBeGreaterThan(950);
    expect(centroid).toBeLessThan(1050);
  });

  it("rises when the tone rises", () => {
    const low = spectralCentroid(sine(400, 1), 0.05, 0.55);
    const high = spectralCentroid(sine(2000, 1), 0.05, 0.55);
    expect(high).toBeGreaterThan(low * 3);
  });

  it("returns 0 for silence rather than NaN", () => {
    const silence: RenderedAudio = { channels: [new Float32Array(SR)], sampleRate: SR };
    expect(spectralCentroid(silence, 0.05, 0.55)).toBe(0);
  });
});

describe("onset window", () => {
  it("is flat over the attack and tapers at the end", () => {
    // The leading taper is ~1% of the window (a few ms), just enough to stop
    // the window edge leaking; everything a real attack occupies is untouched.
    expect(onsetWindow(20, 1000)).toBe(1);
    expect(onsetWindow(500, 1000)).toBe(1);
    expect(onsetWindow(999, 1000)).toBeCloseTo(0, 5);
    expect(onsetWindow(900, 1000)).toBeLessThan(1);
  });

  it("keeps the leading taper an order of magnitude shorter than the trailing one", () => {
    const lead = Array.from({ length: 1000 }, (_, i) => onsetWindow(i, 1000)).findIndex(
      (value) => value === 1,
    );
    const trail = 1000 - Array.from({ length: 1000 }, (_, i) => onsetWindow(i, 1000)).lastIndexOf(1);
    expect(lead).toBeLessThan(trail / 10);
  });

  it("keeps a transient's brightness measurable", () => {
    // A bright burst confined to the first 60ms, then a low sine: with a
    // symmetric window the burst would be faded out and invisible.
    const length = Math.round(0.55 * SR);
    const channel = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const t = i / SR;
      channel[i] =
        t < 0.06
          ? Math.sin(2 * Math.PI * 4000 * t)
          : 0.5 * Math.sin(2 * Math.PI * 200 * t);
    }
    const audio: RenderedAudio = { channels: [channel], sampleRate: SR };
    expect(spectralCentroid(audio, 0, 0.55)).toBeGreaterThan(400);
  });
});

describe("envelope figures", () => {
  it("measures the attack time to 90% of peak", () => {
    const length = Math.round(0.5 * SR);
    const channel = new Float32Array(length);
    const onsetIdx = Math.round(0.05 * SR);
    const rampSamples = Math.round(0.1 * SR);
    for (let i = onsetIdx; i < length; i++) {
      const env = Math.min(1, (i - onsetIdx) / rampSamples);
      channel[i] = env * Math.sin((2 * Math.PI * 500 * i) / SR);
    }
    const audio: RenderedAudio = { channels: [channel], sampleRate: SR };
    // 90% of the peak is reached 90ms into a 100ms linear ramp.
    expect(attackMs(audio, 0.05)).toBeGreaterThan(80);
    expect(attackMs(audio, 0.05)).toBeLessThan(110);
  });

  it("measures the tail from the release to silence", () => {
    const length = Math.round(3 * SR);
    const channel = new Float32Array(length);
    const stopAt = Math.round(2 * SR); // 0.75s after the release at 1.25s
    for (let i = 0; i < stopAt; i++) {
      channel[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / SR);
    }
    const audio: RenderedAudio = { channels: [channel], sampleRate: SR };
    expect(tailSeconds(audio, 1.25)).toBeGreaterThan(0.7);
    expect(tailSeconds(audio, 1.25)).toBeLessThan(0.82);
  });

  it("reports an unbounded tail when the render ends while the note still rings", () => {
    expect(tailSeconds(sine(300, 3, 0.5), 1.25)).toBe(Infinity);
  });

  it("is not fooled by a tremolo dip into silence mid-tail", () => {
    const length = Math.round(3 * SR);
    const channel = new Float32Array(length);
    const stopAt = Math.round(2.5 * SR);
    for (let i = 0; i < stopAt; i++) {
      const t = i / SR;
      // A 5Hz tremolo to full depth: several windows read as silent.
      const trem = Math.abs(Math.sin(2 * Math.PI * 5 * t));
      channel[i] = 0.5 * trem * Math.sin(2 * Math.PI * 300 * t);
    }
    const audio: RenderedAudio = { channels: [channel], sampleRate: SR };
    expect(tailSeconds(audio, 1.25)).toBeGreaterThan(1.2);
  });
});

describe("analyzeRender flags", () => {
  it("passes a healthy render", () => {
    const metrics = analyzeRender(sine(440, 2, 0.5), timing);
    expect(metrics.silent).toBe(false);
    expect(metrics.nan).toBe(false);
    expect(metrics.clipping).toBe(false);
    expect(metrics.peakDb).toBeCloseTo(-6, 0);
    expect(metrics.noteRmsDb).toBeGreaterThan(metrics.rmsDb - 1);
  });

  it("flags silence", () => {
    const silence: RenderedAudio = { channels: [new Float32Array(2 * SR)], sampleRate: SR };
    const metrics = analyzeRender(silence, timing);
    expect(metrics.silent).toBe(true);
    expect(metrics.peakDb).toBe(-Infinity);
  });

  it("flags clipping above −0.1 dBFS", () => {
    expect(analyzeRender(sine(440, 2, 0.999), timing).clipping).toBe(true);
    expect(analyzeRender(sine(440, 2, 0.9), timing).clipping).toBe(false);
  });

  it("flags non-finite samples without throwing", () => {
    const audio = sine(440, 2, 0.5);
    audio.channels[0][1000] = Number.NaN;
    const metrics = analyzeRender(audio, timing);
    expect(metrics.nan).toBe(true);
    expect(metrics.clipping).toBe(false);
  });
});
