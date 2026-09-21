# Melody Engine Analysis

This document records three rounds of work on the melody generator: the
original phrase-based refactor that replaced a note-by-note walker, the
rebuild around musical form, metre and harmonic context, and the approach
figures and interval budget that followed. Sections 1–7 describe the first
round, section 8 the second, section 9 the third.

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

---

## 9. Third round: approach patterns and a surprise budget

Two of the four items §8.5 left open: **approach and enclosure patterns before
chord changes**, and **a surprise budget of one rare interval per phrase**.
They are the same problem seen from two sides — §8.5 reported a line that
"leaps into and away from its peak", with a mean interval of 2.7 against the
corpora's 2.15 and 17–21 % of intervals a fourth or wider against 12 %, while
arriving at each new chord from wherever the motif happened to leave it.

### 9.1 What was measured

Three statistics, added to `scripts/analyzeMelodies.ts` and defined once, in
`lib/music/generators/melody/approach.ts`, so the generator and the analysis
cannot drift apart.

- **Approach rate at chord changes.** The denominator is the changes a melody
  *could* approach: a note ends exactly on the change, inside the beat before
  it (the last one or two half-beat slots), and the new chord begins with an
  onset of its own — about half of all changes. Each is then classified:
  *diatonic* (a step of one or two semitones into a chord tone of the new
  chord), *chromatic* (a semitone from a note the previous chord calls
  chromatic), or *enclosure* (the two notes before the change straddling the
  target, each within a step, in either order).
- **Surprises per phrase**, and the share of phrases holding more than one. A
  surprise is an interval of a sixth or more, or a chromatic tone that never
  resolves by semitone. Intervals across a rest or a phrase boundary are not
  counted: where the line has stopped and started again, the distance between
  the two notes is register, not a leap.
- **The interval distribution**: mean interval, unisons, steps, thirds, and
  the shares at a fourth or wider and a sixth or wider, against Essen.

Sample: the script's own — four progressions (C major I–vi–IV–V at four and
eight bars, C–D7–G–C, and an eight-chord F major long form with half-bar
chords) × four moods × 13 seeds, lyrical, eight candidates per melody; 208
melodies, plus the same sample in all three styles for the style table.

### 9.2 What the research says

- **Approach tones.** The engine already speaks Impro-Visor's vocabulary
  (§8.2): every pitch over a chord is a chord, colour, scale or avoid tone.
  The approach-note idiom is the other half of that vocabulary — a note whose
  whole justification is the note after it. The chromatic approach is the
  clearest case: a tone outside the chord's own scale is admissible precisely
  because it resolves by semitone on the next onset, which is also what
  distinguishes it from a wrong note. The enclosure is the same idea from both
  sides at once.
- **Tendency tones outrank it.** *Open Music Theory* is explicit that a
  functional dissonance resolving at a change of function "takes precedence
  over other principles". Where a dominant's leading tone or seventh already
  resolves into the next chord, the harmony has brought its own approach and
  the melody does not invent a second one.
- **Interval budgets.** Essen: 22 % unisons, 49 % steps, 17 % thirds, 12 % of
  intervals a fourth or wider, mean 2.15 semitones; only about 2.5 % reach a
  sixth. A phrase of eight or nine notes therefore carries at most one wide
  interval, and a sixth is a once-a-song event rather than a once-a-phrase one.
- **The peak is approached by leap but left by step** (§8.2: approached by
  leap in 56–63 % of phrases, left by step in 66–73 %). The corpora's approach
  leaps are thirds and fourths; nothing in them justifies reaching the high
  note from a sixth below and falling off it by a seventh.
- **The hook returns whole** (POP909: 65 % of consecutive same-type phrases
  share their first four notes). Whatever an approach figure is worth, it is
  not worth bending a restatement out of recognition.

### 9.3 The design

**Approach patterns live in two places, planned then spent.**

`approach.ts` plans them, *after* the rhythm is laid out and before pitches
are realized. That is the only stage where the question "can this change be
approached at all?" has an answer: it is a question about onsets, not about
pitches. For each eligible change the planner draws, from the mood's rate,
whether it gets a figure and which one — deterministically, from the
candidate's own RNG stream, so a seed still reproduces its melody exactly. It
refuses to plan into a phrase's peak or its cadence note (both are pinned, and
neither is an approach target), and where the previous chord is a dominant
whose leading tone or seventh already resolves into this one it plans only the
plain step, leaving the tendency tone in possession of the slot.

`realizePitches.ts` spends the plan inside the beam-search objective, as three
terms:

- a bonus at the arrival for the figure actually being played — a step in
  (2.5), the semitone from below (3.5) or from above (2.0), both neighbours in
  either order (4.0);
- a *preparation* a note earlier, to the approach tone itself. The reward
  lands on the arrival, which is one note too late for a chromatic tone: it
  costs about five points on category alone and would be pruned from the beam
  before the arrival could pay it back. A planned chromatic approach tone is
  therefore charged as the motion it is rather than as a foreign note — its
  category cost is refunded and a 4.5-point edge added — but only while it
  stays short (a beat at most) and off the strong positions the harmony tests
  read. The preparation is never paid to a hook that is coming back;
- a penalty, planned or not, whenever a chromatic tone moves by anything other
  than a semitone (6.0), with the final safety pass in `generateMelody.ts`
  enforcing the same rule by construction: a chromatic tone that does not
  resolve by a semitone on the very next onset is pulled onto a chord tone.

Making it a bonus rather than a constraint is the point: an approach is a
preference the harmony, the motif and the cadence can all outvote.

**Rates by mood and style** (`moods.ts`, so the four moods stay audibly
distinct and the style modulates the mood as everywhere else):

| Mood | Rate | Chromatic share | Enclosure share |
|---|---|---|---|
| dark | 0.50 | 0.45 | 0.15 |
| emotional | 0.50 | 0.40 | 0.20 |
| dreamy | 0.40 | 0.12 | 0.12 |
| energetic | 0.45 | 0.25 | 0.20 |

Style multiplies the rate: lyrical ×0.85 (a sung line is carried by its words,
not by the changes), rhythmic ×1.2, arpeggiated ×1.2. Dark and emotional
favour the chromatic approach, dreamy the diatonic one, as the brief asked.

**The surprise budget lives in the beam search.** Each phrase starts with one
surprise and one wide leap. A surprise is an interval of a sixth or more or a
chromatic tone that fails to resolve; a wide leap is a fourth or a fifth,
which is not a surprise but is rationed on the same principle one tier down
because Essen puts only 12 % of intervals there. The first of each is free;
the second costs 5 points (2.5 for a wide leap) and every one after that costs
more. Nothing is charged across a rest or a phrase boundary.

**The climax spends its phrase's budget.** The peak is pinned to a chord tone
under the phrase's ceiling, so the leap into it is not negotiable — and being
charged to the path, not to the note, it is the *previous* note the search
moves. Three changes give the line somewhere to stand: the note before the
peak may not sit more than a fifth below it, its target is nudged up toward
the peak the phrase will actually reach (the peak and the degree walk are
chosen independently, and the gap between them was what the line used to cross
in one jump), and the descent from the peak is charged by the semitone beyond
a step. Where a phrase spends a surprise at all it is now the climax's own
leap in 60 % of cases or more, which is what the budget is for.

Two smaller changes came out of the measurements rather than the brief. The
final safety pass, which pulls a stranded non-chord tone onto a chord tone,
used to take the *nearest* one; on this sample it fired on 5.6 % of all notes
and, blind to the line, turned thirds into fifths — it accounted for nearly
three points of the ≥ 4th share on its own. It now prefers a tone that keeps
both neighbours close, except inside a hook, where it stays with the nearest
so that a restatement is repaired the same way its model was. And a head note
that is *replaying* an earlier head now holds its target harder than one
stating it (fidelity 2.8 against 1.8), which is what keeps the hook intact
while the approach figures work on the line around it.

### 9.4 Before/after results

Same sample and the same measurement code on both sides; "before" is the
engine as §8 left it.

**Approach figures at chord changes** (share of approachable changes):

| Engine | Approachable | Any approach | Diatonic | Chromatic | Enclosure |
|---|---|---|---|---|---|
| legacy | 147 | 33.3 % | 27.2 % | 0.0 % | 6.1 % |
| before (all moods) | 480 | 36.7 % | 32.1 % | **0.0 %** | 4.6 % |
| after (all moods) | 452 | **48.2 %** | **40.7 %** | **2.2 %** | **5.3 %** |
| after — dark | 91 | 29.7 % | 27.5 % | 1.1 % | 1.1 % |
| after — emotional | 130 | 52.3 % | 36.2 % | 4.6 % | 11.5 % |
| after — dreamy | 101 | 37.6 % | 34.7 % | 0.0 % | 3.0 % |
| after — energetic | 130 | 65.4 % | 59.2 % | 2.3 % | 3.8 % |

By style (emotional, all four progressions): lyrical 38.8 % → **52.3 %**,
rhythmic 46.3 % → **60.2 %**, arpeggiated 36.4 % → **46.6 %**.

**Surprises and the interval distribution:**

| Measure | Before | After | Corpus (Essen) |
|---|---|---|---|
| Surprises per phrase | 0.41 | **0.25** | — |
| Phrases over budget (> 1) | 11.5 % | **0.9 %** | — |
| Mean interval (semitones) | 2.91 | **2.73** | 2.15 |
| Unisons | 12.7 % | **13.2 %** | 22 % |
| Steps | 47.6 % | **49.4 %** | 49 % |
| Thirds | 18.5 % | 18.9 % | 17 % |
| A fourth or wider | 21.2 % | **18.6 %** | 12 % |
| A sixth or wider | 7.4 % | **5.1 %** | 2.5 % |

Per mood, surprises per phrase and the share of phrases over budget:
dark 0.02 → **0.00** (0.0 % → 0.0 %), emotional 0.57 → **0.33** (17.1 % →
**1.7 %**), dreamy 0.45 → **0.28** (17.1 % → **0.0 %**), energetic 0.61 →
**0.38** (12.0 % → **1.7 %**). Mean interval by mood: dark 2.63 → 2.55,
emotional 3.01 → 2.71, dreamy 3.17 → 2.79, energetic 2.87 → 2.82.

**The dimensions §8 already tracked**, unchanged in kind and slightly better
in every case — the interval work did not cost repetition or harmony:

| Engine | Score | Motif coverage | Mean interval | Dir-change | Strong-beat CT % | Final note | Final on CT | Leaps > 7 |
|---|---|---|---|---|---|---|---|---|
| legacy | 52.7 | 0.06 | 2.72 | 0.55 | 93 | 1.3 | 58 % | 0.00 |
| before — dark | 91.9 | 0.36 | 2.62 | 0.44 | 81 | 2.0 | 100 % | 0.04 |
| after — dark | 93.7 | 0.37 | 2.55 | 0.40 | 80 | 2.0 | 100 % | 0.00 |
| before — emotional | 95.3 | 0.41 | 3.12 | 0.54 | 88 | 2.0 | 100 % | 1.56 |
| after — emotional | 99.7 | 0.45 | 2.75 | 0.48 | 87 | 2.0 | 100 % | 0.98 |
| before — dreamy | 92.5 | 0.37 | 3.24 | 0.50 | 88 | 2.0 | 100 % | 1.10 |
| after — dreamy | 93.2 | 0.37 | 2.83 | 0.44 | 85 | 2.0 | 100 % | 0.75 |
| before — energetic | 106.8 | 0.47 | 2.96 | 0.51 | 92 | 2.0 | 100 % | 1.94 |
| after — energetic | 108.4 | 0.51 | 2.90 | 0.50 | 96 | 2.0 | 100 % | 1.50 |

Over the chord engine's own progressions, leading tones and chordal sevenths
still resolve mid-phrase at 64 %, against 65 % before — the rule that puts a
tendency ahead of an approach is what holds it there. An earlier draft that
pinned the notes either side of the peak instead of nudging them cost ten
points of that figure, which is how the pin became a nudge.

**Generation time**, median of three runs over the same 208 melodies: 5.19 ms
→ 5.86 ms per melody, **1.14×**. The planner is a single pass over the placed
events; the rest is extra terms in a search that was already running.

### 9.5 Trade-offs and what is still open

- **The mean interval is 2.73, not 2.15.** Roughly half the remaining gap is
  unisons: Essen repeats a pitch 22 % of the time and the engine does it 13 %,
  deliberately — repeated-pitch drones were the first round's worst fault
  (§8.1) and the anti-drone rules that removed them also removed the corpora's
  cheapest source of small intervals. The rest is the pinned peak, below.
- **The peak is left by a third, not a step** (measured: a step in about 20 %
  of melodies, against 66–73 % in the corpora). This is structural: the peak
  is pinned to a chord tone, and the tone a step below a chord tone is usually
  not one, so leaving by step means leaving onto a non-chord tone that then
  owes its own resolution. Shrinking the descent from a sixth to a third is as
  far as the pin allows; the rest would need the peak unpinned, which is what
  §8.4 bought the single high point with.
- **The chromatic approach is rarer than its rate suggests** — 2.2 % of
  approachable changes against a planned 6 %. Two filters account for it: the
  tone has to be short and off the beat, which the sparser moods rarely offer
  (dark ends up at 1.1 %, dreamy at 0), and the slot before a change often
  falls inside the restated head, where the hook holds its shape. Both are the
  right refusals, but they mean the figure is a colour the engine reaches for
  rather than a habit.
- **The escape tone and the cambiata are still unimplemented**, and now
  deliberately so. Both are non-chord tones *left by leap* — that is their
  definition — and the engine's standing guarantee, asserted by two tests and
  enforced by the final safety pass, is that every non-chord tone resolves by
  step. Adding them means loosening that guarantee for a flagged exception;
  the trade did not look worth it against the two items measured here, and it
  should be taken as a deliberate decision rather than an omission.
- Still open from §8.5: a sixteenth-note grid for pop styles.

### 9.6 Tests

`lib/music/generators/melody/__tests__/approach.test.ts` — 12 tests, four of
which fail against the engine as §8 left it:

- the approach rate over the analysis script's own sample, inside a stated
  band (above 40 %, below 85 %), with all three devices in use and the plain
  step the commonest;
- every chromatic tone resolving by a semitone on the very next onset, with no
  rest between them and no more than a beat of it — and the count being
  non-zero, so the guarantee is not vacuous;
- strict harmony admitting no chromatic tone at all;
- the planner's determinism, and its refusal to approach a peak or a cadence;
- the classification itself, on hand-written figures: a step in, the semitone
  below, both enclosure orders, a leap in, and a note held across the change;
- at most one surprise per phrase (0.9 % of phrases exceed it), where a phrase
  spends the one it has (the climax, in more than 60 % of the phrases that
  spend one), and the interval mix against the corpora.

No existing threshold was loosened. The 78 tests §8.6 describes still pass
unchanged, including the interval-mix, post-leap-reversal, tendency-resolution
and hook-return guarantees that the work here had to be shaped around.
