# Harmonia Chord Progression Engine — Deep Audit & Redesign Plan

**Date:** 2026-03-13
**Scope:** Full analysis of `lib/music/generators/advanced/`, `lib/theory/`, `lib/audio/`, and `lib/state/progressionStore.ts`

---

## 1. Executive Summary

After a thorough code review of every file in Harmonia's chord progression pipeline, I've identified **six root causes** that explain the majority of the poor-sounding output:

1. **`buildStackedVoicing` duplicates entire chord tones across octaves** — a 4-voice triad gets built as `[C3, E3, G3, C4]` or worse `[C3, E3, G3, C4, E4]` for 5 voices, producing doubled triads that sound thick, organ-like, and harmonically rigid.

2. **No voice-leading awareness in voicing generation** — candidates are generated purely from mechanical stacking + inversions. There are no rules for common-tone retention, stepwise motion, or contrary motion. The `pickBestVoiceLedCandidate` function only minimizes total semitone distance between sorted arrays — it doesn't track individual voice identity.

3. **Progression templates are not harmonically weighted** — all template positions are equally weighted "main" chords. There is no concept of structural vs. passing vs. cadential roles. The `adaptLength` function pads progressions with random degree indices from a grab-bag pool `[1, 3, 5, 4, 6, 0]`.

4. **Substitutions are injected without context scoring** — secondary dominants, tritone subs, passing diminished chords, and suspensions are all inserted by probability thresholds (`random() > 0.64`, `random() > 0.55`, etc.) with no regard for whether the surrounding context supports them.

5. **Complexity extensions stack too aggressively** — at complexity 3, *every* chord gets a 9th added, and major/dominant chords also get a 13th. At complexity 4, dominant chords get random alterations (b9, #9, b13). This produces too many rich chords with no contrast.

6. **The audio playback layer is disconnected from voicing** — `playChordFromPitchClasses` maps all pitch classes to a single octave (octave 4 by default) with no spread, while the advanced generator produces carefully voiced MIDI arrays that *are* used by the Tone.js playback in `page.tsx`. However, the `rangeLow: 48, rangeHigh: 72` range is only 2 octaves (C3–C5), which constrains voicing options severely.

**The single highest-leverage fix is replacing `buildStackedVoicing` with a voicing algorithm that intelligently distributes chord tones rather than duplicating them across octaves.** This alone would address the muddy, over-dense sound.

---

## 2. Likely Root Causes of Poor Musical Output

### 2.1 Over-Dense Voicings from Octave Stacking

**What it is:** `voicing.ts:18-33` builds voicings by looping through the interval set and repeating it in octave layers until `voiceCount` is reached:

```
while (expandedIntervals.length < voiceCount) {
    for (const interval of intervals) {
        expandedIntervals.push(interval + octaveLayer * 12);
    }
    octaveLayer += 1;
}
```

For a triad `[0, 4, 7]` with `voiceCount: 4`, this produces `[0, 4, 7, 12]` — root, third, fifth, doubled root an octave up. For `voiceCount: 5`, it produces `[0, 4, 7, 12, 16]` — the entire triad doubled.

**Why it sounds bad:** Doubling all voices in parallel octaves creates a rigid, organ-like texture. Every chord has identical intervallic spacing. There is no independence between voices. Parallel octaves are the single most forbidden voice-leading error in classical harmony, and for good reason — they eliminate voice independence and sound mechanical.

**How it manifests:** Every chord sounds equally heavy. Slow progressions feel ponderous. Fast progressions feel cluttered. There is no dynamic range between chords.

**How to fix:** Replace the stacking algorithm with one that selectively doubles *one* tone (preferring root or fifth, rarely the third), and distributes voices across the range with varied spacing.

### 2.2 Voice-Leading Cost Function Doesn't Track Voice Identity

**What it is:** `voiceLeading.ts:12-33` calculates cost by sorting both previous and next voicings from low to high and comparing corresponding positions:

```
const a = [...previous].sort((x, y) => x - y);
const b = [...next].sort((x, y) => x - y);
for (let i = 0; i < overlap; i++) {
    const delta = Math.abs(a[i] - b[i]);
    movement += delta;
}
```

**Why it sounds bad:** This treats voices as anonymous sorted positions, not as individual melodic lines. If the bass voice crosses above the tenor, the cost function doesn't notice. If two voices swap positions, it counts as zero movement. This means the selected voicing may have good aggregate distance but terrible individual voice motion — crossing, leaping, and parallel movement that sounds disjointed.

**How to fix:** Implement a proper voice-assignment algorithm (e.g., Hungarian algorithm or simple greedy matching) that assigns each voice in the previous chord to its closest match in the next chord, penalizing voice crossing and parallel perfect intervals.

### 2.3 No Phrase-Level Structure

**What it is:** Progressions are built as flat sequences. The `adaptLength` function pads short templates by randomly choosing from `[1, 3, 5, 4, 6, 0]`. The resolution heuristic at line 336-355 only forces the last chord to tonic.

**Why it sounds bad:** Real musical phrases have an arc: establishment → departure → tension → resolution. Without phrase structure, 6- and 8-chord progressions meander. The padding pool introduces chords without regard for what came before or what function they need to serve.

**How to fix:** Assign phrase roles (opening, continuation, pre-dominant, dominant, cadence) and constrain each position's chord selection to candidates appropriate for that role.

### 2.4 Substitutions Without Contextual Validation

**What it is:** `substitutions.ts` inserts secondary dominants, tritone subs, passing diminished chords, and suspensions using flat probability thresholds:

- Secondary dominants: `random() > 0.64` (36% chance per eligible position)
- Tritone subs: `random() < 0.5` (50% of dominants)
- Passing diminished: `random() < 0.42` threshold (58% when distance matches)
- Suspensions: `random() > 0.55` (45% of dominants)

If `insertions === 0` for secondary dominants, one is forced in. Combined, at complexity 3-4, a 4-chord progression can balloon to 7-8 chords with insertions, most of which are chromatic.

**Why it sounds bad:** Multiple chromatic insertions without scoring produce harmonic "thrashing" — the tonal center gets obscured by too many non-diatonic chords. A secondary dominant that isn't properly prepared (approached from an appropriate pre-dominant) sounds like a wrong note, not sophisticated harmony.

**How to fix:** Score each potential substitution against the full context (what precedes it, what follows it, how far we are from the tonal center) before insertion. Limit total insertions as a proportion of progression length.

### 2.5 Uniform Harmonic Weight

**What it is:** Every chord in the output is a `VoicedChord` with no duration, weight, or role metadata. The playback schedules every chord for `"1n"` (one whole note at the given BPM). Passing diminished chords, suspensions, and structural chords all get identical time and voicing density.

**Why it sounds bad:** A passing diminished chord between I and ii should be quick — an eighth note or a beat at most. At full whole-note duration, it becomes a prominent dissonance that overstays its welcome. Suspensions that last a full measure with no resolution within the chord sound unresolved rather than tantalizingly tense.

**How to fix:** Add `durationClass` and `role` fields to `VoicedChord`. Passing chords should default to half or quarter duration. Structural chords get full duration. Suspensions should pair with their resolution.

### 2.6 Complexity Extensions Without Contrast

**What it is:** `extensions.ts:38-63` adds a 7th at complexity >= 2 to *every* chord, a 9th and sometimes 13th at complexity >= 3 to *every* non-diminished chord, and random alterations at complexity >= 4 to *every* dominant.

**Why it sounds bad:** When every chord is equally complex, none of them are. Richness requires contrast. A progression where the tonic is a simple triad and the dominant is an altered 7th chord sounds intentional and dramatic. A progression where every chord is a 9th chord sounds flat and samey — the harmonic "color" becomes background noise.

**How to fix:** Apply extensions selectively: simpler voicings on stable/tonic chords, richer extensions on tension/dominant chords. Use complexity as a *ceiling*, not a universal floor.

### 2.7 `rangeLow: 48, rangeHigh: 72` is Too Narrow

**What it is:** The default range in `progressionStore.ts:104-105` is C3 (48) to C5 (72) — exactly 2 octaves.

**Why it sounds bad:** With only 24 semitones of range and a 4-voice chord, the voicing engine is forced to pack voices tightly together or, with open/spread voicings, run out of room. This produces either claustrophobic close voicings or candidates that get filtered out by `normalizeVoicingToRange`, reducing variety. A good piano voicing typically spans 2.5-3 octaves.

**How to fix:** Expand the default range to C3–G5 (48–79) or even C3–C6 (48–84), with a lower density zone below E3 (52) where intervals should be wider.

### 2.8 No Bass Voice Differentiation

**What it is:** There is no concept of a bass voice. The voicing algorithm treats all voices identically. The lowest note is whatever falls out of the inversion + style + normalization process.

**Why it sounds bad:** Bass motion is the single most important determinant of harmonic progression quality. Root position bass movement of fifths or steps sounds strong. First inversion provides smooth bass lines. Second inversion is a specific device (cadential, passing, pedal). Without explicit bass control, the engine may produce an awkward bass line that leaps erratically or stays static when it should move.

**How to fix:** Separate bass note selection from upper-voice voicing. Choose the bass note first (root, 3rd, or 5th based on inversion rules), then voice the remaining tones above it.

---

## 3. Voicing Audit

### 3.1 Current Voicing Pipeline

1. `toIntervals()` — converts pitch classes to semitone intervals from root
2. `buildStackedVoicing()` — fills `voiceCount` voices by repeating interval pattern across octaves
3. `invert()` — shifts lowest N notes up 12 semitones
4. `applyStyle()` — applies closed/open/drop2/drop3/spread transformations
5. `normalizeVoicingToRange()` — shifts entire voicing to fit within [rangeLow, rangeHigh]
6. Deduplication

### 3.2 Critical Voicing Problems

| Problem | Severity | Location |
|---------|----------|----------|
| Octave-parallel doubling | **Critical** | `buildStackedVoicing` |
| No bass/treble voice distinction | High | entire voicing pipeline |
| `normalizeVoicingToRange` shifts all voices by same amount | High | `voicing.ts:96-122` |
| No low-register spacing rules | High | absent |
| `applyStyle("open")` only raises voice[1] by 12 | Medium | `voicing.ts:53-57` |
| `applyStyle("spread")` raises every-other voice by 12 | Medium | `voicing.ts:73-78` |
| No root omission for rootless voicings (jazz) | Medium | absent |
| No 5th omission for 7th/extended chords | Medium | absent |

### 3.3 Recommended Voicing Framework

#### Default Voice Counts by Context

| Context | Recommended Voices | Notes |
|---------|-------------------|-------|
| Simple triads (complexity 1) | 3 | No doubling needed |
| 7th chords (complexity 2) | 4 | Root, 3, 5, 7 — no doubling |
| Extended chords (complexity 3) | 4 | Omit 5th, keep root, 3, 7, 9 |
| Altered chords (complexity 4) | 4 | Omit 5th, keep root, 3, 7, alteration |
| Passing/bridge chords | 3 | Lighten texture for transient harmony |
| Cadential chords (V→I) | 4–5 | Fuller for emphasis, with bass root |

#### Note Omission Rules

Priority of tones to keep (highest to lowest):
1. **Root** — always in bass (or explicit rootless voicing for jazz)
2. **3rd** — always keep (defines major/minor quality)
3. **7th** — always keep in 7th+ chords (defines chord color)
4. **Alteration/Extension** (9, #9, b9, 13, b13) — keep one
5. **5th** — **omit first** in any chord with 7th or extension (unless diminished/augmented where the 5th *is* the color)

Pseudo-rule:
```
if (chord has 7th or higher) AND (5th is perfect):
    omit the 5th
```

#### Note Doubling Rules

- **Prefer doubling root** (especially in bass) for triads that need an extra voice
- **Doubling the 5th** is acceptable for reinforcement
- **Never double the 3rd** — creates muddiness and over-emphasizes the quality tone
- **Never double the 7th** — amplifies dissonance and tension beyond what's wanted
- **Never double alterations** (b9, #9, b13)

#### Inversion Rules

| Inversion | Bass Note | When to Use |
|-----------|-----------|-------------|
| Root position | Root | Default for structural chords, strong bass |
| 1st inversion | 3rd | Smooth stepwise bass lines, lighter texture |
| 2nd inversion | 5th | Cadential 6/4 (V chord before resolution), passing, pedal |

Pseudo-rule:
```
if (this is a cadential V before I):
    use 2nd inversion → 1st inversion or root
if (bass would leap > 5 semitones to reach root):
    prefer 1st inversion
if (this is a passing chord):
    choose inversion that creates stepwise bass motion
```

#### Spacing Rules

| Register | Minimum Interval | Reason |
|----------|-----------------|--------|
| Below C3 (< MIDI 48) | Perfect 5th (7 semitones) | Prevents rumble/mud |
| C3–E3 (48–52) | Perfect 4th (5 semitones) | Low-register clarity |
| E3–C5 (52–72) | Minor 2nd OK | Standard voicing range |
| Above C5 (> 72) | Minor 3rd (3 semitones) | Prevents shrillness |

Additional: no interval larger than an octave between adjacent voices (avoids "holes" in the voicing).

#### Voice-Leading Constraints

Between consecutive chords:
1. **Common tones should be retained in the same voice** (cost = 0 for held notes)
2. **Non-common tones should move by step** (1–2 semitones) when possible (cost = 1)
3. **Leaps > 4 semitones penalized** (cost = delta * 1.5)
4. **Voice crossing penalized** (cost += 8 per crossing)
5. **Parallel perfect 5ths/octaves penalized** (cost += 6 per parallel)
6. **Contrary motion rewarded** (cost -= 1 when bass moves opposite to soprano)

### 3.4 Proposed Voicing Algorithm

```
function voiceChord(chord, prevVoicing, context):
    1. Determine tones to voice:
       - Start with essential tones (root, 3rd, 7th if present)
       - Add color tones (extensions) up to voiceCount
       - Omit 5th first if needed

    2. Select bass note:
       - Default: root
       - If prev bass is within 2 semitones of the 3rd: consider 1st inversion
       - If cadential context: consider 2nd inversion
       - Prefer stepwise or small-leap bass motion from previous chord

    3. Voice upper tones above bass:
       - If prevVoicing exists, assign tones to voices via
         nearest-match (not sorted position comparison)
       - Apply spacing rules (wide in bass, normal in middle)
       - Ensure no voice crossing

    4. Score candidate against voice-leading rules
    5. Return best candidate
```

---

## 4. Progression Logic Audit

### 4.1 Current Progression Pipeline

1. Select template from `MAJORISH_TEMPLATES` or `MINORISH_TEMPLATES` (15 each)
2. `adaptLength()` — truncate or pad to `numChords`
3. `maybeApplyFunctionalSwap()` — 55% chance to swap an interior chord with a same-family alternate
4. Build diatonic chord plans for each degree
5. `injectSecondaryDominants()` — insert V/x before target chords
6. `applyTritoneSubstitutions()` — replace dominants with tritone subs
7. `insertPassingDiminished()` — insert chromatic diminished between whole-step pairs
8. `insertSuspensions()` — insert sus4 before dominant chords
9. Force last chord to tonic
10. Limit total length

### 4.2 Critical Progression Problems

| Problem | Severity | Details |
|---------|----------|---------|
| Templates are flat sequences with no functional annotations | **Critical** | No distinction between "this is the pre-dominant" vs "this is a passing chord" |
| `adaptLength` padding is random | High | Choosing from `[1, 3, 5, 4, 6, 0]` with equal probability produces incoherent continuations |
| Substitution chain can over-expand | High | 4 requested chords can become 8+ with insertions |
| No limit on chromatic density | High | Multiple consecutive non-diatonic chords possible |
| Forced secondary dominant if none inserted | Medium | Line 54-57 of substitutions.ts guarantees at least one, even if musically inappropriate |
| No phrase arc modeling | Medium | Tension doesn't build and release — it's random |
| `familyForDegreeIndex` groups iii and vi with I as "tonic" | Low | iii is arguably mediant/dominant-prep, not tonic-function in all contexts |

### 4.3 Recommended Progression Framework

#### Phrase Roles

Every position in a progression should have a **role**:

| Role | Function | Typical Degrees (Major) | Typical Degrees (Minor) |
|------|----------|------------------------|------------------------|
| **Opening** | Establish tonic | I, vi, iii | i, III, bVI |
| **Continuation** | Maintain energy | IV, ii, vi, iii | iv, bVI, bVII, III |
| **Pre-Dominant** | Build toward tension | ii, IV | ii°, iv, bVI |
| **Dominant** | Maximum tension | V, vii° | V (major!), bVII |
| **Cadence** | Resolution | I | i |
| **Deceptive** | Surprise deflection | vi (instead of I) | bVI (instead of i) |

#### Phrase Templates by Length

```
4 chords: Opening → Continuation → Dominant → Cadence
5 chords: Opening → Continuation → Pre-Dominant → Dominant → Cadence
6 chords: Opening → Continuation → Continuation → Pre-Dominant → Dominant → Cadence
8 chords: Opening → Continuation → Pre-Dom → Dominant → Opening → Continuation → Dominant → Cadence
```

#### Chord Ranking in Context

Instead of equal-probability selection, rank candidates for each role:

```
For "Pre-Dominant" in C major:
  ii (Dm)  → weight 0.40  (strong pre-dominant)
  IV (F)   → weight 0.35  (classic subdominant)
  vi (Am)  → weight 0.15  (softer pre-dominant)
  iii (Em) → weight 0.10  (weak but usable)
```

#### Tension Curve

Model tension as a value 0.0–1.0 that should generally follow the phrase arc:

```
Position:  1    2    3    4
Tension:  0.1  0.3  0.7  0.0   (for a 4-chord progression)

Position:  1    2    3    4    5    6    7    8
Tension:  0.1  0.2  0.4  0.6  0.2  0.3  0.8  0.0   (for an 8-chord progression)
```

Tension informs:
- Whether a substitution is appropriate (high tension → yes, low tension → no)
- Whether an extension should be added (higher tension → richer extensions)
- Whether voicing should be denser (higher tension → more voices) or lighter

#### Controlling Substitution Insertion

Instead of flat probability, score each potential substitution:

```
function shouldInsertSecondaryDominant(before, target, tensionCurve, position):
    score = 0
    score += 2 if target is a "strong" diatonic chord (I, IV, V, vi)
    score += 1 if target is approached by step from before
    score -= 2 if two non-diatonic chords already adjacent
    score -= 1 if position.tension < 0.3  // too early for chromaticism
    score += 1 if position.tension > 0.5  // tension zone wants color
    return score > threshold
```

#### Balancing Novelty with Coherence

The "2/3 rule": in any 4-chord window, at least 2 should be diatonic. In any 8-chord progression, at least 5 should be diatonic. This prevents harmonic "thrashing" while still allowing interesting color.

---

## 5. Transition / Bridge Chord Design

### 5.1 When Transition Chords Are Appropriate

A transition chord is appropriate when:
- Two structural chords are harmonically distant (e.g., I → vi requires no bridge, but I → bVI might benefit from one)
- The bass motion between two chords is a large leap (> 4 semitones)
- A chromatic approach by half-step would smoothen the arrival at the next chord
- A suspension-to-resolution pairing would create satisfying tension-release

A transition chord is *not* appropriate when:
- The two chords already connect smoothly (e.g., V → I)
- The progression is short (3-4 chords) and every chord needs to count
- Adding one would create three consecutive non-diatonic chords

### 5.2 Transition Chord Types

| Type | Duration | Voicing | Example |
|------|----------|---------|---------|
| **Passing chord** | Half beat to 1 beat | 3 voices, light | dim7 between I and ii (C→C#°7→Dm) |
| **Approach chord** | 1 beat | 3-4 voices, medium | V/V before V (D7→G7→C) |
| **Suspension** | 1-2 beats then resolve | 4 voices | Gsus4→G7→C |
| **Pedal embellishment** | 1 beat | 3 voices over held bass | IV/I before I (F/C → C) |
| **Cadential 6/4** | 1-2 beats | 4 voices, 2nd inversion | I6/4 → V → I |

### 5.3 Voicing Rules for Transition Chords

- **Use fewer voices** than the surrounding structural chords (e.g., 3 vs. 4)
- **Lower velocity/volume** if the audio system supports dynamics
- **Prefer close voicing** (less spread) to minimize their footprint
- **Bass should create stepwise motion** between the structural chords on either side

### 5.4 Implementation Model

Add to `PlannedAdvancedChord`:

```typescript
type ChordRole =
  | "structural"      // Full-weight main harmony
  | "passing"         // Brief chromatic connection
  | "approach"        // Dominant preparation
  | "suspension"      // Tension before resolution
  | "embellishment"   // Color added to a structural chord
  | "cadential";      // Cadential preparation (6/4, etc.)

type DurationClass =
  | "full"      // Full measure
  | "half"      // Half measure
  | "quarter"   // One beat
  | "eighth";   // Half beat

// Extended chord plan:
type EnrichedChordPlan = PlannedAdvancedChord & {
  role: ChordRole;
  durationClass: DurationClass;
  tensionLevel: number;  // 0.0 - 1.0
};
```

#### Scheduling Algorithm

```
function scheduleTransitionChords(structural: EnrichedChordPlan[]): EnrichedChordPlan[] {
    const result: EnrichedChordPlan[] = [];

    for (let i = 0; i < structural.length; i++) {
        const current = structural[i];
        const next = structural[i + 1];

        result.push(current);

        if (next && shouldInsertTransition(current, next)) {
            const transition = buildTransitionChord(current, next);
            // Steal time from the current chord:
            current.durationClass = "half";
            transition.durationClass = "half";
            result.push(transition);
        }
    }

    return result;
}
```

---

## 6. Proposed Scoring Model

### 6.1 Scoring Dimensions

| Dimension | Weight | Type | What It Measures |
|-----------|--------|------|-----------------|
| **Voice-leading smoothness** | 25% | Penalty | Total semitone motion across all voices, with leaps >4 penalized 1.5x |
| **Bass motion quality** | 20% | Mixed | Stepwise/5th bass = reward; tritone leap = heavy penalty; static repeated bass = mild penalty |
| **Common-tone retention** | 15% | Reward | Number of pitch classes shared with previous chord × 2 points each |
| **Spacing quality** | 10% | Penalty | Violations of register-specific spacing rules (see §3.3) |
| **Harmonic plausibility** | 10% | Penalty | How far the chord is from the diatonic set (0 = diatonic, 1 = one chromatic note, etc.) |
| **Register balance** | 5% | Penalty | Voicing center deviation from target center |
| **Parallel 5ths/octaves** | 5% | Hard penalty | Each instance adds 6 points |
| **Voice crossing** | 5% | Hard penalty | Each instance adds 8 points |
| **Phrase arc fit** | 5% | Mixed | Does the chord's tension level match the target tension curve? |

### 6.2 Detail for Key Dimensions

#### Voice-Leading Smoothness (25%)

```
cost = sum over each voice of:
    if delta == 0: 0           (common tone held)
    if delta <= 2: 1           (stepwise motion, ideal)
    if delta <= 4: delta       (small leap, acceptable)
    if delta > 4: delta * 1.5  (large leap, penalized)
    if delta > 7: delta * 2.0  (very large leap, strongly penalized)
```

**Why highest weight:** This is the most perceptible quality. Listeners hear each voice's motion. Smooth voice leading is what makes a progression sound "connected" rather than like a sequence of unrelated events.

#### Bass Motion Quality (20%)

```
bass_cost = 0
delta = |prev_bass - next_bass| mod 12

if delta == 0: bass_cost += 1     (repeated root — slightly static)
if delta in [1, 2]: bass_cost -= 2   (stepwise — excellent)
if delta in [5, 7]: bass_cost -= 2   (4th/5th — strong harmonic motion)
if delta == 6: bass_cost += 4     (tritone leap — awkward)
if delta in [3, 4, 8, 9]: bass_cost += 1  (3rd-based leap — acceptable but not ideal)
```

**Why second-highest weight:** Bass motion defines the harmonic rhythm more than any other single voice. The difference between a great and poor progression is often just the bass line.

#### Common-Tone Retention (15%)

```
shared = intersection(prev_pitch_classes, next_pitch_classes)
reward = shared.length * 2
```

**Why important:** Common tones create continuity. When C major (C-E-G) goes to A minor (A-C-E), two shared tones (C, E) make the transition feel natural.

### 6.3 Composite Scoring

```
total_score =
    voice_leading_cost * 0.25 +
    bass_cost * 0.20 +
    (max_common_tones - common_tone_reward) * 0.15 +
    spacing_violations * 0.10 +
    chromatic_distance * 0.10 +
    register_deviation * 0.05 +
    parallel_violations * 0.05 +
    crossing_violations * 0.05 +
    arc_mismatch * 0.05

// Lower is better. Select the voicing candidate with minimum total_score.
```

---

## 7. Phased Improvement Plan

### Phase 1 — Fast Fixes (1-2 days)

**Objective:** Immediate quality gains with minimal structural changes.

**Changes:**
1. **Expand default range** from `48-72` to `48-79` in `progressionStore.ts`
2. **Cap effective voice count** at `min(voiceCount, chord.pitchClasses.length)` in `generateVoicingCandidates` so a 3-note triad never gets 5 voices
3. **Add low-register spacing** in `normalizeVoicingToRange`: if any two adjacent notes below MIDI 52 are less than 5 semitones apart, reject the candidate
4. **Limit substitution count** proportional to progression length: `maxInsertions = floor(numChords / 3)` in each substitution function
5. **Reduce complexity uniformity**: at complexity 3, only add 9th to 60% of chords (random per chord); at complexity 3, only add 13th to 30% of chords

**Expected benefit:** Less mud, less density, less chromatic clutter. Immediately more listenable.

**Risks:** Changing ranges may alter existing snapshot tests. Voice count capping may reduce expected chord thickness for users who want full voicings.

**Validation:**
- Generate 10 progressions in C major, complexity 2, 4 chords — listen for clarity
- Generate 5 progressions at complexity 4, 8 chords — listen for coherence
- All existing tests should still pass (update snapshots if needed)

### Phase 2 — Voicing Redesign (3-5 days)

**Objective:** Replace `buildStackedVoicing` with an intelligent voice-distribution algorithm.

**Changes:**
1. **New `distributeVoices()` function** that:
   - Selects essential tones (root, 3rd, 7th)
   - Omits 5th when chord has 7th+ and 5th is perfect
   - Doubles root (in bass) if voice count exceeds unique tones
   - Distributes upper voices with minimum spacing rules
2. **Bass-first voicing**: select bass note independently, then voice remaining tones above it
3. **Proper voice-leading cost function** with voice-identity tracking (greedy nearest-match, not sorted-position comparison)
4. **Penalties for parallel 5ths/octaves** and voice crossing in the cost function
5. **Common-tone retention bonus** in the scoring

**Expected benefit:** Dramatic improvement in chord-to-chord smoothness. Elimination of parallel-octave muddiness. More varied and natural-sounding voicings.

**Risks:** Complete replacement of the voicing pipeline — extensive testing needed. May break drop2/drop3 style expectations.

**Validation:**
- Unit test: C major triad with 4 voices should produce [C3, E3, G3, C4] or [C3, G3, C4, E4] (root doubled), NOT [C3, E3, G3, E4] (third doubled)
- Unit test: voice-leading cost from Cmaj to Fmaj should prefer [C3, F3, A3, C4] over [F2, A2, C3, F3] (closer to previous)
- Listening test: 4-chord progressions should feel "connected"

### Phase 3 — Progression Logic Redesign (3-5 days)

**Objective:** Add phrase structure, tension modeling, and contextual substitution scoring.

**Changes:**
1. **Phrase role assignment**: each position gets a role (opening, continuation, pre-dominant, dominant, cadence)
2. **Role-aware chord selection**: template indices are filtered/weighted by role
3. **Tension curve**: define target tension values per position; use them to gate substitutions and extensions
4. **Contextual substitution scoring**: replace flat probability thresholds with scoring functions that consider:
   - Adjacent chord chromaticism
   - Distance from tonic
   - Position in phrase
   - Target tension level
5. **Selective extension application**: complexity becomes a ceiling, not a floor. Tonic chords stay simpler; dominant/tension chords get richer.
6. **Replace `adaptLength` random padding** with role-appropriate degree selection

**Expected benefit:** Progressions that tell a harmonic story. Proper tension-release arcs. Substitutions that enhance rather than clutter.

**Risks:** Most complex change. Phrase templates need careful design per mode. Could over-constrain creative variety if tension curves are too rigid.

**Validation:**
- Generate 20 progressions of each length (4, 6, 8) and verify phrase arc is audible
- No more than 2 consecutive non-diatonic chords in any progression at complexity <= 3
- Last two chords should always feel like a cadence

### Phase 4 — Transition Chord System (2-3 days)

**Objective:** Implement the structural/passing/approach chord framework.

**Changes:**
1. **Add `role` and `durationClass` to `PlannedAdvancedChord`**
2. **Duration-aware playback**: modify Tone.js scheduling to use variable durations
3. **Lighter voicings for passing chords**: reduce voice count by 1, use close position
4. **Transition insertion logic**: detect when structural chords are harmonically distant and insert chromatic or diatonic passing chords
5. **Suspension-resolution pairing**: suspensions are always followed by their resolution within the same "time slot"

**Expected benefit:** Chromatic passing chords become quick, graceful connections instead of jarring full-weight events. Suspensions gain proper resolution timing.

**Risks:** Variable-duration playback is a significant change to the Tone.js scheduling loop. Piano roll visualization needs updating for variable widths.

**Validation:**
- Passing diminished chords should sound like brief "slides" between chords
- Suspensions should audibly resolve (sus4 → major/dominant)
- Total progression duration should stay close to original despite added chords

### Phase 5 — Evaluation and Tuning (Ongoing)

**Objective:** Systematic quality assessment and parameter tuning.

**Changes:**
1. **Debug panel** showing voice-leading costs, tension curve, phrase roles for each chord
2. **A/B comparison mode**: generate two progressions side-by-side with old vs. new logic
3. **Scoring histogram**: visualize the distribution of scores across generated progressions
4. **Regression test suite**: 50 seeded progressions with snapshot tests to catch quality regressions
5. **Parameter sweep**: systematically test combinations of weights in the scoring model

**Expected benefit:** Data-driven tuning instead of guesswork. Confidence that changes improve quality.

**Validation:**
- Blind A/B listening tests (play random old vs. new, rate preference)
- Automated metrics: average voice-leading cost should decrease by >30% after Phase 2
- No regression in snapshot tests

---

## 8. Verification Checklist

### Listening Test Criteria

For each generated progression, assess:

- [ ] **Connectivity**: Does each chord feel connected to the previous one? (No jarring leaps)
- [ ] **Unity**: Does the progression feel like one musical idea, not random chords?
- [ ] **Surprise quality**: Are there any "where did that come from?" chords?
- [ ] **Transition smoothness**: Do passing chords help motion rather than cluttering it?
- [ ] **Density**: Are voicings too thick or muddy? (Especially in the bass register)
- [ ] **Variety**: Do consecutive chords sound different enough in texture?
- [ ] **Tension arc**: Is there a convincing sense of building tension and release?
- [ ] **Complexity fit**: Do complex progressions sound intentional, not random?
- [ ] **Ending quality**: Does the progression end with a convincing sense of arrival?
- [ ] **Bass line**: Does the bass motion sound purposeful and smooth?

### A/B Test Protocol

1. Generate 10 progressions with fixed seeds using old logic
2. Generate the same 10 progressions using new logic
3. Play each pair blind (randomize which is A/B)
4. Rate each on a 1-5 scale for: smoothness, musicality, density appropriateness
5. Track which version is preferred overall

### Representative Test Cases

| Test Case | Key | Mode | Chords | Complexity | What to Listen For |
|-----------|-----|------|--------|------------|-------------------|
| Simple pop | C | Major | 4 | 1 | Should sound clean and familiar |
| Rich jazz | F | Major | 4 | 3 | Should sound colorful but coherent |
| Minor moody | A | Minor | 4 | 2 | Should sound dark but smooth |
| Long form | G | Major | 8 | 2 | Should have clear phrase arc |
| Complex jazz | Bb | Dorian | 6 | 4 | Should sound sophisticated, not chaotic |
| Simple minor | D | Minor | 3 | 1 | Minimal — should be perfectly clean |
| Mixolydian | E | Mixolydian | 4 | 2 | Blues-rock feel, dominant 7ths natural |
| Phrygian | E | Phrygian | 4 | 2 | Spanish/modal feel, bII prominent |

### Edge Cases to Test

- **3 chords, complexity 1**: should be perfectly clean, no insertions
- **8 chords, complexity 4**: maximum stress on the system — should still be coherent
- **All modes with same root**: character should clearly differ between modes
- **Extreme key (F#)**: no bugs from enharmonic handling
- **Repeated generation with different seeds**: variety should be evident

### Red Flags — Progressions That Should Be Flagged as Poor

- Three or more consecutive non-diatonic chords
- Bass jumping by tritone (augmented 4th) between structural chords
- Two adjacent diminished chords
- A passing chord that's louder/longer than the structural chord it connects
- A secondary dominant that doesn't resolve to its target
- All chords having identical voicing density
- Voice-leading cost > 20 for any single chord transition (with 4 voices)

---

## 9. Architectural Recommendations

### 9.1 Chord Representation

```typescript
// Enriched chord plan — the core internal representation
type ChordPlan = {
  // Identity
  root: PitchClass;
  pitchClasses: PitchClass[];     // Abstract pitch classes (unvoiced)
  symbol: string;                  // Display symbol: "Cmaj7", "Dm9", etc.
  degreeLabel: string;             // Roman numeral in context

  // Harmonic function (explicit, not inferred)
  harmonicFunction: "tonic" | "subdominant" | "dominant" | "chromatic";
  role: ChordRole;                 // structural, passing, approach, etc.
  tensionLevel: number;            // 0.0 - 1.0

  // Voice leading hints
  preferredBassNote: PitchClass | null;  // null = use root
  preferredInversion: 0 | 1 | 2 | null; // null = auto

  // Duration
  durationClass: DurationClass;

  // Generation metadata
  kind: ChordKind;                 // diatonic, secondary-dominant, etc.
  isDominant: boolean;
};
```

### 9.2 Voicing Template

```typescript
type VoicingTemplate = {
  bass: number;          // MIDI note for bass
  upper: number[];       // MIDI notes for upper voices, sorted ascending
  style: VoicingStyle;
  voiceCount: number;
};

type VoicedChordOutput = {
  plan: ChordPlan;              // Back-reference to the plan
  voicing: VoicingTemplate;     // The chosen voicing
  voiceLeadingCost: number;     // Cost from previous chord
  midi: number[];               // Final MIDI array [bass, ...upper]
  notes: string[];              // Human-readable ["C3", "E3", "G3", "C4"]
};
```

### 9.3 Progression State

```typescript
type ProgressionContext = {
  key: PitchClass;
  mode: Mode;
  phraseLength: number;
  tensionCurve: number[];          // One tension value per position

  // Running state during generation
  chromaticDensity: number;        // How many recent non-diatonic chords (sliding window)
  previousChordPlan: ChordPlan | null;
  previousVoicing: VoicingTemplate | null;
};
```

### 9.4 What to Encode Explicitly vs. Infer

| Data | Approach | Reason |
|------|----------|--------|
| Harmonic function | **Explicit** — set when building chord plan | Inference from degree alone is unreliable for borrowed/chromatic chords |
| Phrase role | **Explicit** — assigned before chord selection | Drives all downstream decisions |
| Tension level | **Explicit** — from tension curve template | Must be consistent across the progression |
| Preferred inversion | **Infer** — from bass motion optimization | Depends on the previous chord, which changes |
| Voice count per chord | **Infer** — from role + complexity | Passing chords should auto-reduce |
| Duration class | **Explicit** — set based on chord role | Critical for playback scheduling |
| Pitch class set | **Explicit** — built from theory functions | Core identity, must be deterministic |
| Voicing (MIDI notes) | **Infer** — from voicing algorithm + voice leading | The whole point of the voicing engine |

---

## 10. Top 10 Highest-Leverage Changes

Ranked by expected impact on listening quality per unit of implementation effort:

| Rank | Change | Impact | Effort | Files Affected |
|------|--------|--------|--------|----------------|
| **1** | Replace `buildStackedVoicing` with intelligent voice distribution (omit 5th, don't parallel-double) | **Massive** — fixes the mud | Medium | `voicing.ts` |
| **2** | Add bass-first voicing — select bass note based on inversion rules, then voice upper tones | **Large** — fixes aimless bass lines | Medium | `voicing.ts` |
| **3** | Cap effective voice count at number of unique pitch classes (no empty doubling) | **Large** — instant density fix | Tiny | `voicing.ts` or `generateAdvancedProgression.ts` |
| **4** | Implement voice-identity tracking in `calculateVoiceLeadingCost` (greedy matching, not sorted comparison) | **Large** — fixes voice crossing and disconnection | Medium | `voiceLeading.ts` |
| **5** | Add `durationClass` to passing/suspension chords and variable-duration playback | **Large** — fixes passing chord overstay | Medium | `types.ts`, `substitutions.ts`, `page.tsx` |
| **6** | Limit substitution insertions to `floor(numChords / 3)` and require at least 2/3 diatonic chords | **Medium** — fixes chromatic thrashing | Small | `substitutions.ts` |
| **7** | Selective complexity extensions (simpler on tonic, richer on dominant) | **Medium** — adds contrast | Small | `extensions.ts`, `generateAdvancedProgression.ts` |
| **8** | Expand default range to C3–G5 (48–79) with low-register spacing enforcement | **Medium** — more room for good voicings | Tiny | `progressionStore.ts`, `voicing.ts` |
| **9** | Add phrase roles and tension curve to guide chord selection | **Medium** — fixes aimless long progressions | Large | `generateAdvancedProgression.ts`, new file |
| **10** | Add common-tone retention bonus and parallel-5ths/octaves penalty to voice-leading scoring | **Medium** — improves smoothness perception | Small | `voiceLeading.ts` |

---

*End of audit. This document is intended to be a living reference — update it as changes are implemented and validated.*
