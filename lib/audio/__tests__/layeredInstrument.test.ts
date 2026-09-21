/**
 * Tests for the layered instrument: the velocity-curve maths and the fan-out
 * to the underlying voices. No Tone, no AudioContext — the layer interface is
 * structural, so plain recording objects stand in for synths.
 */

import { describe, expect, it, vi } from "vitest";
import {
  LayeredInstrument,
  layerDuration,
  layerVelocity,
  planLayerVelocities,
  type InstrumentLayer,
  type LayerNode,
} from "../layeredInstrument";

/** A poly-style voice: has `releaseAll`. */
function polyNode() {
  return {
    triggerAttackRelease: vi.fn(),
    triggerAttack: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
  };
}

/** A mono-style voice: only `triggerRelease`. */
function monoNode() {
  return {
    triggerAttackRelease: vi.fn(),
    triggerAttack: vi.fn(),
    triggerRelease: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("layerVelocity", () => {
  it("is the identity for a linear curve", () => {
    expect(layerVelocity({ exponent: 1 }, 0.5)).toBeCloseTo(0.5);
    expect(layerVelocity({ exponent: 1 }, 1)).toBeCloseTo(1);
  });

  it("compresses below exponent 1 and expands above it", () => {
    // A body layer still speaks at pianissimo; a bright layer barely does.
    expect(layerVelocity({ exponent: 0.7 }, 0.3)).toBeGreaterThan(0.3);
    expect(layerVelocity({ exponent: 2 }, 0.3)).toBeLessThan(0.3);
  });

  it("applies the floor and ceiling", () => {
    expect(layerVelocity({ exponent: 0.7, min: 0.2 }, 0)).toBeCloseTo(0.2);
    expect(layerVelocity({ exponent: 1, max: 0.5 }, 1)).toBeCloseTo(0.5);
  });

  it("gates a transient layer off below its threshold", () => {
    const curve = { exponent: 1.5, gate: 0.1 };
    expect(layerVelocity(curve, 0.05)).toBe(0);
    expect(layerVelocity(curve, 0.2)).toBeGreaterThan(0);
  });

  it("clamps out-of-range and non-finite velocities", () => {
    expect(layerVelocity({ exponent: 1 }, 5)).toBe(1);
    expect(layerVelocity({ exponent: 1 }, -3)).toBe(0);
    expect(layerVelocity({ exponent: 1 }, Number.NaN)).toBe(0);
  });

  it("is monotonic in velocity for every curve shape", () => {
    for (const exponent of [0.5, 0.7, 1, 2, 2.2]) {
      let previous = -1;
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const value = layerVelocity({ exponent }, v);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });
});

describe("planLayerVelocities", () => {
  const layers = [
    { velocity: { exponent: 0.7, min: 0.1 } },
    { velocity: { exponent: 2 } },
    { velocity: { exponent: 1.5, gate: 0.06 } },
  ];

  it("gives each layer its own velocity from one input", () => {
    const plan = planLayerVelocities(layers, 0.5);
    expect(plan).toHaveLength(3);
    // The body is louder than the bright layer at half velocity: that is the
    // whole point of the different curves.
    expect(plan[0]!).toBeGreaterThan(plan[1]!);
  });

  it("returns null for layers that should not be triggered at all", () => {
    expect(planLayerVelocities(layers, 0.02)[2]).toBeNull();
    expect(planLayerVelocities(layers, 0.8)[2]).not.toBeNull();
  });

  it("widens the gap between body and bright layers as velocity rises", () => {
    const soft = planLayerVelocities(layers, 0.3);
    const hard = planLayerVelocities(layers, 1);
    expect(hard[1]! / hard[0]!).toBeGreaterThan(soft[1]! / soft[0]!);
  });
});

describe("layerDuration", () => {
  const base = { name: "x", node: polyNode() as LayerNode, velocity: { exponent: 1 } };

  it("follows the note for sustaining layers", () => {
    expect(layerDuration(base, "2n")).toBe("2n");
    expect(layerDuration(base, 1.2)).toBe(1.2);
  });

  it("keeps transients at their fixed length", () => {
    expect(layerDuration({ ...base, fixedDuration: 0.05 }, "2n")).toBe(0.05);
  });
});

describe("LayeredInstrument", () => {
  function build() {
    const body = polyNode();
    const bright = polyNode();
    const click = polyNode();
    const layers: InstrumentLayer[] = [
      { name: "body", node: body, velocity: { exponent: 0.7, min: 0.1 } },
      { name: "bright", node: bright, velocity: { exponent: 2 } },
      { name: "click", node: click, velocity: { exponent: 1.5, gate: 0.1 }, fixedDuration: 0.05 },
    ];
    return { instrument: new LayeredInstrument(layers), body, bright, click };
  }

  it("fans one trigger out to every layer with its own velocity", () => {
    const { instrument, body, bright, click } = build();

    instrument.triggerAttackRelease(["C3", "E3"], "2n", 1.5, 0.8);

    expect(body.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(bright.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(click.triggerAttackRelease).toHaveBeenCalledTimes(1);

    const [bodyNotes, bodyDuration, bodyTime, bodyVel] = body.triggerAttackRelease.mock.calls[0];
    expect(bodyNotes).toEqual(["C3", "E3"]);
    expect(bodyDuration).toBe("2n");
    expect(bodyTime).toBe(1.5);
    const brightVel = bright.triggerAttackRelease.mock.calls[0][3];
    expect(bodyVel).toBeGreaterThan(brightVel);

    // The transient ignores the note length.
    expect(click.triggerAttackRelease.mock.calls[0][1]).toBe(0.05);
  });

  it("leaves gated layers silent on a soft note", () => {
    const { instrument, body, click } = build();

    instrument.triggerAttackRelease("C4", 1, 0, 0.05);

    expect(body.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(click.triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("defaults to full velocity when none is given", () => {
    const { instrument, body } = build();
    instrument.triggerAttackRelease("C4", 1);
    expect(body.triggerAttackRelease.mock.calls[0][3]).toBeCloseTo(1);
  });

  it("holds notes with triggerAttack but still fires transients as one-shots", () => {
    const { instrument, body, click } = build();

    instrument.triggerAttack("C4", 2, 0.9);

    expect(body.triggerAttack).toHaveBeenCalledTimes(1);
    expect(body.triggerAttackRelease).not.toHaveBeenCalled();
    expect(click.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(click.triggerAttack).not.toHaveBeenCalled();
  });

  it("propagates releaseAll to every layer", () => {
    const { instrument, body, bright, click } = build();

    instrument.releaseAll(3);

    for (const node of [body, bright, click]) {
      expect(node.releaseAll).toHaveBeenCalledWith(3);
    }
  });

  it("falls back to triggerRelease on layers that have no releaseAll", () => {
    const mono = monoNode();
    const instrument = new LayeredInstrument([
      { name: "body", node: mono, velocity: { exponent: 1 } },
    ]);

    instrument.releaseAll(2);
    instrument.triggerRelease(4);

    expect(mono.triggerRelease).toHaveBeenNthCalledWith(1, 2);
    expect(mono.triggerRelease).toHaveBeenNthCalledWith(2, 4);
  });

  it("disposes every layer and everything else it owns", () => {
    const { instrument, body, bright, click } = build();
    const insert = { dispose: vi.fn() };
    const owning = new LayeredInstrument(
      [{ name: "body", node: body, velocity: { exponent: 1 } }],
      [insert],
    );

    instrument.dispose();
    owning.dispose();

    for (const node of [body, bright, click]) {
      expect(node.dispose).toHaveBeenCalled();
    }
    expect(insert.dispose).toHaveBeenCalledTimes(1);
  });

  it("survives a layer that throws while being disposed", () => {
    const angry = { ...polyNode(), dispose: vi.fn(() => { throw new Error("already disposed"); }) };
    const calm = polyNode();
    const instrument = new LayeredInstrument([
      { name: "angry", node: angry, velocity: { exponent: 1 } },
      { name: "calm", node: calm, velocity: { exponent: 1 } },
    ]);

    expect(() => instrument.dispose()).not.toThrow();
    expect(calm.dispose).toHaveBeenCalled();
  });

  it("ignores triggers after disposal instead of waking dead nodes", () => {
    const { instrument, body } = build();

    instrument.dispose();
    instrument.triggerAttackRelease("C4", 1, 0, 1);
    instrument.releaseAll();

    expect(body.triggerAttackRelease).not.toHaveBeenCalled();
    expect(body.releaseAll).not.toHaveBeenCalled();
  });

  it("exposes its layer names for diagnostics", () => {
    expect(build().instrument.layerNames).toEqual(["body", "bright", "click"]);
  });
});
