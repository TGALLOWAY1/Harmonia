/**
 * Layered instruments — one trigger, several voices, velocity that changes
 * *timbre* rather than only level.
 *
 * A real instrument does not just get louder when you hit it harder: it gets
 * brighter, the attack sharpens, and the extra brightness dies away faster
 * than the body. A single Tone voice cannot do that, because velocity there
 * only scales the amplitude envelope. So each instrument here is a small stack
 * of voices with its own velocity curve per layer:
 *
 * - a **body** layer with a compressive curve (v^0.7) that carries the note at
 *   every dynamic;
 * - a **bright** layer with an expansive curve (v^2) that is nearly absent
 *   when played softly and blooms when played hard;
 * - a **transient** layer (hammer, tine click, key click) that is gated below
 *   a threshold and always lasts a fixed few milliseconds.
 *
 * The fan-out and the curve maths are deliberately kept as pure functions with
 * no Tone import, so they can be unit-tested without an AudioContext. The
 * class is a thin dispatcher over them, and it implements exactly the contract
 * the app's call sites rely on: `triggerAttackRelease`, `releaseAll`,
 * `triggerRelease` and `dispose`.
 */

/** Note names ("C4") or frequencies, as Tone accepts them. */
export type NoteLike = string | number;
/** Seconds, or Tone notation like "2n". */
export type TimeLike = string | number;

/**
 * How one layer answers velocity.
 *
 * `exponent` is the character: below 1 the layer is compressive (present even
 * at pianissimo), above 1 it is expansive (a colour that only appears when
 * pushed). `gate` keeps transient layers off entirely under soft playing.
 */
export interface VelocityCurve {
  exponent: number;
  /** Lower bound for a layer that should never disappear completely. */
  min?: number;
  /** Level at velocity 1. */
  max?: number;
  /** Input velocity below which the layer does not sound at all. */
  gate?: number;
}

/**
 * The subset of a Tone instrument a layer needs to expose. Declared with
 * method syntax so Tone's own (bivariant) signatures satisfy it structurally —
 * `Tone.PolySynth`, `Tone.Synth`, `Tone.FMSynth` and `Tone.AMSynth` all fit
 * without adapters.
 */
export interface LayerNode {
  triggerAttackRelease(
    note: NoteLike | NoteLike[],
    duration: TimeLike,
    time?: number,
    velocity?: number,
  ): unknown;
  /**
   * Present on every Tone instrument, but with a different signature on each
   * (`PolySynth.triggerRelease(notes, time)` vs `Synth.triggerRelease(time)`),
   * so they are typed loosely here and dispatched through {@link callOptional}.
   */
  triggerAttack?: LooseTrigger;
  triggerRelease?: LooseTrigger;
  releaseAll?: LooseTrigger;
  dispose(): unknown;
}

type LooseTrigger = (...args: never[]) => unknown;

/** Call one of the loosely-typed optional methods, if the node has it. */
function callOptional(
  node: LayerNode,
  method: "triggerAttack" | "triggerRelease" | "releaseAll",
  args: unknown[],
): boolean {
  const fn = node[method] as ((...callArgs: unknown[]) => unknown) | undefined;
  if (typeof fn !== "function") return false;
  fn.apply(node, args);
  return true;
}

export interface InstrumentLayer {
  /** Diagnostic name ("body", "bright", "hammer"). */
  name: string;
  node: LayerNode;
  velocity: VelocityCurve;
  /**
   * Fixed length in seconds, for transient layers whose job is over long
   * before the note is. When absent the layer follows the note's duration.
   */
  fixedDuration?: number;
}

/** Anything the instrument owns and must dispose (per-instance inserts). */
export interface DisposableNode {
  dispose(): unknown;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Shape one incoming velocity for one layer. Returns 0 when the layer is
 * gated off, which callers read as "do not trigger this layer at all".
 */
export function layerVelocity(curve: VelocityCurve, velocity: number): number {
  const v = clamp01(Number.isFinite(velocity) ? velocity : 0);
  if (curve.gate !== undefined && v < curve.gate) return 0;
  const min = curve.min ?? 0;
  const max = curve.max ?? 1;
  const shaped = Math.pow(v, curve.exponent);
  return clamp01(min + (max - min) * shaped);
}

/**
 * The fan-out: one velocity in, one per-layer velocity out (null where the
 * layer stays silent). This is the whole behavioural contract of a layered
 * instrument, isolated so it can be tested without audio.
 */
export function planLayerVelocities(
  layers: ReadonlyArray<{ velocity: VelocityCurve }>,
  velocity: number,
): (number | null)[] {
  return layers.map((layer) => {
    const shaped = layerVelocity(layer.velocity, velocity);
    return shaped > 0 ? shaped : null;
  });
}

/** A transient layer ignores the note length; everything else follows it. */
export function layerDuration(layer: InstrumentLayer, duration: TimeLike): TimeLike {
  return layer.fixedDuration ?? duration;
}

/**
 * A composite instrument that fans one trigger out to several Tone voices.
 *
 * Satisfies the same surface as `Tone.PolySynth` / `Tone.Sampler` for the
 * calls the app makes, so it can sit in the `Synth` / `MelodySynth` unions:
 * `triggerAttackRelease(noteOrNotes, duration, time?, velocity?)`,
 * `releaseAll(time?)`, `triggerRelease(time?)`, `dispose()`.
 */
export class LayeredInstrument {
  readonly name = "LayeredInstrument";
  private readonly layers: InstrumentLayer[];
  private readonly owned: DisposableNode[];
  private disposed = false;

  constructor(layers: InstrumentLayer[], owned: DisposableNode[] = []) {
    this.layers = layers;
    this.owned = owned;
  }

  /** The layer names, in order — used by tests and diagnostics. */
  get layerNames(): string[] {
    return this.layers.map((layer) => layer.name);
  }

  triggerAttackRelease(
    note: NoteLike | NoteLike[],
    duration: TimeLike,
    time?: number,
    velocity = 1,
  ): this {
    if (this.disposed) return this;
    const plan = planLayerVelocities(this.layers, velocity);
    this.layers.forEach((layer, i) => {
      const layerVel = plan[i];
      if (layerVel === null) return;
      layer.node.triggerAttackRelease(note, layerDuration(layer, duration), time, layerVel);
    });
    return this;
  }

  /**
   * Held note. Transient layers still get a fixed-length trigger, since a
   * hammer strike has no "hold" phase to sustain.
   */
  triggerAttack(note: NoteLike | NoteLike[], time?: number, velocity = 1): this {
    if (this.disposed) return this;
    const plan = planLayerVelocities(this.layers, velocity);
    this.layers.forEach((layer, i) => {
      const layerVel = plan[i];
      if (layerVel === null) return;
      if (layer.fixedDuration !== undefined) {
        layer.node.triggerAttackRelease(note, layer.fixedDuration, time, layerVel);
        return;
      }
      callOptional(layer.node, "triggerAttack", [note, time, layerVel]);
    });
    return this;
  }

  /** Release everything ringing, on every layer, poly or mono. */
  releaseAll(time?: number): this {
    if (this.disposed) return this;
    for (const layer of this.layers) {
      // Poly voices release everything they hold; mono voices just release.
      if (callOptional(layer.node, "releaseAll", [time])) continue;
      callOptional(layer.node, "triggerRelease", [time]);
    }
    return this;
  }

  /** Mono-style alias, so `useInstrument`'s `silence()` works either way. */
  triggerRelease(time?: number): this {
    return this.releaseAll(time);
  }

  dispose(): this {
    if (this.disposed) return this;
    this.disposed = true;
    for (const layer of this.layers) {
      try {
        layer.node.dispose();
      } catch {
        // Tone throws when a node is disposed twice; never fail a teardown.
      }
    }
    for (const node of this.owned) {
      try {
        node.dispose();
      } catch {
        // as above
      }
    }
    return this;
  }
}
