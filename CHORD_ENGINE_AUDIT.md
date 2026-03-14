# Harmonia Chord Progression Engine — Deep Audit & Redesign Plan

**Date:** 2026-03-13
**Scope:** Full analysis of `lib/music/generators/advanced/`, `lib/theory/`, `lib/audio/`, and `lib/state/progressionStore.ts`
**Perspective:** Expert music theorist, voice-leading specialist, and pragmatic software engineer

---

## 1. Executive Summary

After a line-by-line review of every file in Harmonia's chord progression pipeline, I have identified **eight root causes** that collectively explain why generated progressions often sound dissonant, disjointed, muddy, or aimless. The problems span three layers: **voicing** (how individual chords are realized as pitches), **progression logic** (how chord sequences are constructed), and **temporal weighting** (how chords relate to each other in duration and function).

### The eight root causes, ranked by impact on listening quality:

1. **`buildStackedVoicing` duplicates entire triads across octaves.** A 4-voice C major triad becomes `[C3, E3, G3, C4]` and a 5-voice version becomes `[C3, E3, G3, C4, E4]`. This creates organ-like parallel doubling — the single most forbidden texture in voice leading — producing thick, rigid, undifferentiated harmony where every chord has the same intervallic profile.

2. **The voice-leading cost function doesn't track voice identity.** It sorts both chords low-to-high and compares positions, so it treats voices as anonymous. Voice crossing, voice swapping, and parallel perfect intervals are invisible to the algorithm. This means the "best" candidate may have terrible individual voice motion despite decent aggregate distance.

3. **All chords are weighted equally.** Every chord — structural tonic, passing diminished, suspension, secondary dominant — gets the same duration (one full measure), the same voicing density, and the same playback weight. A passing diminished chord that should be a brief chromatic slide between two diatonic chords instead sits for four beats as a prominent dissonance.

4. **Substitutions are inserted by flat probability with no contextual scoring.** Secondary dominants (36% chance per position), tritone subs (50% of dominants), passing diminished chords (58% when distance matches), and suspensions (45% of dominants) are all triggered by random thresholds. Combined, a 4-chord progression at complexity 3-4 can balloon to 7-8 chords, most of them chromatic. If no secondary dominant gets inserted, one is forced in regardless of context.

5. **Complexity extensions apply uniformly to every chord.** At complexity 3, every non-diminished chord gets a 9th. Major/dominant chords also get a 13th. At complexity 4, every dominant gets random alterations. When every chord is equally complex, none stand out — the richness becomes background noise, and the lack of contrast between stable and tense chords makes the progression feel flat.

6. **The default range (C3-C5, 48-72) is only 2 octaves.** A good piano voicing typically spans 2.5-3 octaves. With only 24 semitones of room and 4 voices, the engine is forced into either claustrophobic close position or candidates that get filtered out by range normalization, dramatically reducing voicing variety.

7. **No phrase-level structure exists.** Progressions are flat sequences. The `adaptLength` function pads short templates by randomly picking from `[1, 3, 5, 4, 6, 0]`. There's no concept of opening, continuation, pre-dominant, dominant, or cadence — so 6- and 8-chord progressions meander without arc or direction.

8. **No bass voice differentiation.** There is no concept of a bass line. The lowest note is whatever falls out of the inversion/style/normalization pipeline. Since bass motion is the single most important determinant of progression quality to the ear, this is a critical omission.

### The single highest-leverage fix:

**Replace `buildStackedVoicing` with an intelligent voice-distribution algorithm** that selectively doubles one tone (preferring root or fifth, never third or seventh), omits the perfect 5th when a 7th or extension is present, and separates bass selection from upper-voice voicing. This single change would address the muddy, over-dense, organ-like sound that dominates current output.

---

## 2. Likely Root Causes of Poor Musical Output

### 2.1 Over-Dense Voicings from Octave Stacking

**What it is:** `voicing.ts:18-33` builds voicings by looping through the interval set and repeating it in octave layers:

```
intervals = [0, 4, 7]  // C major triad
voiceCount = 5

Result: [0, 4, 7, 12, 16]  →  C3, E3, G3, C4, E4
```

This mechanically duplicates the entire triad. For a 7th chord `[0, 4, 7, 10]` with `voiceCount: 5`, you get `[0, 4, 7, 10, 12]` — root doubled at the octave on top of a complete seventh chord.

**Why it sounds bad:** Parallel octave doubling eliminates voice independence. Every chord has identical intervallic spacing — the same M3+m3+P4 or m3+M3+P4 stacking pattern repeats in every voicing. This creates a "block chord" texture where no individual voice has a distinct melodic line. The doubled 3rd (E3 + E4 in the 5-voice triad example) is particularly problematic: the 3rd is the most characterful tone in a chord (it defines major vs. minor), and doubling it creates an over-emphasized, prominent quality-defining sound that becomes fatiguing.

**How it manifests in output:**
- Every chord sounds equally "full" regardless of its harmonic function
- Slow progressions feel ponderous and organ-like
- Fast progressions feel cluttered — too many notes changing simultaneously
- There's no textural contrast between a restful tonic and a tense dominant
- The characteristic "mud" happens when this doubling occurs below E3, where close intervals become acoustically indistinct

**How to detect/prevent in software:**
- Rule: never allow more voices than unique pitch classes unless explicitly doubling root or 5th
- Rule: never double the 3rd or 7th
- Rule: if `voiceCount > pitchClasses.length`, double only root (bass) or 5th (reinforcement)
- Rule: if the chord has a 7th or extension, omit the perfect 5th before adding any doubling

### 2.2 Voice-Leading Cost Function Ignores Voice Identity

**What it is:** `voiceLeading.ts:12-33` sorts both the previous and next voicings ascending and compares positions index-by-index:

```
previous = [C3, E3, G3, C4]  sorted → [48, 52, 55, 60]
next     = [D3, F3, A3, D4]  sorted → [50, 53, 57, 62]

Cost = |48-50| + |52-53| + |55-57| + |60-62| = 2+1+2+2 = 7
```

This looks reasonable, but consider what happens when the optimal voice leading would have the soprano descend while the alto ascends — the sorted comparison can't distinguish this from parallel motion. Worse, if two voices cross (soprano goes below alto), the function doesn't notice because it only compares sorted positions.

**Why it sounds bad:** The ear tracks individual melodic lines, not aggregate sorted positions. When the bass suddenly leaps up while an inner voice drops to cover the bass register, the listener hears a jarring texture change even if the total semitone distance is small. Parallel perfect fifths and octaves (two voices moving by the same interval simultaneously) are perceptually prominent and create a hollow, medieval sound that clashes with contemporary harmony.

**How it manifests:**
- Voice crossing: soprano ends up below the tenor between chords, creating timbral confusion
- Parallel fifths/octaves: two voices move in lockstep, creating an unintentional "power chord" effect
- Bass discontinuity: the lowest note jumps unpredictably because it's just whatever sorted-position-0 happens to be

**How to detect/prevent:**
- Use a voice-assignment algorithm (greedy nearest-match or Hungarian algorithm) that pairs each voice in the previous chord to its closest match in the next chord
- Add explicit penalties: voice crossing (+8 cost), parallel P5/P8 (+6 cost), contrary motion (-1 reward)
- Separate bass from upper voices: evaluate bass motion independently, then optimize upper voices

### 2.3 Uniform Duration / No Chord Role Distinction

**What it is:** Every chord in the output is a flat `VoicedChord` with no duration, weight, or role metadata. The MIDI export (`progressionMidiExport.ts:28-29`) allocates exactly 4 beats per chord. A passing diminished chord, a suspension, and a structural tonic all get identical time.

**Why it sounds bad:** A passing diminished chord (e.g., C#dim7 between C major and D minor) is meant to be heard as a quick chromatic slide — ideally an eighth note or one beat at most. At four full beats, it becomes a prominent, lingering dissonance that sounds like a wrong chord rather than a graceful connection. Similarly, a sus4 before a dominant is meant to be heard as a brief tension that resolves. If the suspension and its resolution are each four beats long, the suspension overstays its welcome and the resolution feels anti-climactic because it arrives too late.

**How it manifests:**
- Passing chords sound like intentional dissonances rather than connective tissue
- Suspensions feel unresolved because they sit too long before their resolution
- Secondary dominants feel like key changes rather than brief tonicizations
- The progression loses forward momentum because every event has equal temporal weight

**How to detect/prevent:**
- Add `durationClass` to the chord plan: `"full"` (4 beats), `"half"` (2 beats), `"quarter"` (1 beat), `"eighth"` (half beat)
- Assign durations based on `kind`: diatonic/functional → full; secondary-dominant → half or full; passing → quarter; suspension → half (paired with resolution at half)
- Update MIDI export to schedule chords with variable durations

### 2.4 Substitutions Without Contextual Validation

**What it is:** `substitutions.ts` inserts chromatic chords using flat probability thresholds:

| Substitution | Probability | Max Insertions | Forced? |
|-------------|-------------|---------------|---------|
| Secondary dominant | 36% per position (`random() > 0.64`) | 2 | Yes — if 0 inserted, forces one before final chord |
| Tritone sub | 50% per dominant | unlimited | No |
| Passing diminished | 58% when distance = whole step | 2 | No |
| Suspension | 45% per dominant (`random() > 0.55`) | 2 | No |

**Combined worst case for 4 chords at complexity 4:** Start with 4 chords → inject 2 secondary dominants (now 6) → tritone-sub 2 of the dominants (still 6 but 3 are chromatic) → insert 2 passing diminished (now 8) → insert 2 suspensions (now 10). A user asked for 4 chords and got 10, with 7 of them non-diatonic.

**Why it sounds bad:** When more than half the chords are chromatic, the tonal center dissolves. The listener can't orient themselves. Each chord sounds "interesting" in isolation but the sequence is incoherent — like a series of spice samples with no dish. The forced secondary dominant insertion (lines 54-57 of substitutions.ts) is particularly problematic: it guarantees at least one chromatic insertion even in short, simple progressions where it's musically inappropriate.

**How it manifests:**
- Progressions at complexity 3-4 often sound like they're in multiple keys simultaneously
- Short progressions (3-4 chords) get overwhelmed by insertions
- The forced secondary dominant before the final chord can undermine the cadence
- Consecutive chromatic chords (e.g., secondary dominant → tritone sub) sound like mistakes

**How to detect/prevent:**
- Score each potential substitution against context: what precedes it, what follows, chromatic density so far, position in phrase
- Enforce the "2/3 rule": in any 4-chord window, at least 2 must be diatonic
- Limit total insertions to `floor(numChords / 3)` per substitution type
- Remove the forced secondary dominant insertion
- Never insert a chromatic chord adjacent to another chromatic chord

### 2.5 Complexity Extensions Without Contrast

**What it is:** `extensions.ts:38-63` applies extensions to *every* chord at a given complexity level:

| Complexity | What gets added | Applied to |
|-----------|----------------|-----------|
| 2 | 7th | Every chord |
| 3 | 7th + 9th (+ 13th for maj/dom) | Every non-diminished chord |
| 4 | 7th + 9th + random alteration (b9, #9, b13) | Every dominant |

**Why it sounds bad:** Musical contrast requires some chords to be simpler than others. In a jazz standard, the tonic chord is often voiced simply (root, 3rd, 7th) while the dominant gets rich extensions (9th, 13th, altered tones). This contrast is what makes the dominant *feel* tense — it's richer than the surrounding harmony. When every chord has a 9th, the 9th stops being a color and becomes wallpaper. The progression feels "samey" — harmonically complex but emotionally flat.

**How it manifests:**
- Complexity 3 progressions where every chord is a 9th or 13th chord
- No audible difference in "weight" between a tonic and a dominant
- The resolution from V to I doesn't feel satisfying because I is just as complex as V
- High complexity settings produce chords that are technically correct but musically unengaging

**How to detect/prevent:**
- Treat complexity as a *ceiling*, not a floor
- Assign extensions based on harmonic function: tonic → simpler (triad or 7th), pre-dominant → moderate (7th), dominant → richest (9th, 13th, alterations)
- At complexity 3, apply 9th to ~60% of chords (weighted toward dominants), not 100%
- Reserve alterations (b9, #9, b13) for specific dramatic moments, not random application

### 2.6 Narrow Range Constrains Voicing Options

**What it is:** `progressionStore.ts:104-105` sets `rangeLow: 48` (C3) and `rangeHigh: 72` (C5) — exactly 24 semitones.

**Why it sounds bad:** A 4-voice chord spans at minimum a tritone (~6 semitones) in close position and typically 12-19 semitones in open/spread voicings. In a 24-semitone range, there are very few valid placements. The `normalizeVoicingToRange` function shifts the entire voicing up or down by octaves to fit, which means many stylistically useful voicings get rejected. A typical piano voicing spans C3 to E5 or F5 (about 29-32 semitones). A 2-octave range is adequate only for very tight, close-position triads.

**How it manifests:**
- Limited voicing variety — the engine keeps producing similar registral placements
- Open and spread voicings frequently get rejected because they exceed the range
- Low-register voicings pack too tightly, creating mud
- High-register voicings are impossible

**How to detect/prevent:**
- Expand default range to C3-G5 (48-79) or C3-C6 (48-84)
- Enforce a low-register density rule: below E3 (MIDI 52), minimum interval between adjacent voices should be a perfect 5th (7 semitones)
- Allow the bass to go as low as G2 (43) for root-position chords with the remaining voices above C3

### 2.7 No Phrase-Level Structure or Tension Arc

**What it is:** Progressions are flat sequences of degree indices. Templates like `[0, 3, 4, 0]` encode I-IV-V-I, but the positions carry no functional annotation. The `adaptLength` function pads short templates by randomly choosing from `[1, 3, 5, 4, 6, 0]` (ii, IV, vi, V, vii, I) — a grab bag of degrees with no regard for what role the position needs.

**Why it sounds bad:** Real musical phrases have an arc: establishment → departure → building tension → resolution. Without this arc, longer progressions (6-8 chords) wander aimlessly. A 6-chord progression padded to 8 might get random vi and iii chords appended, creating an extended "plateau" with no sense of arrival. The listener's expectation of "where is this going?" is never answered.

**How it manifests:**
- 6-8 chord progressions that meander without direction
- No sense of "home" being established and returned to
- Substitutions applied to already-aimless sequences compound the problem
- The resolution heuristic (force last chord to tonic) creates a crude ending but doesn't fix the lack of journey

**How to detect/prevent:**
- Assign phrase roles to each position: opening, continuation, pre-dominant, dominant, cadence
- Select chords per position from role-appropriate candidates with weighted probabilities
- Model tension as a curve (0.0-1.0) that rises and falls across the phrase
- Use tension to gate substitution insertion and extension application

### 2.8 No Bass Voice Differentiation

**What it is:** There is no concept of a bass voice in the voicing pipeline. The lowest note is whatever sorted position 0 happens to be after stacking, inversion, style application, and range normalization. The inversion function (`voicing.ts:35-45`) mechanically shifts bottom notes up by 12, but there's no logic for *why* a particular inversion should be chosen.

**Why it sounds bad:** Bass motion is the single most perceptible aspect of harmonic progression. The bass line defines the listener's sense of harmonic rhythm, directionality, and tonal anchoring. A bass line that moves by step (C→D or C→B) sounds smooth and directional. A bass line that leaps by tritone (C→F#) sounds jarring. A bass line that moves by falling fifth (C→F→Bb→Eb) sounds like classic harmonic motion. Without explicit bass control, the engine may produce a bass line that erratically alternates between root position and random inversions, destroying the sense of harmonic flow.

**How it manifests:**
- Bass jumps unpredictably between chords
- First inversions and second inversions appear randomly rather than purposefully
- The powerful effect of a descending bass line (I→V6→vi) is never intentionally created
- Cadential 6/4 (second inversion I before V) never occurs because there's no logic to trigger it

**How to detect/prevent:**
- Separate bass note selection from upper-voice voicing
- Choose the bass note first based on: default root position, 1st inversion if it creates stepwise bass motion, 2nd inversion only for specific cadential patterns
- Evaluate bass motion independently in the scoring function with high weight
- Prefer bass motion by step (1-2 semitones), by perfect 4th/5th (5-7 semitones), avoid tritone leaps

### 2.9 Overuse of Theoretically Legal but Contextually Weak Chords

**What it is:** The functional substitution system (`generateAdvancedProgression.ts:129-142`) groups chords into families:
- Tonic: I, iii, vi
- Subdominant: ii, IV
- Dominant: V, vii

And swaps chords within families with 55% probability. While iii and vi *can* function as tonic substitutes, they're significantly weaker than I in most contexts. Replacing I with iii at a cadence point sounds evasive rather than resolving. Similarly, vii as a dominant substitute is weak compared to V — it lacks the bass-note gravity of V.

**Why it sounds bad:** A progression that ends iii-vi-iii instead of V-IV-I sounds harmonically directionless. The chords are "correct" by theory (they're in the same functional family) but they lack the gravitational pull that listeners expect. The iii chord in particular is the weakest chord in the major diatonic set — it has ambiguous function and provides little harmonic momentum.

**How to detect/prevent:**
- Weight substitution candidates: I (weight 1.0) vs. vi (0.4) vs. iii (0.15) as tonic substitutes
- Never substitute at cadence points (first or last position)
- Require V (not vii) at dominant positions in phrase-final cadences
- Model chord "strength" as a property and avoid too many consecutive weak chords

### 2.10 Insufficient Modeling of Tension and Release

**What it is:** There is no tension model anywhere in the codebase. The system doesn't know that V7 is tense and wants to resolve to I, that a suspension creates tension that demands resolution, or that a series of pre-dominant chords should build expectation. Every chord is treated as an independent event.

**Why it sounds bad:** Music *is* tension and release. A chord progression that doesn't model this is like prose without sentence structure — individual words may be correct but the sequence doesn't communicate meaning. The listener's emotional engagement comes from anticipation (tension building) and satisfaction (tension releasing). Without this, even complex progressions feel emotionally inert.

**How to detect/prevent:**
- Assign tension values: I/i = 0.0 (fully resolved), IV/iv = 0.3 (mild departure), ii = 0.4 (pre-dominant), V7 = 0.8 (strong tension), viidim = 0.9 (extreme tension), altered dominants = 0.95
- Ensure tension generally rises toward the cadence point and drops at resolution
- Gate chromatic substitutions to high-tension positions
- Gate rich extensions to moderate-to-high tension positions

---

## 3. Voicing Audit

### 3.1 Current Voicing Pipeline (Step by Step)

| Step | Function | File:Line | What It Does | Problem |
|------|----------|-----------|-------------|---------|
| 1 | `toIntervals()` | voicing.ts:4-16 | Converts pitch classes to semitone intervals from root | None — works correctly |
| 2 | `buildStackedVoicing()` | voicing.ts:18-33 | Fills `voiceCount` slots by repeating interval pattern across octaves | **Critical** — creates octave-parallel doubling |
| 3 | `invert()` | voicing.ts:35-45 | Shifts N lowest notes up 12 semitones | Mechanical — no musical logic for *when* to use each inversion |
| 4 | `applyStyle()` | voicing.ts:47-84 | Applies closed/open/drop2/drop3/spread transforms | Open only moves voice[1]; spread is too aggressive |
| 5 | `normalizeVoicingToRange()` | voicing.ts:96-122 | Shifts entire voicing by octaves to fit range | Moves all voices together — no individual adjustment |
| 6 | `generateVoicingCandidates()` | voicing.ts:148-179 | Enumerates all combinations of style x octave x inversion | Brute-force enumeration produces many bad candidates |

### 3.2 Deep Critique of Each Step

#### `buildStackedVoicing` — The Core Problem

For a C major triad `[0, 4, 7]`:
- `voiceCount: 3` → `[C3, E3, G3]` — Fine, no doubling needed
- `voiceCount: 4` → `[C3, E3, G3, C4]` — Root doubled at octave. Acceptable if intentional, but it's the *only* option generated
- `voiceCount: 5` → `[C3, E3, G3, C4, E4]` — Third doubled at octave. This is the specific configuration described in the user's concern. Two complete triads stacked in adjacent octaves. This creates:
  - 5 voices where 3 unique pitch classes are present
  - The 3rd (E) doubled, which over-emphasizes chord quality
  - Parallel octaves between E3→E4 and C3→C4
  - No voice independence — the upper octave is a clone of the lower

For a Cmaj7 chord `[0, 4, 7, 11]`:
- `voiceCount: 4` → `[C3, E3, G3, B3]` — Fine, each tone present once
- `voiceCount: 5` → `[C3, E3, G3, B3, C4]` — Root doubled at octave, acceptable
- But note: the 5th (G) is present and takes up a voice. In jazz/contemporary voicing, the 5th is routinely omitted from 7th chords because it adds no color (it's the most "generic" interval). Omitting it would free a voice for more interesting spacing.

For a C9 chord `[0, 2, 4, 7, 10]` (root, 9th, 3rd, 5th, 7th):
- `voiceCount: 4` → `[C3, D3, E3, G3]` — Only 4 of 5 tones, and a densely packed cluster in a low register. D3-E3 is a major 2nd (2 semitones) — this will sound crunchy and muddy.
- `voiceCount: 5` → `[C3, D3, E3, G3, A#3]` — All tones, but densely packed below middle C. This is deeply muddy.

**The fundamental issue:** The stacking algorithm has no awareness of register-appropriate spacing, no tone prioritization, and no concept of which tones to omit.

#### `applyStyle` — Too Mechanical

The "open" voicing style (`voicing.ts:53-57`) only raises `voiced[1]` by 12 semitones. This is a correct open-voicing technique for exactly 4-voice chords in root position, but it's applied blindly:
- For a 3-voice chord, it raises the middle voice, which may create a huge gap
- For a 5-voice chord, it only opens one gap, leaving the others close
- It doesn't adapt to register — opening a voicing that's already in a high register may push a voice out of range

The "spread" style (`voicing.ts:73-78`) raises every other voice by 12, which for a 4-voice chord creates a widely spaced voicing. But this creates exactly 12-semitone gaps between adjacent voices — unnaturally uniform spacing that sounds artificial.

The "drop2" and "drop3" styles are correct jazz voicing techniques but are applied without considering whether the resulting bass note makes harmonic sense.

#### `normalizeVoicingToRange` — Blunt Instrument

This function shifts the entire voicing up or down by octaves until it fits within `[rangeLow, rangeHigh]`. The problem is that it moves *all* voices by the same amount. If the voicing naturally spans C2 to G3 but the range starts at C3, shifting everything up an octave gives C3 to G4 — which may be fine, but the bass lost its low-register gravitas. A better approach would shift individual voices to fit the range while maintaining the voicing's internal structure.

### 3.3 When Note Doubling Is Useful vs. Harmful

| Doubling | When Useful | When Harmful |
|----------|------------|-------------|
| **Root in bass + root in upper voice** | Reinforcing tonal gravity in cadential chords; creating registral span for emphasis | When voicing is already thick; when the chord has many unique tones that need to be heard |
| **5th in upper voice** | Reinforcing an open, powerful texture (power-chord effect, useful in rock/pop contexts) | When the chord has a 7th or higher — the 5th adds no color and wastes a voice |
| **Root in multiple octaves** | Only when creating a pedal-point effect or a dramatic bass anchor | When it creates consecutive parallel octaves with the previous chord |
| **3rd doubled** | Almost never — only in very specific contrapuntal contexts where voice-leading demands it | In virtually all homophonic (chord-based) contexts — doubling the 3rd over-weights the quality-defining tone and creates a "honking" effect |
| **7th doubled** | Never in any context | Doubling a dissonant interval amplifies the dissonance beyond what's desired and creates an unresolvable "sour" sound |
| **Alteration doubled** | Never | Same as 7th — alterations are color tones that should appear once |

### 3.4 How Many Voices Should Be Used

| Musical Context | Recommended Voice Count | Rationale |
|----------------|------------------------|-----------|
| Simple triads (complexity 1) | **3** | Triad has 3 unique tones — no doubling needed |
| Seventh chords (complexity 2) | **4** | Root, 3rd, 7th, + optionally 5th or root doubling. Omitting 5th preferred. |
| Extended chords (complexity 3) | **4** | Root, 3rd, 7th, extension (9th or 13th). Omit 5th. |
| Altered dominant (complexity 4) | **4** | Root, 3rd, 7th, alteration. Omit 5th. 4 voices keeps altered chords focused. |
| Passing/bridge chords | **3** | Lighter texture differentiates them from structural chords |
| Cadential/climactic chords | **4-5** | Fuller voicing for emphasis, with bass root + wide upper spacing |
| Suspension chords | **3-4** | Clean texture so the suspended note is audible |

**Key principle:** The voice count should never exceed the number of unique pitch classes *unless* doubling the root in the bass for emphasis. A triad with 5 voices is almost always wrong.

### 3.5 Close vs. Spread Voicings

**Close voicing** (all notes within one octave): Best for mid-register chords (C4-C5 range), simple progressions, and contexts where clarity matters more than grandeur. Creates a focused, intimate sound. Risk: muddiness if placed too low.

**Open voicing** (voices spread across 1.5-2.5 octaves): Best for piano-style accompaniment, richer harmonic contexts, and when the bass needs to be an octave or more below the upper voices. Creates a fuller, more resonant sound. Risk: "holes" in the voicing if spacing is too wide.

**Spread voicing** (very wide spacing, 2+ octaves): Best for orchestral or ambient textures. Usually inappropriate for piano-style accompaniment. Risk: the chord loses its identity as a unified harmonic event if voices are too far apart.

**Style-awareness rule:** At complexity 1-2, prefer close voicings with optional open for variety. At complexity 3-4, prefer open or drop2 voicings that give extensions room to breathe. Passing chords should always be close (concentrated, brief).

### 3.6 Low-Register Density and Mud

Below C3 (MIDI 48), intervals smaller than a perfect 5th (7 semitones) become acoustically muddy because the harmonic overtone series creates dense beating patterns. Below G2 (MIDI 43), even a perfect 5th starts to become indistinct. This is a psychoacoustic fact, not a stylistic preference.

**Current problem:** The engine happily places `[C3, E3, G3]` (root position C major starting on C3), where the C3-E3 interval is only 4 semitones — a major 3rd in the low register. This is borderline muddy. For a minor chord, `[C3, Eb3, G3]` has C3-Eb3 at only 3 semitones — clearly muddy.

**Rule for software:**
```
if (note < MIDI 48) {                    // below C3
    require next note >= note + 7        // at least a P5 apart
}
if (note >= MIDI 48 && note < MIDI 52) { // C3 to E3
    require next note >= note + 5        // at least a P4 apart
}
if (note >= MIDI 52 && note <= MIDI 72) { // E3 to C5
    any interval >= m2 (1 semitone) OK   // standard range
}
if (note > MIDI 72) {                    // above C5
    require next note >= note + 3        // at least a m3 apart (avoids shrillness)
}
```

### 3.7 Proposed Voicing Framework

#### New Algorithm: `distributeVoices()`

```
function distributeVoices(chord, voiceCount, prevVoicing, context):

  1. DETERMINE ESSENTIAL TONES:
     essential = [root, 3rd]
     if chord has 7th:  essential.add(7th)
     if chord has extension (9, 13, alteration): essential.add(highest_extension)

  2. OMIT UNNECESSARY TONES:
     if chord has 7th AND 5th is perfect (not dim/aug):
         remove 5th from available tones
     available = essential + remaining_tones (up to voiceCount)

  3. SELECT BASS NOTE:
     if prevVoicing exists:
         prevBass = prevVoicing.bass
         bassOptions = [root, 3rd, 5th_if_available]
         for each option, compute bass_interval = |option - prevBass|
         prefer option with:
           - stepwise motion (1-2 semitones): score +3
           - P4/P5 motion (5 or 7 semitones): score +2
           - P8 (12 semitones): score +1
           - tritone (6 semitones): score -3
           - other: score 0
         choose highest-scoring bass option
     else:
         bass = root (root position default)

  4. PLACE BASS NOTE:
     bassMidi = place bass in range [rangeLow, rangeLow + 12]
     preferring the octave closest to prevBass (if exists)

  5. DISTRIBUTE UPPER VOICES:
     remaining = voiceCount - 1 tones to place above bass
     sort remaining tones ascending
     place each tone in the octave that:
       - is above the previous placed tone
       - satisfies spacing rules (see §3.6)
       - if prevVoicing exists, minimizes distance to the
         nearest unmatched voice in prevVoicing
       - avoids placing two voices within 1 semitone unless
         in the mid register (52-72)

  6. VALIDATE:
     check all spacing rules (§3.6)
     check no voice crossing with previous voicing
     check span <= 28 semitones (reasonable maximum)

  7. RETURN [bassMidi, ...upperMidi] sorted ascending
```

#### Note Omission Rules (Explicit)

Priority of tones to **keep** (highest to lowest):
1. **Root** — always in bass
2. **3rd** — always keep (defines major/minor quality)
3. **7th** — always keep in 7th+ chords (defines chord color)
4. **Highest extension** (9th, 13th, or alteration) — keep one for color
5. **5th** — **omit first** if chord has 7th and 5th is perfect

```
pseudo-rule:
if (chord.has7thOrHigher && chord.fifthIsP5):
    omit(5th)
if (voiceCount < essentialTones.length):
    omit in order: 5th → lowest extension → 13th → 9th
    never omit: root, 3rd, 7th (if present)
```

#### Note Doubling Rules (Explicit)

```
if voiceCount > uniqueTones.length:
    if voiceCount == uniqueTones.length + 1:
        double root in bass (one octave below lowest upper voice)
    if voiceCount == uniqueTones.length + 2:
        double root in bass AND double 5th (if present)
    never double: 3rd, 7th, any alteration, any extension
```

#### Inversion Selection Rules

| Inversion | Bass Note | When to Choose |
|-----------|-----------|----------------|
| Root position (0) | Root | Default for structural chords; strong harmonic statements; first chord of phrase; last chord of phrase |
| First inversion (1) | 3rd in bass | When root position would create a bass leap > 5 semitones; when stepwise bass motion is desired; lighter texture wanted |
| Second inversion (2) | 5th in bass | **Only** in specific patterns: cadential 6/4 (I6/4 before V), passing 6/4 (stepwise bass between two root-position chords), pedal 6/4 (bass stays on same note). Never use as a random default. |

```
pseudo-rule:
if (position == "cadential" && nextChord.isDominant):
    use 2nd inversion (cadential 6/4)
elif (|rootBass - prevBass| > 5 && |thirdBass - prevBass| <= 3):
    use 1st inversion (smoother bass line)
else:
    use root position
```

#### Voice-Leading Constraints Between Chords

| Rule | Cost | Rationale |
|------|------|-----------|
| Common tone held in same voice | -2 (reward) | Creates continuity; the held note acts as a thread between chords |
| Stepwise motion (1-2 semitones) | +1 | Ideal non-common-tone motion; smooth, singable |
| Small leap (3-4 semitones) | +3 | Acceptable but less smooth than step |
| Moderate leap (5-7 semitones) | +5 | P4/P5 leaps — acceptable in outer voices, awkward in inner voices |
| Large leap (8-11 semitones) | delta * 1.5 | Sounds disjunct; should be rare |
| Very large leap (12+ semitones) | delta * 2.0 | Octave+ leaps — only for bass; penalize heavily in upper voices |
| Voice crossing | +8 per instance | Voices trade positions — timbral confusion |
| Parallel perfect 5ths | +6 per instance | Archaic hollow sound; eliminates voice independence |
| Parallel perfect octaves | +8 per instance | Eliminates voice independence completely |
| Contrary motion (bass opposite to soprano) | -2 (reward) | Creates dimensional independence; most satisfying to ear |

---

## 4. Progression Logic Audit

### 4.1 Current Pipeline (Detailed Flow)

```
1. Choose template from MAJORISH_TEMPLATES or MINORISH_TEMPLATES (15 each)
   ↓
2. adaptLength() — truncate/pad to numChords
   ↓  padding: random from [1, 3, 5, 4, 6, 0] (ii, IV, vi, V, vii°, I)
   ↓
3. maybeApplyFunctionalSwap() — 55% chance swap interior chord with same-family alternate
   ↓
4. Build diatonic chord plans (buildDiatonicChordPlan for each degree index)
   ↓
5. injectSecondaryDominants() — 36% per position, max 2, forced 1 if 0
   ↓
6. applyTritoneSubstitutions() — 50% per dominant
   ↓
7. insertPassingDiminished() — 58% between whole-step pairs, max 2
   ↓
8. insertSuspensions() — 45% per dominant, max 2
   ↓
9. Force last chord to tonic (if diatonic/functional-sub)
   ↓
10. Limit total length to max(numChords, 4) + 4
```

### 4.2 Critical Progression Problems

#### Templates Are Good but Unannotated

The 15 major and 15 minor templates are well-chosen. They include canonical progressions (I-IV-V-I, I-vi-IV-V, vi-IV-I-V) and interesting variants. However, they carry no metadata about:
- Which positions are structurally important
- What phrase role each position serves
- What tension level each position should have
- Which positions are safe for substitution and which shouldn't be modified

This means the engine can swap a V at a cadence point for a vii° (same "dominant family") and destroy the cadential force. Or it can insert a secondary dominant before the opening tonic and delay the tonal establishment.

#### `adaptLength` Padding Is Aimless

When a 4-chord template needs to be extended to 6 chords, the padding pool `[1, 3, 5, 4, 6, 0]` is chosen from with equal probability. This can produce results like:

```
Template: I - IV - V - I
Padded to 6: I - IV - V - I - vii° - IV
```

The vii° and IV appended after the tonic resolution create an anticlimactic tail. The progression resolved at chord 4 and then... kept going with no purpose. The padding should be role-aware: if extending beyond the cadence, insert a new sub-phrase (continuation → pre-dominant → dominant → cadence).

#### Substitution Chain Over-Expansion

Here's a concrete worst-case trace for C major, 4 chords, complexity 4:

```
Base template: I - vi - IV - V  →  C - Am - F - G

After secondary dominants (2 inserted):
  C - E7 - Am - C7 - F - G

After tritone subs (G becomes Db7):
  C - E7 - Am - C7 - F - Db7

After passing diminished (between C and E7, between F and Db7):
  C - C#°7 - E7 - Am - C7 - F - E°7 - Db7

After suspensions (before Db7):
  C - C#°7 - E7 - Am - C7 - F - E°7 - Db7sus4 - Db7

Result: 9 chords, 6 of them chromatic. The original I-vi-IV-V is unrecognizable.
```

This is not a contrived edge case — with the current probabilities, this scenario occurs regularly at complexity 4.

### 4.3 Recommended Progression Framework

#### Phrase Role System

Every position in a progression should have an assigned role *before* chord selection:

| Role | Function | Musical Effect | Suitable Degrees (Major) | Suitable Degrees (Minor) |
|------|----------|---------------|-------------------------|-------------------------|
| **Opening** | Establish tonal center | Stability, grounding | I (weight 0.7), vi (0.2), iii (0.1) | i (0.7), III (0.2), bVI (0.1) |
| **Continuation** | Maintain energy, gentle departure | Forward motion without strong pull | IV (0.35), ii (0.25), vi (0.25), iii (0.15) | iv (0.30), bVI (0.30), bVII (0.20), III (0.20) |
| **Pre-Dominant** | Build expectation toward dominant | Increasing tension | ii (0.45), IV (0.40), vi (0.15) | ii° (0.40), iv (0.35), bVI (0.25) |
| **Dominant** | Maximum tension | Strong pull toward tonic | V (0.75), V7 (0.20), vii° (0.05) | V (0.60), bVII (0.25), vii° (0.15) |
| **Cadence** | Resolution | Arrival, rest | I (0.85), vi (0.15 for deceptive cadence) | i (0.85), bVI (0.15 for deceptive) |

#### Phrase Templates by Length

```
3 chords: Opening → Dominant → Cadence
4 chords: Opening → Continuation → Dominant → Cadence
5 chords: Opening → Continuation → Pre-Dominant → Dominant → Cadence
6 chords: Opening → Continuation → Pre-Dominant → Dominant → Continuation → Cadence
7 chords: Opening → Continuation → Continuation → Pre-Dominant → Dominant → Continuation → Cadence
8 chords: Opening → Continuation → Pre-Dom → Dom → Opening → Continuation → Dom → Cadence
          (two 4-bar sub-phrases: antecedent + consequent)
```

#### Tension Curve Model

Assign target tension values per position. These drive downstream decisions (substitutions, extensions, voicing density):

```
4 chords:    [0.1, 0.3, 0.8, 0.0]
5 chords:    [0.1, 0.3, 0.5, 0.8, 0.0]
6 chords:    [0.1, 0.3, 0.5, 0.8, 0.3, 0.0]
8 chords:    [0.1, 0.2, 0.5, 0.7, 0.2, 0.3, 0.8, 0.0]
```

**How tension gates decisions:**
- `tension < 0.3`: No chromatic substitutions allowed. Extensions limited to 7th max. Simpler voicing.
- `tension 0.3-0.5`: Secondary dominant allowed if target is strong (I, IV, V, vi). Extensions up to 9th.
- `tension 0.5-0.7`: Secondary dominant encouraged. Passing chords allowed. Extensions up to 13th.
- `tension > 0.7`: All substitutions allowed. Altered dominants allowed. Densest voicings.

#### Controlling Substitution Insertion (Context-Scored)

Instead of flat probability thresholds, score each potential substitution:

```
function scoreSecondaryDominantInsertion(context):
    score = 0
    score += 2 if target is strong diatonic (I, IV, V, vi)
    score += 1 if position.tension > 0.5
    score += 1 if target is approached by 4th/5th from secondary dom root
    score -= 3 if adjacent chord is already non-diatonic
    score -= 2 if position.tension < 0.3
    score -= 1 if totalChromaticCount / totalChords > 0.33

    return score > 2  // only insert if score exceeds threshold
```

#### The 2/3 Rule

In any sliding window of 4 consecutive chords, at least 2 must be diatonic. This prevents the tonal center from dissolving:

```
function validateChromaticDensity(chords):
    for i in range(0, chords.length - 3):
        window = chords[i..i+4]
        diatonicCount = window.filter(c => c.kind == "diatonic").length
        if diatonicCount < 2:
            remove the least-important chromatic chord in the window
```

#### Balancing Novelty with Coherence

**The "anchor chord" principle:** In any progression, at least one chord should appear twice (typically I). This gives the ear a reference point. The current templates already do this in many cases (e.g., I-IV-V-I), but the substitution chain can replace the second I, destroying the anchor.

**Implementation:** Mark anchor chords in templates as "protected" — no substitution, no functional swap, no extension beyond what the base complexity provides.

---

## 5. Transition / Bridge Chord Design

### 5.1 When a Transition Chord Is Appropriate

A transition chord (passing harmony, approach chord, bridge chord) is appropriate when:

1. **Two structural chords are harmonically distant:** E.g., I → bVI (C major to Ab major). A chromatic passing chord between them (C → B°7 → Ab) smooths the arrival.

2. **The bass motion between chords is a large leap (> 4 semitones):** E.g., C in bass to A in bass. A passing chord with D or B in bass fills the gap.

3. **A suspension-to-resolution pairing would create satisfying tension:** E.g., Gsus4 → G7 → C. The sus4 is a brief approach to the dominant.

4. **Chromatic approach by half-step:** E.g., approaching Dm through C#°7 (one semitone below the target root).

A transition chord is **NOT** appropriate when:

1. **The chords already connect smoothly:** V → I already has strong harmonic logic. Adding anything between them weakens the cadence.

2. **The progression is short (3-4 chords):** Every chord needs to carry harmonic weight. Inserting transitions into a 3-chord progression creates clutter.

3. **It would create three consecutive non-diatonic chords:** This dissolves the tonal center.

4. **The surrounding chords are already chromatically complex:** Adding more non-diatonic material to an already colorful sequence creates chaos.

### 5.2 How Transition Chords Differ from Structural Chords

| Property | Structural Chord | Transition Chord |
|----------|-----------------|-----------------|
| **Duration** | Full measure (4 beats) | Half beat to 1 beat |
| **Voice count** | 4 (or contextually appropriate) | 3 (lighter) |
| **Voicing style** | Open, drop2, spread — whatever fits context | Close position (compact, unobtrusive) |
| **Dynamic weight** | Full velocity | Reduced velocity (80% of structural) |
| **Bass note** | Root or contextually chosen inversion | Whatever creates stepwise motion between surrounding structural bass notes |
| **Extensions** | Based on complexity setting | None — keep transition chords simple (triad or 7th max) |
| **Function** | Carries harmonic meaning | Provides connective tissue |

### 5.3 Types of Transition Chords

#### Passing Chord
**What:** A chord whose root is between the roots of two surrounding chords (by step).
**Example:** C → C# → Dm (chromatic passing) or C → D → Em (diatonic passing).
**Duration:** Quarter note (1 beat) or eighth note.
**Voicing:** 3 voices, close position, minimal density.
**When appropriate:** Between whole-step root motions. The current `insertPassingDiminished` does this, but at full duration.

#### Approach Chord
**What:** A dominant-function chord that targets the next chord.
**Example:** D7 → G (D7 is V/V, approaching G which is V).
**Duration:** Half measure (2 beats) to full measure.
**Voicing:** 4 voices, standard density — this is a harmonically meaningful chord.
**When appropriate:** Before structurally important chords (V, I, IV). The current `injectSecondaryDominants` does this, but without duration differentiation.

#### Suspension
**What:** A chord where the 3rd is temporarily replaced by the 4th, creating tension that resolves.
**Example:** Gsus4 → G7 → C. The sus4 creates tension, the 7th resolves it, then the tonic resolves the dominant.
**Duration:** 1-2 beats, always paired with its resolution within the same time slot.
**Voicing:** 3-4 voices, clean — the suspended note needs to be audible.
**Implementation:** A suspension should **not** be a separate chord event. It should be scheduled as a sub-event *within* the dominant chord's time slot: first half = sus4, second half = dom7.

#### Embellishing Chord
**What:** A brief chord that decorates a structural chord without changing the harmonic function.
**Example:** C/E (first inversion C) used briefly before C (root position C) — same chord, different voicing.
**Duration:** 1 beat.
**When appropriate:** Between repeated instances of the same structural chord. Adds motion without changing harmony.

#### Cadential Setup
**What:** A specific voicing pattern that signals an approaching cadence.
**Example:** I6/4 → V → I (the cadential 6/4 is the tonic chord in second inversion, functioning as a dominant approach).
**Duration:** Half measure (the 6/4 and the V share the dominant's time slot).
**When appropriate:** At the end of a phrase, before the final V → I.

### 5.4 Implementation Model

```typescript
type ChordRole =
  | "structural"     // Full-weight main harmony event
  | "passing"        // Brief chromatic or diatonic connection (quarter/eighth duration)
  | "approach"       // Dominant preparation targeting next chord (half/full duration)
  | "suspension"     // Tension within a chord's time slot (paired with resolution)
  | "embellishment"  // Decorative variant of structural chord (quarter duration)
  | "cadential";     // Cadential setup (shares time with dominant)

type DurationClass =
  | "full"           // 4 beats (1 measure)
  | "half"           // 2 beats
  | "quarter"        // 1 beat
  | "eighth";        // half beat

type EnrichedChordPlan = PlannedAdvancedChord & {
  role: ChordRole;
  durationClass: DurationClass;
  tensionLevel: number;     // 0.0 - 1.0
  voiceCountOverride?: number;  // if set, overrides context voiceCount
};
```

#### Scheduling Algorithm

```
function scheduleTransitionChords(structural: EnrichedChordPlan[]): EnrichedChordPlan[] {
    result = []

    for i in 0..structural.length:
        current = structural[i]
        next = structural[i + 1]  // null if last

        result.push(current)

        if next is null: continue

        // Case 1: Large bass leap → insert passing chord
        bassInterval = |current.root - next.root| in semitones
        if bassInterval >= 3 AND bassInterval != 5 AND bassInterval != 7:
            passingRoot = midpoint between current.root and next.root
            transition = buildPassingChord(passingRoot, "quarter", voiceCount: 3)
            current.durationClass = "half"  // shorten current to make room
            result.push(transition)

        // Case 2: Dominant chord → add suspension sub-event
        elif next.isDominant AND next.role == "structural":
            suspension = buildSuspension(next.root, "quarter")
            // Don't add as separate event — mark the dominant's first half as sus4
            next.hasSuspensionPrefix = true

        // Case 3: Approaching a strong chord with a secondary dominant
        // (Already handled by substitution phase, but ensure duration is "half")
        elif current.kind == "secondary-dominant":
            current.durationClass = "half"

    return result
}
```

### 5.5 How Transition Chords Improve Specific Progressions

**Before (current behavior):**
```
| C major    | C#dim7     | D minor   | G7        | C major   |
| 4 beats    | 4 beats    | 4 beats   | 4 beats   | 4 beats   |
  ↑ structural  ↑ JARRING    ↑ structural ↑ structural ↑ structural
```

The C#dim7 sits for a full measure — it's a prominent, sustained dissonance that sounds like the wrong key.

**After (with transition chord system):**
```
| C major    |C#°7| D minor        | G7sus4|G7 | C major        |
| 3 beats    |1bt | 4 beats        | 1 bt  |3bt| 4 beats        |
  ↑ structural ↑pass ↑ structural    ↑ sus   ↑dom ↑ cadence
```

The C#dim7 is a brief quarter-note slide. The Gsus4 creates a moment of tension within the dominant's time slot. The progression breathes naturally.

---

## 6. Proposed Scoring Model

### 6.1 Scoring Dimensions Table

| # | Dimension | Weight | Type | What It Measures | Why It Matters |
|---|-----------|--------|------|-----------------|---------------|
| 1 | **Voice-leading smoothness** | 25% | Penalty (lower is better) | Total semitone motion across all voices, with leaps penalized progressively | The most perceptible quality. Smooth voice leading is what makes chords feel "connected" vs. "random." |
| 2 | **Bass motion quality** | 20% | Mixed (reward good, penalize bad) | Whether bass moves by step, 4th/5th, or awkward leap | Bass defines harmonic rhythm. A strong bass line can save a mediocre progression; a weak one ruins a good one. |
| 3 | **Common-tone retention** | 15% | Reward | Number of pitch classes shared between adjacent chords | Common tones create continuity. C→Am shares two tones (C, E), making the transition seamless. |
| 4 | **Spacing quality** | 10% | Penalty | Violations of register-specific spacing rules (§3.6) | Low-register mud and high-register harshness are immediately audible. |
| 5 | **Harmonic plausibility** | 10% | Penalty | How far the chord is from the diatonic set (0 = diatonic, 1 = one altered note, etc.) | Non-diatonic chords need proportionally more musical justification. |
| 6 | **Register balance** | 5% | Penalty | Deviation of voicing center from the target center of the range | Voicings that cluster too high or too low sound unbalanced. |
| 7 | **Parallel 5ths/octaves** | 5% | Hard penalty | Count of parallel perfect intervals between adjacent voicings | These are the most perceptible voice-leading errors — immediately audible. |
| 8 | **Voice crossing** | 5% | Hard penalty | Count of voice crossings between adjacent voicings | Creates timbral confusion; voices "jump" registers unpredictably. |
| 9 | **Phrase arc fit** | 5% | Mixed | Does the chord's complexity/tension match the target tension curve? | Progressions need shape — tension should rise and fall, not flatline. |

### 6.2 Detailed Scoring Formulas

#### Voice-Leading Smoothness (25%)

For each voice `i` in the chord (matched to the nearest voice in the previous chord via greedy assignment):

```
delta = |prev_voice[i] - next_voice[i]|

if delta == 0:  cost_i = 0           // common tone held — ideal
if delta <= 2:  cost_i = 1           // stepwise motion — excellent
if delta <= 4:  cost_i = delta       // small leap — acceptable
if delta <= 7:  cost_i = delta * 1.3 // moderate leap — penalized
if delta > 7:   cost_i = delta * 2.0 // large leap — heavily penalized

voice_leading_cost = sum(cost_i for all voices)
```

#### Bass Motion Quality (20%)

```
bass_delta = |prev_bass - next_bass| mod 12

if bass_delta == 0:      bass_score = +1     // static bass — slightly boring
if bass_delta in [1, 2]: bass_score = -3     // stepwise — excellent
if bass_delta in [5, 7]: bass_score = -3     // P4/P5 — strong harmonic motion
if bass_delta == 6:      bass_score = +5     // tritone — awkward, jarring
if bass_delta in [3, 4]: bass_score = +1     // 3rd-based — acceptable
if bass_delta in [8, 9]: bass_score = +2     // large interval — bit disjunct
if bass_delta in [10,11]:bass_score = 0      // near-step in other direction

// Bonus: if bass creates a pattern (consecutive steps, consecutive 5ths)
if last 3 bass motions are all steps: bass_score -= 2  // smooth bass line reward
```

#### Common-Tone Retention (15%)

```
shared_pitch_classes = intersection(prev.pitchClasses, next.pitchClasses)
common_tone_reward = shared_pitch_classes.length * 2

// Maximum possible = 3 (for triads) or 4 (for 7th chords)
// Normalize: common_tone_score = (max_possible - common_tone_reward)
```

#### Spacing Quality (10%)

```
spacing_violations = 0

for each pair of adjacent voices [note_low, note_high]:
    interval = note_high - note_low

    if note_low < 48 AND interval < 7:   // below C3, need P5+
        spacing_violations += (7 - interval) * 2
    if note_low < 52 AND interval < 5:   // below E3, need P4+
        spacing_violations += (5 - interval) * 1.5
    if note_low > 72 AND interval < 3:   // above C5, need m3+
        spacing_violations += (3 - interval) * 1
    if interval > 12:                    // gap > octave between voices
        spacing_violations += (interval - 12) * 0.5  // "hole" in voicing
```

#### Harmonic Plausibility (10%)

```
diatonic_scale = getDiatonicPitchClasses(key, mode)  // 7 pitch classes
chord_pitch_classes = chord.pitchClasses

chromatic_notes = chord_pitch_classes.filter(pc => !diatonic_scale.includes(pc))
chromatic_distance = chromatic_notes.length

// Diatonic chords = 0, secondary dominants = 1-2, altered chords = 2-3
```

#### Composite Score

```
total_score =
    voice_leading_cost * 0.25 +
    bass_score * 0.20 +
    (max_common_tones - common_tone_reward) * 0.15 +
    spacing_violations * 0.10 +
    chromatic_distance * 2.0 * 0.10 +
    register_deviation * 0.05 +
    parallel_violations * 6.0 * 0.05 +
    crossing_violations * 8.0 * 0.05 +
    arc_mismatch * 0.05

// Lower total_score is better.
// Select the voicing candidate with minimum total_score.
```

### 6.3 Which Categories Deserve Greatest Weight

The top 3 categories (voice-leading smoothness, bass motion quality, common-tone retention) account for **60%** of the total score. This is intentional because:

1. **Voice-leading smoothness (25%)** is the single most perceptible quality difference. Listeners can tolerate odd chord choices if the voice leading is smooth; they cannot tolerate jerky voice motion even with great chord choices.

2. **Bass motion (20%)** has outsized perceptual impact because the bass is the loudest, most prominent voice in most musical textures. A smooth bass line carries the listener through the progression.

3. **Common-tone retention (15%)** creates the "glue" between chords. When notes carry over between chords, the transition feels connected rather than like a jump cut.

The remaining 40% handles spacing, register, structural violations, and style-level concerns that matter but are less immediately audible.

---

## 7. Phased Improvement Plan

### Phase 1 — Fast Fixes (1-2 days)

**Objective:** Immediate quality gains with minimal code changes.

**Changes:**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | Expand default range | `progressionStore.ts:104-105` | Change `rangeLow: 48, rangeHigh: 72` to `rangeLow: 48, rangeHigh: 79` (C3-G5) |
| 2 | Cap effective voice count | `voicing.ts` or `generateAdvancedProgression.ts` | `effectiveVoiceCount = Math.min(voiceCount, chord.pitchClasses.length + 1)` — never more than unique tones + 1 root doubling |
| 3 | Low-register spacing guard | `voicing.ts:normalizeVoicingToRange` | After normalization, reject candidate if any two adjacent notes below MIDI 52 are < 5 semitones apart |
| 4 | Limit substitution count | `substitutions.ts` | `maxInsertions = Math.max(1, Math.floor(numChords / 3))` per substitution function |
| 5 | Remove forced secondary dominant | `substitutions.ts:54-58` | Delete the `if (insertions === 0)` block that forces one insertion |
| 6 | Selective extension application | `extensions.ts:47-52` | At complexity 3, only add 9th to ~60% of chords (`random() > 0.4`); only add 13th to ~25% (`random() > 0.75`) |

**Expected benefit:** Less mud (wider range + spacing guard), less chromatic clutter (insertion limits + no forced secondary dominant), more contrast (selective extensions). Immediately more listenable without any architectural changes.

**Risks:** Changing range may alter existing test snapshots. Reduced substitution count may feel "less complex" to users who expect lots of color at higher complexity levels.

**Validation tests:**
- Generate 10 progressions: C major, complexity 2, 4 chords. Listen for clarity and connection between chords.
- Generate 5 progressions: F major, complexity 4, 6 chords. Verify no more than 2 consecutive non-diatonic chords.
- Generate 5 progressions: A minor, complexity 1, 3 chords. Should sound perfectly clean.

### Phase 2 — Voicing Redesign (3-5 days)

**Objective:** Replace `buildStackedVoicing` with `distributeVoices` (§3.7).

**Changes:**

| # | Change | File | Details |
|---|--------|------|---------|
| 1 | New `distributeVoices()` | `voicing.ts` | Implements §3.7 algorithm: essential tones → omit 5th → select bass → distribute upper voices |
| 2 | Bass-first voicing | `voicing.ts` | Select bass note independently based on inversion rules (§3.7), then voice upper tones above it |
| 3 | Voice-identity cost function | `voiceLeading.ts` | Replace sorted-position comparison with greedy nearest-match assignment |
| 4 | Add voice-crossing penalty | `voiceLeading.ts` | +8 cost per crossing |
| 5 | Add parallel 5th/octave penalty | `voiceLeading.ts` | +6 per parallel P5, +8 per parallel P8 |
| 6 | Add common-tone retention bonus | `voiceLeading.ts` | -2 per common tone held in the same voice |
| 7 | Update `generateVoicingCandidates` | `voicing.ts` | Use `distributeVoices` instead of `buildStackedVoicing` for candidate generation |

**Expected benefit:** Dramatic improvement in chord-to-chord smoothness. Elimination of organ-like parallel doubling. More varied, natural voicings. Bass lines that move purposefully.

**Risks:** This is a complete replacement of the voicing core. All existing voicing tests will need updating. Drop2/drop3 style behavior needs re-validation. The inversion selection logic is new and needs tuning.

**Validation tests:**
- Unit: C major triad, 4 voices → should produce [C3, G3, C4, E4] or similar (root doubled, NOT [C3, E3, G3, C4] with E and C doubled)
- Unit: Cmaj7, 4 voices → should produce [C3, E3, B3, (no G)] or [C3, B3, E4, (no G)] — 5th omitted
- Unit: voice-leading cost from Cmaj to Am → common tones (C, E) should be held; cost should be very low
- Unit: voice crossing between [C3, E3, G3] and [E3, C3, G3] → detected and penalized
- Listening: 4-chord progressions should feel "connected" — each chord flows naturally into the next

### Phase 3 — Progression Logic Redesign (3-5 days)

**Objective:** Add phrase structure, tension modeling, and contextual substitution scoring.

**Changes:**

| # | Change | File(s) | Details |
|---|--------|---------|---------|
| 1 | Define phrase role templates | New file `phraseStructure.ts` | Phrase templates by length (§4.3): role arrays for 3-8 chord progressions |
| 2 | Tension curve generation | `phraseStructure.ts` | Generate tension value arrays per phrase length (§4.3) |
| 3 | Role-aware chord selection | `generateAdvancedProgression.ts` | Use role-weighted degree selection instead of flat template + random padding |
| 4 | Contextual substitution scoring | `substitutions.ts` | Replace flat probability with scoring functions (§4.3) that consider tension, adjacent chromaticism, position |
| 5 | Chromatic density validation | `substitutions.ts` | Enforce 2/3 rule: in any 4-chord window, at least 2 must be diatonic |
| 6 | Selective complexity extensions | `extensions.ts` | Gate extensions by tension level: low tension → simpler (triad/7th), high tension → richer (9th, 13th, alterations) |
| 7 | Replace `adaptLength` random padding | `generateAdvancedProgression.ts` | Use role-appropriate degree selection instead of random from `[1, 3, 5, 4, 6, 0]` |
| 8 | Protect anchor positions | `generateAdvancedProgression.ts` | Mark first and last positions as "protected" — no functional swaps or substitutions |

**Expected benefit:** Progressions with audible arc and direction. Substitutions that enhance rather than clutter. Contrast between simple tonic chords and rich dominant chords. Longer progressions (6-8 chords) that tell a harmonic story.

**Risks:** Most complex change. Phrase templates need careful design and testing per mode. Could over-constrain variety if tension curves are too rigid. The scoring functions need parameter tuning.

**Validation tests:**
- Generate 20 progressions of each length (4, 6, 8) — listen for audible phrase arc
- Verify: no more than 2 consecutive non-diatonic chords at any complexity
- Verify: last 2 chords always sound like a cadence (dominant-function → tonic)
- Verify: complexity 1 progressions have no chromatic insertions
- Compare old vs. new at complexity 4: new should sound "intentional" rather than "chaotic"

### Phase 4 — Transition Chord System (2-3 days)

**Objective:** Implement the structural/passing/approach chord framework from §5.

**Changes:**

| # | Change | File(s) | Details |
|---|--------|---------|---------|
| 1 | Add `role` and `durationClass` to types | `types.ts` | New fields on `PlannedAdvancedChord` or new `EnrichedChordPlan` type |
| 2 | Assign roles to existing chord kinds | `substitutions.ts` | passing → "passing", secondary-dominant → "approach", suspension → "suspension", diatonic → "structural" |
| 3 | Duration-aware MIDI export | `progressionMidiExport.ts` | Variable beat allocation per chord based on `durationClass` |
| 4 | Lighter voicing for passing chords | `generateAdvancedProgression.ts` | Override `voiceCount` to 3 for passing chords; use close position |
| 5 | Suspension-resolution pairing | `substitutions.ts` | Instead of separate sus4 → dom chord events, create paired sub-events within one time slot |
| 6 | Duration-aware Tone.js playback | UI playback code | Schedule chords with variable time offsets based on `durationClass` |

**Expected benefit:** Passing chords become quick, graceful slides instead of jarring full-weight events. Suspensions gain proper resolution timing. Approach chords feel like brief tonicizations rather than key changes.

**Risks:** Variable-duration playback is a significant change to the Tone.js scheduling loop. Piano roll / chord display visualization needs updating for variable widths. MIDI export needs careful timing calculation.

**Validation tests:**
- Passing diminished chords should sound like brief "slides" between structural chords
- Suspensions should audibly resolve (sus4 → dom within one time slot)
- Total progression duration should be approximately the same (transition chords share time with their structural neighbors, not add time)
- MIDI export should produce correct variable-length note events

### Phase 5 — Evaluation and Tuning (Ongoing)

**Objective:** Systematic quality assessment and parameter tuning.

**Changes:**

| # | Change | Details |
|---|--------|---------|
| 1 | Debug panel | Show voice-leading costs, tension curve, phrase roles, bass line for each chord in the UI |
| 2 | A/B comparison mode | Generate two progressions side by side: one with current settings, one with an alternative |
| 3 | Regression test suite | 50 seeded progressions across all modes and complexity levels, with snapshot tests |
| 4 | Scoring histogram | Visualize the distribution of voice-leading costs across generated progressions |
| 5 | Parameter sweep tool | Systematically vary scoring weights and measure average voice-leading cost |

**Expected benefit:** Data-driven tuning. Confidence that changes improve quality. Early detection of regressions.

**Validation:**
- Blind A/B listening tests: play random old vs. new, rate preference (target: >70% preference for new)
- Automated metric: average voice-leading cost should decrease by >30% after Phase 2
- No regression in snapshot tests after parameter changes

---

## 8. Verification Checklist

### 8.1 Listening Test Criteria

For each generated progression, the human developer should assess:

- [ ] **Connectivity:** Does each chord feel connected to the previous one? No jarring, unexplained jumps.
- [ ] **Unity:** Does the progression feel like one musical idea, not a random sequence of chords?
- [ ] **Surprise quality:** Are there any "where did that come from?" chords that feel out of place?
- [ ] **Transition smoothness:** Do passing/bridge chords help motion rather than cluttering it?
- [ ] **Density:** Are voicings too thick, muddy, or organ-like? Especially check bass register.
- [ ] **Variety:** Do consecutive chords sound different enough in texture? Or are they all identical blocks?
- [ ] **Tension arc:** Is there a convincing sense of tension building toward a climax and releasing?
- [ ] **Complexity fit:** Do complex progressions sound intentional and sophisticated, not chaotic?
- [ ] **Ending quality:** Does the progression end with a convincing sense of arrival/resolution?
- [ ] **Bass line:** Does the bass motion sound purposeful and smooth? Can you hum the bass line?
- [ ] **Duration appropriateness:** Do passing chords feel brief? Do structural chords have adequate time?

### 8.2 A/B Test Protocol

1. Choose 10 configurations spanning all modes and complexity levels (see §8.4)
2. For each, generate a progression with old logic (save with a seed)
3. Generate the same seed with new logic
4. Play pairs blind (randomize A/B assignment)
5. Rate each 1-5 on: smoothness, musicality, density appropriateness, harmonic direction
6. Record which version is preferred per pair
7. Target: new version preferred in >70% of pairs

### 8.3 Representative Test Cases

| # | Test Case | Key | Mode | Chords | Complexity | What to Listen For |
|---|-----------|-----|------|--------|------------|-------------------|
| 1 | Simple pop | C | Major | 4 | 1 | Clean, familiar, uncluttered |
| 2 | Rich pop | G | Major | 4 | 2 | 7th chords add warmth without muddiness |
| 3 | Extended jazz | F | Major | 4 | 3 | Colorful extensions feel intentional |
| 4 | Altered jazz | Bb | Major | 4 | 4 | Alterations sound sophisticated, not chaotic |
| 5 | Minor moody | A | Minor | 4 | 2 | Dark but smooth transitions |
| 6 | Long form major | C | Major | 8 | 2 | Clear phrase arc, sense of journey |
| 7 | Long form minor | D | Minor | 6 | 3 | Direction despite length and complexity |
| 8 | Dorian modal | D | Dorian | 4 | 2 | Dorian color (natural 6th) preserved |
| 9 | Mixolydian blues | G | Mixolydian | 4 | 2 | Dominant 7th on I feels natural |
| 10 | Phrygian dark | E | Phrygian | 4 | 2 | bII chord (F major) is prominent, exotic |

### 8.4 Edge Cases to Test

- **3 chords, complexity 1:** Should be perfectly clean — no insertions, no extensions, simple triads
- **8 chords, complexity 4:** Maximum system stress — should still be coherent despite length and chromaticism
- **All modes with same root and settings:** Character should clearly differ between ionian, aeolian, dorian, mixolydian, phrygian
- **Extreme key (F#):** No bugs from enharmonic handling, no wrong notes
- **Repeated generation with different seeds:** Variety should be evident — not the same progression every time
- **numChords = 1:** Edge case — should produce a single well-voiced tonic chord
- **numChords = 12:** Should still produce a coherent phrase (probably two sub-phrases)

### 8.5 Red Flags — Outputs That Should Be Flagged as Poor

Any of these in generated output indicates a quality problem:

| Red Flag | Why It's Bad |
|----------|-------------|
| Three or more consecutive non-diatonic chords | Tonal center dissolves |
| Bass jumping by tritone between structural chords | Sounds like a mistake |
| Two adjacent diminished chords | Excessive symmetry, no tonal anchor |
| Passing chord longer than adjacent structural chord | Wrong temporal emphasis |
| Secondary dominant that doesn't resolve to its target | Sounds like a wrong key change |
| All chords having identical voice count and spacing | No textural variety |
| Voice-leading cost > 20 for any single chord transition (4 voices) | Excessive total motion |
| Any voice leaping more than an octave | Unless it's the bass, this sounds random |
| Soprano and bass moving in parallel octaves | Eliminates voice independence |
| Progression ending on a chord that isn't I/i | Unresolved, unsatisfying |
| Every chord in a 4+ chord progression having a 9th | No contrast between stable and tense |

---

## 9. Architectural Recommendations

### 9.1 Chord Representation — Enriched Plan

```typescript
// The core internal representation for a chord in the pipeline
type ChordPlan = {
  // Identity
  root: PitchClass;
  pitchClasses: PitchClass[];     // Abstract pitch classes (unvoiced)
  symbol: string;                  // Display: "Cmaj7", "Dm9", "G7alt"
  degreeLabel: string;             // Roman numeral: "V/vi", "ii", "bVII"

  // Harmonic function — set explicitly when building the plan
  harmonicFunction: "tonic" | "subdominant" | "dominant" | "chromatic";
  stability: number;              // 0.0 (most stable, I/i) to 1.0 (most unstable, viidim)

  // Phrase role — assigned by phrase template before chord selection
  role: ChordRole;                // structural, passing, approach, suspension, etc.
  durationClass: DurationClass;   // full, half, quarter, eighth
  tensionLevel: number;           // 0.0-1.0, from tension curve

  // Voice-leading hints — set during planning, used during voicing
  preferredBassNote: PitchClass | null;  // null = use root
  preferredInversion: 0 | 1 | 2 | null; // null = auto-select based on context

  // Origin tracking
  kind: ChordKind;               // diatonic, secondary-dominant, passing, etc.
  isDominant: boolean;
  isProtected: boolean;           // if true, no substitutions or swaps allowed
};
```

### 9.2 Voicing Output

```typescript
type VoicingResult = {
  bass: number;            // MIDI note for bass voice
  upper: number[];         // MIDI notes for upper voices, sorted ascending
  allMidi: number[];       // [bass, ...upper] combined and sorted
  allNotes: string[];      // Human-readable: ["C3", "G3", "C4", "E4"]

  // Metadata
  style: VoicingStyle;
  voiceCount: number;
  inversion: 0 | 1 | 2;
  omittedTones: PitchClass[];    // which tones were omitted (e.g., ["G"] for 5th omission)
  doubledTones: PitchClass[];    // which tones were doubled (e.g., ["C"] for root doubling)

  // Scoring
  voiceLeadingCost: number;      // from previous chord
  totalScore: number;            // composite score from all dimensions
};
```

### 9.3 Progression Context (Running State)

```typescript
type ProgressionContext = {
  // Fixed for the entire progression
  key: PitchClass;
  mode: Mode;
  diatonicScale: PitchClass[];   // 7 pitch classes of the scale
  phraseLength: number;
  tensionCurve: number[];        // one tension value per position
  phraseRoles: ChordRole[];      // one role per position

  // Updated as chords are generated (running state)
  chromaticDensity: number;      // count of non-diatonic chords in last 4-chord window
  previousChordPlan: ChordPlan | null;
  previousVoicing: VoicingResult | null;
  bassHistory: number[];         // last N bass notes for pattern detection
  position: number;              // current position in the progression
};
```

### 9.4 What to Encode Explicitly vs. Infer Dynamically

| Data | Approach | Reason |
|------|----------|--------|
| **Harmonic function** (tonic/subdominant/dominant/chromatic) | **Explicit** — set when building chord plan | Inference from degree alone is unreliable for borrowed/chromatic chords. A V/V is "dominant" but not scale-degree V. |
| **Phrase role** (opening/continuation/pre-dominant/dominant/cadence) | **Explicit** — assigned before chord selection | This drives all downstream decisions. Must be set as part of the template. |
| **Tension level** (0.0-1.0) | **Explicit** — from tension curve template | Must be globally consistent across the progression. |
| **Duration class** (full/half/quarter/eighth) | **Explicit** — based on chord role | Critical for playback timing. Passing = quarter, structural = full, etc. |
| **Pitch class set** | **Explicit** — built from theory functions | Core identity. Must be deterministic from scale + degree + extensions. |
| **Preferred inversion** | **Infer** — from bass motion optimization | Depends on the previous chord's bass note, which changes during generation. |
| **Voice count per chord** | **Infer** — from role + complexity | Passing chords auto-reduce to 3. Structural use context's voiceCount. |
| **Voicing (MIDI notes)** | **Infer** — from voicing algorithm + scoring | The whole point of the voicing engine. |
| **Whether a substitution should be inserted** | **Infer** — from context scoring | Depends on adjacent chords, chromatic density, tension level — all dynamic. |
| **Which extension to apply** | **Infer** — gated by tension level + harmonic function | Low tension = simpler, high tension = richer. Dominant gets more color than tonic. |

### 9.5 Recommended File Organization

```
lib/music/generators/advanced/
├── types.ts                    // ChordPlan, VoicingResult, ProgressionContext, enums
├── phraseStructure.ts          // NEW: phrase role templates, tension curves
├── chordSelection.ts           // NEW: role-weighted chord selection with scoring
├── voicing.ts                  // REWRITE: distributeVoices(), bass-first voicing
├── voiceLeading.ts             // REWRITE: greedy voice matching, crossing/parallel detection
├── scoring.ts                  // NEW: composite scoring model (§6)
├── extensions.ts               // MODIFY: tension-gated extension application
├── substitutions.ts            // MODIFY: context-scored insertion, 2/3 rule
├── generateAdvancedProgression.ts  // MODIFY: use phrase structure, tension curves
└── index.ts                    // Registry entry point (unchanged)
```

---

## 10. Top 10 Highest-Leverage Changes

Ranked by expected impact on listening quality per unit of implementation effort:

| Rank | Change | Impact | Effort | Primary File |
|------|--------|--------|--------|-------------|
| **1** | **Replace `buildStackedVoicing` with `distributeVoices`** — omit 5th when 7th present, don't parallel-double, cap voices at unique tones + 1 | Massive — fixes the mud, the organ-like texture, the identical chord weights | Medium | `voicing.ts` |
| **2** | **Add bass-first voicing** — select bass note based on stepwise/5th motion from previous bass, then voice upper tones above it | Large — fixes aimless bass lines, gives progressions directional gravity | Medium | `voicing.ts` |
| **3** | **Cap effective voice count** at `min(voiceCount, pitchClasses.length + 1)` | Large — instant density fix, prevents triad-with-5-voices | Tiny (one line) | `voicing.ts` |
| **4** | **Implement voice-identity tracking** in `calculateVoiceLeadingCost` using greedy nearest-match instead of sorted comparison; add crossing/parallel penalties | Large — fixes voice crossing and disconnected upper voices | Medium | `voiceLeading.ts` |
| **5** | **Add `durationClass` to passing/suspension chords** and implement variable-duration playback | Large — transforms passing chords from jarring events to smooth transitions | Medium | `types.ts`, `substitutions.ts`, MIDI export, UI playback |
| **6** | **Limit substitution insertions** to `floor(numChords / 3)` per type; remove forced secondary dominant; enforce 2/3 diatonic rule | Medium — fixes chromatic thrashing | Small | `substitutions.ts` |
| **7** | **Selective complexity extensions** — apply 9th/13th based on harmonic function (richer on dominant, simpler on tonic) instead of uniformly | Medium — adds contrast between stable and tense chords | Small | `extensions.ts` |
| **8** | **Expand default range** from C3-C5 (48-72) to C3-G5 (48-79) with low-register spacing enforcement | Medium — more room for good voicings, less forced-close packing | Tiny | `progressionStore.ts`, `voicing.ts` |
| **9** | **Add phrase roles and tension curve** to guide chord selection and gate substitutions/extensions | Medium-Large — fixes aimless long progressions, gives them narrative arc | Large | New `phraseStructure.ts`, modifications to `generateAdvancedProgression.ts` |
| **10** | **Add common-tone retention bonus** and **contrary-motion reward** to voice-leading scoring | Medium — improves perception of smoothness and voice independence | Small | `voiceLeading.ts` |

### Quick-Win Implementation Order

If working on this incrementally, the recommended order for maximum impact with minimum risk is:

1. **#3** (cap voice count) — one line, instant improvement
2. **#8** (expand range) — two constants, immediate benefit
3. **#6** (limit substitutions) — small changes to substitutions.ts, big coherence improvement
4. **#7** (selective extensions) — small change to extensions.ts, adds contrast
5. **#1** (distributeVoices) — larger effort but the single biggest quality leap
6. **#2** (bass-first voicing) — builds on #1, completes the voicing redesign
7. **#4** (voice identity tracking) — builds on #1-2, polishes the smoothness
8. **#10** (common-tone/contrary-motion bonuses) — small addition to #4
9. **#5** (duration classes) — medium effort, big impact on passing chords
10. **#9** (phrase roles) — largest effort, required for 6-8 chord progressions to work well

---

*This document is a living reference. Update it as changes are implemented and validated. Mark completed items, record before/after listening impressions, and adjust scoring weights based on empirical tuning.*
