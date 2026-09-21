import { describe, expect, it } from "vitest";

import {
  TENDENCY_COSTS,
  chordIdentity,
  evaluateTendencies,
  tendencyPenalty,
  tritoneResolution,
} from "@/lib/music/generators/advanced/tendencyTones";
import type { PlannedAdvancedChord } from "@/lib/music/generators/advanced/types";

/** Minimal plan entry; only the fields the identity reads are set. */
function chord(over: Partial<PlannedAdvancedChord> & Pick<PlannedAdvancedChord, "root" | "pitchClasses">): PlannedAdvancedChord {
  return {
    degreeLabel: over.degreeLabel ?? "?",
    symbol: over.symbol ?? "?",
    kind: over.kind ?? "diatonic",
    ...over,
  } as PlannedAdvancedChord;
}

const G7 = chord({
  degreeLabel: "V", symbol: "G7", root: "G", pitchClasses: ["G", "B", "D", "F"],
  isDominant: true, degreeIndex: 4,
});
const C_TRIAD = chord({ degreeLabel: "I", symbol: "C", root: "C", pitchClasses: ["C", "E", "G"], degreeIndex: 0 });
const CMAJ7 = chord({ degreeLabel: "I", symbol: "Cmaj7", root: "C", pitchClasses: ["C", "E", "G", "B"], degreeIndex: 0 });
const AM7 = chord({ degreeLabel: "vi", symbol: "Am7", root: "A", pitchClasses: ["A", "C", "E", "G"], degreeIndex: 5 });
const DM7 = chord({ degreeLabel: "ii", symbol: "Dm7", root: "D", pitchClasses: ["D", "F", "A", "C"], degreeIndex: 1 });
const EB = chord({ degreeLabel: "bIII", symbol: "D#", root: "D#", pitchClasses: ["D#", "G", "A#"], kind: "borrowed", functionTag: "mediant" });

const context = (from: PlannedAdvancedChord, to: PlannedAdvancedChord) => ({
  from: chordIdentity(from),
  to: chordIdentity(to),
});

describe("chord identity", () => {
  it("reads a dominant seventh's leading tone, seventh and tritone", () => {
    const identity = chordIdentity(G7);
    expect(identity.isDominant).toBe(true);
    expect(identity.resolutionRoot).toBe(0); // G7 resolves to C
    expect(identity.seventh).toBe(5); // F
    expect(identity.tritone).toEqual({ rising: 11, falling: 5 }); // B up, F down
    expect(identity.tendencies).toEqual([
      { pc: 11, direction: 1, steps: [1], kind: "leadingTone" },
      { pc: 5, direction: -1, steps: [1, 2], kind: "seventh" },
    ]);
  });

  // A tritone substitution carries the same two pitch classes with the roles
  // swapped: Db7's spelled seventh (Cb = B) is the tone that rises, and its
  // third (F) is the tone that falls.
  it("swaps the roles in a tritone substitution", () => {
    const identity = chordIdentity(
      chord({
        degreeLabel: "sub(V)", symbol: "C#7", root: "C#", pitchClasses: ["C#", "F", "G#", "B"],
        kind: "tritone-substitution", isDominant: true,
      })
    );
    expect(identity.resolutionRoot).toBe(0);
    expect(identity.tritone).toEqual({ rising: 11, falling: 5 });
    const rising = identity.tendencies.find((t) => t.pc === 11);
    expect(rising?.kind).toBe("leadingTone");
    expect(rising?.direction).toBe(1);
    // The spelled seventh is already spoken for, so it is not asked to fall.
    expect(identity.tendencies.filter((t) => t.pc === 11)).toHaveLength(1);
  });

  it("resolves a leading-tone diminished chord up a semitone, not down a fifth", () => {
    const viiDim7 = chordIdentity(
      chord({ degreeLabel: "vii°", symbol: "B°7", root: "B", pitchClasses: ["B", "D", "F", "G#"], degreeIndex: 6 })
    );
    expect(viiDim7.isDominant).toBe(true);
    expect(viiDim7.resolutionRoot).toBe(0);
    // B rises, F falls, and the diminished seventh (G#) falls too.
    expect(viiDim7.tendencies.map((t) => `${t.pc}${t.direction > 0 ? "+" : "-"}`)).toEqual(["11+", "5-", "8-"]);
  });

  it("leaves a pre-dominant diminished chord alone", () => {
    // ii° in a minor key is a diminished triad doing pre-dominant duty; it is
    // not a leading-tone chord and owes nothing but its own seventh.
    const iiDim = chordIdentity(
      chord({ degreeLabel: "ii°", symbol: "Bm7b5", root: "B", pitchClasses: ["B", "D", "F", "A"], degreeIndex: 1 })
    );
    expect(iiDim.isDominant).toBe(false);
    expect(iiDim.resolutionRoot).toBeUndefined();
    expect(iiDim.tendencies).toEqual([{ pc: 9, direction: -1, steps: [1, 2], kind: "seventh" }]);
  });

  it("asks a suspension to fall to its resolution", () => {
    const sus = chordIdentity(
      chord({
        degreeLabel: "V(sus4)", symbol: "G7sus4", root: "G", pitchClasses: ["G", "C", "D", "F"],
        kind: "suspension", role: "suspension", isDominant: true,
      })
    );
    expect(sus.tendencies.some((t) => t.kind === "suspension" && t.pc === 0)).toBe(true);
  });

  it("gives a plain triad nothing to resolve", () => {
    expect(chordIdentity(C_TRIAD).tendencies).toEqual([]);
  });

  it("does not mistake a thirteenth for a seventh", () => {
    // C13 has a 13th (interval 9) and a seventh (10); only the seventh falls.
    const thirteenth = chordIdentity(
      chord({ degreeLabel: "I", symbol: "C7(13)", root: "C", pitchClasses: ["C", "E", "G", "A#", "A"] })
    );
    expect(thirteenth.seventh).toBe(10);
  });
});

describe("leading tone", () => {
  // G3 B3 D4 F4 -> C3 G3 E4 G4: B rises to C4, F falls to E4.
  it("costs nothing when it rises by semitone", () => {
    expect(tendencyPenalty([55, 59, 62, 65], [48, 60, 64, 67], context(G7, C_TRIAD))).toBe(0);
  });

  it("charges an inner voice that goes elsewhere", () => {
    // B3 leaps up to C5 instead of rising to C4; F4 still falls to E4.
    const penalty = tendencyPenalty([55, 59, 62, 65], [48, 64, 67, 72], context(G7, C_TRIAD));
    expect(penalty).toBeGreaterThanOrEqual(TENDENCY_COSTS.leadingToneInner);
  });

  it("charges the top voice more than an inner one", () => {
    const soprano = tendencyPenalty([55, 62, 65, 71], [48, 55, 64, 67], context(G7, C_TRIAD));
    const inner = tendencyPenalty([55, 59, 62, 65], [48, 64, 67, 72], context(G7, C_TRIAD));
    expect(soprano).toBeGreaterThan(inner);
  });

  // The classical licence: in an inner voice of a complete dominant seventh the
  // leading tone may fall to the fifth so the tonic triad is complete.
  it("allows the frustrated leading tone in an inner voice", () => {
    const outcomes = evaluateTendencies([55, 59, 62, 65], [48, 55, 64, 67], context(G7, C_TRIAD));
    const leadingTone = outcomes.find((o) => o.tone.kind === "leadingTone");
    expect(leadingTone?.frustrated).toBe(true);
    expect(leadingTone?.penalty).toBe(TENDENCY_COSTS.frustratedLeadingTone);
  });

  // Deceptive motion: vi contains the tonic, so the leading tone still rises.
  it("still asks for the rise on a deceptive resolution", () => {
    const resolved = tendencyPenalty([55, 59, 62, 65], [57, 60, 64, 67], context(G7, AM7));
    // The same dominant into an Am7 voiced without a C4 above the leading tone.
    const stranded = tendencyPenalty([55, 59, 62, 65], [57, 64, 67, 72], context(G7, AM7));
    expect(resolved).toBe(0);
    expect(stranded).toBeGreaterThan(0);
  });

  it("asks for nothing when the next chord has no resolution to offer", () => {
    // bIII does not contain C, so the rise the leading tone owes is not on
    // offer and nothing is charged for failing to take it.
    const outcomes = evaluateTendencies([55, 59, 62, 65], [51, 55, 58, 62], context(G7, EB));
    const leadingTone = outcomes.find((o) => o.tone.kind === "leadingTone");
    expect(leadingTone?.possible).toBe(false);
    expect(leadingTone?.penalty).toBe(0);
  });

  // V7 -> Imaj7: the leading tone *is* the major seventh of the chord it
  // resolves to, so holding it is idiomatic and at four voices it is the only
  // thing the voice can do.
  it("treats a leading tone the target chord owns as absorbed, not stranded", () => {
    const outcomes = evaluateTendencies([55, 59, 62, 65], [48, 59, 64, 67], context(G7, CMAJ7));
    const leadingTone = outcomes.find((o) => o.tone.kind === "leadingTone");
    expect(leadingTone?.absorbed).toBe(true);
    expect(leadingTone?.penalty).toBe(TENDENCY_COSTS.leadingToneAbsorbed);
    expect(leadingTone?.penalty).toBeLessThan(TENDENCY_COSTS.leadingToneInner);
  });

  it("never charges the bass, which the bass planner owns", () => {
    // The leading tone is the lowest note and goes nowhere; only the seventh
    // above it is judged, and it resolves.
    const outcomes = evaluateTendencies([59, 62, 65, 67], [60, 64, 67, 72], context(G7, C_TRIAD));
    expect(outcomes.every((o) => o.pitch !== 59)).toBe(true);
  });
});

describe("chordal seventh", () => {
  it("costs nothing when it falls by step", () => {
    // Dm7's C falls to B in G7.
    expect(tendencyPenalty([50, 57, 60, 65], [55, 59, 62, 65], context(DM7, G7))).toBe(0);
  });

  it("costs nothing when it is held as a tone of the next chord", () => {
    // Am7's G is a chord tone of Cmaj7, so holding it resolves nothing but
    // creates no dissonance either.
    const outcomes = evaluateTendencies([57, 60, 64, 67], [48, 59, 64, 67], context(AM7, CMAJ7));
    const seventh = outcomes.find((o) => o.tone.kind === "seventh");
    expect(seventh?.held).toBe(true);
    expect(seventh?.penalty).toBe(0);
  });

  it("charges a seventh that rises instead", () => {
    // Dm7's C climbs to D rather than falling to B.
    const penalty = tendencyPenalty([50, 57, 60, 65], [55, 62, 62 + 5, 71], context(DM7, G7));
    expect(penalty).toBeGreaterThanOrEqual(TENDENCY_COSTS.seventh);
  });

  it("accepts a whole tone as well as a semitone", () => {
    // Am7's G falls a whole tone to F in Dm7.
    expect(tendencyPenalty([57, 60, 64, 67], [50, 57, 62, 65], context(AM7, DM7))).toBe(0);
  });
});

describe("tritone", () => {
  it("reports contrary motion when both halves resolve", () => {
    expect(tritoneResolution([55, 59, 62, 65], [48, 60, 64, 67], context(G7, C_TRIAD))).toMatchObject({
      rose: true, fell: true, contrary: true, absorbed: false,
    });
  });

  it("reports a half resolution as not contrary", () => {
    // F falls to E, B leaps away.
    expect(
      tritoneResolution([55, 59, 62, 65], [48, 64, 67, 72], context(G7, C_TRIAD))
    ).toMatchObject({ rose: false, fell: true, contrary: false });
  });

  it("is silent for a chord with no dominant tritone", () => {
    expect(tritoneResolution([50, 57, 60, 65], [55, 59, 62, 65], context(DM7, G7))).toBeNull();
  });

  it("charges a stranded tritone on top of the two voices' own costs", () => {
    const half = tendencyPenalty([55, 59, 62, 65], [48, 64, 67, 72], context(G7, C_TRIAD));
    const outcomes = evaluateTendencies([55, 59, 62, 65], [48, 64, 67, 72], context(G7, C_TRIAD));
    const voices = outcomes.reduce((sum, o) => sum + o.penalty, 0);
    expect(half).toBeCloseTo(voices + TENDENCY_COSTS.tritone, 10);
  });

  // The frustrated leading tone over a seventh that did fall is the textbook
  // V7 - I, so the joint tritone charge is waived.
  it("exempts the classical frustrated resolution", () => {
    expect(tendencyPenalty([55, 59, 62, 65], [48, 55, 64, 67], context(G7, C_TRIAD))).toBe(
      TENDENCY_COSTS.frustratedLeadingTone
    );
  });
});

describe("purity", () => {
  it("is a pure function of its inputs", () => {
    const run = () => tendencyPenalty([55, 59, 62, 65], [48, 55, 64, 76], context(G7, C_TRIAD));
    expect(run()).toBe(run());
  });

  it("costs nothing without an identity on either side", () => {
    expect(tendencyPenalty([55, 59, 62, 65], [48, 60, 64, 67], {})).toBe(0);
    expect(tendencyPenalty([55, 59, 62, 65], [48, 60, 64, 67], { from: chordIdentity(G7) })).toBe(0);
  });
});
