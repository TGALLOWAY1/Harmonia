# Harmonia Audio Engine Assessment

Assessment of the current playback stack and a proposal for a two-tier (Lightweight / High-Quality) audio architecture.

> **Implementation status:** Option D was approved and Phases 1–3 are implemented
> (persisted `audioSettingsStore`, lightweight synth tier — Soft Keys, Filtered Saw,
> FM Electric Piano, synth piano — quality modes with background sample loading,
> hot-swap, and timbre-preserving fallback). Phase 4 (self-hosted samples + a better
> EP sample set) and Phase 5 (Tone.js code-splitting) remain follow-ups; samples
> still stream from the Tone.js CDN, and sample assets could not be mirrored from
> this environment (network policy blocks `tonejs.github.io`).

---

## Current Architecture

### Libraries

| Library | Version | Role |
|---|---|---|
| `tone` | ^15.1.22 | All synthesis, sampling, scheduling, effects |
| `@tonejs/midi` | ^2.0.28 | MIDI export only (no playback role) |
| Raw Web Audio API | — | `lib/audio/playChordFromPitchClasses.ts` (sine-wave chord/scale preview; only referenced by `_deferred/` practice components, dead in the live app) |

### Instrument layer — `lib/audio/synthPresets.ts`

The app already has a real instrument abstraction: an `INSTRUMENTS` registry of `InstrumentDefinition` entries (`id`, `label`, `category`, `needsLoading`, `create`, `createMelody`). Call sites go through `createSynthForPreset()` / `createMelodySynthForPreset()` and never touch Tone classes directly. Three instruments exist today:

1. **Piano** — `Tone.Sampler` with 18 Salamander Grand mp3s loaded from `https://tonejs.github.io/audio/salamander/` (CDN, GitHub Pages). Routed through a compressor + dedicated 2.5s reverb.
2. **Electric Piano** — `Tone.Sampler` with only **2** Casio mp3s (`A1`, `A2`) from `https://tonejs.github.io/audio/casio/`, pitch-shifted across the entire keyboard, through a chorus.
3. **Organ** — `Tone.PolySynth(Tone.FMSynth)`, sine-on-sine FM. The only zero-download instrument, and therefore the universal fallback.

A shared master chain (`Compressor → Reverb → Limiter(-3dB) → Destination`) is built lazily as singletons.

### Lifecycle & fallback — `lib/audio/useInstrument.ts`

A shared hook (used by both `app/page.tsx` and `components/sketchpad/Workspace.tsx`) creates/disposes the instrument, exposes `isLoading` / `loadError`, and on sample-load error **or a 10s timeout** disposes the sampler and swaps in the Organ synth with a dismissible notice ("Piano couldn't load — using Organ instead."). The Play button is disabled and shows a spinner while samples download.

### Scheduling — `app/page.tsx` (~lines 190–345) and `Workspace.tsx`

- Chords are scheduled on the **Tone.js Transport** using musical time strings (`bars:quarters:sixteenths`) derived from each chord's `durationClass` (full/half/quarter/eighth → 4/2/1/0.5 beats).
- Transport `loop`/`loopStart`/`loopEnd` give sample-accurate looping; BPM is synced to the store.
- UI highlight sync uses `Tone.getDraw().schedule()`; the playhead is a `requestAnimationFrame` loop reading `transport.seconds`.
- Melody notes are scheduled the same way on a second (melody) instrument instance.
- `await Tone.start()` is called inside user-gesture handlers (Play, Generate, sketchpad play/chord-click) — the standard iOS/Chrome autoplay unlock.

### Velocity, duration, humanization — `lib/audio/humanization.ts`

A pure, Tone-free module converts a chord's notes into `NoteEvent[]` (`note`, `velocity`, `timeOffset`): bounded velocity variation (±0.12 max), timing jitter (±12ms max), strum (~18ms steps), and tempo-aware arpeggio spread. Playback reads live settings via `usePlaybackSettingsStore.getState()` so slider changes apply mid-loop. This module is well-designed and engine-agnostic — it survives any engine change unmodified.

### Settings & persistence

- `lib/state/playbackSettingsStore.ts` (Zustand + `persist` → localStorage key `harmonia-playback-settings`): velocity, humanize, sustain, playback style. **Persisted.**
- **Instrument choice is NOT persisted** — it's plain `useState<SoundPresetId>("piano")` duplicated independently in `app/page.tsx:141` and `Workspace.tsx:35`. It resets to Piano on every reload, and the main page and Sketchpad can disagree.

### Settings UX today

Everything lives in a popover behind a small volume icon in the action bar: instrument `<select>`, chord/melody mute, velocity, humanize, sustain, style. There is no concept of audio quality anywhere in the UI.

---

## Current Limitations

1. **Heavy default load, no lightweight path.** Piano (sampled) is the hard-coded default, so ~18 Salamander mp3s (~2–4 MB) download from a third-party CDN **on every fresh page load**, and Play is disabled until they finish. On slow connections the user waits up to 10s and is then dumped to Organ.
2. **Fallback changes timbre drastically.** Sampled piano failing → FM organ. Functional, but jarring; the fallback doesn't try to sound like the instrument the user picked.
3. **Electric Piano quality is poor.** Two Casio samples stretched over 7+ octaves sounds thin and detuned at the extremes — far from a "warm electric piano." (A code comment confirms this map was reduced to 2 files just to stop a loading hang.)
4. **No pad / soft-synth / filtered-saw option at all.** The brief's "soft synth pads" and "mellow polysynth" categories don't exist; Organ is the only synth voice.
5. **Third-party CDN dependency.** `tonejs.github.io` is GitHub Pages: no SLA, no versioning, can be blocked on corporate/school networks, and breaks entirely offline. There is no service worker, so nothing audio works offline today.
6. **Instrument preference isn't persisted** and is duplicated per page (see above).
7. **Double sample download per preset.** Enabling melody creates a *second* `Tone.Sampler` with the same URLs (`createMelodySynthForPreset`). HTTP cache usually saves the network hit, but decode + memory cost is doubled, which matters on low-end mobile.
8. **Tone.js is in the main client bundle.** `app/page.tsx` and `Workspace.tsx` statically `import * as Tone from "tone"` (~150–200 KB gzipped). It is not code-split or deferred, and it's loaded even for users who never press Play.
9. **Mobile edge cases.** `Tone.start()` on gesture is handled, but there's no `visibilitychange`/interruption recovery (iOS suspends the AudioContext when backgrounded or on a phone call), and the 10ms `setTimeout` in `handleChordClick` is a code smell for release/attack sequencing.
10. **Effects singletons never adapt.** Reverb decay/wet, compressor, chorus are fixed; `Tone.Reverb` also generates its impulse response asynchronously at startup (small one-time CPU cost).

What's genuinely **good** and worth keeping: the instrument registry abstraction, the `useInstrument` loading/timeout/fallback pattern, the pure humanization module, Transport-based musical-time scheduling with `Draw` sync, and the persisted playback-settings store. The architecture already supports instrument abstraction and async (lazy) sample loading — the missing pieces are quality tiers, better sounds, persistence, and graceful degradation.

---

## Sound Quality Goals

Target palette (from the brief):

| Target sound | Today | Gap |
|---|---|---|
| Lush acoustic piano | Salamander sampler (decent) | No velocity layers; CDN fragility; blocking load |
| Warm electric piano | 2-sample Casio (weak) | Needs a real EP sample set (Rhodes-style, ~10+ zones) |
| Soft synth pads / keys | — | New lightweight synth voice |
| Filtered saw / mellow polysynth | — | New lightweight synth voice |

"Musical and polished" is achievable in *both* tiers: a well-designed filtered-saw PolySynth with chorus + reverb sounds intentional and warm; the lightweight tier should never feel like a punishment.

---

## Option A: Improve Existing Synth Engine

**Description.** Stay 100% synthesis. Replace/augment the Organ with carefully designed Tone.js patches: a "Soft Keys" voice (triangle/sine PolySynth, gentle attack, lowpass, chorus), a "Filtered Saw" pad (`Tone.PolySynth(Tone.Synth, {oscillator: "fatsawtooth"})` → `Tone.Filter` lowpass with envelope → chorus → reverb), an FM electric-piano emulation (classic DX7-style FM patch), and an additive/FM piano approximation. Tune the master chain per voice.

- **Pros**
  - Zero asset downloads; instant startup everywhere, including offline.
  - No CDN, no loading states, no fallback complexity.
  - Smallest possible scope; all changes confined to `synthPresets.ts`.
  - Pads and filtered saw genuinely sound *good* as synthesis — these two targets are best served by synths anyway.
- **Cons**
  - Acoustic piano via synthesis will never sound "lush" — this is the hard ceiling. FM electric piano can get to "pleasant" but not "warm vintage."
  - Doesn't deliver the headline goal (inspiring realistic piano).
- **Estimated effort:** 2–4 days (sound design is the bulk).
- **Bundle/load impact:** ~0. No new bytes.
- **Sound quality potential:** Medium for EP/pads/saw, **low for acoustic piano**.

## Option B: Tone.js Sampler With Lazy-Loaded Samples

**Description.** Double down on what already exists. Keep `Tone.Sampler`, but: (1) self-host a curated, compressed sample set (Salamander subset for piano; a properly multi-sampled EP such as a Rhodes set converted from a permissively-licensed SoundFont/FreePats source) in `public/samples/` or a first-party CDN (the app already deploys to Vercel, which serves static assets from its edge CDN); (2) load samples **lazily on instrument selection**, never blocking page load; (3) progressively load — fetch the 6–8 mid-range zones first so playback can start in ~1s, then fill in outer octaves; (4) share one sampler between chord and melody roles.

- **Pros**
  - Best realism per engineering hour; `Tone.Sampler` already handles pitch-shifting, polyphony, and integrates natively with the existing Transport scheduling and humanization.
  - Minimal architectural change — extends the existing registry/`useInstrument` pattern.
  - Self-hosting removes the third-party CDN risk and enables offline caching later.
- **Cons**
  - Samples are still megabytes; without a synth tier, slow networks still mean waiting or falling back to a mismatched sound.
  - Sample curation/licensing work (Salamander is CC-BY 3.0 — fine with attribution; EP set needs vetting).
  - Repo/deploy size grows (~4–8 MB of audio assets).
- **Estimated effort:** 4–6 days.
- **Bundle/load impact:** JS unchanged; ~2–4 MB lazy audio per sampled instrument (mp3/ogg, loaded only when selected; ~300–600 KB for the "playable fast" progressive first wave).
- **Sound quality potential:** **High** for piano/EP.

## Option C: SoundFont / WebAudioFont Approach

**Description.** Replace or augment playback with General-MIDI-style instrument banks: WebAudioFont (instruments as ~100–600 KB JS files with its own player), or `soundfont-player`/`smplr` loading FluidR3/FatBoy/MusyngKite banks.

- **Pros**
  - Hundreds of instruments instantly available; small per-instrument payloads.
  - Battle-tested GM sounds; lazy loading is the default model.
- **Cons**
  - **GM sound quality is dated** — typically *worse* than the current Salamander piano. This moves the headline sound backwards.
  - WebAudioFont and soundfont players have their **own scheduling/envelope APIs** that don't plug into `Tone.Transport`, `triggerAttackRelease`, or the humanization event model — the scheduler in `page.tsx`/`Workspace.tsx` would need an adapter layer or rewrite.
  - Two audio paradigms in one codebase = long-term maintenance drag.
- **Estimated effort:** 5–8 days (mostly integration/adapter work).
- **Bundle/load impact:** +20–40 KB player JS; 100–600 KB per instrument, lazy.
- **Sound quality potential:** Medium-low (GM-grade). Good breadth, weak depth.

## Option D: Hybrid Engine (Synth tier + Lazy Sampler tier)

**Description.** Combine A and B behind the existing registry, organized as explicit quality tiers:

- **Lightweight tier (synthesis, instant, always works):** Soft Keys, Filtered Saw pad, FM Electric Piano, FM/additive Piano approximation, Organ. Zero downloads.
- **High-Quality tier (Tone.Sampler, lazy, self-hosted):** Lush Piano (Salamander), Warm EP (real multi-sample set), optionally a sampled pad later.
- Every HQ instrument declares a **lightweight twin** (`fallbackId`), so degradation keeps the timbre family (sampled piano → synth piano, not organ).
- An `audioSettingsStore` (persisted) holds quality mode + instrument; both pages consume it.

- **Pros**
  - Delivers all four target sounds at the best quality each can achieve.
  - Instant, reliable default; HQ is opt-in/auto-upgrade, never blocking.
  - Builds directly on the existing registry, `useInstrument`, humanization, and Transport scheduling — no rewrite, no second audio paradigm.
  - Future instruments slot in as registry entries in either tier.
- **Cons**
  - Largest single scope (though it decomposes into safe phases — see plan).
  - Sound-design and sample-curation work both required.
  - More UI states to design (per-instrument loading, quality badges, fallback notices).
- **Estimated effort:** 7–10 days total across phases; each phase ships independently.
- **Bundle/load impact:** JS roughly unchanged (optionally −150 KB initial if Tone.js is dynamically imported in a later phase); HQ audio is 100% lazy.
- **Sound quality potential:** **High** — and the floor (lightweight mode) also rises substantially.

---

## Recommended Path

**Option D (Hybrid), implemented as incremental phases on top of the existing registry.**

Why: the codebase is already ~60% of the way there — it has an instrument abstraction, async sample loading with timeout/fallback, loading UI, and engine-agnostic humanization. What's missing is exactly what the hybrid adds: a pleasant always-instant synth tier, a properly-sourced HQ tier that loads lazily instead of blocking page load, persistence, and timbre-preserving fallback. Options A and B are each *half* of D; C would be a paradigm fork with a quality ceiling below what Harmonia already has.

Priority alignment: great sound (HQ sampler tier) ✓, fast initial load (synth default + lazy samples) ✓, reliable mobile (synth tier always works; samples optional) ✓, simple UX (one quality toggle + one instrument picker) ✓, maintainable (single registry, single scheduler) ✓, expandable (new instrument = one registry entry) ✓.

---

## Proposed Audio Mode Architecture

```
                    audioSettingsStore (persisted)
                    quality: "lightweight" | "high" (+ "auto" upgrade flag)
                    instrumentId, defaultQuality
                              │
                       useInstrument(instrumentId, quality)
                              │
              INSTRUMENTS registry (extends existing InstrumentDefinition)
              ┌──────────────────────────┬────────────────────────────────┐
              │ Lightweight (synth)      │ High-Quality (Tone.Sampler)    │
              │ needsLoading: false      │ needsLoading: true             │
              │ • Soft Keys              │ • Lush Piano   (fallback:      │
              │ • Filtered Saw           │     Soft Keys / synth piano)   │
              │ • Electric Piano (FM)    │ • Warm EP      (fallback:      │
              │ • Organ                  │     FM Electric Piano)         │
              └──────────────────────────┴────────────────────────────────┘
                              │
        Existing, unchanged: humanization → Transport.schedule → triggerAttackRelease
```

Key behaviors:

1. **Instrument identity is separate from quality.** The user picks a *sound* ("Lush Piano", "Electric Piano", "Soft Keys", "Filtered Saw"); the quality mode decides whether the sampled or synth realization is used where both exist. Each `InstrumentDefinition` gains `tier: "lightweight" | "high"` and optional `fallbackId`.
2. **Lightweight is the cold-start default.** First-ever visit plays instantly on synthesis. If the user's persisted default is High Quality (or "auto-upgrade" is on), the sampler loads **in the background while the synth twin is already playable**; when `onload` fires, the engine hot-swaps at the next scheduled chord boundary. The Play button is never disabled by sample loading again.
3. **Fallback preserves timbre.** Sampler error/timeout → the instrument's `fallbackId` twin (not Organ), plus the existing dismissible notice, now worded: "High-quality Piano couldn't load — playing the lightweight version."
4. **One instrument instance per role, shared sample buffers.** Chord and melody instruments for the same sampled preset should share `Tone.ToneAudioBuffers` (or simply one Sampler) to halve memory/decoding.
5. **Scheduling, humanization, looping, Draw sync: unchanged.** The hot-swap only replaces what `synthRef.current` points to.

## Proposed User Settings UX

Keep everything in the existing audio popover (volume icon in the action bar) — it's already the discoverable home for sound settings — but restructure it:

```
┌─ Sound ────────────────────────────────┐
│ Instrument:  [♪ Lush Piano        ▾]   │   ← grouped select: "Keys", "Synths"
│              (spinner + "loading…"     │
│               inline while HQ loads)   │
│                                        │
│ Audio quality:  ( Lightweight | High ) │   ← segmented control
│   "Lightweight starts instantly.       │
│    High Quality downloads real         │
│    instrument samples (~3 MB)."        │   ← one-line plain-language hint
│                                        │
│ ☑ Use high quality when available      │   ← auto-upgrade: start light,
│                                        │     switch when samples are ready
├─ Mute: Chords / Melody (unchanged) ────┤
├─ Playback: velocity, humanize, sustain,│
│            style (unchanged)           │
└────────────────────────────────────────┘
```

- **Selecting quality mode:** the segmented control switches immediately; switching to High shows the inline loading state on the instrument row and keeps playing the lightweight twin until ready.
- **Default quality:** whatever the user last selected *is* the persisted default (no separate "default" dropdown — one less concept; the "use high quality when available" checkbox covers the "prefer HQ but don't block" case). If a distinct default control is desired later it's a one-line store addition.
- **Instrument picker:** options labeled plainly (Lush Piano, Electric Piano, Soft Keys, Filtered Saw, Organ); HQ-capable entries get a small "HQ" badge when high quality is active.
- **Loading state:** inline spinner + label in the popover row, plus the existing subtle notice area above the action bar. Play is never disabled.
- **Failure:** automatic fallback to the lightweight twin + dismissible amber notice (existing pattern, re-worded). A "Retry" link re-attempts the sampler load.
- **Sketchpad** consumes the same store, so the choice follows the user across pages.

## Persistence Plan

Add `lib/state/audioSettingsStore.ts` mirroring the existing `playbackSettingsStore` pattern (Zustand + `persist`, localStorage key `harmonia-audio-settings`):

```ts
{ instrumentId: "lush-piano", quality: "lightweight" | "high",
  autoUpgrade: boolean }   // defaults: soft instrument, "lightweight", true
```

Both `app/page.tsx` and `Workspace.tsx` drop their local `useState` and read this store — fixing the no-persistence and duplicated-state issues in one move. Migration: none needed (instrument was never persisted); keep `harmonia-playback-settings` untouched.

## Fallback Plan

Trigger conditions (all already detected by `useInstrument`): Sampler `onerror`, or load exceeding the timeout (keep 10s; consider 15s on detected slow connections via `navigator.connection`).

1. Dispose the failed sampler (existing behavior).
2. Instantiate the instrument's `fallbackId` lightweight twin — *not* Organ — so the music keeps the same character.
3. Surface the existing dismissible notice with a Retry affordance.
4. Record the failure in-memory for the session; `autoUpgrade` stops re-attempting after 2 failures to avoid background-retry loops on captive/blocked networks.
5. If even synth creation throws (no Web Audio at all), keep the current behavior: controls disabled, console warning — this is the SSR/ancient-browser case and is already guarded.

Offline: lightweight mode works fully offline once the JS is cached. HQ samples self-hosted under `public/samples/` become cacheable by a future service worker (out of scope here, but the self-hosting choice is what makes it possible).

## Implementation Plan

Each phase is independently shippable and low-risk:

1. **Phase 1 — Settings foundation (no sound change).** Add `audioSettingsStore` (persisted); wire `page.tsx` + `Workspace.tsx` to it; instrument choice now persists and is shared. *(~½ day)*
2. **Phase 2 — Lightweight tier sound design.** Add Soft Keys and Filtered Saw `InstrumentDefinition`s (synth, `needsLoading: false`); add an FM electric-piano synth voice; tune per-voice effects sends. Make a lightweight voice the cold-start default. *(~2 days, mostly ear time)*
3. **Phase 3 — Quality modes + timbre-preserving fallback.** Add `tier`/`fallbackId` to the registry; add the quality segmented control + explainer + auto-upgrade checkbox to the popover; change `useInstrument` to fall back to the twin; hot-swap on background load. Play button no longer disabled while loading. *(~2 days)*
4. **Phase 4 — HQ sample quality + self-hosting.** Move Salamander subset to first-party hosting (`public/samples/` on Vercel's CDN); source and integrate a real multi-sampled EP (license-vetted); progressive loading (mid-octaves first); share buffers between chord/melody roles. *(~2–3 days)*
5. **Phase 5 (optional) — Bundle hygiene.** Dynamically import a thin `audioEngine` module (which itself imports Tone) so Tone.js leaves the initial bundle; preload on first pointer-down. *(~1 day; measurable LCP/TTI win, zero UX change)*

## Files Likely to Change

| File | Why |
|---|---|
| `lib/audio/synthPresets.ts` | New instrument entries (Soft Keys, Filtered Saw, FM EP), `tier`/`fallbackId` fields, EP sample map replacement, self-hosted `baseUrl`s |
| `lib/audio/useInstrument.ts` | Quality-aware creation, twin fallback, background load + hot-swap, retry |
| `lib/state/audioSettingsStore.ts` | **New** — persisted instrument + quality + auto-upgrade |
| `app/page.tsx` | Drop local `soundPreset` state; popover UI: quality control, explainer, badges, loading row; un-disable Play during loads |
| `components/sketchpad/Workspace.tsx` | Same store consumption; remove duplicated state |
| `public/samples/**` | **New** — self-hosted piano/EP sample assets |
| `lib/audio/__tests__/` | Tests for store, registry tiers, fallback logic |
| `README.md` | Document the new audio modes (per project convention) |

## Testing Plan

- **Unit (vitest, happy-dom — existing setup):** `audioSettingsStore` persistence/defaults/clamping; registry invariants (every HQ instrument has a valid `fallbackId`; every `SoundPresetId` resolves); humanization regression suite already exists and must stay green; fallback state machine in `useInstrument` with mocked Sampler (`onload`/`onerror`/timeout paths — fake timers).
- **Integration:** render the page with a mocked Tone module; assert Play is enabled during HQ load, hot-swap happens on `onload`, twin fallback + notice on error, settings survive a simulated reload (localStorage).
- **Manual browser matrix:** Chrome/Firefox/Edge desktop, **Safari desktop** (stricter Web Audio), with DevTools network throttling (Slow 3G: verify instant lightweight playback + background HQ upgrade; Offline: verify lightweight works, HQ falls back gracefully).
- **Mobile:** iOS Safari — first-tap audio unlock, silent-switch behavior, backgrounding/return (context suspension), HQ load over cellular; Android Chrome — same pass; verify memory stability when toggling instruments repeatedly (sampler disposal).
- **Audio QA checklist:** each instrument auditioned across C2–C6, block/strum/arpeggio styles, velocity extremes, sustained loop for 5+ minutes (no clipping at limiter, no envelope clicks, no chorus/reverb buildup).

## Open Questions

1. **Sample hosting:** self-host in `public/` (repo grows ~4–8 MB; served by Vercel's edge CDN — recommended) vs. external object storage/CDN? Any Vercel bandwidth budget concerns?
2. **Cold-start default sound:** Soft Keys (safest, prettiest synth) or the synth piano twin (closer to current default timbre)? Recommendation: Soft Keys.
3. **`autoUpgrade` default ON?** Recommended yes on desktop; consider defaulting OFF when `navigator.connection.saveData` is set or on detected 2G/3G.
4. **EP sample source:** needs a license-vetted multi-sampled Rhodes/Wurli set (FreePats, permissive SoundFont extraction, or a purchased/CC0 set). Decision needed before Phase 4. Salamander piano is CC-BY 3.0 — attribution should be added to the README either way (it's in production use today).
5. **Keep "Organ"?** It's currently fallback + a selectable preset. Proposal: keep as a lightweight instrument, retire it as the universal fallback.
6. **Is Phase 5 (Tone.js code-splitting) worth it now**, or defer until there's a perf budget exercise?
7. **Melody voice:** should melody default to the same instrument as chords (current behavior) or get its own picker later? Proposal: keep shared for now; the registry already supports divergence.
