# Melody Engine Analysis

This document records two rounds of work on the melody generator: the original
phrase-based refactor that replaced a note-by-note walker, and the later
rebuild around musical form, metre and harmonic context. Sections 1–7 describe
the first round; section 8 onward describes the second.

Regenerate the first round's raw data anytime with:

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
| `motif.ts` | Generates 2- or 4-beat rhythmic/melodic cells and variation operators: transpose, invert, rhythm-shift, densify, truncate. Tiles them into the plan. |
| `realizePitches.ts` | Turns events into pitches, anchored per segment, scored for motif fidelity, smoothness, chord-tone pull and clash avoidance. |
| `ornaments.ts` | Passing tones, neighbor tones, suspensions, anticipations, appoggiaturas — mood-gated, tension-scaled, and **always inserted together with their step resolution**. |
| `scoring.ts` | Catchiness score; best of 8 candidates wins. |
| `moods.ts` | Dark / Emotional / Dreamy / Energetic profiles. |
| `rng.ts` | Seeded mulberry32 + derived per-candidate streams. |

## 5. Melody scoring criteria (first round)

Positive: motif repetition (+25), strong-beat chord-tone alignment (+20),
contour adherence (+15), phrase-ending resolution (+15), smooth voice leading
(+10), rhythmic interest (+10), range sanity (+5). Negative: oversized leaps,
zig-zag motion, runaway density, zero repetition, unresolved NCTs.

## 6. Before/after results (first round)

Aggregate over 52 melodies per row (13 seeds × 4 progressions, lyrical style):

| Engine | Score | Motif coverage | Mean interval | Dir-change rate | Strong-beat CT % | Final note beats | Final on CT |
|---|---|---|---|---|---|---|---|
| legacy | 38.4 | 0.06 | 2.72 | 0.55 | 93 | 1.3 | 58% |
| new (dark) | 94.4 | 0.75 | 1.69 | 0.47 | 98 | 2.0 | 100% |
| new (emotional) | 87.8 | 0.68 | 1.74 | 0.45 | 98 | 2.0 | 100% |
| new (dreamy) | 63.1 | 0.26 | 1.90 | 0.39 | 98 | 2.0 | 100% |
| new (energetic) | 97.1 | 0.81 | 1.91 | 0.41 | 98 | 2.0 | 100% |

## 7. Tests for melody quality constraints

`lib/music/generators/melody/__tests__/` covers seed determinism, chromatic
chord-tone reachability, strict/expressive strong-beat rules, motif repetition,
long resolving endings, mood differentiation, leap limits, NCT step resolution,
the half-beat grid and degenerate progressions.

---

## 8. Second round: form, metre and harmonic context

The first round made melodies *shaped*. Running the engine at scale showed it
had not made them *composed*. Over 26,256 generated melodies (fixed
progressions across four moods and three styles, plus progressions from the
chord engine at 4, 8 and 16 chords) the same faults recurred.

### 8.1 What the measurements showed

| # | Weakness | Measured |
|---|---|---|
| 1 | **The climax was not a climax.** The highest note recurred 3.5–3.8 times per melody, arrived in the first bar in 23–24% of melodies (falling contours start at the top) and in the last bar in 27–46% (rising contours end there). | peak count 3.5–3.8; first bar 23–24%; climax segment 0–37% |
| 2 | **The melody ignored the harmony's shape.** The phrase plan read a table keyed to chord *count*, not the progression's real tension, so the peak fell on a below-median-tension chord in 50–97% of runs and on the dominant 0% of the time. | peak on a tense chord 44% |
| 3 | **Repeated-note drones.** Runs of four or more identical pitches in 48–62% of melodies; one pitch held ~28% of all sounding beats. | longest run 4.5–4.6 notes |
| 4 | **No form past four chords.** Eight- and sixteen-chord progressions were one breathless arc: a mid-phrase breath appeared in 22–41% of melodies, and rests averaged 0.67 per melody on fixed progressions. | mid-phrase breath 22–41% |
| 5 | **Tendency tones were invisible.** The engine saw pitch classes only, so a leading tone rose to the tonic in 22–32% of chances and a chordal seventh fell by step in 17–31%. | resolution 22–32% |
| 6 | **Harmony was a proximity test.** `isSemitoneClash` rejected the major 7th over a major chord and the 13th over a dominant, yet accepted the ♭6 over a major triad. Sustained avoid tones: 0.18 per melody on real progressions. | — |
| 7 | **Rhythm had no metre.** Onsets were drawn by a flat coin with a syncopation chance; the scorer's rhythm term gave every candidate full marks, so it applied no selection pressure at all. | — |

### 8.2 What the research says

Five research lanes and a corpus-statistics lane ran against primary sources
and against melody corpora on disk: the **Essen Folksong Collection** (6,059
songs, 35,043 phrases, 293,595 intervals), the **CoCoPops Rolling Stone 200**
pop/rock vocal melodies with chords (194 songs, 59,607 notes), **POP909**,
**Nottingham** and **OpenEWLD**. Theory citations are to *Open Music Theory*;
Impro-Visor's note categories and guide-line generator, IDyOM's
implication-realisation viewpoints and the MIDI Toolbox Narmour codings were
read from source.

The findings that drove the rebuild:

- **Periods and sentences.** A phrase's ending degree is decided by its
  cadence: a half cadence ends on 2̂, 7̂ or 5̂; an imperfect close on 3̂ or 5̂; the
  final phrase on 1̂ approached by step. Essen bears this out — non-final
  phrases end on 5̂ 25%, 1̂ 23%, 3̂ 20%, 2̂ 17%, while final phrases end on 1̂ 84%.
- **The hook returns where the harmony returns.** In POP909, 65% of
  consecutive same-type phrases share their first four notes and 91% of those
  change the tail. "Same head, different tail" is the real relation.
- **One peak, early in its phrase.** The peak is unique in 65% of Essen phrases
  and 52% of Rolling Stone phrases; it sits at about a third of the way in
  (Essen median 0.33, POP909 0.28), is approached by leap 56–63% of the time
  and left by step 66–73%.
- **Interval mix.** Essen: 22% unisons, 49% steps, 17% thirds, 12% of intervals
  a fourth or wider, mean 2.15 semitones. A leap of a fifth or more is followed
  by a reversal 74–90% of the time.
- **Metre is a hierarchy, not a binary.** The downbeat, beat three, beats two
  and four and the off-beats form four levels; syncopation is measurable
  (Longuet-Higgins & Lee) at about 0.3 per bar in folk and 1.8 in pop.
- **Note categories, not proximity.** Impro-Visor classifies every pitch over a
  chord as a chord tone, a colour tone, a scale tone or an avoid tone. The
  avoid tone is the scale tone a semitone above a chord tone.
- **Tendency tones.** *Open Music Theory* is explicit that a functional
  dissonance resolving down by step at a change of function "takes precedence
  over other principles", with a stated exception: a leading tone inside a
  stepwise descent may continue down.
- **Phrases breathe.** The final note of a phrase runs about 1.5× the phrase's
  mean (Essen), 77% of phrases lengthen it, and 62% of phrases begin with a
  pickup of half a beat or a beat.

### 8.3 The rebuilt pipeline

```
harmonic context → form plan → rhythm → motifs → beam-search realization → ornaments → score → select
```

| Module | Responsibility |
|---|---|
| `harmonicContext.ts` *(new)* | Derives, per chord, its quality, scale degree, harmonic function, tension (the chord engine's own formula), a category for all twelve pitch classes (chord / colour / avoid / chromatic), its tendency tones, a targeting priority and a guide-tone line. |
| `meter.ts` *(new)* | Metric weights on the half-beat grid and the Longuet-Higgins & Lee syncopation measure. |
| `phrasePlan.ts` *(rewritten)* | Cuts the progression into phrases, matches restatements to returning harmony, assigns each phrase a cadence type and ending degree, a local peak, a register, a pickup, a breath and a density. Chooses the climax phrase by harmonic tension. |
| `rhythm.ts` *(new)* | A vocabulary of one-bar cells chosen by metric weight and reused across phrases, with onsets at chord changes, anticipations, a density taper and a lengthened cadence note. |
| `motif.ts` *(rewritten)* | A basic idea stated, restated with a new ending, fragmented and sequenced, and liquidated into the close. |
| `realizePitches.ts` *(rewritten)* | A beam search per phrase over motif fidelity, expectation (proximity, post-leap reversal, step inertia, regression to the mean), harmony by category and metric weight, guide tones, tendency resolution, the pinned peak and the planned cadence pitch. |
| `scoring.ts` *(rewritten)* | Thirteen terms calibrated against the corpora, replacing the saturated rhythm term, plus tie-band selection so equal candidates still vary with the seed. |

### 8.4 Before/after results

Fixed progressions (I–vi–IV–V at 4 and 8 bars; 4 moods × 3 styles × 25 seeds)
and progressions from the chord engine (C ionian, complexity 3, at 4, 8 and 16
chords; 8 progressions × 4 moods × 6 seeds).

| Measure | Fixed before | Fixed after | Real before | Real after | Corpus |
|---|---|---|---|---|---|
| Times the highest note is reached | 3.8 | **1.0** | 3.5 | **1.0** | unique in 52–65% of phrases |
| Peak in the first bar | 24% | **0%** | 23% | **0%** | 24% (Essen phrase-level) |
| Longest run of one pitch | 4.5 | **2.1** | 4.6 | **2.0** | 1.3–1.4 mean run |
| Melodies with a 4-note drone | 62% | **0%** | 48% | **0%** | — |
| Peak on a tense chord | — | — | 44% | **85%** | — |
| Mid-phrase breath | 22% | **100%** | 41% | **96%** | 41–81% of boundaries |
| Rests per melody | 0.67 | **1.61** | 1.73 | **2.92** | — |
| Leading tone / seventh resolved | 22% | **39%** | 32% | **61%** | 37–44% (pop) |
| Sustained avoid tones per melody | 0.03 | **0.01** | 0.18 | **0.03** | — |
| Leap followed by a reversal | 71% | **81%** | 65% | **78%** | 74–90% |
| Steps as a share of small intervals | 39% | **61%** | 53% | **62%** | 49% of all intervals |
| Mean interval (semitones) | 1.84 | 2.78 | 1.78 | 2.73 | 2.06–2.17 |
| Melodic range (semitones) | 16.2 | **13.2** | 15.7 | **13.8** | 12–19 per song |
| Distinct melodies per 300 seeds | 252 | **275** | — | — | — |

Measured separately over a wider population (4, 8 and 16 chords × four moods ×
ten progressions), with phrase endings, rests and the stepwise-descent
exception excluded, leading tones and chordal sevenths resolve **25% → 56%**.

Generation costs more: 0.8 ms → 6.9 ms at four chords, 3.1 ms → 22.5 ms at
sixteen, for eight scored candidates. It remains synchronous and deterministic
per seed.

### 8.5 Trade-offs and what is still open

- **Repetition is measured lower**, from 0.72 to 0.55 on fixed progressions and
  0.69 to 0.39 on real ones. Much of the old figure came from the drones the
  rebuild removed: a run of four identical pitches matches its own n-gram. On
  four-chord generated progressions, where two short phrases sit over
  non-repeating harmony, coverage is genuinely thin (0.28) because there is
  little room for a three-note pattern to return before the piece ends.
- **The line is leapier than the corpora**: mean interval 2.7 against 2.15, and
  17–21% of intervals a fourth or wider against 12%. Each phrase leaps into and
  away from its peak, which is what a pinned single high point costs.
- **A pinned peak outranks a tendency resolution.** Where a phrase's peak falls
  on the chord change, the leading tone below it leaps to the peak instead of
  resolving. Real pop does this too, but it is a conflict between two rules
  rather than a decision.
- Still unimplemented from the research: approach and enclosure patterns before
  chord changes, the escape tone and cambiata, a surprise budget of one rare
  interval per phrase, and a sixteenth-note grid for pop styles (47% of POP909
  durations are sixteenths, which the half-beat grid cannot express).

### 8.6 Tests

`lib/music/generators/melody/__tests__/` — 77 tests across ten files.
`harmonicContext.test.ts`, `meter.test.ts`, `rhythm.test.ts` and `form.test.ts`
cover the new modules; `melodyForm.test.ts` asserts the engine's musical
guarantees end to end (a single high point in the climax phrase approached from
below, phrase endings on planned degrees, inner phrases avoiding the tonic,
breathing at boundaries, the hook returning whole, the corpus interval mix,
post-leap reversal, no drones, tendency resolution, the raised leading tone in
minor, and behaviour over real chromatic progressions).
