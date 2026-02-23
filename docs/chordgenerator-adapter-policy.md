# ChordGenerator Adapter Policy

**Never import from ChordGenerator/** outside `lib/chordGeneratorAdapter.ts`.

The ChordGenerator folder (`ChordGenerator/Harmonia Chord Progression Generator/`) is an internal implementation. The only public entrypoint is `lib/chordGeneratorAdapter.ts`, which:

- Accepts Harmonia canonical inputs (`PitchClass`, `ScaleType`)
- Returns Harmonia-shaped progressions (`{ degree, symbol, quality, notes: PitchClass[] }[]`)
- Normalizes enharmonics to Harmonia's sharps-only policy

All other imports from ChordGenerator/** are forbidden.

**Import compatibility:** The adapter imports ChordGenerator via relative paths. The ChordGenerator modules in the adapter's dependency chain (src/lib/theory.ts, src/logic/harmonyEngine.ts, src/audio/voicing.ts) use relative imports only, so they compile within Harmonia without changing Harmonia's @/ path aliases.
