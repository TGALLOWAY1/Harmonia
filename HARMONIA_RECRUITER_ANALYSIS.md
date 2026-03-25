# Harmonia Codebase Analysis for Recruiter-Facing Infographic and PowerPoint

Analysis date: March 25, 2026

Scope note:
- This report focuses on the active product paths under `app/`, `components/`, `lib/music/`, `lib/creative/`, `lib/theory/`, `lib/sketchpad/`, and `lib/audio/`.
- The repository also contains an archived `_deferred/` learning-platform branch with flashcards, curriculum, and API work. That code broadens the repo's history, but it is not the current shipping product and should not be the center of the recruiter story.
- Verification snapshot from this analysis:
  - `npm run build` succeeded on March 25, 2026.
  - `npm test` reported 41 passing tests and 4 failing suites. The failing suites were in a removed adapter test and `_deferred` paths, not in the active progression, theory, or advanced generator modules.

# 1. Executive Summary

Harmonia is a browser-based harmonic composition system built in Next.js that combines a theory-aware chord progression generator, a note-editable harmonic workstation, and a section-based song sketchpad. At its best, it is not just "a chord generator." It is a layered musical system that starts with symbolic theory objects such as keys, modes, degrees, and chord qualities, turns them into phrase-aware harmonic plans, realizes those plans as voiced MIDI-note chords, lets the user iteratively reshape the result through substitutions and mutations, and then extends the workflow into song-level harmonic planning.

The project is technically interesting because it models music as a constrained generative system instead of as a static content app. Harmonia has:
- a multi-stage generation pipeline in `lib/music/generators/advanced/`
- explicit theory modeling in `lib/theory/`
- rule-based musical transformations in `lib/creative/`
- cost-based voice-leading selection in `lib/music/generators/advanced/voiceLeading.ts`
- direct human-in-the-loop editing via the interactive piano roll and chord re-interpretation flow
- a second product surface, the Harmonic Sketchpad, that turns the same musical primitives into a section and variant planning tool

From an engineering perspective, the hard part is not the UI alone. The hard part is that Harmonia has to maintain consistency across several musical representations at once:
- symbolic chord labels
- Roman numerals
- pitch-class sets
- octave-specific note names
- MIDI note arrays
- duration classes and beat lengths
- local audio playback scheduling
- user-edited state

That combination makes the project substantially more impressive than a typical CRUD portfolio app. It demonstrates domain modeling, algorithm design, heuristics, interactive system design, and product judgment around explainability and iteration.

## Recruiter Takeaways

- Harmonia demonstrates algorithm design through a staged generation pipeline: template selection, phrase-role adaptation, substitution insertion, voicing candidate generation, and cost-based ranking.
- It shows strong domain modeling: the code represents keys, modes, scale definitions, chord qualities, Roman numerals, durations, voicing styles, and source provenance as explicit typed objects.
- It demonstrates rule-based generative systems design rather than black-box randomness. The active generator encodes phrase roles, tension curves, chromatic-density constraints, and spacing rules.
- It shows constraint handling: the voicing engine manages register range, spacing, omission and doubling rules, inversion limits, and voice-count caps.
- It demonstrates search and scoring logic through candidate voicing enumeration plus `calculateVoiceLeadingCost()` and `pickBestVoiceLedCandidate()`.
- It shows human-in-the-loop product thinking: users can lock chords, preview substitutions, mutate with controlled intensity, edit individual notes, and revert to originals.
- It demonstrates explainability. The substitution UI groups alternatives by musical category and provides reasons rather than opaque outputs.
- It shows practical frontend and systems integration: Next.js, Zustand, Tone.js scheduling, sample/synth presets, MIDI export, and local persistence all work together.
- It shows an evaluation mindset. The repo includes deterministic generator tests, an explicit `CHORD_ENGINE_AUDIT.md`, and a feedback-capture path for voicing ratings.
- It supports strong recruiter narratives for creative technologist, generative systems engineer, music-tech engineer, and frontend-heavy product engineer roles.

# 2. Project Purpose and User Value

Harmonia solves the "blank page" problem for songwriting and harmonic exploration.

In practice, the product helps a user:
- generate a starting progression in a chosen key and mode
- hear that progression immediately
- inspect the exact voicing on a piano-roll style grid
- preserve the parts they like with chord locks
- ask for theory-guided alternatives
- mutate the progression in controlled ways
- manually edit notes and have the chord re-labeled in real time
- add a simple melody overlay
- export the result to MIDI
- plan an entire song's harmonic flow section by section inside the Sketchpad

The output is not just a list of chord names. Harmonia produces a richer musical artifact:
- chord symbols
- Roman numerals
- pitch classes
- octave-specific notes
- MIDI notes
- durations
- playable audio
- editable harmonic events in the Sketchpad

Best classification:
- It is partly a music generation engine.
- It is partly an intelligent chord progression assistant.
- It is partly a harmonic composition system.
- It is partly a music-theory exploration tool.

Best recruiter framing:
- Harmonia is best described as an interactive harmonic composition engine: a theory-aware system that generates, evaluates, voices, explains, and edits chord progressions, then scales that workflow up to section-level song planning.

Why that framing works:
- "Chord generator" undersells the editing, voicing, and planning layers.
- "AI composer" would overstate the system. It is primarily heuristic and rule-based, not model-based.
- "Music theory tool" is true but incomplete because the product is also generative and production-oriented.

# 3. Architecture Overview

## Concise Architecture Narrative

Harmonia has two active product surfaces:
- the main progression workstation at `app/page.tsx`
- the Harmonic Sketchpad at `app/sketchpad/page.tsx`

Both are client-heavy Next.js pages backed by Zustand stores. The main page feeds user settings into `useProgressionStore`, which calls `generateAdvancedProgression()` to build a progression, stores the resulting chord objects, and then routes those objects through playback, MIDI export, mutation, substitution, melody generation, and note-level editing. The Sketchpad uses a separate store to manage song projects, sections, variants, and harmonic events, with local persistence in `localStorage`.

The most important architectural choice is the separation between:
- theory primitives
- generation logic
- creative editing logic
- audio/export logic
- UI/state orchestration

That separation makes the repo readable and gives a recruiter a clear "systems" story rather than a pile of UI code.

## Component Breakdown

| Layer | Purpose | Main Modules |
| --- | --- | --- |
| UI surfaces | User controls, visualization, workflow | `app/page.tsx`, `app/sketchpad/page.tsx`, `components/creative/*`, `components/sketchpad/*`, `components/feedback/*` |
| State orchestration | Centralized progression and sketchpad state | `lib/state/progressionStore.ts`, `lib/sketchpad/store.ts`, `lib/feedback/feedbackStore.ts` |
| Music-theory primitives | Keys, modes, scales, chords, note mapping, inversions | `lib/theory/scale.ts`, `lib/theory/chord.ts`, `lib/theory/midiUtils.ts`, `lib/theory/progressionTypes.ts`, `lib/theory/inversionLabel.ts` |
| Progression planning | Template selection, phrase roles, substitutions, harmonic plan | `lib/music/generators/advanced/generateAdvancedProgression.ts`, `phraseStructure.ts`, `substitutions.ts`, `extensions.ts`, `types.ts` |
| Voicing and evaluation | Candidate voicing generation, spacing rules, voice-leading cost selection | `lib/music/generators/advanced/voicing.ts`, `voiceLeading.ts` |
| Creative iteration | Manual substitutions, mutation, chord interpretation after editing | `lib/creative/substitutionEngine.ts`, `mutationEngine.ts`, `chordInterpreter.ts`, `types.ts` |
| Melody overlay | Monophonic melody generation and editing | `lib/music/generators/melody/generateMelody.ts`, `types.ts`, `components/creative/MelodyLane.tsx` |
| Playback and export | Synth creation, playback scheduling, MIDI export | `lib/audio/synthPresets.ts`, `lib/progressionMidiExport.ts`, `components/sketchpad/Workspace.tsx` |
| Song planning | Sections, variants, harmonic events, local persistence | `lib/sketchpad/types.ts`, `lib/sketchpad/store.ts`, `lib/sketchpad/chordUtils.ts` |

## Simple Text Diagram

Main generator flow:

`UI controls`
-> `useProgressionStore`
-> `generateAdvancedProgression(options)`
-> `phrase roles + tension curve`
-> `template adaptation + functional swap`
-> `secondary dominants / tritone subs / passing chords / suspensions`
-> `chromatic density validation`
-> `voicing candidate generation`
-> `voice-leading scoring and best-candidate selection`
-> `canonical Chord objects in store`
-> `piano roll / playback / MIDI export / mutation / substitution / melody`

Sketchpad flow:

`project and section UI`
-> `useSketchpadStore`
-> `HarmonicSection / HarmonicVariant / HarmonicEvent`
-> `diatonic palette or parsed custom chord`
-> `local persistence`
-> `section playback / full-song playback / transition preview / piano-roll preview`

## Where Core Responsibilities Live

- Theory rules live mainly in `lib/theory/`.
- Progression generation happens in `lib/music/generators/advanced/generateAdvancedProgression.ts`.
- Phrase-role and tension logic live in `lib/music/generators/advanced/phraseStructure.ts`.
- Extension logic lives in `lib/music/generators/advanced/extensions.ts`.
- Chromatic insertion logic lives in `lib/music/generators/advanced/substitutions.ts`.
- Voicing logic lives in `lib/music/generators/advanced/voicing.ts`.
- Scoring and ranking live in `lib/music/generators/advanced/voiceLeading.ts`.
- Preset and parameter logic lives in `lib/state/progressionStore.ts` and `lib/audio/synthPresets.ts`.
- Output formatting and playback/export logic live in `app/page.tsx`, `components/sketchpad/Workspace.tsx`, and `lib/progressionMidiExport.ts`.

# 4. Feature Inventory

## A. User-Facing Features

| Feature | What it does | Why it matters | Modules | Recruiter value |
| --- | --- | --- | --- | --- |
| Progression generator | Generates voiced chord progressions by key, mode, complexity, and chord count | Gives immediate musical output instead of static theory content | `app/page.tsx`, `lib/state/progressionStore.ts`, `lib/music/generators/advanced/*` | **Portfolio Highlight** |
| Chord locking and partial regeneration | Preserves selected chords while regenerating the rest | Shows product understanding of iterative creative workflows | `lib/state/progressionStore.ts` | **Portfolio Highlight** |
| Interactive piano roll | Visualizes chord notes and supports note add/remove/move operations | Turns symbolic harmony into an inspectable and editable musical object | `components/creative/InteractivePianoRoll.tsx` | **Portfolio Highlight** |
| Theory-guided substitution panel | Surfaces alternate chords with categories and explanations | Makes the generator explainable and user-steerable | `lib/creative/substitutionEngine.ts`, `components/creative/SubstitutionPanel.tsx` | **Portfolio Highlight** |
| Intensity-based mutation | Applies controlled near-neighbor variation with undo | Demonstrates human-in-the-loop generative UX | `lib/creative/mutationEngine.ts`, `components/creative/MutationControls.tsx` | **Portfolio Highlight** |
| Melody overlay | Generates a monophonic line over the progression and lets the user edit it | Expands the system from harmony only to harmony plus melodic context | `lib/music/generators/melody/*`, `components/creative/MelodyLane.tsx` | Strong |
| Voicing controls | Lets the user pick voicing style and voice density | Exposes lower-level algorithm parameters as product controls | `app/page.tsx`, `lib/music/generators/advanced/voicing.ts` | Strong |
| Instant playback with preset selection | Plays progressions through sample-based piano, EP, or organ sounds | Makes the system feel like an instrument, not just an analyzer | `lib/audio/synthPresets.ts`, `app/page.tsx` | Medium |
| MIDI export | Exports generated progressions to DAW-friendly MIDI | Bridges the app to actual music production workflows | `lib/progressionMidiExport.ts` | Strong |
| Harmonic Sketchpad | Creates sections, variants, and song-level harmonic plans | Expands the product from one-loop generation to full-song planning | `app/sketchpad/page.tsx`, `lib/sketchpad/*`, `components/sketchpad/*` | **Portfolio Highlight** |

## B. Technical Features

| Technical feature | What the system is doing under the hood | Why it matters | Modules | Recruiter value |
| --- | --- | --- | --- | --- |
| Phrase-role planning | Assigns roles such as opening, pre-dominant, dominant, cadence by progression length | Adds musical direction beyond random chord selection | `lib/music/generators/advanced/phraseStructure.ts` | **Portfolio Highlight** |
| Tension-curve gating | Uses a per-position tension curve to influence substitutions and extensions | Encodes musical arc as a control signal | `phraseStructure.ts`, `extensions.ts`, `substitutions.ts` | **Portfolio Highlight** |
| Functional family substitution | Swaps within tonic/subdominant/dominant families before decoration | Adds variety without losing harmonic plausibility | `generateAdvancedProgression.ts` | Strong |
| Chromatic insertion with validation | Injects secondary dominants, tritone subs, passing diminished chords, and suspensions with constraints | Creates richer harmony while limiting chaos | `substitutions.ts` | **Portfolio Highlight** |
| Voice-leading candidate search | Enumerates possible voicings across octaves, inversions, and styles | Converts abstract harmony into performable pitch distributions | `voicing.ts` | **Portfolio Highlight** |
| Composite voice-leading scoring | Ranks candidates using smoothness, bass motion, common tones, parallel perfects, crossings, span, and contrary motion | Gives the system an optimization layer rather than fixed voicing formulas | `voiceLeading.ts` | **Portfolio Highlight** |
| Real-time chord reinterpretation | Re-labels user-edited note clusters by scoring chord templates against the MIDI set | Keeps symbolic meaning aligned with note-level edits | `chordInterpreter.ts` | **Portfolio Highlight** |
| Melody candidate scoring | Scores nearby melody candidates for smoothness, chord-tone fit, tension, and style | Shows the same generative thinking applied to melody, not just harmony | `generateMelody.ts` | Strong |
| Provenance tracking | Marks chords as generated, substituted, mutated, or manually edited | Helps the UI stay explainable and supports undo/revert flows | `lib/creative/types.ts`, `lib/state/progressionStore.ts` | Strong |
| Feedback capture | Logs voicing ratings and simple quality metrics locally | Shows an evaluation mindset even without ML training | `lib/feedback/feedbackStore.ts`, `components/feedback/*` | Strong |

## C. Hidden Sophistication

| Hidden sophistication | What a casual observer might miss | Why it matters | Modules | Recruiter value |
| --- | --- | --- | --- | --- |
| Multiple synchronized representations | Chords carry label, Roman numeral, pitch classes, MIDI notes, note names, and durations | This is the core systems challenge of the app | `lib/theory/progressionTypes.ts`, `lib/state/progressionStore.ts` | **Portfolio Highlight** |
| Deterministic generator support | The advanced generator accepts a seed and is snapshot-tested | Shows reproducibility and testability in a generative system | `generateAdvancedProgression.ts`, `advancedGenerator.test.ts` | Strong |
| Duration-aware generation | Non-structural inserted chords receive shorter durations | Prevents passing material from overpowering structural harmony | `substitutions.ts`, `progressionMidiExport.ts` | Strong |
| Low-register spacing rules | Candidate voicings are rejected if lower intervals are too cramped | Encodes psychoacoustic knowledge rather than just notation rules | `voicing.ts` | **Portfolio Highlight** |
| Range normalization plus deduplication | Candidate search spans octaves/styles/inversions and then normalizes and deduplicates | Demonstrates search-pipeline discipline | `voicing.ts` | Strong |
| Song planning data model | Sketchpad models project -> section -> variant -> event with ordering and timestamps | Shows data-modeling maturity beyond single-screen demos | `lib/sketchpad/types.ts`, `lib/sketchpad/store.ts` | **Portfolio Highlight** |
| Build health despite archived debt | Active app builds cleanly even though `_deferred` code still drags test noise into the repo | Indicates the shipping surface is healthier than the whole history tree | build + tests, `_deferred/` | Medium |
| Self-audit artifact | `CHORD_ENGINE_AUDIT.md` documents architectural weaknesses and redesign direction | Signals reflective engineering and iterative improvement | `CHORD_ENGINE_AUDIT.md` | Strong |

# 5. Harmonic / Music-Theory Intelligence

## Concept-by-Concept Analysis

| Concept | How it appears in code | Implementation style | Where it lives | Assessment |
| --- | --- | --- | --- | --- |
| Keys and modes | Supports Ionian, Aeolian, Dorian, Mixolydian, and Phrygian. Scale pitch classes are built from interval recipes. | Deterministic rule-based modeling | `lib/theory/scale.ts`, `lib/theory/harmonyEngine.ts`, `lib/sketchpad/chordUtils.ts` | Solid and explicit for five modes; limited breadth compared with full enharmonic or modal systems |
| Scales | Scale definitions are arrays of pitch classes rooted at a normalized tonic | Deterministic interval walk | `scale.ts`, `types.ts` | Clean and easy to extend |
| Chord qualities | Triad and seventh qualities are inferred from semitone relationships or built from known formulas | Rule-based interval analysis | `lib/theory/chord.ts`, `lib/creative/chordInterpreter.ts` | Strong for common triads/sevenths; not exhaustive for advanced jazz vocabulary |
| Roman numerals | The generator assigns degree labels, and the Sketchpad derives Roman numerals relative to the local section key | Deterministic mapping plus some contextual labeling | `chord.ts`, `generateAdvancedProgression.ts`, `lib/sketchpad/chordUtils.ts` | Good enough for current feature set; not a full harmonic-analysis engine |
| Harmonic function | Family grouping and phrase-role weights approximate tonic/subdominant/dominant behavior | Heuristic and weighted-rule system | `generateAdvancedProgression.ts`, `phraseStructure.ts` | Strong relative to hobby projects; still simpler than academic harmonic parsers |
| Tension and release | A tension curve by chord position gates extension richness and chromatic insertion | Heuristic control-signal model | `phraseStructure.ts`, `extensions.ts`, `substitutions.ts` | One of the most interesting musical ideas in the repo |
| Cadences | Template library includes cadence-oriented patterns and the generator forces final tonic resolution if needed | Template-driven with end-condition heuristic | `generateAdvancedProgression.ts` | Effective and practical; less sophisticated than full phrase-level backtracking |
| Phrase roles | Positions are labeled opening, continuation, pre-dominant, dominant, cadence | Template-based structural planning | `phraseStructure.ts` | Strong differentiator versus naive generators |
| Substitutions | Functional swaps, secondary dominants, tritone subs, passing diminished chords, suspensions, modal mixture, relative substitutions | Rule-based transformation and gating | `generateAdvancedProgression.ts`, `substitutions.ts`, `lib/creative/substitutionEngine.ts` | Strong breadth; some are automatic, some manual only |
| Inversions | Candidate voicings explore inversions; UI shows inversion labels; manual substitution engine also surfaces inversion variants | Enumerative plus label inference | `voicing.ts`, `lib/theory/inversionLabel.ts`, `substitutionEngine.ts` | Useful and musical, though inversion choice is still cost-driven rather than phrase-specific |
| Extensions | Complexity level and tension determine 7ths, 9ths, 13ths, and altered dominant colors | Heuristic gating | `extensions.ts` | Well-scoped and tasteful for a browser tool |
| Suspensions | Dominant chords can receive brief suspended versions before resolution | Rule-based insertion with duration shortening | `substitutions.ts` | Good product value and good musical intuition |
| Passing chords | Whole-step root motion can trigger passing diminished insertions | Contextual rule-based insertion | `substitutions.ts` | Good example of local connective intelligence |
| Borrowed chords / modal interchange | Available in the manual substitution panel by comparing against the parallel mode's diatonic set | Rule-based option generation | `lib/creative/substitutionEngine.ts` | Present, but manual rather than fully integrated into auto-generation |
| Secondary dominants | Inserted before suitable targets when the context score is high enough | Context-scored heuristic | `substitutions.ts` | One of the better examples of music-aware constraint logic in the repo |
| Tritone substitutions | Optional automatic dominant substitution and explicit substitution-panel option | Rule-based chromatic transformation | `substitutions.ts`, `substitutionEngine.ts` | Musically ambitious for a portfolio app |
| Voice leading | Candidate transitions are scored for movement, bass motion, common tones, crossings, parallel perfects, span, and contrary motion | Search + scoring | `voiceLeading.ts` | This is the strongest algorithmic music-tech piece in the repo |
| Chord spacing and doubling | The voicing engine prioritizes root, third, seventh, and extensions; omits fifths first; restricts unsafe low spacing | Rule-based constraint handling | `voicing.ts` | Very strong practical musicianship encoded in software |
| Bass movement | Bass motion is not explicitly pre-planned, but it is rewarded or penalized in the cost function | Scoring heuristic | `voiceLeading.ts` | Good but not fully separated as an independent bass-line planner |
| Progression structure | The engine starts from real chord templates, adapts length, swaps functionally, decorates, validates density, then resolves | Pipeline-based heuristic generation | `generateAdvancedProgression.ts` | Clearly more sophisticated than random diatonic sampling |

## Musical Intelligence Assessment

What Harmonia already does well:
- It understands the difference between structural harmony and connective harmony.
- It treats voicing as a search-and-score problem instead of a fixed formula.
- It exposes substitutions in musician-friendly categories rather than abstract rule dumps.
- It carries theory labels all the way into the UI, which makes the system legible.
- It allows human override at the note level without breaking the symbolic layer.

What is elegant:
- Phrase roles and tension curves are a clean way to turn "musical arc" into software.
- Duration classes for inserted material are a strong product and musical design choice.
- The voicing engine's omission and spacing rules show practical theory knowledge.
- The chord interpreter closes the loop between free editing and formal harmony representation.

What is limited or simplistic:
- The system uses sharps-only pitch spelling, so enharmonic notation is musically coarse.
- Mode support is limited to five scale types.
- Bass movement is scored but not designed as a first-class melodic line.
- Mutation uses heuristic operations and unseeded randomness, not a globally optimized search.
- Borrowed harmony is stronger in the manual substitution UX than in the automatic generator.
- Melody generation is coherent and musical enough for overlay, but it is not contrapuntal or phrase-semantic.

What is novel or especially interesting:
- The combination of phrase-level planning, voicing search, live explainable substitution, and note-level reinterpretation is unusually rich for a solo music-tech portfolio project.
- The app is not trying to be fully autonomous. It is explicitly built as a collaborative composition assistant, which is a stronger and more believable product story.

# 6. Algorithmic Analysis

## Core Algorithms and Mechanisms

| Algorithm / mechanism | Problem solved | How it works here | Inputs | Outputs | Tradeoffs | Recruiter relevance |
| --- | --- | --- | --- | --- | --- | --- |
| Phrase-role template adaptation | Preventing aimless progressions at different lengths | Starts from a template library, then pads or trims according to phrase-role weighted degree selection | key mode, chord count, RNG | degree-index sequence | More coherent than random filling, but still heuristic | Strong |
| Functional family swap | Adding variety without derailing function | Swaps interior degrees within tonic/subdominant/dominant families | template degrees, RNG, complexity gates | modified degree sequence | Simple and effective, but family buckets are broad | Strong |
| Context-scored secondary dominant insertion | Adding chromatic preparation only where it helps | Scores each insertion point by target type, tension, nearby chromatic density, and adjacency | planned diatonic chords, tension, options | expanded planned chord list | Greedy local decisions, not full search | **Portfolio Highlight** |
| Tritone / passing / suspension decoration | Richening harmony with recognizable devices | Applies optional transformations with contextual gating and shorter duration classes | planned chords, complexity flags, RNG | decorated planned chord list | Great color, but still rule-heavy | Strong |
| Chromatic density validation | Keeping complexity from becoming chaos | Repeatedly scans windows of four chords and removes lower-priority chromatic chords until at least two are diatonic | planned chord list | pruned chord list | Greedy pruning can remove musically plausible cases, but it keeps outputs sane | **Portfolio Highlight** |
| Tone selection for voicing | Choosing which chord tones to keep or double under voice-count limits | Prioritizes root, third, seventh, top extension; omits fifth first; doubles root safely | pitch classes, voice count | selected intervals | Hard-coded rules, but musically grounded | **Portfolio Highlight** |
| Candidate voicing generation | Turning one chord into many legal voicings | Enumerates octaves, styles, inversions, range-normalized candidates and deduplicates them | chord plan, style, voice count, range | candidate MIDI voicings | Can grow combinatorially, but current scope is controlled | **Portfolio Highlight** |
| Composite voice-leading cost | Ranking candidate transitions by musical quality | Uses greedy voice assignment plus penalties/rewards for motion, bass, common tones, parallels, crossings, span, contrary motion | previous voicing, candidate voicing | scalar cost | Heuristic scoring, not learned evaluation | **Portfolio Highlight** |
| Chord interpretation after editing | Recovering symbolic meaning from arbitrary user-edited note clusters | Tries every pitch class as a root against a template bank, scores matches, and returns best interpretation plus alternates | MIDI note set | chord label, inversion, confidence | Limited template vocabulary; good practical fit | **Portfolio Highlight** |
| Intensity-bucketed mutation | Controlled variation rather than total regeneration | Maps intensity bands to allowed operations and max change count | progression, intensity, key, mode | mutated chords plus mutation record | Less global than search, more controllable for UX | Strong |
| Melody candidate scoring | Generating a melody that feels connected to the harmony | Scores nearby scale tones by smoothness, style, tension, and chord-tone fit, then applies leap-recovery logic | scale, chord progression, style, tension | melody notes | Monophonic and heuristic, but musically explainable | Strong |

## Most Interesting Algorithms

1. Phrase-role-aware progression planning that maps chord positions to opening, continuation, pre-dominant, dominant, and cadence roles.
2. Tension curves that influence both harmonic density and melodic behavior.
3. Context-scored secondary dominant insertion instead of blind chromatic decoration.
4. A chromatic-density validator that enforces "enough diatonic grounding" inside sliding windows.
5. Tone-selection rules that explicitly decide what to omit or double in a voicing.
6. Enumerative voicing search across octaves, styles, inversions, and voice counts.
7. Composite voice-leading scoring with penalties for crossings and parallel perfects plus rewards for common tones and contrary motion.
8. Real-time chord reinterpretation after piano-roll edits.
9. Intensity-based mutation that changes operation availability rather than just "amount of randomness."
10. Melody generation that reuses generative-system ideas from harmony: candidate scoring, rhythmic shaping, and leap recovery.

# 7. Generation Pipeline Walkthrough

## Step-by-Step Prose

1. The user chooses `rootKey`, `mode`, `complexity`, `numChords`, `voicingStyle`, and `voiceCount` in `app/page.tsx`.
2. `useProgressionStore.generateNew()` maps the UI complexity level to generator flags such as `useSecondaryDominants`, `usePassingChords`, `useSuspensions`, and `useTritoneSubstitution`.
3. `generateAdvancedProgression()` converts the musical mode to a scale type and builds a seeded RNG.
4. The generator asks `phraseStructure.ts` for phrase roles and a tension curve based on progression length.
5. It picks a template from major-ish or minor-ish progression libraries and adapts it to the requested length.
6. It optionally performs a functional-family swap on an interior chord for controlled variation.
7. It builds diatonic chord plans from the scale, using complexity and tension to choose pitch content and chord symbols.
8. It decorates that plan through substitution stages: secondary dominants, tritone substitutions, passing diminished chords, and suspensions.
9. It runs chromatic-density validation so the decorated progression does not drift too far from tonal grounding.
10. It forces tonic resolution at the end if the last structural chord is not already tonic-like.
11. For each planned chord, `generateVoicingCandidates()` creates legal realizations across styles, inversions, octaves, and ranges.
12. `pickBestVoiceLedCandidate()` chooses the best voiced result by minimizing transition cost from the previous chord.
13. `useProgressionStore` converts the voiced result into canonical `Chord` objects with labels, pitch classes, note names, MIDI notes, and duration classes.
14. Playback uses Tone.js scheduling in `app/page.tsx`. MIDI export uses `progressionToMidi()`. Optional melody generation turns the voiced progression into a monophonic overlay.
15. After generation, the user can lock, substitute, mutate, or manually edit chords. Those actions update the same canonical chord representation.

## Concise Pipeline Diagram

`User settings`
-> `complexity -> generator flags`
-> `phrase roles + tension curve`
-> `template selection`
-> `length adaptation`
-> `functional swap`
-> `diatonic chord plan`
-> `chromatic decoration`
-> `density validation`
-> `final tonic check`
-> `voicing candidate search`
-> `voice-leading ranking`
-> `Chord objects in store`
-> `playback / MIDI / melody / creative editing`

## Recruiter-Friendly Summary Version

Harmonia does not jump straight from "key = C major" to a random list of chord names. It runs a full musical pipeline:
- plan the phrase
- assign tension over time
- build structurally plausible harmony
- add controlled color tones and substitutions
- voice each chord in a playable range
- score transitions for smoothness
- render the result as something the user can hear, inspect, edit, and export

## Key Decision Points and Tradeoffs

- Template pool choice: favors recognizable harmonic movement, but limits novelty versus unconstrained search.
- Functional swap: introduces variation while preserving role families, but family definitions are intentionally coarse.
- Substitution insertion: adds richness, but must be density-limited to avoid tonal drift.
- Voice-leading bottleneck: the best candidate is chosen greedily from local candidates, not via global sequence optimization.
- Final tonic enforcement: increases coherence, but can flatten more adventurous endings.
- Post-generation editing: improves usability, but requires a strong representation layer to keep labels, MIDI, and UI aligned.

# 8. Codebase Deep Dive by Module

## Progression Engine

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/music/generators/advanced/generateAdvancedProgression.ts` | Main orchestration of advanced harmonic generation | Input: `AdvancedProgressionOptions`. Output: `AdvancedProgressionResult` with voiced chords and debug metadata. | Central "smart engine" of the app | Yes |
| `lib/music/generators/advanced/phraseStructure.ts` | Encodes phrase-role templates and tension curves | Input: progression length. Output: role arrays, tension arrays, weighted degree picks. | Gives the generator direction and arc | Yes |
| `lib/music/generators/advanced/substitutions.ts` | Applies secondary dominants, tritone subs, passing diminished chords, suspensions, and density validation | Input: planned chords plus options. Output: decorated chord list. | Adds advanced harmonic color under constraints | Yes |
| `lib/music/generators/advanced/extensions.ts` | Expands pitch content based on complexity and tension | Input: base chord content and context. Output: enriched pitch classes. | Handles controlled harmonic color | Yes |
| `lib/music/generators/advanced/types.ts` | Shared advanced-generator types | Contracts for planned chords, voiced chords, options, roles, and durations | Keeps the engine explicit and strongly typed | Medium |

## Voicing Engine and Scoring

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/music/generators/advanced/voicing.ts` | Generates legal voicing candidates | Input: planned chord and voicing context. Output: candidate MIDI arrays. | Encodes spacing, omission, doubling, inversion, and range rules | Yes |
| `lib/music/generators/advanced/voiceLeading.ts` | Scores transitions and picks best candidate | Input: previous voicing and candidates. Output: best voicing plus cost. | Most technically impressive algorithmic module | Yes |
| `lib/theory/inversionLabel.ts` | Labels the resulting bass-position relationship | Input: MIDI notes and root. Output: inversion label. | Small but useful theory-to-UI bridge | Medium |

## Theory Utilities

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/theory/scale.ts` | Builds scale definitions from interval recipes | root + scale type -> scale pitch classes | Core tonal foundation | Yes |
| `lib/theory/chord.ts` | Builds and infers chord structures and symbols | roots, qualities, scales -> pitch classes and labels | Core harmonic modeling | Yes |
| `lib/theory/midiUtils.ts` | Converts among pitch classes, note names, MIDI numbers, and ranges | musical primitives -> numeric/audio-ready values | Glue between symbolic theory and playback/UI | Yes |
| `lib/theory/progressionTypes.ts` | Defines the canonical `Chord` and `Progression` objects | type declarations | Key representation contract across the app | Yes |
| `lib/theory/harmonyEngine.ts` | Legacy simple generator and mode/depth types | simple generator input -> generated degrees and qualities | Useful as an evolution marker; not the main product path anymore | Medium |

## Creative Iteration

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/creative/substitutionEngine.ts` | Builds manual substitution candidates with reasons and confidence | selected chord + context -> substitution options | Makes the generator explainable | Yes |
| `lib/creative/mutationEngine.ts` | Applies intensity-gated mutations and records changes | progression + intensity -> changed chords + mutation record | Strong generative UX layer | Yes |
| `lib/creative/chordInterpreter.ts` | Reinterprets edited note clusters as chord labels | MIDI note set -> chord interpretation | Keeps free editing musically meaningful | Yes |
| `lib/creative/types.ts` | Shared mutation, substitution, source-tracking, and interpretation types | type declarations | Makes the editing layer coherent | Medium |

## State and Orchestration

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/state/progressionStore.ts` | Main application store for progression generation, editing, melody, playback flags, and export | UI actions -> progression state transitions | Real orchestration layer for the main product surface | Yes |
| `lib/sketchpad/store.ts` | Store for projects, sections, variants, events, playback state, and persistence | sketchpad UI actions -> project graph updates | Powers the second major product surface | Yes |
| `lib/feedback/feedbackStore.ts` | Local voicing-feedback capture | rating events -> stored entries | Lightweight evaluation instrumentation | Medium |

## Sketchpad and Song Planning

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/sketchpad/types.ts` | Defines projects, sections, variants, and harmonic events | type declarations | Clean data model for song planning | Yes |
| `lib/sketchpad/chordUtils.ts` | Builds diatonic palettes, parses chord symbols, and converts them to event objects | key/mode or text input -> harmonic events | Lets the Sketchpad stay theory-aware without the full advanced generator | Yes |
| `components/sketchpad/Workspace.tsx` | Playback orchestration for sections, songs, and transitions | project graph -> Tone.js scheduling | Strong systems integration | Yes |
| `components/sketchpad/SectionEditorPanel.tsx` | Section/variant editing UI | store state -> editing workflow | Exposes the sketchpad composition model | Medium |
| `components/sketchpad/HarmonicPreviewPanel.tsx` | Piano-roll and context preview for sketchpad events | events -> harmonic visualization and playback controls | Good recruiter demo surface | Medium |
| `components/sketchpad/SongStructurePanel.tsx` | Section management, ordering, and project-level controls | project -> structural editing | Shows product thinking beyond one-off generation | Medium |

## Playback, Export, and Product Polish

| Module | Purpose | Inputs / outputs | Why it matters | Highlight? |
| --- | --- | --- | --- | --- |
| `lib/audio/synthPresets.ts` | Creates sample-based and synth-based playback presets | preset id -> Tone.js synth/sampler | Makes the app feel polished and musically usable | Medium |
| `lib/progressionMidiExport.ts` | Converts voiced progressions to a MIDI Blob | chord list + BPM -> MIDI file | Connects the app to actual music production workflows | Yes |
| `app/page.tsx` | Main generator UI and playback scheduling | store state -> UI, controls, Tone.js transport | The user-facing shell around the engine | Yes |
| `components/creative/InteractivePianoRoll.tsx` | Visualization plus note-level editing | chord list -> interactive grid | High demo value and strong representation work | Yes |
| `components/creative/MelodyLane.tsx` | Visual melody overlay and editing | melody notes -> editable lane | Strong product extension | Medium |

## Tests and Audit Artifacts

| Module | Purpose | Why it matters | Highlight? |
| --- | --- | --- | --- |
| `lib/music/generators/advanced/__tests__/advancedGenerator.test.ts` | Verifies deterministic output and voice-leading candidate preference | Shows the generator is treated as testable logic | Yes |
| `lib/theory/__tests__/*` | Golden tests for scales, chords, MIDI utilities, and mappings | Strong for domain-core correctness | Yes |
| `CHORD_ENGINE_AUDIT.md` | Deep redesign and critique artifact | Signals reflective engineering and willingness to iterate on quality | Yes |

# 9. Engineering Quality Assessment

## Overall Assessment

Code organization:
- Strong. The repo has real module boundaries: theory, generation, voicing, creative editing, sketchpad, audio, and UI.

Modularity:
- Good. The advanced generator is broken into sensible files instead of one monolith.

Separation of concerns:
- Good in the engine. More mixed in the top-level UI pages, especially `app/page.tsx`, which handles a lot of playback and UI wiring.

Maintainability:
- Reasonable for a solo project. Typed interfaces and focused modules help. The largest maintenance risk is state and action growth inside the two main stores.

Extensibility:
- Good in the active music engine.
- Adding new substitution types, voicing styles, or modes looks straightforward.
- Sketchpad data structures are extensible enough for future persistence or collaboration.

Naming clarity:
- Generally strong. Function names like `insertPassingDiminished`, `pickBestVoiceLedCandidate`, `generateMelodyForProgression`, and `buildChordFromParsed` are self-explanatory.

Use of types/interfaces/models:
- Strong. Harmonia makes disciplined use of TypeScript types for musical primitives and state contracts.

Testability:
- Mixed but promising.
- Core theory and advanced-generator modules are testable and currently covered by passing tests.
- Full-suite reliability is weakened by stale tests in removed or archived paths.

Instrumentation/debuggability:
- Better than average for a music toy project.
- The advanced generator returns debug data including the seed, planned chords, and voice-leading costs.
- There is also a local feedback capture path and a substantial engineering audit doc.

Abstractions:
- Good where it matters most.
- The distinction between a planned chord and a voiced chord is especially useful.
- The stores are effective orchestration points, though `progressionStore.ts` is becoming a large multipurpose module.

Technical debt / fragile areas:
- `_deferred/` code creates noise in the test suite and can muddy the repo narrative.
- The repo has a known Prisma/db edge case and inactive database scaffolding that is not central to the shipping app.
- The main app surface is frontend-heavy; backend claims should be made carefully.
- End-to-end deterministic generation is not fully consistent because some mutation flows still use unseeded randomness.
- Enharmonic spelling is simplified to sharps-only pitch classes.

## Build and Test Reality

As of March 25, 2026:
- `npm run build` succeeds, and the active routes `/` and `/sketchpad` compile as static pages.
- `npm test` shows active theory and generator paths passing.
- Four failing suites remain in a removed adapter test and `_deferred` modules, which should be framed as historical cleanup debt rather than active product instability.

## What This Project Says About the Engineer

Evidence-backed signals:
- Strong systems thinker: the engineer can model a domain deeply enough to move between theory concepts, algorithms, and UI representation.
- Product-minded builder: the app is interactive, opinionated, and built around a real creative workflow rather than just technical demos.
- Comfortable with heuristics and constraints: the project uses controllable rules, not vague randomness.
- Good at shaping abstractions: `PlannedAdvancedChord`, `VoicedChord`, `Chord`, `HarmonicEvent`, and provenance types show structured design.
- Capable of translating specialized knowledge into software: this is the core recruiter signal here.

Roles this project supports well:
- Creative technologist
- Music-tech engineer
- Generative systems engineer
- Frontend-heavy product engineer
- Applied AI-adjacent engineer focused on explainable generation

Roles it supports with more caution:
- Full-stack engineer

Why "with more caution":
- The active product is mostly client-side. There is Prisma and archived server-side work, but the strongest honest story is domain-heavy frontend plus algorithmic systems design.

# 10. Visuals Worth Turning Into Infographics

## Recommended Visual Concepts

| Title | Purpose | What it should show | Why recruiter-useful | Supporting source material | Suggested structure |
| --- | --- | --- | --- | --- | --- |
| Harmonia system map | Fast orientation | UI, stores, theory engine, generator, voicing, playback, Sketchpad | Gives immediate "this is a real system" credibility | Sections 3 and 8 | Layered architecture diagram |
| Progression generation pipeline | Show algorithm depth | Phrase roles -> template -> substitutions -> voicing -> scoring -> output | Makes the technical story legible in one slide | Sections 6 and 7 | Horizontal flow with stage callouts |
| What makes Harmonia smart | Differentiate from generic generators | phrase roles, tension curves, chromatic gating, voice-leading cost, note reinterpretation | Great recruiter-facing summary panel | Sections 4, 5, 6 | Five-box feature strip |
| Candidate generation and scoring funnel | Explain search-and-rank logic | one harmonic plan -> many voicing candidates -> scored winner | Strong algorithm visual | `voicing.ts`, `voiceLeading.ts` | Funnel diagram |
| Harmonic intelligence map | Explain theory coverage | keys, modes, Roman numerals, substitutions, tensions, inversions, voice leading | Shows musical depth without reading code | Section 5 | Radial or matrix chart |
| Human-in-the-loop editing loop | Show product differentiation | generate -> lock -> substitute -> mutate -> edit notes -> reinterpret -> export | Highlights interactive system design | `progressionStore.ts`, UI components | Circular workflow diagram |
| Sketchpad song-planning model | Show second product surface | project -> section -> variant -> event | Shows breadth beyond one-screen demo | `lib/sketchpad/types.ts`, store/UI | Tree or lane diagram |
| Before / after generic chord generator comparison | Positioning visual | random chord labels versus Harmonia's voiced, editable, exportable output | Makes differentiation obvious | Sections 2, 5, stretch goal | Two-column comparison |
| Voice-leading evaluation graphic | Explain scoring | common tones, bass motion, crossings, parallels, span | Great for engineering managers | `voiceLeading.ts` | Scorecard around two adjacent chords |
| Representation stack | Show data modeling quality | chord symbol -> Roman numeral -> pitch classes -> note names -> MIDI -> playback | Signals systems rigor | `progressionTypes.ts`, stores, MIDI utils | Layer stack diagram |
| Product journey | Show user value | idea -> progression -> refinement -> song plan -> MIDI export | Makes recruiter story user-centered | Sections 2 and 7 | Journey map |
| Engineering maturity panel | Show code quality signals | tests, build, typed models, audit doc, feedback logging | Helps justify seriousness | Section 9 | Checklist-style graphic |

## Top 8 Visuals for an Infographic

1. Harmonia system map
2. Progression generation pipeline
3. What makes Harmonia smart
4. Candidate generation and scoring funnel
5. Human-in-the-loop editing loop
6. Sketchpad song-planning model
7. Voice-leading evaluation graphic
8. Representation stack

## Top 12 Slides for a PowerPoint

1. Harmonia at a glance
2. Problem and user value
3. Why this is more than a chord generator
4. High-level architecture
5. Progression generation pipeline
6. Harmonic intelligence and theory modeling
7. Voicing and voice-leading algorithm
8. Human-in-the-loop editing and explainability
9. Harmonic Sketchpad and song planning
10. Engineering quality and evidence
11. Recruiter takeaways and role fit
12. Future opportunities

# 11. Slide Deck Blueprint

| Slide title | Slide goal | Key bullets | Suggested visual | Speaker notes / takeaway |
| --- | --- | --- | --- | --- |
| 1. Harmonia: Interactive Harmonic Composition Engine | Establish the project quickly | Browser-based, theory-aware, editable, exportable | Hero screenshot plus one-line summary | Frame it as a system, not a toy |
| 2. The Problem It Solves | Explain user value | Blank-page problem, theory-to-practice gap, pre-DAW planning | User journey strip | Emphasize songwriter workflow |
| 3. Why It Is Technically Interesting | Hook technical reviewers | symbolic theory + generative pipeline + note-level editing | "What makes Harmonia smart" panel | This is where recruiters understand it is not CRUD |
| 4. Architecture Overview | Show system shape | UI, stores, theory, generator, voicing, playback, Sketchpad | Layered architecture diagram | Strong separation of concerns |
| 5. Generation Pipeline | Explain the engine at a high level | phrase roles, templates, substitutions, validation, voicing, scoring | Pipeline diagram | Tell the story of staged generation |
| 6. Harmonic Intelligence | Show domain depth | keys, modes, Roman numerals, substitutions, tension, cadences | Harmonic intelligence map | Domain modeling is a major strength |
| 7. Voicing and Voice Leading | Highlight strongest algorithmic section | candidate search, spacing rules, cost function, best-candidate pick | Funnel plus cost scorecard | This is the best engineering slide |
| 8. Human-in-the-Loop Editing | Show product maturity | locks, substitutions, mutation, piano-roll edits, chord reinterpretation | Editing loop diagram | The tool collaborates with the user |
| 9. Harmonic Sketchpad | Show second major surface | sections, variants, transitions, local persistence | Section -> variant -> event diagram | This expands the scope from loops to songs |
| 10. Engineering Quality | Make the project credible | modular codebase, tests, build success, audit doc, typed models | Quality checklist graphic | Honest and evidence-backed |
| 11. Recruiter Takeaways | Translate to skills | generative systems, algorithm design, music-tech modeling, frontend integration | Skill-signal matrix | Make the hiring case explicit |
| 12. What I Would Build Next | End with momentum | richer modes, bass planning, cleanup of archived test debt, collaborative persistence | Roadmap graphic | Shows judgment and next-step thinking |

# 12. Recruiter-Facing Soundbites

## 10 Short Portfolio Bullets

- Built a theory-aware harmonic composition engine in Next.js, TypeScript, Tone.js, and Zustand.
- Designed a multi-stage chord progression pipeline with phrase planning, chromatic decoration, voicing search, and voice-leading scoring.
- Modeled music as typed system objects spanning keys, scales, chord qualities, Roman numerals, MIDI notes, and durations.
- Implemented note-level harmonic editing with real-time chord reinterpretation after manual piano-roll changes.
- Added explainable substitution workflows with categorized alternatives and theory-based reasons.
- Built an intensity-based mutation engine for controlled harmonic variation and undoable iteration.
- Generated monophonic melodies using smoothness scoring, chord-tone preference, and leap-recovery heuristics.
- Created a section-and-variant Harmonic Sketchpad for song-level harmonic planning and transition preview.
- Integrated sample-based playback, transport scheduling, and MIDI export for production-friendly output.
- Backed the active engine with deterministic tests, build verification, and an explicit redesign audit document.

## 10 Recruiter-Friendly Technical Bullets

- Encoded musical theory rules into reusable TypeScript modules instead of hard-coding behavior inside UI components.
- Built a candidate-generation-plus-ranking pipeline rather than relying on naive random selection.
- Implemented a composite voice-leading cost function with bass-motion, common-tone, span, crossing, and parallel-motion logic.
- Used duration classes to distinguish structural harmony from passing and suspension material.
- Designed stateful editing workflows that preserve provenance across generated, substituted, mutated, and manual chords.
- Maintained consistency between symbolic labels, note names, MIDI numbers, and playback state across the app.
- Added seedable deterministic generation paths and snapshot tests for reproducible musical output.
- Structured the app as two connected product surfaces: instant progression generation and song-structure sketching.
- Chose local-first persistence for the Sketchpad to keep the workflow fast and frictionless.
- Built the active product so it compiles cleanly even while older archived modules remain in the repo.

## 5 Impressive but Honest One-Liners

- Harmonia is a rule-based harmonic generation system with real voice-leading logic, not a random chord picker.
- The project turns music theory into executable software primitives and exposes them through an editable composition workflow.
- Its strongest technical feature is the bridge between abstract harmony and concrete voiced MIDI output.
- The app is especially impressive because users can generate, inspect, mutate, substitute, and manually edit the same harmonic object.
- It is best described as an explainable composition assistant rather than a black-box music AI.

## 5 Descriptions of the System at Different Lengths

### 1 sentence

Harmonia is a browser-based harmonic composition engine that generates, voices, explains, edits, plays back, and exports chord progressions while also supporting section-level song planning.

### 2 sentences

Harmonia combines a theory-aware chord progression generator with interactive editing tools and a song-structure sketchpad. It models musical concepts such as keys, modes, substitutions, voice leading, and durations as software primitives, then turns them into audible and editable musical output.

### 50 words

Harmonia is an interactive music-tech application for generating and refining chord progressions. It uses phrase-aware templates, substitution rules, voicing search, and voice-leading scoring to create playable harmony, then lets users lock chords, mutate progressions, edit notes directly, add melody, export MIDI, and plan song sections in a harmonic sketchpad.

### 100 words

Harmonia is a Next.js and TypeScript music-tech project that helps users create and refine chord progressions through a theory-aware generative pipeline. Instead of only outputting chord labels, it produces voiced chords with MIDI notes, durations, Roman numerals, and playback-ready note names. The system plans phrase structure, adds controlled harmonic color through substitutions and extensions, searches for legal voicings, and ranks them with a voice-leading cost function. Users can then iterate through chord locks, substitution suggestions, mutation controls, note-level piano-roll editing, melody overlay, MIDI export, and a section-based Harmonic Sketchpad for planning an entire song's harmonic flow.

### 200 words

Harmonia is an interactive harmonic composition system built with Next.js 14, TypeScript, Tone.js, and Zustand. Its core technical value lies in how it translates music theory into software architecture. The app models keys, modes, scales, chord qualities, Roman numerals, durations, pitch classes, note names, and MIDI notes as explicit typed representations. Those representations feed a staged progression engine that selects phrase-aware templates, adapts them by progression length, applies functional swaps and controlled chromatic substitutions, enriches chords with tension-aware extensions, and then realizes each chord through a voicing search process. Candidate voicings are evaluated with a composite voice-leading cost function that considers smooth motion, bass movement, common tones, parallel perfect intervals, crossings, span, and contrary motion. On top of that engine, Harmonia provides human-in-the-loop tooling: users can lock favorite chords, browse categorized substitutions with explanations, apply intensity-based mutations, edit notes directly in a piano roll, and have the app reinterpret the resulting chord. A second surface, the Harmonic Sketchpad, extends the workflow to section-level song planning with variants, transition previews, and local persistence. The result is a portfolio project that demonstrates domain modeling, algorithmic thinking, interactive systems design, and product-oriented engineering rather than generic CRUD work.

# 13. Evidence Table

| Claim / insight | Why it matters | Supporting files / modules | Confidence | Good slide / infographic candidate? |
| --- | --- | --- | --- | --- |
| Harmonia uses a staged generation pipeline rather than direct random chord picking | Strong algorithmic story | `lib/music/generators/advanced/generateAdvancedProgression.ts`, `phraseStructure.ts`, `substitutions.ts`, `voicing.ts`, `voiceLeading.ts` | High | Yes |
| The system models music as typed domain objects | Shows engineering rigor and domain abstraction | `lib/theory/*`, `lib/theory/progressionTypes.ts`, `lib/sketchpad/types.ts`, `lib/creative/types.ts` | High | Yes |
| Phrase roles and tension curves are central to output quality | Distinguishes Harmonia from generic generators | `lib/music/generators/advanced/phraseStructure.ts` | High | Yes |
| Chromatic richness is constrained rather than unchecked | Signals thoughtful rule design | `lib/music/generators/advanced/substitutions.ts` | High | Yes |
| Voicing is selected from multiple candidates using a cost function | Strongest algorithmic artifact in the repo | `lib/music/generators/advanced/voicing.ts`, `voiceLeading.ts` | High | Yes |
| Users can partially preserve generated output while iterating | Good product design for creative workflows | `lib/state/progressionStore.ts` | High | Yes |
| Manual substitutions are explainable and categorized | Great recruiter-facing UX signal | `lib/creative/substitutionEngine.ts`, `components/creative/SubstitutionPanel.tsx` | High | Yes |
| Note-level edits are reinterpreted back into symbolic chord labels | Demonstrates representation consistency | `lib/creative/chordInterpreter.ts`, `lib/state/progressionStore.ts`, `components/creative/InteractivePianoRoll.tsx` | High | Yes |
| Harmonia includes melody generation in addition to harmony | Broadens the system beyond chord labels | `lib/music/generators/melody/generateMelody.ts`, `components/creative/MelodyLane.tsx` | High | Yes |
| The app scales from single progression generation to song-level planning | Strong product breadth signal | `app/sketchpad/page.tsx`, `lib/sketchpad/*`, `components/sketchpad/*` | High | Yes |
| The active app is mostly client-side, despite some full-stack scaffolding | Important for honest recruiter framing | `app/*`, `components/*`, build output, `prisma/*`, `_deferred/*` | High | Yes |
| Build health is better than the repo-wide test story suggests | Makes the engineering assessment more accurate | `npm run build`, `npm test` results from March 25, 2026 | High | Yes |
| There is intentional evaluation and iteration work in the repo | Signals engineering maturity | `CHORD_ENGINE_AUDIT.md`, `components/feedback/*`, `lib/feedback/feedbackStore.ts` | High | Yes |
| The project has technical debt concentrated in archived paths | Helps frame weaknesses constructively | `_deferred/*`, `lib/theory/__tests__/chordGeneratorAdapter.test.ts` | High | No |
| Harmonia is differentiated by explainable generation plus interactive editing | Strong portfolio message | Active engine + creative UI modules | High | Yes |

# 14. Gaps, Weaknesses, and Future Opportunities

## Honest Current Limitations

- Active theory support is musically meaningful but bounded: five modes, simplified pitch spelling, and a modest chord-template vocabulary.
- The generator is heuristic and locally optimized. It does not perform global sequence search or learned evaluation.
- Bass movement is scored but not explicitly planned as an independent bass-line composition problem.
- Mutation and some editing flows are less deterministic than the seeded advanced generator path.
- The Sketchpad is strong for manual harmonic planning but does not yet appear to call into the full advanced generator for automatic section generation.
- Feedback capture exists, but the ratings do not currently feed back into automatic scoring or personalization.
- The repo narrative is slightly diluted by archived `_deferred` code and stale tests.
- Database and curriculum infrastructure exist, but they are not central to the current shipping product and should not be oversold.

## Promising Next Steps

- Add explicit bass-line planning before upper-voice voicing search.
- Expand modal interchange and borrowed-harmony logic into the automatic generator, not just the manual substitution UI.
- Add more scale systems and cleaner enharmonic spelling.
- Make mutation deterministic when a seed is provided.
- Add automated section-generation or section-variation suggestions inside the Sketchpad.
- Close the loop between feedback history and future voicing choices.
- Clean or isolate `_deferred` tests so the suite reflects the active product more accurately.
- Introduce saved projects beyond local persistence if the product direction shifts toward collaboration or cross-device workflow.

## Portfolio-Enhancing Future Work

- A "compare 3 candidate progressions" mode using the debug data and cost metrics.
- Audio-humanization or groove-aware rhythmic variation.
- Smarter melody phrasing with motif reuse and cadence awareness.
- A visible "why this chord was chosen" inspector panel using generator debug output.
- A bass-line lane that shows how harmonic decisions map to low-end motion.

# 15. Final Presentation-Ready Extraction

## A. Best Recruiter Messages

- Harmonia is a domain-rich generative system, not a generic CRUD app.
- It demonstrates the ability to turn specialized knowledge into usable product software.
- The strongest engineering signal is the bridge from symbolic theory to voiced, editable, playable musical output.
- The strongest product signal is that generation is collaborative and explainable rather than opaque.

## B. Best Technical Highlights

- Phrase-role-aware progression planning
- Tension-curve-driven extension and substitution gating
- Context-scored chromatic insertion
- Candidate voicing generation with spacing and doubling rules
- Composite voice-leading cost selection
- Real-time chord reinterpretation after note-level edits
- Song-level section and variant modeling in the Sketchpad

## C. Best Visuals to Create

- System architecture diagram
- Generation pipeline diagram
- Candidate generation and scoring funnel
- Human-in-the-loop editing loop
- Sketchpad section -> variant -> event model
- Harmonic intelligence feature map

## D. Best Architecture Diagram to Draw

`UI controls`
-> `Zustand store`
-> `theory primitives`
-> `progression planner`
-> `chromatic decorators`
-> `voicing candidate search`
-> `voice-leading scorer`
-> `canonical chord objects`
-> `playback / MIDI / melody / editing`

Alongside:

`Sketchpad UI`
-> `project/section/variant/event store`
-> `harmonic preview and playback`

## E. Best Algorithm Story to Tell

Tell the story of how Harmonia turns a user choice like "C major, 4 chords, extended harmony" into a playable result:
- choose a phrase shape
- assign musical roles and tension over time
- build a harmonically plausible plan
- add selective color and substitutions
- search for legal voicings
- score transitions to minimize awkward movement
- let the user refine the result through guided edits

That story is concrete, differentiated, and easy to visualize.

## F. Best Evidence-Backed Claims

- The active generator uses phrase roles, tension curves, and substitution gates, not just random chord selection.
- The voicing layer searches candidates and ranks them with a composite voice-leading cost.
- The app keeps symbolic labels and note-level edits synchronized through chord interpretation logic.
- The Sketchpad extends the product from loop generation to section-level harmonic planning.
- The active application currently builds successfully, and the passing tests cover core theory and advanced-generator logic.

## G. Best Concise Project Description

Harmonia is an interactive harmonic composition engine that generates and voices chord progressions using theory-aware planning, then lets users refine them through substitutions, mutations, note-level editing, melody overlay, MIDI export, and section-based song planning.

# 16. Stretch Goal

## What makes Harmonia different from a generic chord generator?

A generic chord generator usually:
- picks a key
- samples diatonic chord labels
- stops at symbolic output

Harmonia goes much further:
- it plans progressions with phrase roles and tension arcs
- it adds controlled substitutions instead of random decoration
- it outputs voiced chords with note names, MIDI notes, and durations
- it ranks voicings by voice-leading quality
- it explains substitutions to the user
- it supports partial regeneration through locking
- it allows note-level editing and re-labels the result in real time
- it extends the workflow into a song-planning sketchpad

That is the core differentiator: Harmonia treats harmony as an editable system of musical representations, not just a list of chord names.

## What technical story should I tell about this project in an interview?

Tell this story:

"I wanted to build a music system that was more credible than a random chord generator, so I broke the problem into layers. First I modeled music-theory primitives like scales, chord qualities, Roman numerals, and pitch classes. Then I built an advanced generator that plans a phrase, adds controlled harmonic color, and searches for voiced realizations that minimize voice-leading cost. On top of that, I designed a human-in-the-loop workflow where users can lock, substitute, mutate, and manually edit notes while the symbolic layer stays consistent. Finally, I expanded the product into a song-level sketchpad so the same harmonic objects could be used for real composition planning."

That interview story works because it shows:
- domain modeling
- algorithm design
- heuristic reasoning
- UX and product thinking
- iterative engineering judgment

