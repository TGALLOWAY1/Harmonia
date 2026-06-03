# Harmonia — Chord Progression Generator & Harmonic Workstation

Generate musically coherent chord progressions in any key and mode. Refine them with theory-guided substitutions and direct note-level editing. Save your favorite progressions, rate voicings with persistent feedback, and plan the harmonic structure of entire songs with the Harmonic Sketchpad. Hear everything instantly with real piano samples and export to MIDI.

<img width="1042" height="1287" alt="image" src="https://github.com/user-attachments/assets/4ac60a95-8dcd-4ba3-a10a-1323475d3199" />

## Features

### Chord Progression Generator

- **5 modes** — Major, Minor, Dorian, Mixolydian, Phrygian
- **4 complexity levels** — Simple triads through altered dominants, tritone substitutions, and passing chords
- **Variable-duration chords** — Full, half, quarter, and eighth-note durations assigned contextually
- **Multiple sound presets** — Salamander Grand Piano, Casio Electric Piano (with chorus), and FM Organ via Tone.js
- **Natural, humanized playback** — Chords are played note-by-note with subtle per-note velocity and timing variation (±~12 ms) so progressions feel hand-played rather than software-triggered. Configurable via the **Audio** menu:
  - **Velocity** — base chord loudness, 20–100% (default 70%)
  - **Humanize** — amount of velocity + timing variation, Off → Natural (default 50%); at 0% playback is perfectly quantized for reference
  - **Sustain** — *Natural* lets notes ring slightly, *Off* tightens releases for clarity
  - **Soft Strum** — optional articulation that lightly rolls chord notes in (~18 ms apart), like a pianist easing into a chord; disabled by default
  - All playback settings persist across sessions via localStorage
- **Interactive piano roll** — Click notes to preview, select and shift individual notes up/down by octave
- **Chord locking** — Lock specific chords to preserve them while regenerating the rest
- **MIDI export** — Download your progression as a standard MIDI file
- **Voicing controls** — Choose voicing style (Tight, Balanced, Open) and density (Sparse 3-voice, Standard 4-voice, Rich 5-voice) via a collapsible panel
- **Validated chord voicings** — Every generated chord is checked against a single source of truth (`getChordPitchClasses` in `lib/theory/chordSymbol.ts`), which derives the allowed pitch classes directly from the chord symbol (e.g. `D7` → D F♯ A C) across all 12 roots, keys, modes, and qualities. Voicings that would contain a note the symbol does not imply are logged and rebuilt from a safe voicing, so the notes you see and hear always match the chord label. Each voiced note also carries a harmonic role (chord tone, extension, alteration, bass), keeping chord tones distinct from non-chord tones
- **Streamlined action bar** — A single horizontal row of actions (Play · Chords · Melody · Save · Audio) keeps every primary control visible at once. Compact, clutter-free chord cards on mobile give the piano roll more room, while desktop retains its roomier spacing
- **Voicing feedback** — Rate generated voicings with thumbs up/down in a lightweight card below the action bar; ratings persist across sessions via localStorage. View approval trends over time in the feedback chart
- **Melody overlay** — Toggle melody generation to hear a monophonic melody line over chords. Three styles: Lyrical (stepwise, longer notes), Rhythmic (shorter notes, syncopation), and Arpeggiated (chord-tone focused). Melody notes are displayed directly on the piano roll with a toggle button and distinct amber styling. Melody uses the same sound preset as chords (Piano, EP, or Organ)
- **Chord-aware melody** — Melody chord tones are derived from the same single source of truth as the voicings (`getChordPitchClasses`), so the melody follows the actual chord notes — including chromatic chord tones such as the F♯ of a `D7` secondary dominant that the diatonic scale alone can't reach. Two harmony modes control how tightly the melody hugs the chords: **Expressive** (default) keeps scale/passing-tone freedom while strongly preferring chord tones on strong beats and avoiding notes a semitone off a chord tone, and **Strict** pins every strong-beat note to an actual chord tone
- **Favorite progressions** — Save progressions to a persistent favorites list. Load or delete saved progressions at any time. The Save button shows a brief "Saved" confirmation so the action is obvious on every screen size, including mobile
- **Adjustable BPM** — 60–180 BPM with looping playback

### Creative Iteration Tools

Two complementary forms of control for refining generated progressions:

- **Manual Chord Substitution** — Click any chord card to open a substitution panel with theory-approved alternatives. Options are grouped by category (diatonic, relative, dominant-function, tritone, modal mixture, inversion) with explanations of why each works. Preview before applying, and revert any time.
- **Interactive Piano Roll Editing** — Double-click empty grid cells to add notes, double-click existing notes to remove them, and drag notes vertically to change pitch. Harmonia re-interprets the chord label in real time after edits. Source badges (Generated, Substituted, Edited) track the provenance of each chord. Reset any chord to its original state.

### Harmonic Sketchpad

A song-level harmonic planning workspace for sketching the harmonic architecture of a full song before opening a DAW.

- **Multi-section song structure** — Add Intro, Verse, Pre-Chorus, Chorus, Bridge, Drop, Outro, or custom sections
- **Variant system** — Create multiple progression alternatives per section and switch between them
- **Diatonic chord palette** — One-click insertion of diatonic chords for the current key and scale
- **Custom chord input** — Type any chord symbol (e.g. Am7, F#dim, Gsus4) to add it to a progression
- **Per-section key and scale** — Override the global key for individual sections (useful for modulations)
- **Section reordering** — Drag sections up and down to rearrange song flow
- **Playback modes** — Play a single chord, a section, loop a section, play the full song, or preview transitions between adjacent sections
- **Piano roll visualization** — See chord voicings and note placement for the active progression
- **Roman numeral analysis** — Chords are labeled with Roman numerals relative to the section key
- **Theory context panel** — View chord tones, key, and scale information while working
- **Song flow overview** — See all sections at a glance with chord counts
- **Local persistence** — Sketches are saved to localStorage and persist across sessions

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start generating progressions, or navigate to [http://localhost:3000/sketchpad](http://localhost:3000/sketchpad) to open the Harmonic Sketchpad.

### App icons & "Add to Home Screen"

The favicon is an SVG (`app/icon.svg`) for crisp browser tabs. Because iOS Safari ignores SVG icons when adding a site to the home screen, the project also ships PNG raster icons (`public/apple-icon.png` plus `icon-192.png` / `icon-512.png`) and a `public/manifest.webmanifest`, wired up via the `icons`/`manifest`/`appleWebApp` metadata in `app/layout.tsx`. The PNGs are regenerated from `app/icon.svg` — re-run the raster step (e.g. with `sharp`) if you change the source SVG.

## Tech Stack

- [Next.js 14](https://nextjs.org) — React framework
- [Tone.js](https://tonejs.github.io) — Web audio synthesis and scheduling
- [Zustand](https://zustand.docs.pmnd.rs) — State management
- [Tailwind CSS](https://tailwindcss.com) — Utility-first styling
- [Framer Motion](https://motion.dev) — Animations
- TypeScript

### Audio architecture & performance

Instruments are defined in a small registry (`lib/audio/synthPresets.ts`) so new instruments (Strings, Pad, …) can be added as a single entry without touching playback code. Playback humanization is a pure, dependency-free module (`lib/audio/humanization.ts`) that the scheduler applies per note.

The piano and electric piano are **sampled** (Salamander Grand / Casio) and stream from the Tone.js CDN — humanization adds **no bundle or asset weight**, no new downloads, and negligible CPU. A "Loading Piano…" state covers the brief sample preload on first selection. (Note: the Salamander set is single-velocity, so velocity changes loudness rather than timbre — a deliberate trade for fast load, small footprint, and mobile/browser compatibility.)

## Usage

### Chord Progression Generator

1. Pick a **key** and **mode** from the control panel
2. Set **complexity** (Simple → Altered) and number of chords
3. Click **Chords** to create a progression
4. Click any chord card to preview it, or hit **Play** to loop the full progression
5. Use the piano roll to inspect voicings — click a note then **Cmd/Ctrl + Arrow Up/Down** to shift it by octave
6. **Lock** chords you like, then regenerate to replace only the unlocked ones
7. **Export MIDI** to bring your progression into a DAW
8. Click the **substitute icon** on a chord card to browse theory-guided replacement options
9. **Double-click** the piano roll grid to add or remove individual notes — chord labels update automatically
10. Click **Melody** to generate a melody line — choose a style (Lyrical, Rhythmic, Arpeggio) and a harmony mode (**Expressive** or **Strict**), then click **Melody** again for a new line. Use the **Audio** button in the action bar to mute/unmute chords and melody and to adjust playback feel — **Velocity**, **Humanize**, **Sustain**, and **Soft Strum** vs **Block Chord**
11. Click **Save** to bookmark a progression to your favorites. Click **Favorites** to view, load, or remove saved progressions

### Harmonic Sketchpad

1. Click **Sketchpad** in the header to open the workspace
2. Create a new sketch with a title, key, and scale
3. **Add sections** (Verse, Chorus, Bridge, etc.) from the left panel
4. Select a section to open the editor — click diatonic chords or type custom chords to build a progression
5. Create **alternate variants** (A, B, C) for a section to compare different harmonic ideas
6. **Reorder sections** using the up/down arrows to shape the song flow
7. Use the playback controls to audition a section, loop it, play the full song, or preview transitions
8. The right panel shows a piano roll, Roman numeral analysis, and song flow overview

## Roadmap

### v2 — Learning Path

Harmonia originally began as a music theory learning platform. The learning path features — including flashcards, spaced repetition, circle of fifths exercises, and milestone-based theory curriculum — have been archived and are planned for a v2 release. The foundation for these features (database schema, card templates, SRS engine) remains in the codebase under `_deferred/` and will be reintroduced in a future version.
