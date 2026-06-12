# Melody Engine Analysis — Phrase-Based Refactor

This document records the audit of the original melody generator, the causes of
its weak output, the architecture of the replacement phrase-based composer, and
measured before/after results. Regenerate the raw data anytime with:

```bash
npx tsx scripts/analyzeMelodies.ts
```

---

## 1. Analysis of the original system

The original engine (`lib/music/generators/melody/legacy/generateMelodyLegacy.ts`)
was a **note-by-note probabilistic walker**. For each chord it rolled a rhythm
(tension-biased durations), then chose each pitch by scoring nearby candidates
(stepwise cheap, chord tones favored on strong beats, semitone clashes
penalized) and sampling softmax-style from the top four.

The notes were always *correct* — diatonic, chord-aware, leap-recovered — but
the melodies didn't sound composed. Reviewing a large sample (4 progressions ×
13 seeds across major/minor keys, all styles) showed why:

| # | Weakness | Root cause |
|---|---|---|
| 1 | **Nothing repeats** | Each pitch decision saw only the previous note; no phrase ever restated material, so nothing was memorable. Measured motif coverage: **0.06** (6% of notes participate in any repeated pattern). |
| 2 | **Rhythm has no identity** | The rhythm was re-rolled independently per chord — no rhythmic cell ever recurred. |
| 3 | **Random zig-zag** | Softmax sampling produced constant direction changes (0.55 direction-change rate — more than every other note). |
| 4 | **No climax, no arc** | A linear tension curve nudged candidate scores by ±1.5 points; no planned peak, no registral shape. |
| 5 | **No phrase endings** | Melodies just stopped: final note averaged 1.3 beats and landed on a chord tone only **58%** of the time. |
| 6 | **Accidental non-chord tones** | NCTs appeared wherever scoring allowed, with no resolution obligation. |
| 7 | **No selection pressure** | One melody was generated and kept, however weak. |

## 2. Largest causes of weak melodies

In order of impact: (1) absence of repetition — the single biggest difference
between "notes" and "music"; (2) no phrase structure or contour — nothing for
the ear to follow; (3) weak endings — no long resolving note; (4) per-note
randomness — local validity, global aimlessness.

## 3. New generation strategy

Compose top-down, the way a songwriter works:

```
phrase plan → contour → motifs → layout → pitch realization → ornaments → score N candidates, keep the best
```

Randomness only chooses among pre-validated structural options (which contour,
which motif variation, which onsets); every pitch decision is a deterministic
argmin against the plan. A fixed seed reproduces the exact melody.

## 4. Architecture changes

All in `lib/music/generators/melody/`:

| Module | Responsibility |
|---|---|
| `phrasePlan.ts` | Partitions the progression's beats into intro / development / climax / resolution segments snapped to chord boundaries, reusing the chord engine's tension curve (`advanced/phraseStructure.ts`). Fixes the contour shape and climax beat. |
| `contour.ts` | Six shapes (rising, falling, arch, inverted arch, wave, stair-step) as target-pitch curves over the whole melody, warped so peaks land on the planned climax beat. |
| `motif.ts` | Generates 2- or 4-beat rhythmic/melodic cells (grid-aligned onsets, syncopation, rests, closing long note + scale-degree contour) and variation operators: transpose, invert, rhythm-shift, densify, truncate. Tiles them into the plan: intro = A·A, development = A′/B call-and-response, climax = densified A, resolution = pickup + long cadence note. |
| `realizePitches.ts` | Turns events into pitches. Each segment anchors to a **chord tone** of its opening harmony nearest the contour target (anchor motion clamped to a fifth); motif degree contours are walked from the anchor; candidates scored for motif fidelity, smoothness, chord-tone pull, clash avoidance. First realization of each motif pattern is memoized so repeats are audible. Strict/expressive strong-beat rules preserved verbatim. |
| `ornaments.ts` | Intentional tension: passing tones, neighbor tones, suspensions, anticipations, appoggiaturas — mood-gated, tension-scaled, register-bounded, and **always inserted together with their step resolution**. |
| `scoring.ts` | Catchiness score (below); best of 8 candidates wins. |
| `moods.ts` | Dark / Emotional / Dreamy / Energetic profiles parameterize register, contour weights, rhythm density, syncopation, rests, pickups, leap limits, ornament palette, and tension scaling. The existing style control (Lyrical/Rhythmic/Arpeggio) modulates the mood. |
| `rng.ts` | Seeded mulberry32 + derived per-candidate streams (deterministic best-of-N). |

The public API (`generateMelody(options): Melody`, `MelodyNote`) is unchanged;
`mood` and `candidateCount` are optional additions. Store/UI gained a
`melodyMood` setting with a Mood dropdown next to Style and Harmony.

## 5. Melody scoring criteria

Positive: motif repetition (+25, n-gram coverage with transposition-invariant
±1-semitone fuzzy matching, capped at 70% so wall-to-wall repetition isn't
rewarded), strong-beat chord-tone alignment (+20), contour adherence (+15,
correlation with the planned curve), phrase-ending resolution (+15, long final
note on a stable tone approached by step), smooth voice leading (+10),
rhythmic interest (+10, 2–4 distinct durations), range sanity (+5).

Negative: leaps > 9 semitones (−2 each), zig-zag motion (up to −10), sustained
density > 2 notes/beat (−5), zero repetition (−15), unresolved NCTs (−3 each).

## 6. Before/after results

Aggregate over 52 melodies per row (13 seeds × 4 progressions, lyrical style):

| Engine | Score | Motif coverage | Mean interval | Dir-change rate | Strong-beat CT % | Final note beats | Final on CT |
|---|---|---|---|---|---|---|---|
| legacy | 38.4 | 0.06 | 2.72 | 0.55 | 93 | 1.3 | 58% |
| new (dark) | 94.4 | 0.75 | 1.69 | 0.47 | 98 | 2.0 | 100% |
| new (emotional) | 87.8 | 0.68 | 1.74 | 0.45 | 98 | 2.0 | 100% |
| new (dreamy) | 63.1 | 0.26 | 1.90 | 0.39 | 98 | 2.0 | 100% |
| new (energetic) | 97.1 | 0.81 | 1.91 | 0.41 | 98 | 2.0 | 100% |

(Dreamy's lower coverage is intentional: sparse, floating lines have fewer
notes to repeat.)

### Notated examples (C major I–vi–IV–V; `*` marks non-chord tones)

Seed 3 — before:

```
E5(1) D5(2*) E5(1) C5(1) D5(1*) C5(2) F5(2) F5(1) D5(1*) G4(1) A4(2*) G4(1)
```

Aimless wandering, no repetition, ends weakly on a 1-beat G4 after an
unmotivated drop.

Seed 3 — after:

```
C5(1) B4(1*) C5(1) C5(0.5) G5(0.5) A5(1) A5(1) A5(1) A5(0.5) C5(0.5) C5(1) B4(1*) C5(1) C5(1) G4(1) F4(1*) G4(2)
```

A neighbor-tone motif (C5–B4–C5) is stated, the line lifts to an A5 climax
plateau, the motif returns, and a 2-beat G4 resolves the phrase — with the
F4 lower neighbor leaning into it.

### Mood fingerprints (same progression, same seed)

```
dark:      C5(1) B4(1*) C5(1) B4(1*) A4(.5) A4(.5) G4(1*) A4(1) G4(1*) F4(1) E4(1*) F4(1) E4(1*) D4(1) C4(1*) D4(2)
emotional: E4(1) D4(1*) E4(1) E4(.5) G4(.5) C5(1) C5(1) C5(1) C5(.5) E5(.5) F5(1) E5(1*) F5(1) E5(.5*) D5(.5*) D5(1) C5(1*) B4(2)
dreamy:    G4(1) F4(.5*) G4(.5) G4(2) C5(1) C5(1) C5(2) F5(1) G5(1*) F5(1) F5(.5) B5(.5*) B5(2) B5(2)
energetic: C4(.5) C4(1) C4(.5) C4(.5) C4(1) C4(.5) C4(.5) C4(1) C4(.5) E4(1) A4(.5) E4(.5) C5(.5) B4(1*) C5(.5) C5(.5) B4(1*) C5(.5) G5(.5) G5(1) G5(.5) G5(2)
```

Dark descends in sequences through a low register; emotional rises through a
full arch and resolves by step; dreamy floats on sustained tones; energetic
drives a repeated-note hook upward through two octaves.

## 7. Tests for melody quality constraints

`lib/music/generators/melody/__tests__/`:

- `melodyHarmony.test.ts` (pre-existing, unchanged): seed determinism,
  chromatic chord-tone reachability (F♯ over D7), expressive clash avoidance,
  strict strong-beat enforcement.
- `melodyQuality.test.ts`: motif repetition present, long resolving endings,
  contour peak placement, mood differentiation (register/density/sustain),
  leap limits, NCT step resolution, candidate-loop determinism, half-beat
  grid + register bounds, degenerate progressions (1 chord, 2 chords,
  all-eighth-note chords).
- `phrasePlan.test.ts`, `motif.test.ts`, `scoring.test.ts`: unit coverage of
  the planning layers (exact beat coverage, boundary snapping, variation
  operators, composed-vs-zig-zag score separation, penalty triggers).

## 8. Remaining opportunities

- **Multi-phrase forms**: long progressions currently get one arc; AABA or
  verse/chorus phrase pairs with a shared hook would scale better past 16 bars.
- **Question/answer cadences**: a half cadence (ending on 2̂/5̂) for the first
  phrase and a full cadence for the second would create true antecedent/
  consequent periods.
- **Rhythmic motif scoring**: the scorer matches interval+duration n-grams;
  scoring rhythm-only repetition would credit invert-style variations too.
- **Melodic-minor awareness**: raised 6̂/7̂ on ascending lines in minor keys.
- **Sketchpad integration**: the sketchpad has no melody features yet; the
  engine is ready for per-section melodies with motif continuity across
  sections.
- **User-adjustable candidate count / "regenerate variation"**: expose
  `candidateCount` and seed control for a "more like this" button.
