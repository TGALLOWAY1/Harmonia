# Chord Progression Generator — Assessment & Research

**Date:** 2026-09-14
**Scope:** `lib/music/generators/advanced/`, `lib/theory/`, `lib/state/progressionStore.ts`, the generator UI in `app/page.tsx`, and the melody engine as an in-repo comparison point
**Complaint under investigation:** *"There isn't an emotional flow and the voicing is limited."*
**Method:** 9 parallel code audits, each re-checked by an independent adversarial verifier that re-ran the generator; 7 research lanes, each citation-checked. 118 findings adjudicated (117 upheld in whole or part, 1 refuted). Every number below was reproduced by running this generator, not inferred from reading it.

---

## 1. Executive summary

Both complaints are literally true, and neither is a matter of taste. The generator has a **resolution bug** and a **missing dimension**.

**The emotional flow problem is mostly one ordering bug.** `generateAdvancedProgression.ts` computes a cadence — it explicitly rewrites the final chord to the tonic so the phrase resolves — and then, on the very next line, truncates the array back to the requested length and throws that resolution away. At the settings the app ships with, **33.4% of generated progressions do not end on the tonic** (1,003 of 3,000 seeds). At complexity 3 it is 50.0%, and roughly one in ten ends on a bare passing diminished chord. The code computes the ending and then deletes it.

**The voicing problem is a missing dimension, not a tuning issue.** The voicing stage contains no randomness and no musical context at all. Over 6,000 generations at default settings the opening chord took **exactly two forms**, and one of them accounted for 93%. That chord — `[55,64,71,72]` = G3-E4-B4-C5 — is a Cmaj7 in *second inversion*, with the fifth in the bass. The app opens on an unstable voicing, almost every time, forever.

The analogy: the previous audit (`CHORD_ENGINE_AUDIT.md`, March) rebuilt the engine and fixed the suspension — and those fixes landed. What you are hearing now is that the car still has no steering wheel. There is no input anywhere in the system that means "make this one wistful," and the harmony sits in exactly the same posture whether it is the opening, the climax, or the cadence.

### The five highest-leverage facts

| # | Finding | Measured | Where |
|---|---|---|---|
| 1 | Cadence is computed, then truncated away | 33.4% of default generations never resolve | `generateAdvancedProgression.ts:673-693` |
| 2 | Default settings have ~2 random decisions | **24 distinct progressions exist**, ever | `generateAdvancedProgression.ts:618-639` |
| 3 | Voicing stage is fully deterministic | Opening chord identical in 93% of runs | `voiceLeading.ts:235-252` |
| 4 | No emotional parameter for chords at all | Melody has a 13-field mood model; chords have 0 | `advanced/types.ts:73-88` |
| 5 | "Rich" (5 voices) is **thinner** than "Standard" (4) | 3 distinct pitch classes vs 4; 7 candidates vs 14 | `voicing.ts:93-99` |

Finding 2 deserves emphasis. At the shipped defaults (C ionian, 4 chords, complexity 2) only two `random()` draws ever execute. Running the real generator over **20,000 seeds produced 24 distinct MIDI sequences**, the most common accounting for 10.1% of generations and the top three for 23.8%.

A user clicking Generate is drawing from a 24-card deck with replacement. Measured against that empirical distribution: a repeat is **92.0% likely within ten clicks**, and ten clicks surface only about **8.1 of the 24** progressions on average. Exhausting the deck is not the point — the point is that repetition starts almost immediately and the ceiling is 24.

---

## 1a. Implementation status

Phase 1 and part of Phase 2 have since been implemented on this branch. Measurements below are before → after, over 3,000 seeds per complexity at the store's own presets.

| # | Change | Before | After |
|---|---|---|---|
| 1 | Length cap moved before the cadence | 33.4% never resolve (50.0% at cx3) | **0.0% at every complexity** |
| 5 | Mode-aware dominant + scale-derived romans | dorian/phrygian/mixolydian emit out-of-scale notes and wrong labels | **every note in-scale; `IV` in dorian, `bII` in phrygian, `bVII` in mixolydian** |
| 2 | `voiceCount: 5` keeps the fifth | Cmaj7 → 3 pitch classes, 4 notes, no fifth | **4 pitch classes, 5 notes, fifth in every candidate** |
| 3 | Root-position bias at structural arrivals | final chord routinely a 6-4; opener a second inversion | **96.3% root-position endings, 92.7% openers** |
| 4 | Drop-2+4 added, inversion cap lifted | Cmaj7 → 14 candidates | **22 candidates, all four bass notes reachable** |
| 6 | `cadence: "open"` | every progression ends on I; axis progression unreachable | **half/plagal/deceptive endings reachable; `I-V-vi-IV` now generates** |

Aeolian deliberately keeps its raised (harmonic-minor) `v|E` — that is idiomatic, not a modal violation.

Covered by 16 regression tests in `advanced/__tests__/progressionQuality.test.ts`, **9 of which fail on the pre-fix code**. Full suite: 695 passing.

### Phase 3 (recommendations #7, #8, #9, #11)

| # | Change | Before | After |
|---|---|---|---|
| 7 | Best-of-8 with a whole-progression rubric | single pass; static bass in 26.4% of generations | **0.0% static bass, 2.5% frozen soprano** |
| — | Interior degree variation + tie-banded selection | 24 distinct progressions reachable | **64 distinct (2.7x)** |
| 8 | Tension and mood drive voicing register/density; seeded tie-breaking | voicing stage had no variation at all | opening voicing 93% → 82% identical |
| 9 | `ChordMood` profiles (dark/emotional/dreamy/energetic) | no emotional parameter for chords | **mood sets tension, register, density, rhythm, cadence** |
| 11 | Harmonic-rhythm profiles | 1-2 rhythms, every chord a full bar | even / anchored / accelerating / pedal-opening |

Generation now costs ~10.7ms versus ~1.4ms, and remains fully deterministic per seed.

One finding worth recording: best-of-N under a **strict argmax made variety worse**, cutting distinct outputs from 24 to 15, because scores cluster and the same few progressions kept winning. Quality rose and variety fell. The fix was two-part — widen the underlying plan space (interior variation within functional families) and treat near-equal candidates as tied — after which both moved in the right direction together.

### Phase 2 remainder and Phase 4 (recommendations #10, #12, #13, #14, #15)

Measured over 400 seeds at the store's own presets (C ionian, 4 chords, complexity 2, mood *emotional*), before → after.

| # | Change | Before | After |
|---|---|---|---|
| 15 | **Target-tension curve as the spine.** Six shapes (`phrase`, `arch`, `ramp`, `question`, `plateau`, `collapse`); the §5.2 per-chord formula (`0.40·functional + 0.20·chromaticism + 0.15·dissonance + 0.10·inversion + 0.15·voice-leading`) replaces the ad-hoc tension gates; slots are filled by distance to the target and scored against the same formula | the curve only gated extensions; nothing checked the chords followed it | **`collapse` opens off the tonic in >50% of runs, `plateau` puts its surge on the penultimate chord in >70%, `ramp` + open ending leaves >60% unresolved**; realised tension is judged by the planner's own formula |
| 12 | **Bass-line planner** in concrete pitches; `bass`/`inversion` on `VoicedChord` and `Chord`; slash labels on the cards | 16.0% of chords in second inversion, 6.6% as unmotivated 6-4s; bass static on 17.5% of chord changes; opening voicing identical in 83% of runs | **0.2% second inversions, every one a cadential, passing or pedal 6-4; static bass 0.5%; the planned bass pitch is realised on 100% of chords and a planned step is never voiced as a leap; identical opener 45%** |
| 10 | **Modal interchange keyed to brightness.** A 16-idiom catalogue derived per mode from the parallel modes (lydian +3 … phrygian −2), five brightness curves, one surprise per phrase, Picardy third | no borrowed chord reachable by generation | **31% of default generations carry one borrowed chord (dark 54%, energetic 66%, dreamy 21%); dark reaches bII/bIII/iv/ii°, dreamy II/#iv°, never more than one per four-chord phrase** |
| 14 | **Neo-Riemannian engine.** P/L/R/S/N/H/LP/PL, chromatic mediants offered from the previous chord, the transform's parsimonious voicing added as a candidate | distant triads unreachable | III, bVI, bvi and the hexatonic pole reachable; every transformed chord shares a held voice with its predecessor (the pole excepted, by definition) |
| 13 | **Bounded Viterbi voicing search** (beam 4, 16 candidates per chord) plus a Plomp-Levelt/Sethares roughness term | greedy chord-by-chord argmin | whole-progression paths; generation ~15ms versus ~10.7ms, still deterministic per seed |

Distinct outputs at the defaults: 57 per 1,000 seeds → 81 per 400.

Three design decisions are worth recording. First, the borrowed chord is deliberately singular: Cheung et al.'s result is that pleasure tracks *one* surprise against an otherwise predictable context, and an early version that let the catalogue fill any slot it fitted dissolved the key exactly as §3.6 warned. Second, the bass plan is a hard constraint on the voicer, not a bonus: with a bonus, the beam search overrode the planned bass on about 15% of chords whenever a smoother path existed, which put the pedal back. Third, the plan is made in concrete MIDI pitches, restricted to the bass pitches the chord's voicings can actually produce, not in pitch classes: a first version planned pitch classes and let the voicer choose the octave, so a "step down" from C to B♭ at the bottom of the range was realised an octave up as a leap of a seventh (review finding on seed 55), and a close voicing whose bass the spacing rule rejects would have been planned and then silently substituted.

Covered by 5 new module test files (70 tests), 18 further generator-level regressions in `progressionQuality.test.ts`, and a store test that keeps `bass`/`inversion` in step with note edits.

### Tendency tones in the upper voices — 2026-09-21

The open item above (§4.2, and the Harrison & Pearce voice-leading model in §5.1). The Viterbi transition cost took two bare MIDI arrays, so a leading tone or a chordal seventh in an inner voice went wherever smoothness sent it; the bass-line planner enforced "a seventh in the bass resolves down by step" and nothing enforced the same rule one voice higher. `advanced/tendencyTones.ts` now derives a **chord identity** per slot — root, harmonic function, dominant flag, pitch classes, the chordal seventh, and the chord it is *expected* to resolve to — and `searchVoicings` carries those identities into the transition cost. Four soft rules, each gated on the resolution actually being available in the next chord:

1. **The leading tone rises** a semitone in V, V7, vii°, an applied dominant, a tritone substitution or the raised seventh of a minor key. The classical licence survives: in an inner voice of a complete dominant seventh it may fall to the fifth of the tonic instead.
2. **The chordal seventh falls** a semitone or a whole tone to a tone of the next chord — or is simply held, which is no failure at all when the next chord contains it.
3. **The dominant tritone resolves in contrary motion.** In a tritone substitution the same two pitch classes do the same thing with the roles swapped: the spelled seventh is the tone that rises and the spelled third is the one that falls.
4. **A suspension falls** by step to its resolution.

Measured over 400 seeds per configuration at the store's own presets (four chords, mood *emotional*, `phrase` tension, `auto` brightness and voicing, four voices, C3–G5), before → after.

| Configuration | Leading tone rises (of those voiceable) | Chordal seventh falls or is held | Suspension falls | Dominant tritone contrary |
|---|---|---|---|---|
| C ionian cx1 | 100.0% → **100.0%** | 96.7% → **100.0%** | — | 50.0% → **100.0%** |
| C ionian cx2 | 100.0% → **100.0%** | 59.8% → **77.4%** | — | 100.0% → 100.0% |
| C ionian cx3 | 60.0% → **100.0%** | 65.2% → **72.5%** | 72.9% → **91.3%** | 100.0% → 100.0% |
| C ionian cx4 | 90.0% → **100.0%** | 64.3% → **72.5%** | 70.3% → **78.8%** | 100.0% → 100.0% |
| A aeolian cx2 | 100.0% → 100.0% | 83.1% → **88.5%** | — | 100.0% → 100.0% |
| A aeolian cx3 | 100.0% → 100.0% | 75.5% → **78.8%** | 83.6% → **85.0%** | 50.0% → **80.0%** |
| D dorian cx2 | 29.7% → **100.0%** | 69.7% → **78.9%** | — | 94.7% → **100.0%** |
| G mixolydian cx2 | 100.0% → 100.0% | 75.2% → **78.7%** | — | 100.0% → 100.0% |

And what it cost:

| Configuration | Mean voice-leading cost | Mean semitones moved per chord change | Chord changes with a leap > P5 | Distinct progressions per 400 seeds | ms per generation |
|---|---|---|---|---|---|
| C ionian cx1 | 0.62 → 0.62 | 8.45 → 8.43 | 0.0% → 0.0% | 36 → 38 | 6.7 → 6.6 |
| C ionian cx2 | 1.37 → 1.45 | 8.52 → **7.98** | 0.2% → 0.3% | 81 → 70 | 6.9 → 7.1 |
| C ionian cx3 | 1.86 → 1.87 | 8.62 → **8.30** | 0.9% → 0.7% | 261 → 263 | 7.1 → 6.8 |
| C ionian cx4 | 1.76 → 1.75 | 8.43 → **8.12** | 2.6% → 2.4% | 289 → 283 | 6.9 → 5.8 |
| A aeolian cx2 | 0.75 → 0.88 | 7.86 → 8.12 | 0.9% → 0.8% | 67 → 65 | 6.9 → 6.7 |
| A aeolian cx3 | 1.44 → 1.51 | 8.95 → 8.94 | 4.2% → 4.3% | 245 → 239 | 6.7 → 7.0 |
| D dorian cx2 | 1.08 → 1.08 | 8.03 → 8.10 | 0.1% → 0.2% | 76 → 87 | 6.4 → 7.2 |
| G mixolydian cx2 | 0.83 → 0.85 | 7.60 → 7.73 | 0.0% → 0.3% | 80 → 81 | 7.0 → 7.2 |

The headline is the second column of the first table and the third of the second: sevenths discharge far more often, and **total voice motion per chord change went down, not up** — resolving a seventh by step is usually the smoothest thing that voice could have done, it simply was not what the geometry happened to pick.

The term is charged at **weight 2.0** against a unit penalty (1.0 for a stranded seventh, 1.6 for a leading tone left hanging in the top voice, 0.25 for one the chord of resolution absorbs, 0.15 for the classical frustrated one, 1.2 for a suspension, 0.6 for a half-resolved tritone). The weight was swept from 0 to 30, with 0, 1.5, 2 and 3 re-measured at 400 seeds across all eight configurations:

- **from 1.5 upward** every voiceable leading tone is taken, in every configuration — that part saturates early;
- **1.5 → 2** is free: at C ionian cx2 the mean cost moves 1.44 → 1.45, leaps over a fifth 0.2% → 0.3%, motion 7.99 → 7.98, while suspensions at cx3 go 82.6% → **91.3%**;
- **2 → 3** is where the price appears: four more points of seventh resolution (77.4% → 81.4%) for mean cost 1.45 → 1.56, motion 7.98 → 8.11 and leaps over a fifth 0.3% → **1.2%**, a fourfold rise.

Two is the knee. For scale, `COST_TIE_BAND` is 0.5 and one extra semitone in one voice is worth about 0.25, so an unresolved seventh costs roughly four extra semitones of motion spread across the chord: decisive when the alternatives are close, overridable when they are not.

Three findings worth recording. First — and this is the real ceiling — **the voicing vocabulary, not the search, is what limits the leading tone**. At four voices a seventh chord is voiced as one of each tone, so a root-position `Imaj7` has its only C in the bass and no upper voice can rise into it; in A aeolian just 11.5% of the owed leading tones are voiceable at all, which is why that row moves in the seventh column and not the first. Where a rise is voiceable the search now takes it every time, including on deceptive motion. Second, a leading tone the chord of resolution owns in its own right — `V7` into `Imaj7`, where the leading tone *is* the major seventh — is not a failure; charging it as one is both unmusical and unwinnable, so it carries a 0.25 nudge rather than the full cost, and the joint tritone charge is waived. Third, the term is kept **out of the reported `voiceLeadingCosts`**: the whole-progression rubric reads those numbers to compare eight chord *plans*, and a plan that contains a dominant can owe a resolution no voicing is able to take, so leaving the term in charged the plan for containing a dominant at all — measured, the share of default generations carrying a dominant fell from 47.8% to 37.0%, against 39.5% with the term confined to the voicing search where it belongs. (Some of that remaining 8-point drop is the rubric's tie band redistributing: the dominant-bearing draws' mean score rose from 7.106 to 7.122 while the dominant-free ones rose further, from 7.033 to 7.106, so they win more ties. The field got better; the ranking tightened.)

A caveat on denominators. The tritone column counts only dominant sevenths whose leading tone the chord of resolution does not absorb, which in C major is rare — 1 to 5 events per 400 seeds, so those cells carry almost no weight; D dorian (19 → 23) and G mixolydian (34 → 35) are the substantive ones. The same applies to the leading-tone column at C ionian cx2 (n = 4): the rows that matter there are cx3, cx4 and D dorian, where n runs from 13 to 151.

Two examples, same seed and the same chords in both, where only the voicing moved:

```
seed 11, C ionian cx2    I Cmaj7       iii Em7       ii Dm7        I Cmaj7
before                   48 59 64 67   52 59 62 67   50 60 65 69   48 55 64 71
after                    48 59 64 67   52 59 62 67   50 60 65 69   48 59 64 67
```

Only the last chord differs. `ii7`'s seventh, the C4 at 60, had nowhere to go into `48 55 64 71`: no B3 was voiced and the tonic chord does not contain a C above the bass either. It now falls a semitone onto the B3 at 59, which is the same `Cmaj7` spelled as C3–B3–E4–G4.

```
seed 42, D dorian cx2    i Dm7         v Am7         ii Em7        i Dm7
before                   50 60 65 69   57 60 64 67   52 62 67 71   50 57 65 72
after                    50 60 65 69   57 60 64 67   52 62 67 71   50 60 65 69
```

Again only the last chord: `Em7`'s seventh, the D4 at 62, was stranded in `50 57 65 72` and now falls a whole tone onto the C4 at 60.

The snapshot in `__snapshots__/advancedGenerator.test.ts.snap` was **not** regenerated — that configuration (complexity 3, `drop2`, C3–C5, seed 123) produces byte-identical voicings with the term on.

Covered by `advanced/__tests__/tendencyTones.test.ts` (26 unit tests over the identity derivation and the penalty's rules and exceptions) and 15 further generator-level regressions in `progressionQuality.test.ts`, including one that pins the pentatonic path to byte-identical output and one that fails on the pre-change code for every complexity from 2 up.

Still open: the corpus-fitted 12-feature weight vector is adopted only for its roughness term; the remaining weights stay hand-tuned. The voicing vocabulary is now the binding constraint on the leading tone (§4.1) — a root-doubled, fifth-omitted shape for seventh chords at four voices would lift the ceiling the table above runs into, and is the natural next step. The pentatonic path takes the tension shapes and the bass plan but, by design, no borrowed harmony and no tendency rules: it has no leading tone, no functional dominant, and its sevenths are scale tones of sus chords rather than dissonances that owe anything.

---

## 2. How the generator works today

`generateAdvancedProgression()` (696 lines) runs one linear pass:

1. **Seed** a PRNG (`createSeededRandom`, line 618).
2. **Pick a template** from one of two pools of 15 four-chord degree arrays (line 627). `MAJORISH_TEMPLATES` for ionian/mixolydian, `MINORISH_TEMPLATES` for everything else.
3. **Adapt length** (`adaptLength`, 129-150) — returns immediately when the template already matches the requested length, which at the default of 4 chords it always does.
4. **Build diatonic chords** (`buildDiatonicChordPlan`, 263) — triad or seventh from the scale, plus complexity-gated extensions.
5. **Insert chromatic chords** — secondary dominants, tritone subs, passing diminished, suspensions (664-667).
6. **Clamp chromatic density** (670).
7. **Force a tonic cadence** (673-691).
8. **Truncate to the requested length** (693).  ← *the bug*
9. **Voice each chord** (`voicePlannedChords`, 423-490) — generate candidates, pick the cheapest by voice-leading cost, greedily, left to right.

Steps 7 and 8 are in the wrong order. Steps 1-8 decide *which* chords; step 9 decides *how they sound* — and step 9 receives none of the information steps 1-8 produced.

---

## 3. Diagnosis: why progressions lack emotional flow

### 3.1 The resolution is computed and then discarded — *critical*

`generateAdvancedProgression.ts:673-693`. The cadence heuristic reads `planned[planned.length - 1]` of the **grown** array and rewrites it to the tonic. Then `limitLength` (345-348) runs `chords.slice(0, maxLength)`, discarding the tail — including the tonic that was just installed.

The verifier confirmed this is not merely correlational but the *only* possible cause of a non-tonic ending: the passing, suspension and secondary-dominant passes all insert their chord *before* the following chord, so none can ever land last; and the final diatonic chord carries `isProtected=true` (647), so the tritone-sub and density passes skip it. **Every non-tonic ending is a truncation artifact.**

Measured over 3,000 seeds per complexity, using the store's own presets (`complexityToOptions`, `progressionStore.ts:140-173`) at C ionian, n=4. "Non-tonic" counts any progression whose final chord is not labelled `I` — stricter than checking the root pitch, since a passing diminished rooted on C is not a tonic arrival:

| Complexity | Non-tonic endings | Notable endings |
|---|---|---|
| 1 | 0% | (no substitutions run) |
| 2 | **33.4%** | IV (409), vi (397), ii (197) |
| 3 | **50.0%** | `pass°` (10.9%), V (7.1%), IV (6.1%), vi (5.9%) |
| 4 | **47.6%** | `pass°`, tritone subs |
| A aeolian, n=8, c3 | **86.1%** | — |

Two reproducible examples at store defaults: seed 5 → `I-Cmaj7 | V-G7 | V/IV-C7 | IV-Fmaj7`; seed 24 → `I-Cmaj7 | IV-Fmaj7 | V/ii-A7 | ii-Dm7`. Neither resolves. Both also spend a user-requested chord slot on a chromatic insertion, so the template's own ending never sounds.

**This is the largest available improvement in the codebase.** The reordering is the bulk of it, but reordering alone is not sufficient: once truncation runs first, the final slot can hold an inserted `pass°` or suspension, and the heuristic's `kind === "diatonic" || kind === "functional-substitution"` guard skips exactly those. The guard has to go too, so the cadence rewrites whatever chord ends up last. With both halves applied, the non-tonic rate is 0.0% at every complexity.

### 3.2 The forced cadence erases every ending that isn't a full stop — *critical*

Even when the truncation doesn't fire, the cadence heuristic (672-691) overwrites *any* non-tonic diatonic final chord with I. `MAJORISH_TEMPLATES` ends on degree 0 in only **3 of 15** cases; `MINORISH_TEMPLATES` in 4 of 15. So 12 of 15 major templates are rewritten.

The consequence is stark: the axis progression the pool explicitly seeds at line 60 — commented `// I - V - vi - IV (pop/axis progression)` — **can never be produced.** It always comes out I-V-vi-I. Half cadences, deceptive cadences, plagal endings and loop-friendly open endings are all structurally unreachable. Every progression lands on the same full stop, which is exactly what "no emotional flow" sounds like. Notably, the code that would fix the resulting doubled-tonic cases already exists — `resolvePentatonicDegrees` (507-541) — but only on the pentatonic path.

### 3.3 There is no emotional control surface for chords — *critical*

`AdvancedProgressionOptions` (`advanced/types.ts:73-88`) has 14 fields: key, mode, length, complexity, voicing style, voice count, range, five substitution booleans, seed. **None is affective.**

Meanwhile `MoodProfile` (`melody/moods.ts:19-46`) declares **13 fields** — `registerCenter`, `registerSpan`, `contourWeights`, `rhythmDensity`, `syncopationChance`, `restChance`, `pickupChance`, `maxLeap`, `leapChance`, `nctDensity`, `nctPalette`, `tensionScale`, `longNoteBias` — and `app/page.tsx:872-881` exposes mood as a first-class user control **for melody only**.

So the melody can be told to sound dreamy and the chords underneath it cannot. To get "wistful" harmony today, a user's only options are to change mode and toggle chromatic switches until something lands.

### 3.4 The phrase plan is computed and then ignored — *high*

`phraseRoles` is assigned at line 622 and **never read**. `PlannedAdvancedChord.phraseRole` is never assigned. Tension comes from `TENSION_CURVES` (`phraseStructure.ts:23-31`), a 7-row lookup keyed only by chord count — so tension is a function of *position*, not of *harmony*.

The musical consequence is backwards: in template `[0,4,5,3]` the actual dominant (V, index 1) receives tension 0.3 while the vi (index 2) receives 0.8. Extensions and chromatic insertions therefore pile onto the submediant and skip the dominant — the one chord that wants tension is starved of it.

At the default 4 chords the role machinery does nothing at all, because templates are already length 4 and `adaptLength` returns early (line 136).

### 3.5 Harmonic rhythm is effectively constant — *critical*

Every diatonic chord is hardcoded `durationClass: "full"` (line 339; pentatonic at 593). Measured over 3,000 seeds: complexity 1 yields **one** rhythm (`full,full,full,full`, 3000/3000); complexity 2 yields **two**. Chord changes land on a metronomic one-per-bar grid. Nothing can linger, breathe, or push into a cadence — and harmonic acceleration into a cadence is one of the primary drivers of felt motion.

### 3.6 No modal interchange exists — *critical*

Over 6,000 chords at complexity 4 in C, the engine emits exactly **39 distinct symbols**, every one of which is diatonic to C, a dominant 7th a fifth/tritone away, or a symmetric dim7. There is no Fm, no Ab, no Bb major, no augmented chord — the entire emotional vocabulary of borrowed harmony (iv in major, bVI, bVII, bIII, Neapolitan, Picardy third) is unreachable by automatic generation.

Borrowed-chord code *does* exist at `lib/creative/substitutionEngine.ts:278-313` (`category: "modal-mixture"`), but it is reachable only by manually clicking Substitute on a chord.

### 3.7 Modal correctness bugs — *critical*

Two independent defects make three of the six modes misrepresent themselves:

- **Degree 4 is force-converted to major/dominant in every mode** (line 279: `const isDominant = degreeIndex === 4 || ...` — no mode parameter). Since degree 4 appears in 14 of 15 major templates, this fires constantly. Live output: G mixolydian emits `D-F#-A` (F# is not in G mixolydian); D dorian emits `A-C#-E` (C# is not in D dorian); E phrygian emits `B-D#-F#` where the real chord is B diminished.
- **Roman numerals come from two hardcoded tables for five modes** (52-53). Dorian's signature major IV displays as `iv`; phrygian's bII displays as `ii°`. The label describes a different chord than the one sounding — actively misleading on a teaching surface.

---

## 4. Diagnosis: why the voicing is limited

### 4.1 The entire voicing vocabulary is five octave shifts — *critical*

`applyStyle` (`voicing.ts:200-238`) is the only shape generator in the codebase, it has exactly one call site, and every branch is a hardcoded ±12 on a fixed index of a sorted stacked-thirds spine. There is no quartal, rootless, shell, cluster, or upper-structure implementation anywhere. `selectTones` can never remove the root, 3rd or 7th (the omission loop `break`s at line 79).

Empirically, the complete shape vocabulary for Cmaj7 at 4 voices is **three closed shapes plus their drop/spread derivatives**. There is no mechanism in this codebase capable of producing the voicings that make a progression sound *arranged* rather than *spelled*.

### 4.2 The voicing stage is deterministic and context-free — *critical*

Neither `voicing.ts` nor `voiceLeading.ts` imports, accepts, or calls a random source — `grep -n random` over both returns nothing. `pickBestVoiceLedCandidate` (`voiceLeading.ts:235-252`) is a strict-`<` argmin, so ties always go to the first candidate in generation order.

Over 6,000 default generations: the opening chord was `[55,64,71,72]` 5,575 times and `[55,64,69,72]` 425 times — **nothing else**. Cmaj7 received 6 distinct voicings across 10,007 appearances; Em7 and A7 received exactly one each.

Worse, the cost function **cannot see chord identity**. Both entry points take bare MIDI arrays (`calculateVoiceLeadingCost(previous: number[], next: number[])`, line 154). No root, quality, `isDominant`, phrase role or tension reaches it. `grep -niE "leadingtone|tendency|resolution"` over the file exits with no matches.

To be precise about what follows: the seven cost terms (smoothness, bass motion, common tones, parallels, crossings, span, contrary motion) do distinguish many pairs of voicings, so two candidates with equal total motion rarely score *identically*. The defect is that **none of those terms knows a leading tone from any other note**. A V-I where the leading tone falls to the 5th is therefore preferred whenever its aggregate geometric score happens to be lower — nothing in the objective can recognise a correct resolution *as* a resolution, or pay anything to obtain one. Every dominant in the app is voiced by geometry alone.

### 4.3 Nothing enforces root position at a cadence — *critical*

Because selection is an unguarded argmin with no positional argument, the voicer does not know which chord index it is voicing. The resolution heuristic in §3.2 only forces the last chord's **root** — never its **bass**.

Re-running I-vi-ii-V-I in C at shipped defaults produces bass notes `55, 55, 53, 55, 55` — an almost unbroken G pedal — and a final tonic of `[55,60,64,71]` = **Cmaj7/G**. The ear hears one sustained sonority with the middle voices wiggling, and the final I never lands.

### 4.4 There is no bass line — *high*

A repo-wide search for a bass generator finds nothing. The only bass concept is `Math.min(...voicing)` scored pairwise by `scoreBassMotion` (127-137), which folds the interval with `% 12` — so it **cannot tell a step from a ninth leap**, and an exact octave leap scores as "static." The verifier added the decisive detail: the bass term is weighted 0.20 with a range of −3..5, so it can move total cost by at most ±1.0, while the raw voice-leading term routinely reaches 5-7. **Bass quality is numerically outvoted by minimum motion** — which is precisely the mechanism producing the pedal in §4.3.

### 4.5 "Rich" is thinner than "Standard" — *high, and a user-facing defect*

`app/page.tsx:56-60` labels `voiceCount: 5` as **"Rich."** For any seventh chord, `selectTones` splices out the perfect fifth (94-99), then the fill loop adds one root doubling and `break`s — returning `[0,0,4,11]`, four tones with **three distinct pitch classes**.

Direct measurement on Cmaj7 over the shipped range: voiceCount 4 → **14 candidates**, 4 distinct pitch classes, all containing G. voiceCount 5 → **7 candidates**, 3 distinct pitch classes, **zero containing G**. Plain triads return byte-identical candidates at 4 and 5.

A user reaching for more body gets a doubled root, a 3rd and a 7th with no fifth, and half the voicing vocabulary. It is the exact opposite of the label, and it is the first thing a frustrated user would try.

### 4.6 Inversions exist but have no policy — *high*

This one correction matters: inversions **are** produced (both drop2 and drop3 yield 7th-in-bass voicings, and both are in the `auto` pool). What is missing is *policy and semantic labelling*, not the capability, and not persistence either.

Be careful not to overstate this. The realised voicing round-trips perfectly well today: `progressionStore.ts:249` stores `midiNotes: voiced.midi`, so the exact bass note survives; `shiftNote` (319-339) edits those notes from the piano roll; locked chords are carried through regeneration wholesale (219 plus the merge at 256-259); and favourites serialise the whole progression. A user can already author and keep a specific bass note by hand.

What is missing is that no layer *knows* what it is looking at. Neither `VoicedChord` nor the canonical `Chord` (`progressionTypes.ts:6-22`) carries a `bass` or `inversion` field, so the generator cannot plan a bass line, the UI cannot label a chord as a 6-4 or render a slash symbol, and nothing can reason about inversion when substituting. `inversionLimit` is also capped at 2 (line 325) and no beat/cadence/bass rule exists. Recommendation #12 adds planning and labelling — it does not restore a capability the product lacks.

### 4.7 Voicing never varies across the phrase — *high*

`voicePlannedChords` (436-443) passes only `style`, `voiceCount` and range into the voicer. Phrase role, tension level and cadence status never arrive. Every chord is voiced by identical rules, so there is no sparse opening, no dense climax, no registral arc. By contrast the melody engine's `contour.ts` gives **every beat** a register target.

### 4.8 The architectural asymmetry

`generateMelody.ts:49,68,73-110` draws `candidateCount ?? 8` whole melodies, scores each, and keeps the argmax. `generateAdvancedProgression` runs **one pass and never compares alternatives**. A grep for `score` across `advanced/` returns only two local gates (`scoreSecondaryDominantInsertion`, `scoreBassMotion`) — there is no whole-progression rubric.

The melody engine gets eight throws of the dice and keeps the best. The harmony gets one, and whatever it produces — including the bad draws — is what you hear.

---

## 5. What the research says

Every technique below is deterministic and needs no ML runtime. Citations were independently verified; corrections noted where the first-pass research misstated a formula.

### 5.1 Voicing — the direct answer to complaint #2

**Drop-voicing family** (*small effort, ~16× vocabulary*). Given an ascending close voicing `[n0,n1,n2,n3]`, counting voices from the top down: drop 2 = `sorted([n2-12, n0, n1, n3])`; drop 3 = `sorted([n1-12, n0, n2, n3])`; drop 2+4 = `sorted([n0-12, n2-12, n1, n3])`. Applied to each of four inversions this yields **16 voicings per seventh chord** (close < an octave; drop 2 ≈ a tenth; drop 3 ≈ a twelfth; drop 2+4 ≈ two octaves). Ten lines of code, no new theory. — [tonal voicing-dictionary](https://raw.githubusercontent.com/tonaljs/tonal/main/packages/voicing-dictionary/data.ts)

**Jazz voicing dictionary** (*small*). Interval templates as candidate seeds — rootless Type A/B, shells, quartal. Verified: m7 A = `[3,7,10,14]`, B = `[10,14,15,19]`; dom7 A = `[4,9,10,14]` (13th replaces the 5th), B = `[10,14,16,21]`; maj7 A = `[4,7,11,14]`, B = `[11,14,16,19]`. Quartal = stacked fourths `[0,5,10,15]`; the "So What" voicing is `[0,5,10,15,19]`. Rootless voicings put the colour tones where they are audible instead of buried. — [@tonaljs/voicing](https://github.com/tonaljs/tonal/tree/main/packages/voicing)

**Upper-structure triads over altered dominants** (*small*). Guide-tone shell `[root+4, root+10]` in the low-middle, plus a major triad above: +2 semitones → 9/#11/13; +3 → #9; +6 → b9/#11 (fully altered). A plain root-position V7 is the flattest chord a generator can emit; this is the fix. — [The Jazz Piano Site](https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/upper-structures/)

**Viterbi DP over the whole progression** (*medium*). `C[t][s] = emit(s) + min_{s'}(C[t-1][s'] + trans(s', s))`, with hard constraints encoded as `Infinity` so they compose with soft costs. For 8 chords × ~400 candidates that is ~1.28M evaluations — a few milliseconds in the browser with memoized `trans()`. Fully deterministic, so seeded reproducibility survives. — Harrison & Pearce, [*A Computational Cognitive Model for the Analysis and Generation of Voice Leadings*](https://online.ucpress.edu/mp/article/37/3/208/110120/A-Computational-Cognitive-Model-for-the-Analysis) (2020); [voicer](https://github.com/pmcharrison/voicer)

**A corpus-fitted 12-feature cost function** — available verbatim, replacing hand-tuned weights: `hutch_78` (roughness) −8.653; `any_parallels` −2.489; `outer_parallels` −2.323; `diff_num_notes` −1.321; `part_overlap` −0.669; `vl_dist` −0.375; `melody_dist` −0.240; `dist_above_top` −0.237; `dist_below_bottom` −0.173; `dist_from_middle` −0.128; `exposed_outer_octaves` +0.204; `change_num_notes` +0.008. Note the shape of these weights: **roughness outweighs voice-leading distance 23:1**. Harmonia currently optimises almost exclusively for the latter.

> ⚠️ **Correction:** the research pass proposed a Plomp-Levelt/Sethares roughness term but dropped the scaling constant — the correct parametrisation is `d = exp(-b1·s·df) - exp(-b2·s·df)` with `s = x*/(s1·f_min + s2)`. It also cross-swapped the canonical passing and pedal 6-4 examples. Use the cited sources, not the summary.

**Two-hand register split & parameterised presets** (*medium*). Impro-Visor ships five presets as pure numeric parameter sets (Shell, Quartal, Open-Low, Closed-High, Default), each with independent LH/RH bounds, spreads and note counts — e.g. Default uses LH 46-55 (narrow low band, 1-2 notes) against RH 60-81 (wide upper band, 1-4 notes). One generator plus five parameter sets yields five audibly distinct textures. — [Impro-Visor voicings](https://github.com/Impro-Visor/Impro-Visor/tree/master/voicings)

### 5.2 Emotional flow — the direct answer to complaint #1

**Two-stage valence/arousal disentanglement.** EMO-Disentanger's central finding: do *not* condition one generator on all four emotion quadrants at once. Stage 1 generates harmony conditioned on **valence** only; stage 2 takes that as fixed and generates performance (articulation, tempo, velocity) conditioned on **arousal**. This beat single-stage conditioning on both objective and subjective evaluation. It maps cleanly onto Harmonia's existing plan-then-voice split. — Huang, Chen & Yang, [arXiv:2407.20955](https://arxiv.org/abs/2407.20955); [EMOPIA](https://arxiv.org/abs/2108.01374)

**Target-tension curve planner.** Assign every slot a target from an explicit curve, then choose chords by minimising distance to it:

```
arch      t[i] = sin(PI * i / (n-1))         depart, peak, return
ramp      t[i] = i / (n-1)                   relentless build
question  half 1 peaks 0.6 ending 0.6 (HC); half 2 ends 0.0 (PAC)
plateau   0.2 until n-2, then 0.9, then 0.0  stillness then one surge
collapse  t[i] = 1 - i / (n-1)               start at maximum, decay
```

with a deterministic per-chord score:
`tension = 0.40·functional + 0.20·chromaticism + 0.15·dissonance + 0.10·inversionInstability + 0.15·voiceLeadingDistance`
where functional = tonic 0.00, mediant/submediant 0.25, pre-dominant 0.50, dominant 0.85, applied dominant 0.95, aug6/Neapolitan 1.00. — Herremans & Chew, [*MorpheuS*](https://arxiv.org/abs/1812.04832); [*Tension ribbons*](https://dorienherremans.com/sites/default/files/paper_tenor_dh_preprint_small.pdf)

**Modal-interchange catalogue keyed to brightness.** Order the parallel modes Lydian +3 > Ionian +2 > Mixolydian +1 > Dorian 0 > Aeolian −1 > Phrygian −2 > Locrian −3, tag each borrowed chord with its source mode's brightness, and select against a `brightnessTarget[]` curve ('steady' | 'darkening' | 'sunrise' | 'arch' | 'collapse'):

| Borrowed | Source | Brightness | Affect |
|---|---|---|---|
| II, #iv° | Lydian | +3 | lift, sparkle |
| bVII, v | Mixolydian | +1 | epic, anthemic (bVII-IV-I = double plagal) |
| major IV in minor | Dorian | 0 | hopeful shade of minor |
| **iv in major** | Aeolian | −1 | bittersweet, yearning (IV-iv-I) |
| bVI, bIII | Aeolian | −1 | cinematic (bVI-bVII-I = "heroic") |
| bII | Phrygian | −2 | darkest; strong half-step descent |
| V7b9, vii°7 | harmonic minor | — | operatic urgency |

Plus the **Picardy third** (minor progression ending major) as an explicit high-valence closure move.

**Neo-Riemannian engine** — the one mechanism that fixes both complaints at once, because each transform *names which voice moves and by how much*, producing optimal voice leading with **zero search**:

```
P (parallel):     (r,maj)->(r,min)     third moves 1    2 common tones  cost 1
L (leittonwechsel):(r,maj)->(r+4,min)  root down 1      2 common tones  cost 1
R (relative):     (r,maj)->(r+9,min)   fifth up 2       2 common tones  cost 2
S (SLIDE)=LPR:    (r,maj)->(r+1,min)   root+fifth by 1  1 common tone   cost 2
N (nebenverw.)=RLP:(r,maj)->(r+5,min)                   1 common tone   cost 2
H (hex. pole)=LPL:(r,maj)->(r+8,min)                    0 common tones  cost 3
LP: (r,maj)->(r+4,maj) cost 2    PL: (r,maj)->(r+8,maj) cost 2   (chromatic mediants)
```

— [music21.analysis.neoRiemannian](https://raw.githubusercontent.com/cuthbertLab/music21/master/music21/analysis/neoRiemannian.py); Lehman, [*Hollywood Harmony* ch. 3](https://music.arts.uci.edu/abauer/3.1/notes/Frank_Lehman_Hollywood_Harmony_Chapter_3_(2018).pdf)

**Cadence choice as an emotional control.** Smit et al. measured signed cadence coefficients: major cadences are substantially higher-valence than minor (the largest effect after pitch height); **half and deceptive cadences are more arousing than authentic**; plagal is weakly negative on valence; a dissonant tetrad on the final chord is weakly negative. Practically: treat cadence type as the *arousal/closure* control and mode plus register as the *valence* controls. — [Smit et al. 2020](https://journals.sagepub.com/doi/pdf/10.1177/2059204320938635)

**Mode ordering — use the measured order, not sharpness.** Temperley & Tan's empirical happiness ranking is Ionian > Mixolydian > **Lydian** > Dorian > Aeolian > Phrygian. Lydian is *less* happy than Ionian despite being brighter by sharpness, so do not compute valence as a monotonic function of raised degrees. — [Temperley & Tan 2013](https://davidtemperley.com/wp-content/uploads/2015/11/temperley-tan.pdf)

**Surprise is the mechanism, and it has a shape.** Cheung et al. found pleasure is driven by the *interaction* of uncertainty and surprise, not either alone — low-uncertainty contexts reward high-surprise events and vice versa. The practical rule: engineer **one** surprise per phrase against an otherwise predictable context, rather than spreading chromaticism evenly (which is what `validateChromaticDensity` currently does). — [Cheung et al. 2019](https://www.sciencedirect.com/science/article/pii/S0960982219312588); [Gold et al. 2019](https://www.jneurosci.org/content/39/47/9397)

**Prolongation and harmonic rhythm.** Slow/static harmonic rhythm reads as anchored and spacious; fast reads as urgent; **accelerating into a cadence reads as intensification**. Mechanisms: arpeggiation `[I, I6, I]`, passing 6/4 `[I, V6/4, I6]`, neighbour 6/4 `[I, IV6/4, I]`, and pedal points. Harmonia already carries `durationClass` and aligns the piano roll to it, so this is a planner change, not a data-model change.

> ⚠️ **Corrections applied:** the research pass misstated the minor-key PAC (it requires a *major* dominant), listed a wrong negative-harmony pair (`G#↔A#`), got one hexatonic-cycle claim wrong, and mis-scaled several composite tension weight sets (one summed to 1.043, not 1.0). 2 of 100 citations were fabricated outright and 14 mischaracterized — all excluded above.

### 5.3 What comparable tools do

Scaler, Captain Chords and Hookpad all ship **mood/genre presets as bundles** — a mood is a tuple of (scale, voicing preset, voice count, register, motion bias), not a chord list. That is the translation layer between what users say ("sad," "epic") and what a generator needs. It is also the cheapest possible version of §5.2 and fits Harmonia's existing options object directly.

---

## 6. Recommendations

Ranked by impact per hour of work.

| # | Change | Fixes | Effort | Impact |
|---|---|---|---|---|
| 1 | **Move `limitLength` before the cadence heuristic, *and* let the cadence rewrite a non-diatonic final chord** | 33-50% of progressions never resolving | **S** | Transformative |
| 2 | **Fix `voiceCount: 5`** so "Rich" adds a voice instead of deleting the fifth | user-facing defect | **S** | High |
| 3 | **Cadence-aware voicing**: pass chord index + a root-position bonus into selection | final chord never lands; the G pedal | **S** | Transformative |
| 4 | **Drop-voicing family + jazz dictionary** | voicing vocabulary (~16×) | **S** | Transformative |
| 5 | **Honour mode**: make `isDominant` mode-aware; derive romans from the scale | dorian/phrygian/mixolydian broken + mislabeled | **S** | High |
| 6 | **Allow open/deceptive endings**: make the tonic cadence a *policy*, not a rewrite | every progression is a full stop | **S** | High |
| 7 | **Best-of-N with a progression rubric** (mirror `generateMelody`) | one-shot draws; 24-item output space | **M** | Transformative |
| 8 | **Pass phrase role + tension into voicing**; animate register/density/spacing | no arc; static texture | **M** | Transformative |
| 9 | **Mood presets as bundles** → a `MoodProfile` for chords | no emotional control at all | **M** | Transformative |
| 10 | **Modal interchange catalogue** keyed to a brightness curve | no borrowed harmony | **M** | High |
| 11 | **Harmonic rhythm profiles** + prolongation/pedal | metronomic one-per-bar grid | **M** | High |
| 12 | **Bass-line planning layer**; add `bass`/`inversion` to `Chord` | no bass line; inversions unlabelled | **M** | High |
| 13 | **Viterbi DP + the 12-feature weight vector** | greedy local choices | **M** | Medium |
| 14 | **Neo-Riemannian engine** for chromatic mediants | distant triads unreachable | **M** | Medium |
| 15 | **Target-tension curve planner** as the spine | ties 8-14 into one shape | **L** | Transformative |

**On ordering:** #13 is deliberately *not* near the top. The verifier's judgement is worth quoting — with `numChords` defaulting to 4 and a purely local objective, a DP pass over the *same* cost function would change very few outputs. **Greedy is not the binding constraint; the objective is.** Fix what the cost function can see (#3, #8) before making the search smarter.

### Suggested sequencing

- **Phase 1 — bugs (a day).** #1, #2, #5. These are defects with measured user-visible symptoms, not design changes. #1 alone converts a third of your generations from "stops" to "resolves."
- **Phase 2 — voicing vocabulary (a few days).** #3, #4, #12. This is the shortest path to complaint #2, and #4 is ten lines of index arithmetic for a ~16× vocabulary increase.
- **Phase 3 — the control surface (a week+).** #6, #7, #9, #11. Best-of-N (#7) is the structural fix for sameness and reuses an architecture already proven in this repo.
- **Phase 4 — the spine (longer).** #8, #10, #14, #15. A target-tension curve is what makes richer vocabulary add up to a *shape* rather than more noise.

Existing snapshot tests in `advanced/__tests__/__snapshots__/` are a usable regression harness throughout — regenerate once per phase and they lock the new behaviour.

---

## 7. Appendix

### 7.1 Refuted

**"The cost function actively rewards a frozen top voice"** — *refuted on mechanism.* A frozen soprano forfeits the contrary-motion bonus, because line 198 requires `sopranoDirection !== 0`. The arithmetic: freezing saves 1 smoothness unit (0.25 weighted) plus one common tone (−0.30) = 0.55, but gives up a flat −2. A soprano moving a whole step contrary to the bass is **1.45 cheaper** than a frozen one. The *structural* half stands — there is no soprano arc, climax or register goal anywhere — but the diagnosis was backwards.

### 7.2 Notable corrections to the audit

- **Inversions are not missing** (§4.6). Both drop2 and drop3 routinely produce 7th-in-bass voicings at shipped defaults. The gap is policy and metadata.
- **Pentatonic does not share the two template pools.** It routes to `generatePentatonicProgression` (562-600) with its own vocabulary — 9 distinct shapes at n=4 vs 14 (ionian) and 13 (aeolian).
- **Modes sharing a template pool do not sound identical.** Roman-label sets are byte-identical between ionian/mixolydian, but chord *symbols* differ because `getScaleDefinition` supplies real modal pitch classes — though only 2 of 14 n=4 shapes actually differ.
- **Degree 6 in major is reachable**, but only at n≥7 (440/3000 seeds at n=8; 0/3000 at n≤6).
- The truncation defect is **worse** at larger settings: A aeolian n=8 c3 measures 86.1%.

### 7.3 Method and limits

Findings were produced by 9 independent audits, then re-checked by adversarial verifiers instructed to refute. Verifiers re-executed the generator via `tsx` over 600-30,000 seeds per configuration and reproduced the quantitative claims independently; several severities were raised or lowered on that evidence. I then re-ran the headline measurements myself against the store's own complexity presets: the 33.4% non-tonic rate, the 24 distinct MIDI sequences, the 93% identical opener and the 1-2 harmonic rhythms all reproduce exactly. Research citations were checked by fetching each URL and searching each title.

**Not examined:** the Sketchpad harmonic-planning path, `lib/creative/` beyond its interaction with the generator, and audio rendering below the scheduling layer. **Not verified:** the emotional characterisations in §5.2 are reported from the cited literature, not independently replicated. The corpus-statistics research lane timed out and was not replaced, so published transition matrices (McGill Billboard, Hooktheory) remain an open avenue — relevant to #7's rubric.

**Baseline at time of writing:** 688 tests pass. The 3 failing test files are all in `_deferred/` and match the pre-existing issues documented in `CLAUDE.md`.
