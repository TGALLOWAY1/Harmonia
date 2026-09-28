# LinkedIn Post — Harmonia

> Suggested attachments (in order):
> 1. `public/marketing/01-chord-generator.png` — Chord generator with piano roll
> 2. `public/marketing/02-chord-melody-engine.png` — Melody overlay on a Cmaj7 → Em7 → E7 → Am7 progression
> 3. `public/marketing/03-substitution-panel.png` — Theory-guided substitution panel
> 4. `public/marketing/04-harmonic-sketchpad.png` — Harmonic Sketchpad workspace

---

## Post (long form)

I’ve been building **Harmonia** — a browser-based harmonic workstation that takes chord progression generation seriously as a music-theory problem, not a probability one.

Most “AI chord generators” roll dice over a key. Harmonia models harmony the way a player would think about it: phrase structure, voice leading, secondary dominants, modal mixture, tritone subs, voicing density, inversions. The output isn’t random — it’s explainable.

A few things I wanted to solve:

🎼 **Generation that respects function, not just key.** Pick a key and mode, set complexity from simple triads up to altered dominants and tritone substitutions, then control voicing style (Tight / Balanced / Open) and density (Sparse / Standard / Rich). Every chord shows its Roman numeral and inversion.

🎹 **A piano roll you can actually edit.** Double-click to add or remove notes, drag to change pitch, and Harmonia re-interprets the chord label in real time. Source badges (Generated · Substituted · Edited) track the provenance of every chord so you can revert any change.

🔀 **Theory-guided substitutions, not vibes.** Click any chord and get a panel of alternatives grouped by category — diatonic, dominant function, tritone sub, modal mixture — each with a one-line explanation of *why* it works (“Shares 3 notes — diatonic iii in C ionian”). Preview, apply, revert.

🎵 **A melody engine on top.** Toggle a monophonic melody over the chords with three styles — Lyrical (stepwise, longer notes), Rhythmic (syncopation), and Arpeggiated (chord-tone focused). It renders directly on the same piano roll so you can see the line breathe with the harmony.

📐 **Song-level planning before the DAW.** The Harmonic Sketchpad lets you build Intro · Verse · Pre-Chorus · Chorus · Bridge · Drop · Outro sections, create A/B/C variants per section to compare ideas, override key/scale per section for modulations, and audition transitions between adjacent sections. MIDI export when you’re ready to commit.

What I’m most happy with is that the whole stack stays deterministic and inspectable — the substitution engine, voice leading, and voicing rules are all rule-driven, with rated voicing feedback feeding into a persistent quality signal over time.

**Stack:** Next.js 14 · TypeScript · Zustand · Tone.js (Salamander Grand Piano sampler + FM/EP synths) · Tailwind · Framer Motion.

If you’re a producer, a music-theory nerd, or someone who has been frustrated by chord generators that don’t know what a secondary dominant is — I’d love your feedback.

#MusicTech #WebAudio #MusicTheory #Nextjs #TypeScript #ToneJS #IndieDev #CreativeTools #MusicProduction

---

## Post (short form, alt)

Built **Harmonia** — a chord & melody engine that thinks like a music theorist, not a Markov chain.

• Generates progressions with phrase structure, voice leading, secondary dominants & tritone subs
• Click any chord → theory-guided substitutions, each with a *why* it works
• Piano roll you can edit note-by-note — chord labels re-interpret in real time
• Melody overlay in three styles (Lyrical / Rhythmic / Arpeggio)
• Sketchpad for song-level planning: Verse, Chorus, Bridge, variants, modulations
• MIDI export · real piano samples · everything deterministic and inspectable

Built with Next.js 14, TypeScript, Tone.js, and Zustand.

#MusicTech #WebAudio #MusicTheory #IndieDev
