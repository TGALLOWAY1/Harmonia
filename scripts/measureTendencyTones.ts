/**
 * Tendency-tone resolution in the voicing search: before/after measurement.
 *
 * Sweeps seeds at the store's own presets and reports, per configuration, how
 * often the upper voices take the resolutions they owe — the leading tone up a
 * semitone, the chordal seventh down by step, the dominant tritone in contrary
 * motion — alongside the smoothness numbers those resolutions trade against.
 *
 * Usage:
 *   npx tsx scripts/measureTendencyTones.ts                  # before → after
 *   npx tsx scripts/measureTendencyTones.ts --weights 0,1,2,4  # calibration sweep
 *   npx tsx scripts/measureTendencyTones.ts --seeds 200
 *
 * `--weights 0` is the pre-change generator exactly: the penalty is multiplied
 * by the weight, so zero leaves every cost byte-identical to what it was.
 *
 * The script only prints to stdout; curated output lives in §1a of
 * CHORD_PROGRESSION_ASSESSMENT.md.
 */

import { generateAdvancedProgression } from "../lib/music/generators/advanced/generateAdvancedProgression";
import {
  chordIdentities,
  evaluateTendencies,
  tritoneResolution,
} from "../lib/music/generators/advanced/tendencyTones";
import { calculateVoiceLeadingCost } from "../lib/music/generators/advanced/voiceLeading";
import type {
  AdvancedProgressionOptions,
  PlannedAdvancedChord,
} from "../lib/music/generators/advanced/types";

/* ─── The store's presets, from `complexityToOptions` in progressionStore.ts ─── */

const COMPLEXITY_PRESETS = {
  1: { useSecondaryDominants: false, usePassingChords: false, useSuspensions: false, useTritoneSubstitution: false, useModalInterchange: false },
  2: { useSecondaryDominants: true, usePassingChords: false, useSuspensions: false, useTritoneSubstitution: false, useModalInterchange: true },
  3: { useSecondaryDominants: true, usePassingChords: true, useSuspensions: true, useTritoneSubstitution: false, useModalInterchange: true },
  4: { useSecondaryDominants: true, usePassingChords: true, useSuspensions: true, useTritoneSubstitution: true, useModalInterchange: true },
} as const;

type Complexity = 1 | 2 | 3 | 4;

type Config = {
  name: string;
  rootKey: AdvancedProgressionOptions["rootKey"];
  mode: AdvancedProgressionOptions["mode"];
  complexity: Complexity;
};

const CONFIGS: Config[] = [
  { name: "C ionian cx1", rootKey: "C", mode: "ionian", complexity: 1 },
  { name: "C ionian cx2", rootKey: "C", mode: "ionian", complexity: 2 },
  { name: "C ionian cx3", rootKey: "C", mode: "ionian", complexity: 3 },
  { name: "C ionian cx4", rootKey: "C", mode: "ionian", complexity: 4 },
  { name: "A aeolian cx2", rootKey: "A", mode: "aeolian", complexity: 2 },
  { name: "A aeolian cx3", rootKey: "A", mode: "aeolian", complexity: 3 },
  { name: "D dorian cx2", rootKey: "D", mode: "dorian", complexity: 2 },
  { name: "G mixolydian cx2", rootKey: "G", mode: "mixolydian", complexity: 2 },
];

function optionsFor(config: Config, seed: number, tendencyWeight: number): AdvancedProgressionOptions {
  return {
    rootKey: config.rootKey,
    mode: config.mode,
    numChords: 4,
    complexity: config.complexity,
    voicingStyle: "auto",
    voiceCount: 4,
    cadence: "resolve",
    mood: "emotional",
    tensionShape: "phrase",
    brightnessCurve: "auto",
    rangeLow: 48,
    rangeHigh: 79,
    ...COMPLEXITY_PRESETS[config.complexity],
    tendencyWeight,
    seed,
  };
}

/* ─── Metrics ─── */

type Stats = {
  /**
   * Dominant → resolution transitions where a non-bass leading tone genuinely
   * owes a rise: the tone the next chord asks for is in it, and the next chord
   * does not contain the leading tone itself (a `V7 - Imaj7` cannot rise at
   * four voices — the major seventh *is* the leading tone).
   */
  leadingToneChances: number;
  leadingToneRose: number;
  /**
   * Of those, the ones where the chord of resolution puts the tone it asks for
   * somewhere other than its own bass — the only way an upper voice can take
   * it. Four distinct pitch classes over a planned root-position bass leaves
   * the root in the bass and nowhere else, so the rise is unvoiceable.
   */
  leadingToneReachable: number;
  leadingToneReachableRose: number;
  /** Transitions where the chord of resolution absorbs the leading tone. */
  leadingToneAbsorbed: number;
  leadingToneAbsorbedHeld: number;
  /** Non-bass voices carrying a chordal seventh, and how many discharged it. */
  sevenths: number;
  seventhsResolved: number;
  /** Same, restricted to the ones where a resolution existed at all. */
  seventhsResolvable: number;
  seventhsResolvableResolved: number;
  /** Suspensions in a non-bass voice. */
  suspensions: number;
  suspensionsResolved: number;
  /**
   * Dominant tritones sounding in the upper voices with both resolutions on
   * offer and the rise voiceable above the next chord's bass.
   */
  tritones: number;
  tritonesContrary: number;
  /** Smoothness. */
  transitions: number;
  costTotal: number;
  motionTotal: number;
  bigLeapChanges: number;
  /** Variety and cost. */
  signatures: Set<string>;
  generations: number;
  millis: number;
};

function emptyStats(): Stats {
  return {
    leadingToneChances: 0,
    leadingToneRose: 0,
    leadingToneReachable: 0,
    leadingToneReachableRose: 0,
    leadingToneAbsorbed: 0,
    leadingToneAbsorbedHeld: 0,
    sevenths: 0,
    seventhsResolved: 0,
    seventhsResolvable: 0,
    seventhsResolvableResolved: 0,
    suspensions: 0,
    suspensionsResolved: 0,
    tritones: 0,
    tritonesContrary: 0,
    transitions: 0,
    costTotal: 0,
    motionTotal: 0,
    bigLeapChanges: 0,
    signatures: new Set<string>(),
    generations: 0,
    millis: 0,
  };
}

/**
 * Total semitone motion between two voicings, pairing voices from the bottom
 * up. The largest single voice move is reported alongside it so a leap bigger
 * than a fifth can be counted.
 */
function voiceMotion(previous: number[], next: number[]): { total: number; largest: number } {
  const a = [...previous].sort((x, y) => x - y);
  const b = [...next].sort((x, y) => x - y);
  const n = Math.min(a.length, b.length);
  let total = 0;
  let largest = 0;
  for (let i = 0; i < n; i++) {
    const delta = Math.abs(a[i] - b[i]);
    total += delta;
    if (delta > largest) largest = delta;
  }
  return { total, largest };
}

function accumulate(stats: Stats, voicings: number[][], planned: PlannedAdvancedChord[]): void {
  const identities = chordIdentities(planned);

  for (let i = 1; i < voicings.length; i++) {
    const previous = voicings[i - 1];
    const next = voicings[i];
    const context = { from: identities[i - 1], to: identities[i] };

    stats.transitions++;
    stats.costTotal += calculateVoiceLeadingCost(previous, next);
    const motion = voiceMotion(previous, next);
    stats.motionTotal += motion.total;
    if (motion.largest > 7) stats.bigLeapChanges++;

    const upperOfNext = new Set(
      [...next].sort((a, b) => a - b).slice(1).map((note) => ((note % 12) + 12) % 12)
    );
    let leadingToneChance = false;
    let leadingToneRose = false;
    let leadingToneReachable = false;
    let leadingToneAbsorbed = false;
    let leadingToneAbsorbedHeld = false;
    for (const outcome of evaluateTendencies(previous, next, context)) {
      if (outcome.tone.kind === "leadingTone") {
        // Only a transition where the resolution actually exists in the next
        // chord counts: a dominant that goes somewhere else owes nothing.
        if (!outcome.possible) continue;
        if (outcome.absorbed) {
          leadingToneAbsorbed = true;
          if (outcome.resolved || outcome.held) leadingToneAbsorbedHeld = true;
          continue;
        }
        leadingToneChance = true;
        if (outcome.resolved) leadingToneRose = true;
        if (upperOfNext.has((outcome.tone.pc + 1) % 12)) leadingToneReachable = true;
      } else if (outcome.tone.kind === "seventh") {
        stats.sevenths++;
        if (outcome.resolved || outcome.held) stats.seventhsResolved++;
        if (outcome.possible || outcome.held) {
          stats.seventhsResolvable++;
          if (outcome.resolved || outcome.held) stats.seventhsResolvableResolved++;
        }
      } else {
        stats.suspensions++;
        if (outcome.resolved) stats.suspensionsResolved++;
      }
    }
    if (leadingToneChance) {
      stats.leadingToneChances++;
      if (leadingToneRose) stats.leadingToneRose++;
      if (leadingToneReachable) {
        stats.leadingToneReachable++;
        if (leadingToneRose) stats.leadingToneReachableRose++;
      }
    }
    if (leadingToneAbsorbed) {
      stats.leadingToneAbsorbed++;
      if (leadingToneAbsorbedHeld) stats.leadingToneAbsorbedHeld++;
    }

    // Only tritones that can actually resolve both ways count: a `V7 - Imaj7`
    // keeps its leading tone as the target's own major seventh, and a rise
    // into a note the next chord only has in its bass is unvoiceable.
    const tritone = tritoneResolution(previous, next, context);
    if (tritone && !tritone.absorbed && leadingToneReachable) {
      stats.tritones++;
      if (tritone.contrary) stats.tritonesContrary++;
    }
  }
}

function measure(config: Config, seeds: number, tendencyWeight: number): Stats {
  const stats = emptyStats();

  for (let seed = 0; seed < seeds; seed++) {
    const start = process.hrtime.bigint();
    const result = generateAdvancedProgression(optionsFor(config, seed, tendencyWeight));
    stats.millis += Number(process.hrtime.bigint() - start) / 1e6;
    stats.generations++;

    stats.signatures.add(result.chords.map((c) => c.midi.join(".")).join("|"));
    accumulate(
      stats,
      result.chords.map((c) => c.midi),
      result.debug?.planned ?? []
    );
  }

  return stats;
}

/* ─── Reporting ─── */

const percent = (numerator: number, denominator: number): string =>
  denominator === 0 ? "—" : `${((numerator / denominator) * 100).toFixed(1)}%`;

type Row = Record<string, string>;

/** Rule 1-4: did the upper voices take the resolutions they owed? */
function resolutionRow(name: string, stats: Stats): Row {
  return {
    config: name,
    "LT rises": percent(stats.leadingToneRose, stats.leadingToneChances),
    "LT voiceable": percent(stats.leadingToneReachable, stats.leadingToneChances),
    "LT rises when voiceable": percent(stats.leadingToneReachableRose, stats.leadingToneReachable),
    "n(LT)": String(stats.leadingToneChances),
    "7th falls or held": percent(stats.seventhsResolved, stats.sevenths),
    "7th when resolvable": percent(stats.seventhsResolvableResolved, stats.seventhsResolvable),
    "n(7th)": String(stats.sevenths),
    "sus falls": percent(stats.suspensionsResolved, stats.suspensions),
    "tritone contrary": percent(stats.tritonesContrary, stats.tritones),
    "n(tri)": String(stats.tritones),
  };
}

/** What those resolutions cost in smoothness, variety and time. */
function smoothnessRow(name: string, stats: Stats): Row {
  return {
    config: name,
    "mean VL cost": (stats.costTotal / Math.max(1, stats.transitions)).toFixed(2),
    "mean semitones moved": (stats.motionTotal / Math.max(1, stats.transitions)).toFixed(2),
    "leap > P5": percent(stats.bigLeapChanges, stats.transitions),
    distinct: String(stats.signatures.size),
    "ms/gen": (stats.millis / Math.max(1, stats.generations)).toFixed(1),
  };
}

function printTable(rows: Row[]): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((r) => r[column].length))
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`;
  console.log(line(columns));
  console.log(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
  for (const r of rows) console.log(line(columns.map((column) => r[column])));
}

/** A couple of worked examples for the write-up: the same seed, both weights. */
function printExamples(config: Config, seeds: number[], weights: number[]): void {
  for (const seed of seeds) {
    console.log(`\n### ${config.name}, seed ${seed}`);

    for (const weight of weights) {
      const result = generateAdvancedProgression(optionsFor(config, seed, weight));
      const symbols = result.chords.map((c) => `${c.degreeLabel} ${c.symbol}`).join("  |  ");
      const voicings = result.chords.map((c) => `[${c.midi.join(" ")}]`).join(" ");
      console.log(`  weight ${weight}: ${symbols}`);
      console.log(`             ${voicings}`);
    }
  }
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function main(): void {
  const seeds = Number(arg("seeds", "400"));
  const weights = arg("weights", "0,2").split(",").map(Number);

  for (const weight of weights) {
    const measured = CONFIGS.map((config) => ({ config, stats: measure(config, seeds, weight) }));
    console.log(`\n## tendencyWeight = ${weight}  (${seeds} seeds per configuration)\n`);
    console.log("### Resolution\n");
    printTable(measured.map((m) => resolutionRow(m.config.name, m.stats)));
    console.log("\n### Smoothness, variety, cost\n");
    printTable(measured.map((m) => smoothnessRow(m.config.name, m.stats)));
  }

  console.log("\n## Examples");
  for (const config of CONFIGS) {
    if (!/cx1|cx2/.test(config.name)) continue;
    printExamples(config, [3, 11, 42, 77], weights);
  }
}

main();
