"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Download, Sparkles, Music, Lock, Unlock, LayoutDashboard, Shuffle, RotateCcw, ChevronDown, Heart, Trash2, Upload, VolumeX, Volume2, Settings2, Layers, Save, MoreVertical, X, Check } from "lucide-react";
import Link from "next/link";
import { useProgressionStore, COMPLEXITY_LABELS, getScalePitchClasses, type ComplexityLevel } from "@/lib/state/progressionStore";
import {
  usePlaybackSettingsStore,
  CHORD_VELOCITY_MIN,
  CHORD_VELOCITY_MAX,
} from "@/lib/state/playbackSettingsStore";
import { buildChordEvents, humanizeVelocity } from "@/lib/audio/humanization";
import { InteractivePianoRoll } from "@/components/creative/InteractivePianoRoll";
import { ChordCard } from "@/components/progression/ChordCard";
import { SubstitutionPanel } from "@/components/creative/SubstitutionPanel";
import { VoicingFeedback } from "@/components/feedback/VoicingFeedback";
import { FeedbackChart } from "@/components/feedback/FeedbackChart";
import { useFavoritesStore } from "@/lib/favorites/favoritesStore";
import {
  SOUND_PRESETS,
  presetHasHighQuality,
  type AudioQuality,
  type SoundPresetId,
} from "@/lib/audio/instrumentCatalog";
import type { Synth, MelodySynth } from "@/lib/audio/synthPresets";
import { useAudioSettingsStore } from "@/lib/state/audioSettingsStore";
import { useInstrument } from "@/lib/audio/useInstrument";
import { ensureAudioReady } from "@/lib/audio/audioEngine";
import { AudioStatusBadge } from "@/components/audio/AudioStatusBadge";
import { midiToNoteName, normalizeToPitchClass, type PitchClass } from "@/lib/theory/midiUtils";
import { keyPrefersFlats } from "@/lib/theory/spelling";
import type { Mode } from "@/lib/theory/harmonyEngine";
import type { SubstitutionOption, ChordSourceType } from "@/lib/creative/types";
import type { VoicingStyle, VoiceCount } from "@/lib/music/generators/advanced/types";
import type { MelodyStyle, MelodyHarmony, MelodyMood } from "@/lib/music/generators/melody/types";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES: { value: Mode; label: string }[] = [
  { value: "ionian", label: "Major" },
  { value: "aeolian", label: "Minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
];
const CHORD_COUNTS = [3, 4, 5, 6, 7, 8];

const VOICING_STYLES: { value: VoicingStyle; label: string }[] = [
  { value: "closed", label: "Tight" },
  { value: "auto", label: "Balanced" },
  { value: "spread", label: "Open" },
];

const VOICE_COUNTS: { value: VoiceCount; label: string }[] = [
  { value: 3, label: "Sparse" },
  { value: 4, label: "Standard" },
  { value: 5, label: "Rich" },
];

const MELODY_STYLES: { value: MelodyStyle; label: string }[] = [
  { value: "lyrical", label: "Lyrical" },
  { value: "rhythmic", label: "Rhythmic" },
  { value: "arpeggiated", label: "Arpeggio" },
];

const MELODY_HARMONIES: { value: MelodyHarmony; label: string }[] = [
  { value: "expressive", label: "Expressive" },
  { value: "strict", label: "Strict" },
];

const MELODY_MOODS: { value: MelodyMood; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "emotional", label: "Emotional" },
  { value: "dreamy", label: "Dreamy" },
  { value: "energetic", label: "Energetic" },
];

/* ─── Component ─── */

export default function HarmoniaPage() {
  const {
    currentProgression,
    isPlaying,
    bpm,
    rootKey,
    mode,
    complexity,
    numChords,
    voicingStyle,
    voiceCount,
    setSettings,
    generateNew,
    toggleLock,
    deleteChord,
    shiftNote,
    setIsPlaying,
    exportMidi,
    exportMelodyMidi,
    loadProgression,
    // Creative iteration
    chordSourceTypes,
    originalChords,
    substitutionTarget,
    substitutionOptions,
    openSubstitution,
    closeSubstitution,
    applySubstitution,
    revertChord,
    addNote,
    removeNote,
    moveNote,
    resetChord,
    // chords mute
    chordsEnabled,
    setChordsEnabled,
    // Melody
    melody,
    melodyEnabled,
    melodyStyle,
    melodyHarmony,
    melodyMood,
    setMelodyEnabled,
    setMelodyStyle,
    setMelodyHarmony,
    setMelodyMood,
    generateMelodyForProgression,
  } = useProgressionStore();

  const { favorites, addFavorite, removeFavorite } = useFavoritesStore();

  const {
    chordVelocity,
    humanize,
    sustainMode,
    playbackStyle,
    setChordVelocity,
    setHumanize,
    setSustainMode,
    setPlaybackStyle,
  } = usePlaybackSettingsStore();

  const {
    instrumentId: soundPreset,
    quality: audioQuality,
    setInstrument: setSoundPreset,
    setQuality: setAudioQuality,
  } = useAudioSettingsStore();

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [generationKey, setGenerationKey] = useState(0);
  const [selectedChordIndex, setSelectedChordIndex] = useState<number | null>(null);
  const [showVoicingControls, setShowVoicingControls] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [showMelodyOnRoll, setShowMelodyOnRoll] = useState(true);
  const [justSaved, setJustSaved] = useState(false);

  const presetLabel = SOUND_PRESETS.find((p) => p.id === soundPreset)?.label ?? "Instrument";

  const synthRef = useRef<Synth | null>(null);
  const melodySynthRef = useRef<MelodySynth | null>(null);
  const playbackIndexRef = useRef(0);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);

  /* ─── Synth lifecycle (loading, hot-swap + fallback handled by the hook) ─── */

  const {
    isLoading: isSynthLoading,
    loadError: synthLoadError,
    activeQuality,
    dismissError: dismissSynthError,
    retry: retrySynthLoad,
  } = useInstrument(soundPreset, { quality: audioQuality, sustainMode, synthRef });

  /* ─── Melody synth lifecycle (same instrument & quality, melody voice) ─── */

  useInstrument(soundPreset, {
    quality: audioQuality,
    role: "melody",
    enabled: melodyEnabled,
    synthRef: melodySynthRef,
  });

  /* ─── Transport BPM ─── */

  useEffect(() => {
    Tone.getTransport().bpm.value = bpm;
  }, [bpm]);

  /* ─── Playback loop ─── */

  /** Convert a DurationClass to beat count (matches MIDI export). */
  const durationToBeats = useCallback((dc?: string): number => {
    switch (dc) {
      case "full": return 4;
      case "half": return 2;
      case "quarter": return 1;
      case "eighth": return 0.5;
      default: return 4;
    }
  }, []);

  /** Convert beats to Tone.js duration notation. */
  const beatsToDuration = useCallback((beats: number): string => {
    switch (beats) {
      case 4: return "1n";
      case 2: return "2n";
      case 1: return "4n";
      case 0.5: return "8n";
      default: return "1n";
    }
  }, []);

  const scheduleIdsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!isPlaying || !currentProgression) {
      // Clear all scheduled events
      for (const id of scheduleIdsRef.current) {
        Tone.getTransport().clear(id);
      }
      scheduleIdsRef.current = [];
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
      playbackIndexRef.current = 0;
      setPlaybackIndex(null);
      if (synthRef.current) synthRef.current.releaseAll();
      return;
    }

    const chords = currentProgression.chords;
    const ids: number[] = [];

    // Calculate total beats in the progression for looping
    let totalBeats = 0;
    for (const chord of chords) {
      totalBeats += durationToBeats(chord.durationClass);
    }
    const releaseBuffer = 1; // 1 beat buffer for note release tails
    const totalMeasures = Math.ceil((totalBeats + releaseBuffer) / 4); // in Tone.js "measures" at 4/4

    // Schedule each chord at its correct beat offset using musical time (bars:quarters:sixteenths)
    let beatOffset = 0;
    for (let i = 0; i < chords.length; i++) {
      const chord = chords[i];
      const beats = durationToBeats(chord.durationClass);
      const duration = beatsToDuration(beats);
      const chordIdx = i;

      // Convert beat offset to bars:quarters:sixteenths
      const bars = Math.floor(beatOffset / 4);
      const quarters = Math.floor(beatOffset % 4);
      const sixteenths = (beatOffset % 1) * 4;
      const timeStr = `${bars}:${quarters}:${sixteenths}`;

      const id = Tone.getTransport().schedule((time) => {
        if (!synthRef.current) return;

        // Safeguard against overlapping chords: the instant a new chord begins,
        // release everything the previous chord left ringing, scheduled at this
        // exact `time`. The per-note `triggerAttackRelease(duration)` below is
        // not enough on its own — a sampled instrument's natural sustain (e.g.
        // the grand-piano samples used in High quality mode) keeps sounding
        // well past the chord's nominal length, a release can be dropped at the
        // transport loop boundary, and a note shared with the next chord never
        // re-articulates. Cutting here keeps a short, bounded tail instead of
        // an unbounded pile-up, independent of the instrument or sustain mode.
        synthRef.current.releaseAll(time);

        if (useProgressionStore.getState().chordsEnabled) {
          // Drive playback from canonical MIDI notes so audio is independent of
          // how the chord is enharmonically spelled for display (e.g. "Bb" vs
          // "A#"). Fall back to note-name strings only when MIDI is absent.
          const notes =
            chord.midiNotes && chord.midiNotes.length > 0
              ? chord.midiNotes.map((m) => midiToNoteName(m))
              : chord.notesWithOctave && chord.notesWithOctave.length > 0
                ? chord.notesWithOctave
                : chord.notes.map((n) => `${n}3`);
          // Read live settings so velocity/humanize/style changes apply mid-loop.
          const ps = usePlaybackSettingsStore.getState();
          // Tempo-aware spread so an arpeggio fits the chord at any BPM.
          const liveBpm = Tone.getTransport().bpm.value || 120;
          const events = buildChordEvents(notes, {
            baseVelocity: ps.chordVelocity,
            humanize: ps.humanize,
            style: ps.playbackStyle,
            spreadSeconds: beats * (60 / liveBpm),
          });
          for (const ev of events) {
            synthRef.current.triggerAttackRelease(
              ev.note,
              duration,
              time + ev.timeOffset,
              ev.velocity,
            );
          }
        }

        Tone.getDraw().schedule(() => {
          setPlaybackIndex(chordIdx);
          playbackIndexRef.current = chordIdx;
        }, time);
      }, timeStr);

      ids.push(id);
      beatOffset += beats;
    }

    // Schedule melody notes
    if (melody && melodySynthRef.current) {
      for (const mn of melody.notes) {
        const mBars = Math.floor(mn.startBeat / 4);
        const mQuarters = Math.floor(mn.startBeat % 4);
        const mSixteenths = (mn.startBeat % 1) * 4;
        const mTimeStr = `${mBars}:${mQuarters}:${mSixteenths}`;
        const mDuration = beatsToDuration(mn.durationBeats);

        const mid = Tone.getTransport().schedule((time) => {
          if (useProgressionStore.getState().melodyEnabled) {
            const ps = usePlaybackSettingsStore.getState();
            const velocity = humanizeVelocity(ps.chordVelocity, ps.humanize);
            melodySynthRef.current?.triggerAttackRelease(mn.noteWithOctave, mDuration, time, velocity);
          }
        }, mTimeStr);
        ids.push(mid);
      }
    }

    scheduleIdsRef.current = ids;

    // Set loop points so the progression repeats
    Tone.getTransport().loop = true;
    Tone.getTransport().loopStart = 0;
    // Use precise bar:quarter:sixteenth formatting for flawless looping
    const endBars = Math.floor(totalBeats / 4);
    const endQuarters = Math.floor(totalBeats % 4);
    const endSixteenths = (totalBeats % 1) * 4;
    Tone.getTransport().loopEnd = `${endBars}:${endQuarters}:${endSixteenths}`;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();

    return () => {
      for (const id of scheduleIdsRef.current) {
        Tone.getTransport().clear(id);
      }
      scheduleIdsRef.current = [];
      Tone.getTransport().loop = false;
      Tone.getDraw().cancel(0);
    };
  }, [isPlaying, currentProgression, durationToBeats, beatsToDuration, melody]);

  /* ─── Playhead animation ─── */

  useEffect(() => {
    if (!isPlaying || !currentProgression) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
      if (playheadRef.current) playheadRef.current.style.display = "none";
      return;
    }

    const totalBeats = currentProgression.chords.reduce(
      (sum, c) => sum + durationToBeats(c.durationClass), 0
    );

    const tick = () => {
      const transport = Tone.getTransport();
      const positionSeconds = transport.seconds;
      const secondsPerBeat = 60 / bpm;
      const totalSeconds = totalBeats * secondsPerBeat;
      const progress = totalSeconds > 0 ? (positionSeconds % totalSeconds) / totalSeconds : 0;

      if (playheadRef.current) {
        playheadRef.current.style.display = "block";
        playheadRef.current.style.left = `${progress * 100}%`;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    };
  }, [isPlaying, currentProgression, bpm, durationToBeats]);

  /* ─── Handlers ─── */

  const handleGenerate = useCallback(async () => {
    await ensureAudioReady();
    if (isPlaying) {
      setIsPlaying(false);
    }
    generateNew();
    setGenerationKey((k) => k + 1);
  }, [generateNew, isPlaying, setIsPlaying]);

  const handleTogglePlayback = useCallback(async () => {
    // Resume from this gesture and wait until the context is actually running
    // before scheduling, so the first press is never a silent no-op.
    await ensureAudioReady();
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  const handleSaveProgression = useCallback(() => {
    if (!currentProgression) return;
    const name = `${rootKey} ${mode} — ${currentProgression.chords.map((c) => c.symbol).join(" · ")}`;
    addFavorite({ name, progression: currentProgression, rootKey, mode, complexity, bpm });
    // Confirm the save so it's obvious the tap registered — especially on
    // mobile, where the favorites count lives inside the closed overflow menu.
    setJustSaved(true);
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setJustSaved(false), 1800);
  }, [currentProgression, rootKey, mode, complexity, bpm, addFavorite]);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  /**
   * Play a one-off chord preview with humanized per-note velocity (no strum,
   * so previews stay snappy). Reads live settings via getState.
   */
  const playChordPreview = useCallback(async (notesWithOctave: string[], duration: string) => {
    // A chord-card / substitution tap is often the first gesture on mobile, so
    // unlock the context here too — otherwise the preview is silently dropped.
    await ensureAudioReady();
    if (!synthRef.current) return;
    const ps = usePlaybackSettingsStore.getState();
    const events = buildChordEvents(notesWithOctave, {
      baseVelocity: ps.chordVelocity,
      humanize: ps.humanize,
      style: "block",
    });
    // Same safeguard as the sequence scheduler: cut whatever is still ringing
    // before attacking so rapid taps (chord cards, substitution previews)
    // replace the previous preview instead of stacking on top of it. Releasing
    // and attacking at one precise `now` is deterministic, unlike the old
    // releaseAll() + setTimeout(10ms) guess that each call site used to repeat.
    const now = Tone.now();
    synthRef.current.releaseAll(now);
    for (const ev of events) {
      synthRef.current.triggerAttackRelease(ev.note, duration, now + ev.timeOffset, ev.velocity);
    }
  }, []);

  const handlePlayNote = useCallback(
    async (noteWithOctave: string) => {
      await ensureAudioReady();
      if (synthRef.current) {
        const ps = usePlaybackSettingsStore.getState();
        const velocity = humanizeVelocity(ps.chordVelocity, ps.humanize);
        synthRef.current.triggerAttackRelease(noteWithOctave, "4n", undefined, velocity);
      }
    },
    []
  );

  const handleChordClick = useCallback(
    (notesWithOctave: string[], chordIndex: number) => {
      // Begin unlocking synchronously while the tap is still "live" (mobile
      // requires this); playChordPreview awaits the same promise before firing.
      void ensureAudioReady();
      // Stop current playback to prevent overlapping sounds
      if (isPlaying) {
        setIsPlaying(false);
      }
      // playChordPreview cuts the previous preview before attacking, so taps
      // replace rather than overlap.
      void playChordPreview(notesWithOctave, "2n");
      // Set this chord as the new loop start position and select it
      playbackIndexRef.current = chordIndex;
      setPlaybackIndex(chordIndex);
      setSelectedChordIndex(chordIndex);
    },
    [isPlaying, setIsPlaying, playChordPreview]
  );

  // ─── Substitution handlers ───
  const handleSubstitutionPreview = useCallback(
    (option: SubstitutionOption) => {
      void ensureAudioReady();
      void playChordPreview(option.candidateNotesWithOctave, "2n");
    },
    [playChordPreview]
  );

  const handleSubstitutionApply = useCallback(
    (option: SubstitutionOption) => {
      if (substitutionTarget === null) return;
      void ensureAudioReady();
      applySubstitution(option, substitutionTarget);
      // Preview the applied chord (cuts any prior preview before attacking).
      void playChordPreview(option.candidateNotesWithOctave, "2n");
    },
    [substitutionTarget, applySubstitution, playChordPreview]
  );

  const handleSubstitutionRevert = useCallback(() => {
    if (substitutionTarget === null) return;
    revertChord(substitutionTarget);
  }, [substitutionTarget, revertChord]);

  // Keyboard handler for chord deletion on selected chord card
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedChordIndex === null || !currentProgression) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if user is typing in an input
        if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
        e.preventDefault();
        if (currentProgression.chords.length > 1) {
          deleteChord(selectedChordIndex);
          setSelectedChordIndex(null);
        }
      } else if (e.key === "Escape") {
        setSelectedChordIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedChordIndex, currentProgression, deleteChord]);

  /* ─── Render ─── */

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border-subtle bg-surface/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 lg:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Music className="w-5 h-5 text-accent" />
            <h1 className="text-lg font-semibold tracking-tight">Harmonia</h1>
          </div>
          <div className="hidden lg:flex items-center gap-4">

            <FeedbackChart />
            
            <div className="flex items-center gap-2 border-r border-border-subtle pr-4 mr-1">
              {currentProgression && (
                <button
                  onClick={() => {
                    const name = `${rootKey} ${mode} — ${currentProgression.chords.map((c) => c.symbol).join(" · ")}`;
                    addFavorite({ name, progression: currentProgression, rootKey, mode, complexity, bpm });
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-border-subtle bg-surface hover:bg-surface-muted transition-colors text-muted hover:text-foreground"
                  title="Save to favorites"
                >
                  <Save className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setShowFavorites(!showFavorites)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                  showFavorites
                    ? "bg-accent/10 text-accent border-accent/30"
                    : "border-border-subtle bg-surface hover:bg-surface-muted text-muted hover:text-foreground"
                }`}
              >
                <Heart className="w-3.5 h-3.5" />
                Favorites{favorites.length > 0 && ` (${favorites.length})`}
              </button>
              {currentProgression && (
                <button
                  onClick={exportMidi}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-subtle bg-surface hover:bg-surface-muted text-xs font-medium transition-colors text-muted hover:text-foreground"
                  title="Export Chords MIDI"
                >
                  <Download className="w-3.5 h-3.5" />
                  Chords
                </button>
              )}
              {melodyEnabled && melody && (
                <button
                  onClick={exportMelodyMidi}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-subtle bg-surface hover:bg-surface-muted text-xs font-medium transition-colors text-muted hover:text-foreground"
                  title="Export Melody MIDI"
                >
                  <Download className="w-3.5 h-3.5" />
                  Melody
                </button>
              )}
            </div>

            <Link
              href="/sketchpad"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-subtle bg-surface-muted hover:bg-accent/10 hover:border-accent/30 text-xs font-medium text-muted hover:text-foreground transition-all"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Sketchpad
            </Link>
          </div>

          {/* Mobile header actions — overflow menu */}
          <div className="relative flex lg:hidden">
            <button
              onClick={() => setHeaderMenuOpen((v) => !v)}
              className="flex items-center justify-center w-10 h-10 rounded-full border border-border-subtle bg-surface text-muted hover:text-foreground transition-colors"
              aria-label="More actions"
              aria-expanded={headerMenuOpen}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {headerMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setHeaderMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border border-border-subtle bg-surface shadow-xl p-2 flex flex-col gap-1">
                  <div className="px-1 py-0.5">
                    <FeedbackChart />
                  </div>
                  {currentProgression && (
                    <button
                      onClick={() => {
                        handleSaveProgression();
                        setHeaderMenuOpen(false);
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      Save to favorites
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowFavorites(!showFavorites);
                      setHeaderMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                  >
                    <Heart className="w-4 h-4" />
                    Favorites{favorites.length > 0 && ` (${favorites.length})`}
                  </button>
                  {currentProgression && (
                    <button
                      onClick={() => {
                        exportMidi();
                        setHeaderMenuOpen(false);
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export Chords MIDI
                    </button>
                  )}
                  {melodyEnabled && melody && (
                    <button
                      onClick={() => {
                        exportMelodyMidi();
                        setHeaderMenuOpen(false);
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export Melody MIDI
                    </button>
                  )}
                  <Link
                    href="/sketchpad"
                    onClick={() => setHeaderMenuOpen(false)}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Sketchpad
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 lg:px-6 pt-2 lg:pt-10 pb-10 space-y-6 lg:space-y-10">
        {/* ── Controls Bar ── */}
        <section className="bg-surface/60 backdrop-blur-xl border border-border-subtle rounded-2xl p-5 shadow-sm relative overflow-visible z-20">
          {/* Mobile: collapsed settings summary */}
          <button
            onClick={() => setSettingsExpanded((v) => !v)}
            className={`flex lg:hidden items-center justify-between w-full gap-3 relative z-10 ${settingsExpanded ? "mb-4" : ""}`}
            aria-expanded={settingsExpanded}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted uppercase tracking-widest shrink-0">
              <Settings2 className="w-3 h-3 text-accent/70" />
              Settings
            </span>
            <span className="flex-1 text-right text-xs font-medium text-foreground truncate">
              {rootKey} {MODES.find((m) => m.value === mode)?.label} · {bpm} BPM · {numChords} Chords · {COMPLEXITY_LABELS[complexity]}
            </span>
            <ChevronDown className={`w-4 h-4 text-muted transition-transform shrink-0 ${settingsExpanded ? "rotate-180" : ""}`} />
          </button>

          <div className={`relative z-10 ${settingsExpanded ? "flex" : "hidden"} lg:flex flex-wrap lg:flex-nowrap items-start justify-between gap-6`}>
            
            {/* Foundation Group */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-[240px]">
              <label className="flex items-center gap-1.5 text-[11px] lg:text-[10px] font-bold text-muted uppercase tracking-widest pl-1">
                <Music className="w-3 h-3 text-accent/70" />
                Foundation
              </label>
              <div className="flex items-center bg-background/50 border border-border-subtle rounded-xl shadow-inner p-1">
                <select
                  value={rootKey}
                  onChange={(e) => setSettings({ rootKey: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Root Key"
                >
                  {NOTES.map((note) => (
                    <option key={note} value={note}>{note}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={mode}
                  onChange={(e) => setSettings({ mode: e.target.value as Mode })}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Scale Mode"
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <div className="flex flex-1 items-center justify-center hover:bg-surface rounded-lg transition-colors group px-1" title="BPM (Tempo)">
                  <input
                    type="number"
                    min={60}
                    max={180}
                    value={bpm}
                    onChange={(e) => setSettings({ bpm: Number(e.target.value) })}
                    className="w-8 bg-transparent py-1.5 text-sm font-medium outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="ml-1 text-[10px] text-muted opacity-50 pointer-events-none group-hover:opacity-100 transition-opacity mt-0.5">BPM</span>
                </div>
              </div>
            </div>

            {/* Generation Group */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-[260px]">
              <label className="flex items-center gap-1.5 text-[11px] lg:text-[10px] font-bold text-muted uppercase tracking-widest pl-1">
                <Settings2 className="w-3 h-3 text-purple-500/70" />
                Generation
              </label>
              <div className="flex items-center bg-background/50 border border-border-subtle rounded-xl shadow-inner p-1">
                <select
                  value={numChords}
                  onChange={(e) => setSettings({ numChords: Number(e.target.value) as 3 | 4 | 5 | 6 | 7 | 8 })}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Number of Chords"
                >
                  {CHORD_COUNTS.map((n) => (
                    <option key={n} value={n}>{n} Chords</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={complexity}
                  onChange={(e) => setSettings({ complexity: Number(e.target.value) as ComplexityLevel })}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Harmonic Complexity"
                >
                  {([1, 2, 3, 4] as ComplexityLevel[]).map((level) => (
                    <option key={level} value={level}>{COMPLEXITY_LABELS[level]}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={voicingStyle}
                  onChange={(e) => setSettings({ voicingStyle: e.target.value as VoicingStyle })}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Voicing Style"
                >
                  {VOICING_STYLES.map((vs) => (
                    <option key={vs.value} value={vs.value}>{vs.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Textures Group */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-[260px]">
              <label className="flex items-center justify-between w-full pl-1">
                <div className="flex items-center gap-1.5 text-[11px] lg:text-[10px] font-bold text-muted uppercase tracking-widest">
                  <Layers className="w-3 h-3 text-emerald-500/70" />
                  Textures
                </div>
                <span className="text-[9px] text-muted/40 uppercase tracking-widest font-medium">Changes apply on Gen</span>
              </label>
              <div className="flex items-center bg-background/50 border border-border-subtle rounded-xl shadow-inner p-1">
                <select
                  value={voiceCount}
                  onChange={(e) => setSettings({ voiceCount: Number(e.target.value) as 3 | 4 | 5 })}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Voice Count (Density)"
                >
                  {VOICE_COUNTS.map((vc) => (
                    <option key={vc.value} value={vc.value}>{vc.label}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={melodyStyle}
                  onChange={(e) => setMelodyStyle(e.target.value as any)}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Melodic Rhythm Style"
                >
                  {MELODY_STYLES.map((ms) => (
                    <option key={ms.value} value={ms.value}>{ms.label}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={melodyHarmony}
                  onChange={(e) => setMelodyHarmony(e.target.value as any)}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Melody Harmony — how tightly the melody follows the chord tones"
                >
                  {MELODY_HARMONIES.map((mh) => (
                    <option key={mh.value} value={mh.value}>{mh.label}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={melodyMood}
                  onChange={(e) => setMelodyMood(e.target.value as MelodyMood)}
                  className="flex-1 min-w-0 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Melody Mood — emotional character: register, contour, rhythm, and tension"
                >
                  {MELODY_MOODS.map((mm) => (
                    <option key={mm.value} value={mm.value}>{mm.label}</option>
                  ))}
                </select>
              </div>
            </div>

          </div>
        </section>

        {/* ── Favorites Panel ── */}
        {showFavorites && (
          <section className="surface-section rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Heart className="w-4 h-4 text-accent" />
                Saved Progressions
              </h3>
              <button
                onClick={() => setShowFavorites(false)}
                className="flex items-center justify-center w-7 h-7 rounded-full text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                title="Hide saved progressions"
                aria-label="Hide saved progressions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {favorites.length === 0 ? (
              <p className="text-xs text-muted py-4 text-center">
                No favorites yet. Save a progression to see it here.
              </p>
            ) : (
              <div className="grid gap-2 max-h-64 overflow-y-auto">
                {favorites.map((fav) => (
                  <div
                    key={fav.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border-subtle bg-surface-muted/50 hover:bg-surface-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{fav.name}</div>
                      <div className="text-[10px] text-muted">
                        {fav.rootKey} {fav.mode} · {fav.progression.chords.length} chords · {fav.bpm} bpm
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (isPlaying) setIsPlaying(false);
                          setSettings({ rootKey: fav.rootKey, mode: fav.mode as Mode, complexity: fav.complexity as ComplexityLevel, bpm: fav.bpm });
                          loadProgression(fav.progression);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                        title="Load this progression"
                      >
                        <Upload className="w-3 h-3" />
                        Load
                      </button>
                      <button
                        onClick={() => removeFavorite(fav.id)}
                        className="p-1 rounded text-muted/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove from favorites"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Action Bar (Play · Chords · Melody · Save · Audio) ── */}
        <section>
          {synthLoadError ? (
            <div className="flex items-center justify-center gap-2 mb-2 text-xs text-amber-600 dark:text-amber-400">
              <span>
                High-quality {synthLoadError} couldn&apos;t load — playing the lightweight
                version.
              </span>
              <button
                onClick={retrySynthLoad}
                className="underline hover:no-underline"
                aria-label="Retry loading samples"
              >
                Retry
              </button>
              <button
                onClick={dismissSynthError}
                className="underline hover:no-underline"
                aria-label="Dismiss notice"
              >
                Dismiss
              </button>
            </div>
          ) : isSynthLoading ? (
            <div className="flex items-center justify-center gap-2 mb-2 text-xs text-muted">
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span>Loading high-quality {presetLabel} — playing lightweight sound meanwhile…</span>
            </div>
          ) : (
            <div className="flex items-center justify-center mb-2 min-h-[1rem]">
              <AudioStatusBadge />
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5 sm:gap-2 lg:gap-3">

            {/* Primary: Play / Stop */}
            <button
              onClick={handleTogglePlayback}
              disabled={!currentProgression}
              className={`flex items-center justify-center gap-1.5 px-4 lg:px-6 py-2.5 rounded-full font-semibold text-sm transition-all duration-200 disabled:opacity-40 shrink-0 ${
                isPlaying
                  ? "bg-surface text-foreground border border-border-subtle shadow-inner"
                  : "bg-accent text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
              }`}
            >
              {isPlaying ? (
                <>
                  <Square className="w-4 h-4" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Play
                </>
              )}
            </button>

            {/* Secondary: Generate Chords */}
            <button
              onClick={handleGenerate}
              className="flex items-center justify-center gap-1.5 px-3 lg:px-4 py-2.5 rounded-full border border-border-subtle bg-surface text-foreground font-medium text-sm hover:bg-surface-muted hover:border-accent/40 transition-all active:scale-95 shrink-0"
            >
              <Sparkles className="w-4 h-4 text-accent" />
              Chords
            </button>

            {/* Secondary: Generate Melody */}
            <button
              onClick={generateMelodyForProgression}
              disabled={!currentProgression}
              className="flex items-center justify-center gap-1.5 px-3 lg:px-4 py-2.5 rounded-full border border-border-subtle bg-surface text-foreground font-medium text-sm hover:bg-surface-muted hover:border-accent/40 transition-all active:scale-95 disabled:opacity-40 shrink-0"
            >
              <Sparkles className="w-4 h-4 text-accent" />
              Melody
            </button>

            {/* Tertiary: Save */}
            <button
              onClick={handleSaveProgression}
              disabled={!currentProgression}
              className={`flex items-center justify-center gap-1.5 h-11 rounded-full border transition-all active:scale-95 disabled:opacity-40 shrink-0 ${
                justSaved
                  ? "px-3 lg:px-4 border-accent/40 bg-accent/10 text-accent"
                  : "w-11 lg:w-auto lg:px-4 border-border-subtle bg-surface text-muted hover:text-foreground hover:bg-surface-muted"
              }`}
              title="Save progression"
            >
              {justSaved ? (
                <>
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Saved</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span className="hidden lg:inline text-sm font-medium">Save</span>
                </>
              )}
            </button>

            {/* Tertiary: Audio (mute toggles) */}
            <div className="relative shrink-0">
              <button
                onClick={() => setAudioMenuOpen((v) => !v)}
                className={`flex items-center justify-center w-11 h-11 rounded-full border transition-all active:scale-95 ${
                  chordsEnabled && (!melody || melodyEnabled)
                    ? "border-border-subtle bg-surface text-muted hover:text-foreground hover:bg-surface-muted"
                    : "border-accent/30 bg-accent/10 text-accent"
                }`}
                title="Audio options"
                aria-expanded={audioMenuOpen}
              >
                {chordsEnabled && (!melody || melodyEnabled) ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>
              {audioMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAudioMenuOpen(false)} />
                  <div className="absolute top-full right-0 mt-2 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border-subtle bg-surface shadow-xl p-1.5 flex flex-col gap-0.5">
                    {/* ── Instrument (live sound) ── */}
                    <span className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                      Sound
                    </span>
                    <div className="px-3 pb-1.5 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          Instrument
                          {isSynthLoading ? (
                            <span
                              className="w-3 h-3 border-2 border-muted border-t-transparent rounded-full animate-spin"
                              title="Loading high-quality samples"
                            />
                          ) : activeQuality === "high" ? (
                            <span className="px-1 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-accent/10 text-accent">
                              HQ
                            </span>
                          ) : null}
                        </span>
                        <div className="relative">
                          <select
                            value={soundPreset}
                            onChange={(e) => setSoundPreset(e.target.value as SoundPresetId)}
                            className="appearance-none bg-background/60 border border-border-subtle rounded-lg pl-3 pr-7 py-1.5 text-sm font-medium text-foreground outline-none cursor-pointer hover:border-accent/40 transition-colors"
                            title="Instrument preset"
                          >
                            <optgroup label="Keys">
                              {SOUND_PRESETS.filter((p) => p.category === "keys").map((preset) => (
                                <option key={preset.id} value={preset.id}>{preset.label}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Synths">
                              {SOUND_PRESETS.filter((p) => p.category === "synth").map((preset) => (
                                <option key={preset.id} value={preset.id}>{preset.label}</option>
                              ))}
                            </optgroup>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
                        </div>
                      </div>
                    </div>

                    {/* Audio quality mode */}
                    <div className="px-3 pb-1.5 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">Audio quality</span>
                        <div className="flex items-center rounded-lg bg-background/60 border border-border-subtle p-0.5">
                          {(
                            [
                              { value: "lightweight", label: "Light" },
                              { value: "high", label: "High" },
                            ] as const
                          ).map((q) => (
                            <button
                              key={q.value}
                              onClick={() => setAudioQuality(q.value as AudioQuality)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                audioQuality === q.value
                                  ? "bg-accent text-white shadow-sm"
                                  : "text-muted hover:text-foreground"
                              }`}
                            >
                              {q.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-[10px] leading-snug text-muted">
                        {audioQuality === "high"
                          ? presetHasHighQuality(soundPreset)
                            ? "Real instrument samples (a few MB) download in the background — playback starts right away on the lightweight sound."
                            : "This instrument is synth-based; it sounds the same in both modes."
                          : "Instant synth sound. No downloads — ideal for slow connections."}
                      </p>
                    </div>

                    <div className="my-1 h-px bg-border-subtle" />

                    <button
                      onClick={() => setChordsEnabled(!chordsEnabled)}
                      className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium text-foreground hover:bg-surface-muted transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        {chordsEnabled ? <Volume2 className="w-4 h-4 text-muted" /> : <VolumeX className="w-4 h-4 text-accent" />}
                        Chords
                      </span>
                      <span className={`text-[10px] uppercase tracking-wide ${chordsEnabled ? "text-muted/50" : "text-accent"}`}>
                        {chordsEnabled ? "On" : "Muted"}
                      </span>
                    </button>
                    <button
                      onClick={() => setMelodyEnabled(!melodyEnabled)}
                      disabled={!melody}
                      className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium text-foreground hover:bg-surface-muted transition-colors disabled:opacity-40"
                    >
                      <span className="flex items-center gap-2">
                        {melodyEnabled ? <Volume2 className="w-4 h-4 text-muted" /> : <VolumeX className="w-4 h-4 text-accent" />}
                        Melody
                      </span>
                      <span className={`text-[10px] uppercase tracking-wide ${!melody ? "text-muted/40" : melodyEnabled ? "text-muted/50" : "text-accent"}`}>
                        {!melody ? "None" : melodyEnabled ? "On" : "Muted"}
                      </span>
                    </button>

                    {/* ── Playback settings ── */}
                    <div className="my-1 h-px bg-border-subtle" />
                    <span className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                      Playback
                    </span>

                    {/* Chord Velocity */}
                    <div className="px-3 py-1.5 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs font-medium text-foreground">
                        <span>Velocity</span>
                        <span className="text-muted tabular-nums">{Math.round(chordVelocity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={CHORD_VELOCITY_MIN}
                        max={CHORD_VELOCITY_MAX}
                        step={0.01}
                        value={chordVelocity}
                        onChange={(e) => setChordVelocity(Number(e.target.value))}
                        className="w-full accent-accent cursor-pointer"
                        aria-label="Chord velocity"
                      />
                      <div className="flex justify-between text-[9px] uppercase tracking-wide text-muted/60">
                        <span>Soft</span>
                        <span>Loud</span>
                      </div>
                    </div>

                    {/* Humanization */}
                    <div className="px-3 py-1.5 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs font-medium text-foreground">
                        <span>Humanize</span>
                        <span className="text-muted tabular-nums">{Math.round(humanize * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.25}
                        value={humanize}
                        onChange={(e) => setHumanize(Number(e.target.value))}
                        className="w-full accent-accent cursor-pointer"
                        aria-label="Humanization amount"
                      />
                      <div className="flex justify-between text-[9px] uppercase tracking-wide text-muted/60">
                        <span>Off</span>
                        <span>Natural</span>
                      </div>
                    </div>

                    {/* Sustain */}
                    <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">Sustain</span>
                      <div className="flex items-center rounded-lg bg-background/60 border border-border-subtle p-0.5">
                        {(["off", "natural"] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setSustainMode(m)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors ${
                              sustainMode === m ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Playback Style */}
                    <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">Style</span>
                      <div className="flex items-center rounded-lg bg-background/60 border border-border-subtle p-0.5">
                        {([
                          { value: "block", label: "Block" },
                          { value: "strum", label: "Strum" },
                          { value: "arpeggio", label: "Arpeggio" },
                        ] as const).map((s) => (
                          <button
                            key={s.value}
                            onClick={() => setPlaybackStyle(s.value)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                              playbackStyle === s.value ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

          </div>
        </section>

        {/* ── Chord Cards + Piano Roll + Creative Tools ── */}
        <section>
          <AnimatePresence mode="wait">
            {currentProgression && currentProgression.chords.length > 0 ? (
              <motion.div
                key={generationKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >

                {/* Section header (desktop) — anchors the working area and
                    separates it from the controls above. Hidden on phones to
                    keep the mobile view focused on the progression itself. */}
                <div className="hidden lg:flex items-baseline justify-between border-b border-border-subtle pb-2">
                  <h2 className="text-sm font-semibold tracking-tight">Progression</h2>
                  <span className="text-xs text-muted tabular-nums">
                    {rootKey} {MODES.find((m) => m.value === mode)?.label} · {currentProgression.chords.length} chords · {bpm} BPM
                  </span>
                </div>

                {/* Chord cards — a responsive grid that wraps cleanly (4 per
                    row on phones, a single row on desktop) and keeps every card
                    a uniform, readable size at any chord count. */}
                <div className="chord-card-grid">
                  {currentProgression.chords.map((chord, index) => {
                    const previewNotes =
                      chord.notesWithOctave && chord.notesWithOctave.length > 0
                        ? chord.notesWithOctave
                        : chord.notes.map((n) => `${n}3`);
                    const sourceType: ChordSourceType = chordSourceTypes[index] ?? "generated";

                    return (
                      <ChordCard
                        key={`${chord.romanNumeral}-${index}`}
                        chord={chord}
                        index={index}
                        isActive={playbackIndex === index}
                        isSelected={selectedChordIndex === index}
                        sourceType={sourceType}
                        canRevert={sourceType !== "generated" && originalChords.has(index)}
                        onSelect={() => handleChordClick(previewNotes, index)}
                        onSubstitute={() => {
                          openSubstitution(index);
                          setSelectedChordIndex(index);
                        }}
                        onToggleLock={() => toggleLock(index)}
                        onRevert={() => revertChord(index)}
                      />
                    );
                  })}
                </div>

                {/* Voicing feedback removed and added to controls bar */}

                {/* Contextual chord actions — lock / substitute / revert for the
                    selected chord. The canonical surface on mobile (the per-card
                    icons are hidden < sm) and a handy shortcut on desktop. */}
                {selectedChordIndex !== null && currentProgression.chords[selectedChordIndex] && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface-muted/50 px-3 py-2">
                    <span className="text-xs text-muted">
                      Chord{" "}
                      <span className="font-semibold text-foreground">
                        {currentProgression.chords[selectedChordIndex].symbol}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        onClick={() => openSubstitution(selectedChordIndex)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface hover:border-accent/50 hover:text-accent text-xs font-medium text-muted transition-colors"
                        title="Change this chord"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        Substitute
                      </button>
                      <button
                        onClick={() => toggleLock(selectedChordIndex)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          currentProgression.chords[selectedChordIndex].isLocked
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-border-subtle bg-surface text-muted hover:border-accent/50 hover:text-accent"
                        }`}
                        title={currentProgression.chords[selectedChordIndex].isLocked ? "Unlock chord" : "Lock chord"}
                      >
                        {currentProgression.chords[selectedChordIndex].isLocked ? (
                          <Lock className="w-3.5 h-3.5" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                        {currentProgression.chords[selectedChordIndex].isLocked ? "Locked" : "Lock"}
                      </button>
                      {originalChords.has(selectedChordIndex) && (
                        <button
                          onClick={() => revertChord(selectedChordIndex)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-subtle bg-surface hover:border-accent/50 hover:text-accent text-xs font-medium text-muted transition-colors"
                          title="Revert to original"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Revert
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Interactive Piano Roll */}
                <p className="lg:hidden flex items-center gap-1.5 px-1 mb-1.5 text-[11px] text-muted/70">
                  <Music className="w-3 h-3 shrink-0 text-accent/60" />
                  Piano roll — tap a note to hear it, then use the up/down arrows to move it
                </p>
                <div className="relative">
                <InteractivePianoRoll
                  chords={currentProgression.chords}
                  playingIndex={playbackIndex}
                  selectedIndex={selectedChordIndex}
                  onPlayNote={handlePlayNote}
                  onDeleteChord={deleteChord}
                  onShiftNote={shiftNote}
                  onSelectChord={setSelectedChordIndex}
                  onExportMidi={exportMidi}
                  onAddNote={addNote}
                  onRemoveNote={removeNote}
                  onMoveNote={moveNote}
                  onResetChord={resetChord}
                  scalePitchClasses={getScalePitchClasses(rootKey, mode)}
                  useFlats={keyPrefersFlats((normalizeToPitchClass(rootKey) || "C") as PitchClass, mode)}
                  chordSourceTypes={chordSourceTypes}
                  playheadRef={playheadRef}
                  melodyNotes={melodyEnabled && melody ? melody.notes : undefined}
                  showMelody={melodyEnabled && showMelodyOnRoll}
                  onMoveMelodyNote={melodyEnabled && melody ? (noteId, toMidi) => {
                    const note = melody.notes.find(n => n.id === noteId);
                    if (note) useProgressionStore.getState().moveMelodyNote(noteId, toMidi, note.startBeat);
                  } : undefined}
                />
                <div className="lg:hidden pointer-events-none absolute right-0 top-0 bottom-0 w-5 bg-gradient-to-l from-black/10 to-transparent" />
                </div>

                {/* Substitution Panel */}
                {substitutionTarget !== null && currentProgression.chords[substitutionTarget] && (
                  <>
                    <div
                      className="lg:hidden fixed inset-0 z-50 bg-black/40"
                      onClick={closeSubstitution}
                    />
                    <div className="fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:mt-4 lg:max-w-md">
                    <SubstitutionPanel
                      chord={currentProgression.chords[substitutionTarget]}
                      chordIndex={substitutionTarget}
                      progressionChords={currentProgression.chords}
                      substitutions={substitutionOptions}
                      onPreview={handleSubstitutionPreview}
                      onApply={handleSubstitutionApply}
                      onRevert={handleSubstitutionRevert}
                      onClose={closeSubstitution}
                      canRevert={originalChords.has(substitutionTarget)}
                    />
                    </div>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-20 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-surface-muted border border-border-subtle flex items-center justify-center mb-4">
                  <Music className="w-7 h-7 text-muted" />
                </div>
                <p className="text-muted text-sm max-w-xs">
                  Choose a key and mode, then click{" "}
                  <span className="font-medium text-foreground">Generate</span> to
                  create your first progression.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ── Voicing Rating ── */}
        <section className="space-y-3">
          {/* Low-emphasis voicing rating */}
          {currentProgression && (
            <VoicingFeedback
              variant="card"
              progression={currentProgression}
              rootKey={rootKey}
              mode={mode}
              complexity={complexity}
              numChords={numChords}
              bpm={bpm}
              voicingStyle={voicingStyle}
              voiceCount={voiceCount}
            />
          )}
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-8 text-xs text-muted">
        Built with harmonic intention
      </footer>
    </div>
  );
}
