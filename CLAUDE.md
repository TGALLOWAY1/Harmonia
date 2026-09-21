# CLAUDE.md — Harmonia Project Instructions

## Project Overview

Harmonia is a music theory learning and harmonic composition tool built with Next.js 14, TypeScript, Tone.js, and Zustand. It generates chord progressions, provides interactive editing, and supports song-level harmonic planning.

## Key Architecture

- **Framework**: Next.js 14 (App Router) with TypeScript and Tailwind CSS
- **State Management**: Zustand stores in `lib/state/` and `lib/sketchpad/store.ts`
- **Audio**: Tone.js for synthesis and scheduling; Web Audio API for simple playback
- **Music Theory Engine**: `lib/theory/` — scales, chords, MIDI utils, pitch classes
- **Progression Generator**: `lib/music/generators/advanced/` — phrase structure, substitutions, voicing, voice leading
- **Creative Iteration**: `lib/creative/` — substitution engine, mutation engine, chord interpreter
- **UI Components**: `components/` — piano roll, chord cards, sketchpad workspace, creative tools

## Development Commands

```bash
npm install       # Install dependencies
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # Run ESLint
```

## Important Conventions

- When adding new features, always update the README.md to document them
- Chord data flows through the Zustand `progressionStore` — all mutations go through store actions
- The `Chord` interface in `lib/theory/progressionTypes.ts` is the canonical chord type used across the app
- Creative iteration features (substitution, mutation, piano roll editing) track source provenance via `ChordSourceType`
- Music theory operations should use deterministic rules, not randomness where possible
- Scales are not all seven notes — `major_pentatonic` has five. Read `ScaleDefinition.pitchClasses.length` rather than assuming 7 degrees, and route pentatonic through `lib/theory/pentatonic.ts` instead of the stacked-thirds helpers in `chord.ts`
- Piano roll and chord cards are visually aligned using flex multipliers based on `durationClass`
- Every generated `Chord` carries `bass` and `inversion`; store actions that change `midiNotes` must keep them in step (use `describeInversion` from `lib/theory/inversionLabel.ts`)
- The melody engine reads chord *categories*, not raw pitch classes: a note is a chord, colour, avoid or chromatic tone over each chord (`harmonicContext.ts`). Never reintroduce a bare "semitone from a chord tone" clash test — it rejects the major 7th and accepts the b6
- Melody scoring targets are calibrated against real corpora (Essen, Rolling Stone 200, POP909); when changing generation, re-measure rather than re-tuning thresholds, and record the numbers in `MELODY_ENGINE_ANALYSIS.md`
- Borrowed harmony (`ChordKind` `"borrowed"`) is opt-in via `useModalInterchange`, which the store's complexity presets enable from "Rich" upward; "Simple" and the pentatonic path stay inside the scale
- Velocity shaping is deterministic: `dynamics.ts` computes voice weights, metric accent and phrase-aware velocity from data, and randomness (jitter, small per-note variation) stays confined to `humanization.ts` — don't move probabilistic variation into `dynamics.ts` or vice versa
- Sound changes (new instruments, layer or effect tweaks) are verified with `npx tsx scripts/auditionInstruments.ts --check` before they land — it renders every instrument × role × velocity offline and fails on silence, clipping, a runaway tail, or loudness/brightness that doesn't rise with velocity
- Tendency-tone resolution (`lib/music/generators/advanced/tendencyTones.ts`) is a soft transition cost inside the voicing search, not a hard constraint — it charges unresolved leading tones, sevenths, tritones and suspensions in the upper voices; the bass note and inversion remain the bass-line planner's (`bassLine.ts`) responsibility

## File Structure Highlights

| Path | Purpose |
|------|---------|
| `app/page.tsx` | Main progression generator + creative iteration UI |
| `app/sketchpad/` | Harmonic Sketchpad workspace |
| `lib/state/progressionStore.ts` | Central Zustand store for progression + creative state |
| `lib/creative/` | Substitution engine, mutation engine, chord interpreter, types |
| `lib/theory/` | Core music theory: scales, chords, MIDI, pitch classes |
| `lib/music/generators/advanced/` | Advanced progression generation pipeline |
| `lib/music/generators/advanced/tensionCurve.ts` | Tension shapes + the per-chord tension formula every stage plans and scores against |
| `lib/music/generators/advanced/slotPlanner.ts` | Fills each slot against the tension/brightness targets; one borrowed chord per phrase |
| `lib/music/generators/advanced/modalInterchange.ts` | Borrowed-chord catalogue derived per mode, keyed to brightness; Picardy third |
| `lib/music/generators/advanced/neoRiemannian.ts` | Neo-Riemannian transforms and parsimonious voice leading |
| `lib/music/generators/advanced/bassLine.ts` | Bass-line planner (inversion per chord as a small DP) |
| `lib/music/generators/advanced/voicingSearch.ts` | Bounded Viterbi search connecting voicings across the whole progression |
| `lib/music/generators/advanced/tendencyTones.ts` | Per-slot chord identity + the tendency-tone resolution cost the voicing search charges |
| `lib/music/generators/melody/` | Melody engine: harmonic context → form plan → rhythm → motifs → beam-search realization → ornaments → corpus-calibrated scoring |
| `lib/music/generators/melody/harmonicContext.ts` | Per-chord function, tension, note categories (chord/colour/avoid/chromatic), tendency tones, guide-tone line |
| `lib/music/generators/melody/phrasePlan.ts` | Phrases, cadence types and target degrees, the tension-placed climax phrase, pickups and breaths |
| `lib/music/generators/melody/meter.ts` | Metric weights on the half-beat grid; Longuet-Higgins & Lee syncopation |
| `lib/theory/pentatonic.ts` | Scale-safe chord vocabulary + templates for major pentatonic (no stacked thirds) |
| `lib/audio/instrumentCatalog.ts` | Tone-free instrument metadata (ids, labels, quality tiers) |
| `lib/audio/layeredInstrument.ts` | Body/bright/transient velocity-layer fan-out behind every lightweight instrument |
| `lib/audio/synthPresets.ts` | Instrument registry: lightweight synth + high-quality sampler realizations per instrument |
| `lib/audio/dynamics.ts` | Deterministic velocity model: voice weights, metric accent, progression/phrase-level shaping |
| `lib/audio/audioSpace.ts` | Master volume + reverb space presets (Tone-free; safe to import in UI) |
| `lib/state/audioSettingsStore.ts` | Persisted audio settings (instrument, Lightweight/High quality mode) |
| `components/creative/` | SubstitutionPanel, MutationControls, InteractivePianoRoll |
| `components/progression/` | VerticalPianoRoll (original read-only version) |
| `scripts/auditionInstruments.ts` | Offline instrument audition harness (headless Chromium); `--check` gates sound changes |
| `scripts/measureTendencyTones.ts` | Before/after measurement of tendency-tone resolution rates across seeds |

## Pre-existing Issues

- `lib/db.ts` has a Prisma client import error (pre-existing, not blocking)
- Test files in `lib/theory/__tests__/` reference a removed adapter module
- These do not affect the main application functionality
