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
- Piano roll and chord cards are visually aligned using flex multipliers based on `durationClass`

## File Structure Highlights

| Path | Purpose |
|------|---------|
| `app/page.tsx` | Main progression generator + creative iteration UI |
| `app/sketchpad/` | Harmonic Sketchpad workspace |
| `lib/state/progressionStore.ts` | Central Zustand store for progression + creative state |
| `lib/creative/` | Substitution engine, mutation engine, chord interpreter, types |
| `lib/theory/` | Core music theory: scales, chords, MIDI, pitch classes |
| `lib/music/generators/advanced/` | Advanced progression generation pipeline |
| `components/creative/` | SubstitutionPanel, MutationControls, InteractivePianoRoll |
| `components/progression/` | VerticalPianoRoll (original read-only version) |

## Pre-existing Issues

- `lib/db.ts` has a Prisma client import error (pre-existing, not blocking)
- Test files in `lib/theory/__tests__/` reference a removed adapter module
- These do not affect the main application functionality
