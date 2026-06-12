/**
 * Melody engine analysis: before/after comparison.
 *
 * Generates a large sample of melodies with the new phrase-based engine and
 * the legacy note-by-note engine across moods, keys, and progressions, then
 * prints aggregate quality statistics and notated examples as markdown.
 *
 * Usage: npx tsx scripts/analyzeMelodies.ts
 *
 * The script only prints to stdout; curated output lives in
 * MELODY_ENGINE_ANALYSIS.md.
 */

import { generateMelody } from "../lib/music/generators/melody/generateMelody";
import { generateMelodyLegacy } from "../lib/music/generators/melody/legacy/generateMelodyLegacy";
import { motifRepetitionCoverage, scoreMelody } from "../lib/music/generators/melody/scoring";
import { buildPhrasePlan } from "../lib/music/generators/melody/phrasePlan";
import { MOOD_PROFILES } from "../lib/music/generators/melody/moods";
import { createRng } from "../lib/music/generators/melody/rng";
import { isStrongBeat, isChordTone } from "../lib/music/generators/melody/helpers";
import type {
  Melody,
  MelodyGenerationOptions,
  MelodyMood,
} from "../lib/music/generators/melody/types";
import type { PitchClass } from "../lib/theory/midiUtils";

/* ─── Test material ─── */

const PROGRESSIONS: { name: string; scale: PitchClass[]; chords: MelodyGenerationOptions["chords"] }[] = [
  {
    name: "C major I–vi–IV–V",
    scale: ["C", "D", "E", "F", "G", "A", "B"],
    chords: [
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["A", "C", "E"], root: "A", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["G", "B", "D"], root: "G", durationClass: "full" },
    ],
  },
  {
    name: "A minor i–VI–III–VII",
    scale: ["A", "B", "C", "D", "E", "F", "G"],
    chords: [
      { midiNotes: [], pitchClasses: ["A", "C", "E"], root: "A", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["G", "B", "D"], root: "G", durationClass: "full" },
    ],
  },
  {
    name: "C major w/ secondary dominant (C–D7–G–C)",
    scale: ["C", "D", "E", "F", "G", "A", "B"],
    chords: [
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["D", "F#", "A", "C"], root: "D", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["G", "B", "D"], root: "G", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
    ],
  },
  {
    name: "F major 8-chord long form",
    scale: ["F", "G", "A", "A#", "C", "D", "E"],
    chords: [
      { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["D", "F", "A"], root: "D", durationClass: "half" },
      { midiNotes: [], pitchClasses: ["A#", "D", "F"], root: "A#", durationClass: "half" },
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["G", "A#", "D"], root: "G", durationClass: "half" },
      { midiNotes: [], pitchClasses: ["C", "E", "G"], root: "C", durationClass: "half" },
      { midiNotes: [], pitchClasses: ["F", "A", "C"], root: "F", durationClass: "full" },
    ],
  },
];

const MOODS: MelodyMood[] = ["dark", "emotional", "dreamy", "energetic"];
const SEEDS = Array.from({ length: 13 }, (_, i) => i); // 13 × 4 progressions = 52 per engine

/* ─── Metrics ─── */

type Stats = {
  score: number;
  motifCoverage: number;
  meanInterval: number;
  directionChangeRate: number;
  strongBeatChordTonePct: number;
  finalNoteBeats: number;
  finalOnChordTone: number;
  distinctDurations: number;
  notesPerBeat: number;
  leapsOver7: number;
};

function totalBeats(chords: MelodyGenerationOptions["chords"]): number {
  return chords.reduce((s, c) => {
    switch (c.durationClass) {
      case "half": return s + 2;
      case "quarter": return s + 1;
      case "eighth": return s + 0.5;
      default: return s + 4;
    }
  }, 0);
}

function analyze(
  melody: Melody,
  chords: MelodyGenerationOptions["chords"],
  mood: MelodyMood,
): Stats {
  const notes = melody.notes;
  const profile = MOOD_PROFILES[mood];
  const plan = buildPhrasePlan(chords, profile, createRng(0));
  const score = scoreMelody(notes, plan, chords, profile, melody.octave);

  let intervalSum = 0;
  let dirChanges = 0;
  let leapsOver7 = 0;
  let prevDir = 0;
  for (let i = 1; i < notes.length; i++) {
    const iv = notes[i].midi - notes[i - 1].midi;
    intervalSum += Math.abs(iv);
    if (Math.abs(iv) > 7) leapsOver7++;
    const dir = Math.sign(iv);
    if (dir !== 0 && prevDir !== 0 && dir !== prevDir) dirChanges++;
    if (dir !== 0) prevDir = dir;
  }

  const strong = notes.filter((n) => isStrongBeat(n.startBeat));
  const strongCT = strong.filter((n) => isChordTone(n.midi, chords[n.chordIndex].pitchClasses));
  const last = notes[notes.length - 1];

  return {
    score: score.total,
    motifCoverage: motifRepetitionCoverage(notes),
    meanInterval: notes.length > 1 ? intervalSum / (notes.length - 1) : 0,
    directionChangeRate: notes.length > 2 ? dirChanges / (notes.length - 2) : 0,
    strongBeatChordTonePct: strong.length ? (strongCT.length / strong.length) * 100 : 0,
    finalNoteBeats: last?.durationBeats ?? 0,
    finalOnChordTone: last && isChordTone(last.midi, chords[last.chordIndex].pitchClasses) ? 1 : 0,
    distinctDurations: new Set(notes.map((n) => n.durationBeats)).size,
    notesPerBeat: notes.length / totalBeats(chords),
    leapsOver7,
  };
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function aggregate(all: Stats[]): Record<keyof Stats, number> {
  const keys = Object.keys(all[0]) as (keyof Stats)[];
  const out = {} as Record<keyof Stats, number>;
  for (const k of keys) out[k] = mean(all.map((s) => s[k]));
  return out;
}

function fmt(v: number, digits = 2): string {
  return v.toFixed(digits);
}

function notate(melody: Melody): string {
  return melody.notes
    .map((n) => `${n.noteWithOctave}(${n.durationBeats}${n.isChordTone ? "" : "*"})`)
    .join(" ");
}

/* ─── Run ─── */

function main() {
  console.log("# Melody Engine Analysis — Legacy vs Phrase-Based\n");
  console.log(`Sample: ${SEEDS.length} seeds × ${PROGRESSIONS.length} progressions per engine/mood.`);
  console.log("Non-chord tones are marked with `*` in notated examples.\n");

  const legacyStats: Stats[] = [];
  for (const prog of PROGRESSIONS) {
    for (const seed of SEEDS) {
      const melody = generateMelodyLegacy({
        scalePitchClasses: prog.scale,
        chords: prog.chords,
        style: "lyrical",
        octave: 5,
        seed,
      });
      legacyStats.push(analyze(melody, prog.chords, "emotional"));
    }
  }

  const newStatsByMood = new Map<MelodyMood, Stats[]>();
  for (const mood of MOODS) {
    const list: Stats[] = [];
    for (const prog of PROGRESSIONS) {
      for (const seed of SEEDS) {
        const melody = generateMelody({
          scalePitchClasses: prog.scale,
          chords: prog.chords,
          style: "lyrical",
          mood,
          octave: 5,
          seed,
        });
        list.push(analyze(melody, prog.chords, mood));
      }
    }
    newStatsByMood.set(mood, list);
  }

  const rows: [string, Record<keyof Stats, number>][] = [
    ["legacy (lyrical)", aggregate(legacyStats)],
    ...MOODS.map((m): [string, Record<keyof Stats, number>] => [
      `new (${m})`,
      aggregate(newStatsByMood.get(m)!),
    ]),
  ];

  console.log("## Aggregate quality metrics\n");
  console.log("| Engine | Score | Motif coverage | Mean interval | Dir-change rate | Strong-beat CT % | Final note beats | Final on CT | Distinct durs | Notes/beat | Leaps>7 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [name, a] of rows) {
    console.log(
      `| ${name} | ${fmt(a.score, 1)} | ${fmt(a.motifCoverage)} | ${fmt(a.meanInterval)} | ${fmt(a.directionChangeRate)} | ${fmt(a.strongBeatChordTonePct, 0)} | ${fmt(a.finalNoteBeats, 1)} | ${fmt(a.finalOnChordTone * 100, 0)}% | ${fmt(a.distinctDurations, 1)} | ${fmt(a.notesPerBeat)} | ${fmt(a.leapsOver7, 2)} |`,
    );
  }

  console.log("\n## Before/after examples (C major I–vi–IV–V, lyrical)\n");
  const prog = PROGRESSIONS[0];
  for (const seed of [1, 2, 3]) {
    const before = generateMelodyLegacy({
      scalePitchClasses: prog.scale, chords: prog.chords, style: "lyrical", octave: 5, seed,
    });
    const after = generateMelody({
      scalePitchClasses: prog.scale, chords: prog.chords, style: "lyrical", mood: "emotional", octave: 5, seed,
    });
    console.log(`### Seed ${seed}`);
    console.log(`- before: ${notate(before)}`);
    console.log(`- after:  ${notate(after)}\n`);
  }

  console.log("## Mood fingerprints (same progression and seed)\n");
  for (const mood of MOODS) {
    const m = generateMelody({
      scalePitchClasses: prog.scale, chords: prog.chords, style: "lyrical", mood, octave: 5, seed: 5,
    });
    console.log(`- ${mood}: ${notate(m)}`);
  }
}

main();
