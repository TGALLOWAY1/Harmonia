import { describe, it, expect } from "vitest";
import { generateMelody } from "../generateMelody";
import { buildHarmonicContext, midiPc, pcIndex, tendencyOf } from "../harmonicContext";
import { metricWeight } from "../meter";
import { generateAdvancedProgression } from "../../advanced/generateAdvancedProgression";
import { getScaleDefinition } from "@/lib/theory/scale";
import { getChordPitchClasses, normalizeRoot } from "@/lib/theory/chordSymbol";
import { midiToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";
import type { Melody, MelodyGenerationOptions } from "../types";

const C_MAJOR: PitchClass[] = ["C", "D", "E", "F", "G", "A", "B"];
const A_MINOR: PitchClass[] = ["A", "B", "C", "D", "E", "F", "G"];

/** I–vi–IV–V in C, repeated to the requested length. */
function pop(bars: number): MelodyGenerationOptions["chords"] {
  const pool: [PitchClass, PitchClass[]][] = [
    ["C", ["C", "E", "G"]],
    ["A", ["A", "C", "E"]],
    ["F", ["F", "A", "C"]],
    ["G", ["G", "B", "D"]],
  ];
  return Array.from({ length: bars }, (_, i) => {
    const [root, pitchClasses] = pool[i % pool.length];
    return { midiNotes: [], pitchClasses, root, durationClass: "full" as const };
  });
}

function options(overrides: Partial<MelodyGenerationOptions> = {}): MelodyGenerationOptions {
  return { scalePitchClasses: C_MAJOR, chords: pop(8), style: "lyrical", octave: 5, seed: 1, ...overrides };
}

/** A real progression from the chord engine, converted the way the store does. */
function realProgression(seed: number, numChords: number) {
  const result = generateAdvancedProgression({
    rootKey: "C", mode: "ionian", numChords, complexity: 3, voicingStyle: "auto", voiceCount: 4,
    rangeLow: 48, rangeHigh: 79, usePassingChords: true, useSuspensions: true,
    useSecondaryDominants: true, useTritoneSubstitution: false, useModalInterchange: true,
    cadence: "resolve", mood: "emotional", tensionShape: "phrase", brightnessCurve: "auto", seed,
  });
  const chords: MelodyGenerationOptions["chords"] = result.chords.map((voiced) => {
    const voicedPcs = Array.from(new Set(voiced.midi.map((m) => midiToPitchClass(m))));
    const canonical = getChordPitchClasses(voiced.symbol);
    return {
      midiNotes: voiced.midi,
      pitchClasses: (canonical.length ? canonical : voicedPcs) as PitchClass[],
      root: (normalizeRoot(voiced.symbol) ?? voicedPcs[0]) as PitchClass,
      durationClass: voiced.durationClass,
      symbol: voiced.symbol,
    };
  });
  return { chords, tensionCurve: result.debug?.tensionCurve };
}

describe("melodic form", () => {
  it("reports the phrases it composed, covering the progression", () => {
    const melody = generateMelody(options());
    expect(melody.phrases).toBeDefined();
    const phrases = melody.phrases!;
    expect(phrases.length).toBeGreaterThan(1);
    expect(phrases[0].startBeat).toBe(0);
    expect(phrases[phrases.length - 1].endBeat).toBe(32);
    expect(phrases[phrases.length - 1].cadence).toBe("final");
    expect(phrases.filter((p) => p.isClimax)).toHaveLength(1);
  });

  it("saves its highest note for the climax phrase and does not repeat it there", () => {
    const runs = 24;
    for (let seed = 0; seed < runs; seed++) {
      const melody = generateMelody(options({ seed }));
      const peak = Math.max(...melody.notes.map((n) => n.midi));
      const peaks = melody.notes.filter((n) => n.midi === peak);
      const climax = melody.phrases!.find((p) => p.isClimax)!;

      // The old engine hit its top note 2–5 times per melody, often in bar
      // one. The top note now arrives in the climax phrase; it may sound again
      // only where that phrase is restated wholesale.
      const first = peaks[0];
      expect(first.startBeat).toBeGreaterThanOrEqual(climax.startBeat);
      expect(first.startBeat).toBeLessThan(climax.endBeat);
      expect(peaks.length).toBeLessThanOrEqual(2);

      // Inside the climax phrase itself the peak is a single event.
      const inClimax = peaks.filter((n) => n.startBeat >= climax.startBeat && n.startBeat < climax.endBeat);
      expect(inClimax).toHaveLength(1);

      // Every other phrase stays below it.
      for (const phrase of melody.phrases!) {
        if (phrase.isClimax) continue;
        const notes = melody.notes.filter((n) => n.startBeat >= phrase.startBeat && n.startBeat < phrase.endBeat);
        if (notes.length === 0) continue;
        const phrasePeak = Math.max(...notes.map((n) => n.midi));
        if (phrasePeak === peak) continue; // a literal restatement of the climax
        expect(phrasePeak).toBeLessThan(peak);
      }
    }
  });

  it("approaches the peak from below and leaves it downward", () => {
    let approached = 0;
    let left = 0;
    const runs = 24;
    for (let seed = 0; seed < runs; seed++) {
      const melody = generateMelody(options({ seed }));
      const peak = Math.max(...melody.notes.map((n) => n.midi));
      const i = melody.notes.findIndex((n) => n.midi === peak);
      if (i > 0 && melody.notes[i].midi > melody.notes[i - 1].midi) approached++;
      if (i + 1 < melody.notes.length && melody.notes[i + 1].midi < peak) left++;
    }
    expect(approached / runs).toBeGreaterThan(0.8);
    expect(left / runs).toBeGreaterThan(0.8);
  });

  it("ends every phrase on the degree the form planned", () => {
    let hits = 0;
    let total = 0;
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      for (const phrase of melody.phrases!) {
        const inPhrase = melody.notes.filter((n) => n.startBeat >= phrase.startBeat && n.startBeat < phrase.endBeat);
        if (inPhrase.length === 0) continue;
        const final = inPhrase[inPhrase.length - 1];
        const chord = pop(8)[Math.min(7, final.chordIndex)];
        total++;
        if (chord.pitchClasses.includes(final.pitchClass)) hits++;
      }
    }
    expect(hits / total).toBeGreaterThan(0.85);
  });

  it("answers a question with an answer: inner phrases avoid the tonic, the last one lands on it", () => {
    const tonic = pcIndex("C");
    let innerOnTonic = 0;
    let inner = 0;
    let finalOnStable = 0;
    const runs = 20;
    for (let seed = 0; seed < runs; seed++) {
      const melody = generateMelody(options({ seed }));
      const phrases = melody.phrases!;
      phrases.forEach((phrase, i) => {
        const inPhrase = melody.notes.filter((n) => n.startBeat >= phrase.startBeat && n.startBeat < phrase.endBeat);
        if (inPhrase.length === 0) return;
        const pc = midiPc(inPhrase[inPhrase.length - 1].midi);
        if (i === phrases.length - 1) {
          if ([tonic, (tonic + 4) % 12, (tonic + 7) % 12].includes(pc)) finalOnStable++;
        } else {
          inner++;
          if (pc === tonic) innerOnTonic++;
        }
      });
    }
    expect(finalOnStable).toBe(runs);
    expect(innerOnTonic / inner).toBeLessThan(0.5);
  });

  it("breathes at phrase boundaries with a rest or a long note", () => {
    let breathed = 0;
    let boundaries = 0;
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      const phrases = melody.phrases!;
      for (let k = 0; k + 1 < phrases.length; k++) {
        const boundary = phrases[k + 1].startBeat;
        // The seam is the last bar of the phrase; a pickup into the next
        // phrase may sound after the breath, so look at the window, not just
        // at the note nearest the boundary.
        const window = melody.notes.filter((n) => n.startBeat >= boundary - 4 && n.startBeat < boundary);
        if (window.length === 0) continue;
        boundaries++;
        const rested = window.some((n, i) => {
          const next = window[i + 1];
          const end = n.startBeat + n.durationBeats;
          return next ? next.startBeat - end >= 0.5 : boundary - end >= 0.5;
        });
        if (rested || window.some((n) => n.durationBeats >= 2)) breathed++;
      }
    }
    expect(breathed / boundaries).toBeGreaterThan(0.9);
  });

  it("brings its opening idea back, whole, when the harmony comes back", () => {
    let restated = 0;
    const runs = 20;
    for (let seed = 0; seed < runs; seed++) {
      const melody = generateMelody(options({ seed }));
      // A full bar of the hook, not a two-note fragment.
      const head = melody.notes.filter((n) => n.startBeat < 4);
      if (head.length < 2) continue;
      const shape = head.slice(1).map((n, i) => n.midi - head[i].midi).join(",");
      const rhythm = head.map((n) => n.durationBeats).join(",");
      for (let i = head.length; i + head.length <= melody.notes.length; i++) {
        const w = melody.notes.slice(i, i + head.length);
        if (w.map((n) => n.durationBeats).join(",") !== rhythm) continue;
        if (w.slice(1).map((n, k) => n.midi - w[k].midi).join(",") !== shape) continue;
        restated++;
        break;
      }
    }
    expect(restated / runs).toBeGreaterThan(0.6);
  });
});

describe("melodic line quality", () => {
  it("keeps the interval mix in the range real melodies use", () => {
    let steps = 0;
    let unisons = 0;
    let total = 0;
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      for (let i = 1; i < melody.notes.length; i++) {
        const iv = Math.abs(melody.notes[i].midi - melody.notes[i - 1].midi);
        total++;
        if (iv === 0) unisons++;
        else if (iv <= 2) steps++;
      }
    }
    // Essen folk: 49 % steps, 22 % unisons. Rolling Stone pop: 40 % / 31 %.
    expect(steps / total).toBeGreaterThan(0.3);
    expect(unisons / total).toBeLessThan(0.35);
  });

  it("reverses after a leap, as melodies overwhelmingly do", () => {
    let leaps = 0;
    let reversed = 0;
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      for (let i = 2; i < melody.notes.length; i++) {
        const I = melody.notes[i - 1].midi - melody.notes[i - 2].midi;
        const R = melody.notes[i].midi - melody.notes[i - 1].midi;
        if (Math.abs(I) < 5) continue;
        leaps++;
        if (R === 0 || Math.sign(R) !== Math.sign(I)) reversed++;
      }
    }
    expect(leaps).toBeGreaterThan(0);
    expect(reversed / leaps).toBeGreaterThan(0.7);
  });

  it("never drones on one pitch", () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const mood of ["dark", "emotional", "dreamy", "energetic"] as const) {
        const melody = generateMelody(options({ seed, mood }));
        let run = 1;
        let longest = 1;
        for (let i = 1; i < melody.notes.length; i++) {
          run = melody.notes[i].midi === melody.notes[i - 1].midi ? run + 1 : 1;
          longest = Math.max(longest, run);
        }
        expect(longest).toBeLessThanOrEqual(3);
      }
    }
  });

  it("puts chord or colour tones on the notes that carry weight, never an avoid tone", () => {
    const hc = buildHarmonicContext(pop(8), C_MAJOR);
    let strongCT = 0;
    let strong = 0;
    for (let seed = 0; seed < 20; seed++) {
      const melody = generateMelody(options({ seed }));
      for (const n of melody.notes) {
        if (metricWeight(n.startBeat) < 3 && n.durationBeats < 1.5) continue;
        strong++;
        if (n.isChordTone) strongCT++;
        // A 6th or a 9th may sound on a downbeat; the 4th over a major triad
        // may not, and neither may a note outside the chord's scale.
        const category = hc.chords[n.chordIndex].categories[midiPc(n.midi)];
        expect(category === "avoid" || category === "chromatic").toBe(false);
      }
    }
    expect(strongCT / strong).toBeGreaterThan(0.8);
  });

  it("resolves leading tones and chordal sevenths when the harmony turns mid-phrase", () => {
    // Measured over real generated progressions of several lengths and moods,
    // which put dominants and secondary dominants inside phrases as well as at
    // their edges.
    let total = 0;
    let resolved = 0;
    const scale = getScaleDefinition("C", "major").pitchClasses;
    for (const numChords of [4, 8, 16]) {
      for (let ps = 1; ps <= 6; ps++) {
        const { chords, tensionCurve } = realProgression(ps, numChords);
        const hc = buildHarmonicContext(chords, scale);
        for (const mood of ["dark", "emotional", "energetic"] as const) {
          for (let seed = 0; seed < 3; seed++) {
            const melody = generateMelody({
              scalePitchClasses: scale, chords, style: "lyrical", mood, octave: 5, seed, tensionCurve,
            });
            const boundaries = melody.phrases!.map((p) => p.endBeat);
            for (let i = 1; i < melody.notes.length - 1; i++) {
              const n = melody.notes[i];
              const next = melody.notes[i + 1];
              // A tone that closes a phrase or is followed by a rest has come
              // to rest; and Open Music Theory allows a leading tone inside a
              // stepwise descent to keep descending.
              if (next.startBeat > n.startBeat + n.durationBeats) continue;
              if (boundaries.some((b) => n.startBeat < b && next.startBeat >= b)) continue;
              const I = n.midi - melody.notes[i - 1].midi;
              const R = next.midi - n.midi;
              if (
                Math.abs(I) >= 1 && Math.abs(I) <= 2 && Math.abs(R) >= 1 && Math.abs(R) <= 2 &&
                Math.sign(R) === Math.sign(I)
              ) continue;
              const t = tendencyOf(hc.chords[n.chordIndex], n.midi);
              if (!t || t.strength < 0.9 || next.chordIndex === n.chordIndex) continue;
              total++;
              if (t.to.includes(midiPc(next.midi))) resolved++;
            }
          }
        }
      }
    }
    expect(total).toBeGreaterThan(30);
    // Measured: 25 % before, 56 % after, against 37–44 % in pop corpora.
    expect(resolved / total).toBeGreaterThan(0.45);
  });

  it("uses the raised leading tone over a dominant in a minor key", () => {
    const chords: MelodyGenerationOptions["chords"] = [
      { midiNotes: [], pitchClasses: ["A", "C", "E"], root: "A", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["D", "F", "A"], root: "D", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["E", "G#", "B", "D"], root: "E", durationClass: "full" },
      { midiNotes: [], pitchClasses: ["A", "C", "E"], root: "A", durationClass: "full" },
    ];
    let sawRaised = false;
    let sawSubtonic = false;
    for (let seed = 0; seed < 30; seed++) {
      const melody = generateMelody({ scalePitchClasses: A_MINOR, chords, style: "lyrical", octave: 5, seed });
      for (const n of melody.notes.filter((x) => x.chordIndex === 2)) {
        if (n.pitchClass === "G#") sawRaised = true;
        if (n.pitchClass === "G" && n.durationBeats >= 1) sawSubtonic = true;
      }
    }
    expect(sawRaised).toBe(true);
    expect(sawSubtonic).toBe(false);
  });
});

describe("melodies over real generated progressions", () => {
  it("handles chromatic harmony without stranding notes or leaving the register", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { chords, tensionCurve } = realProgression(seed, 8);
      const melody = generateMelody({
        scalePitchClasses: getScaleDefinition("C", "major").pitchClasses,
        chords,
        style: "lyrical",
        octave: 5,
        seed,
        tensionCurve,
      });
      expect(melody.notes.length).toBeGreaterThan(0);
      for (const n of melody.notes) {
        expect(n.midi).toBeGreaterThanOrEqual(60);
        expect(n.midi).toBeLessThanOrEqual(84);
        expect(n.startBeat % 0.5).toBe(0);
      }
      // Every non-chord tone still resolves by step.
      for (let i = 0; i < melody.notes.length; i++) {
        const n = melody.notes[i];
        if (n.isChordTone) continue;
        const next = melody.notes[i + 1];
        expect(next).toBeDefined();
        expect(Math.abs(next.midi - n.midi)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("follows the chord engine's own tension curve to its climax", () => {
    let aboveMedian = 0;
    let runs = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { chords, tensionCurve } = realProgression(seed, 8);
      if (!tensionCurve) continue;
      const melody = generateMelody({
        scalePitchClasses: getScaleDefinition("C", "major").pitchClasses,
        chords, style: "lyrical", octave: 5, seed, tensionCurve,
      });
      const peak = Math.max(...melody.notes.map((n) => n.midi));
      const at = melody.notes.find((n) => n.midi === peak)!;
      const sorted = [...tensionCurve].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      runs++;
      if (tensionCurve[at.chordIndex] >= median) aboveMedian++;
    }
    expect(runs).toBeGreaterThan(0);
    // The old engine peaked on a below-median-tension chord 50–97 % of the time.
    expect(aboveMedian / runs).toBeGreaterThan(0.5);
  });

  it("stays deterministic on real progressions", () => {
    const { chords, tensionCurve } = realProgression(5, 8);
    const build = () => generateMelody({
      scalePitchClasses: getScaleDefinition("C", "major").pitchClasses,
      chords, style: "lyrical", octave: 5, seed: 99, tensionCurve,
    });
    const a: Melody = build();
    const b: Melody = build();
    expect(a.notes.map((n) => [n.midi, n.startBeat, n.durationBeats])).toEqual(
      b.notes.map((n) => [n.midi, n.startBeat, n.durationBeats]),
    );
  });
});
