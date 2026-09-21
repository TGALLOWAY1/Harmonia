// @vitest-environment happy-dom
/**
 * Registry invariants and effects-chain behaviour.
 *
 * Tone.js is mocked (as in `audioEngine.test.ts`) with recording stand-ins, so
 * these run in node without an AudioContext: what is asserted here is the
 * wiring — that every catalog entry is playable, that quality tiers line up
 * with the catalog, and that master volume and space actually reach the chain.
 * How the instruments *sound* is measured separately by
 * `scripts/auditionInstruments.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mocked Tone module. Built inside `vi.hoisted` because `vi.mock` factories
 * are hoisted above everything else in the file.
 */
const tone = vi.hoisted(() => {
  /** Every node the mocked Tone module has ever created, in order. */
  const created: FakeNode[] = [];

  class FakeNode {
    readonly args: unknown[];
    readonly connections: FakeNode[] = [];
    disposed = false;
    started = false;
    decay = 0;
    preDelay = 0;
    ready = Promise.resolve();
    gain = { value: 1, rampTo: vi.fn() };

    constructor(...args: unknown[]) {
      this.args = args;
      created.push(this);
    }

    connect(node: FakeNode): this {
      this.connections.push(node);
      return this;
    }
    toDestination(): this {
      return this;
    }
    start(): this {
      this.started = true;
      return this;
    }
    triggerAttackRelease(): this {
      return this;
    }
    triggerAttack(): this {
      return this;
    }
    triggerRelease(): this {
      return this;
    }
    releaseAll(): this {
      return this;
    }
    dispose(): this {
      this.disposed = true;
      return this;
    }
  }

  class FakeGain extends FakeNode {
    constructor(...args: unknown[]) {
      super(...args);
      this.gain = { value: typeof args[0] === "number" ? args[0] : 1, rampTo: vi.fn() };
    }
  }

  return { created, FakeNode, FakeGain };
});

type FakeNode = InstanceType<typeof tone.FakeNode>;

vi.mock("tone", () => {
  const node = tone.FakeNode;
  return {
    PolySynth: node,
    Synth: node,
    FMSynth: node,
    AMSynth: node,
    MonoSynth: node,
    Sampler: node,
    Gain: tone.FakeGain,
    Compressor: node,
    Limiter: node,
    Reverb: node,
    Chorus: node,
    Tremolo: node,
    StereoWidener: node,
    Filter: node,
  };
});

/** Every Gain node the chain has built so far. */
function gainNodes() {
  return tone.created.filter((node): node is InstanceType<typeof tone.FakeGain> =>
    node instanceof tone.FakeGain,
  );
}

import { INSTRUMENT_CATALOG, resolvePresetId } from "../instrumentCatalog";
import { masterVolumeToGain, SPACES } from "../audioSpace";
import { useAudioSettingsStore } from "../../state/audioSettingsStore";
import {
  INSTRUMENTS,
  applyAudioSettings,
  createMelodySynthForPreset,
  createSynthForPreset,
  getEffectsChain,
  presetHasHighQuality,
  presetNeedsLoading,
  resetEffectsChain,
} from "../synthPresets";

beforeEach(() => {
  resetEffectsChain();
  tone.created.length = 0;
  useAudioSettingsStore.setState({ masterVolume: 0.8, space: "room" });
});

describe("registry invariants", () => {
  it("has a definition for every catalog entry, and nothing else", () => {
    const catalogIds = INSTRUMENT_CATALOG.map((e) => e.id).sort();
    expect(Object.keys(INSTRUMENTS).sort()).toEqual(catalogIds);
  });

  it("gives every instrument a lightweight realization that needs no download", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      const definition = INSTRUMENTS[entry.id];
      expect(definition.realizations.lightweight).toBeDefined();
      expect(definition.realizations.lightweight.needsLoading).toBe(false);
      expect(presetNeedsLoading(entry.id, "lightweight")).toBe(false);
    }
  });

  it("keeps hasHighQuality and the sampled realization in step, both ways", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      const high = INSTRUMENTS[entry.id].realizations.high;
      expect(Boolean(high)).toBe(entry.hasHighQuality);
      expect(presetHasHighQuality(entry.id)).toBe(entry.hasHighQuality);
      if (high) {
        expect(high.needsLoading).toBe(true);
        expect(presetNeedsLoading(entry.id, "high")).toBe(true);
      } else {
        // Asking for high quality where there is none falls back, never throws.
        expect(presetNeedsLoading(entry.id, "high")).toBe(false);
      }
    }
  });

  it("carries the catalog metadata onto each definition", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      expect(INSTRUMENTS[entry.id].label).toBe(entry.label);
      expect(INSTRUMENTS[entry.id].category).toBe(entry.category);
    }
  });

  it("still maps stale persisted ids to the default instrument", () => {
    expect(resolvePresetId("fm-bell-from-2019")).toBe("piano");
    expect(() => createSynthForPreset("fm-bell-from-2019" as never, "lightweight")).not.toThrow();
  });
});

describe("building instruments", () => {
  it("builds a playable chord and melody voice for every instrument", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      const chord = createSynthForPreset(entry.id, "lightweight");
      const melody = createMelodySynthForPreset(entry.id, "lightweight");
      for (const instrument of [chord, melody]) {
        expect(typeof instrument.triggerAttackRelease).toBe("function");
        expect(typeof instrument.dispose).toBe("function");
        // `useInstrument` silences through releaseAll, falling back to
        // triggerRelease; every instrument must answer one of them.
        const releasable =
          "releaseAll" in instrument || "triggerRelease" in instrument;
        expect(releasable).toBe(true);
      }
      chord.dispose();
      melody.dispose();
    }
  });

  it("reports readiness immediately for synth voices", () => {
    const onLoaded = vi.fn();
    createSynthForPreset("vibraphone", "lightweight", { onLoaded });
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("layers more than one voice per instrument", () => {
    for (const entry of INSTRUMENT_CATALOG) {
      const instrument = createSynthForPreset(entry.id, "lightweight");
      const layers = (instrument as { layerNames?: string[] }).layerNames;
      expect(layers && layers.length).toBeGreaterThan(1);
      instrument.dispose();
    }
  });

  it("disposing an instrument disposes its own voices but not the shared chain", () => {
    const instrument = createSynthForPreset("piano", "lightweight");
    const { limiter } = getEffectsChain();
    instrument.dispose();
    expect((limiter as unknown as FakeNode).disposed).toBe(false);
  });
});

describe("effects chain", () => {
  it("ends in a limiter and reuses the chain across instruments", () => {
    const first = getEffectsChain();
    const second = getEffectsChain();
    expect(first.limiter).toBe(second.limiter);
    expect(first.reverb).toBe(second.reverb);
    expect((first.limiter as unknown as FakeNode).args[0]).toBe(-3);
  });

  it("builds the reverb for the current space", () => {
    useAudioSettingsStore.setState({ space: "hall" });
    resetEffectsChain();
    const { reverb } = getEffectsChain();
    const options = (reverb as unknown as FakeNode).args[0] as { decay: number; wet: number };
    expect(options.decay).toBe(SPACES.hall.decay);
    // Fully wet: it is a parallel send, the dry path is the compressor branch.
    expect(options.wet).toBe(1);
  });

  it("starts the master gain at the persisted volume", () => {
    useAudioSettingsStore.setState({ masterVolume: 0.5 });
    resetEffectsChain();
    getEffectsChain();
    const gains = gainNodes();
    expect(gains.some((node) => Math.abs(node.gain.value - masterVolumeToGain(0.5)) < 1e-6)).toBe(
      true,
    );
  });

  it("ramps rather than jumps when the volume changes", () => {
    getEffectsChain();
    const gains = gainNodes();
    applyAudioSettings({ masterVolume: 0.25 });
    const ramped = gains.flatMap((node) => node.gain.rampTo.mock.calls);
    expect(ramped.some(([value]) => Math.abs(value - masterVolumeToGain(0.25)) < 1e-6)).toBe(true);
    expect(ramped.every(([, time]) => typeof time === "number" && time > 0)).toBe(true);
  });

  it("applies settings live when the store changes, with no UI involved", () => {
    createSynthForPreset("warm-strings", "lightweight");
    const gains = gainNodes();
    gains.forEach((node) => node.gain.rampTo.mockClear());

    useAudioSettingsStore.getState().setMasterVolume(0.4);

    const ramped = gains.flatMap((node) => node.gain.rampTo.mock.calls);
    expect(ramped.some(([value]) => Math.abs(value - masterVolumeToGain(0.4)) < 1e-6)).toBe(true);
  });

  it("scales the reverb sends with the space", () => {
    createSynthForPreset("warm-strings", "lightweight");
    const gains = gainNodes();
    gains.forEach((node) => node.gain.rampTo.mockClear());

    useAudioSettingsStore.getState().setSpace("dry");

    const ramped = gains.flatMap((node) => node.gain.rampTo.mock.calls);
    // "dry" means every send goes to zero.
    expect(ramped.some(([value]) => value === 0)).toBe(true);
  });

  it("resetEffectsChain disposes everything and detaches the store listener", async () => {
    createSynthForPreset("piano", "lightweight");
    const chainNodes = gainNodes();
    expect(chainNodes.length).toBeGreaterThan(0);

    resetEffectsChain();
    expect(chainNodes.every((node) => node.disposed)).toBe(true);

    // A later store change must not reach the disposed nodes.
    chainNodes.forEach((node) => node.gain.rampTo.mockClear());
    useAudioSettingsStore.getState().setMasterVolume(0.1);
    expect(chainNodes.every((node) => node.gain.rampTo.mock.calls.length === 0)).toBe(true);
  });

  it("rebuilds a fresh chain after a reset (offline renders depend on it)", () => {
    const before = getEffectsChain().limiter;
    resetEffectsChain();
    const after = getEffectsChain().limiter;
    expect(after).not.toBe(before);
  });
});
