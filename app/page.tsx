"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Download, Sparkles, Music, Lock, Unlock, LayoutDashboard, Shuffle, RotateCcw, ChevronDown, Heart, Trash2, Upload, VolumeX, Volume2, Settings2, Layers, Activity, Save } from "lucide-react";
import Link from "next/link";
import { useProgressionStore, COMPLEXITY_LABELS, type ComplexityLevel } from "@/lib/state/progressionStore";
import { InteractivePianoRoll } from "@/components/creative/InteractivePianoRoll";
import { SubstitutionPanel } from "@/components/creative/SubstitutionPanel";
import { VoicingFeedback } from "@/components/feedback/VoicingFeedback";
import { FeedbackChart } from "@/components/feedback/FeedbackChart";
import { getInversionLabel } from "@/lib/theory/inversionLabel";
import { useFavoritesStore } from "@/lib/favorites/favoritesStore";
import {
  SOUND_PRESETS,
  createSynthForPreset,
  createMelodySynthForPreset,
  presetNeedsLoading,
  type SoundPresetId,
  type Synth,
  type MelodySynth,
} from "@/lib/audio/synthPresets";
import type { Mode } from "@/lib/theory/harmonyEngine";
import type { SubstitutionOption, ChordSourceType } from "@/lib/creative/types";
import type { VoicingStyle, VoiceCount } from "@/lib/music/generators/advanced/types";
import type { MelodyStyle } from "@/lib/music/generators/melody/types";

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

/** Map durationClass to a flex multiplier for column width alignment. */
function durationToFlex(dc?: string): number {
  switch (dc) {
    case "full": return 4;
    case "half": return 2;
    case "quarter": return 1;
    case "eighth": return 0.5;
    default: return 4;
  }
}

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
    setMelodyEnabled,
    setMelodyStyle,
    generateMelodyForProgression,
  } = useProgressionStore();

  const { favorites, addFavorite, removeFavorite } = useFavoritesStore();

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [soundPreset, setSoundPreset] = useState<SoundPresetId>("piano");
  const [generationKey, setGenerationKey] = useState(0);
  const [isSynthLoading, setIsSynthLoading] = useState(false);
  const [selectedChordIndex, setSelectedChordIndex] = useState<number | null>(null);
  const [showVoicingControls, setShowVoicingControls] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showMelodyOnRoll, setShowMelodyOnRoll] = useState(true);

  const synthRef = useRef<Synth | null>(null);
  const melodySynthRef = useRef<MelodySynth | null>(null);
  const playbackIndexRef = useRef(0);
  const playheadRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);

  /* ─── Synth lifecycle ─── */

  useEffect(() => {
    setIsSynthLoading(presetNeedsLoading(soundPreset));
    const synth = createSynthForPreset(soundPreset, () => {
      setIsSynthLoading(false);
    });
    synthRef.current = synth;

    return () => {
      synth.releaseAll();
      synth.dispose();
      synthRef.current = null;
    };
  }, [soundPreset]);

  /* ─── Melody synth lifecycle ─── */

  useEffect(() => {
    if (!melodyEnabled) {
      if (melodySynthRef.current) {
        melodySynthRef.current.dispose();
        melodySynthRef.current = null;
      }
      return;
    }
    const synth = createMelodySynthForPreset(soundPreset);
    melodySynthRef.current = synth;
    return () => {
      synth.dispose();
      melodySynthRef.current = null;
    };
  }, [melodyEnabled, soundPreset]);

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

        if (useProgressionStore.getState().chordsEnabled) {
          const notes =
            chord.notesWithOctave && chord.notesWithOctave.length > 0
              ? chord.notesWithOctave
              : chord.notes.map((n) => `${n}3`);
          synthRef.current.triggerAttackRelease(notes, duration, time);
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
            melodySynthRef.current?.triggerAttackRelease(mn.noteWithOctave, mDuration, time);
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
    if (Tone.getContext().state !== "running") {
      await Tone.start();
    }
    if (isPlaying) {
      setIsPlaying(false);
    }
    generateNew();
    setGenerationKey((k) => k + 1);
  }, [generateNew, isPlaying, setIsPlaying]);

  const handleTogglePlayback = useCallback(async () => {
    if (Tone.getContext().state !== "running") {
      await Tone.start();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  const handlePlayNote = useCallback(
    (noteWithOctave: string) => {
      if (synthRef.current) {
        synthRef.current.triggerAttackRelease(noteWithOctave, "4n");
      }
    },
    []
  );

  const handleChordClick = useCallback(
    (notesWithOctave: string[], chordIndex: number) => {
      // Stop current playback to prevent overlapping sounds
      if (isPlaying) {
        setIsPlaying(false);
      }
      if (synthRef.current) {
        synthRef.current.releaseAll();
        // Small delay to let releaseAll take effect before new attack
        setTimeout(() => {
          synthRef.current?.triggerAttackRelease(notesWithOctave, "2n");
        }, 10);
      }
      // Set this chord as the new loop start position and select it
      playbackIndexRef.current = chordIndex;
      setPlaybackIndex(chordIndex);
      setSelectedChordIndex(chordIndex);
    },
    [isPlaying, setIsPlaying]
  );

  // ─── Substitution handlers ───
  const handleSubstitutionPreview = useCallback(
    (option: SubstitutionOption) => {
      if (synthRef.current) {
        synthRef.current.releaseAll();
        setTimeout(() => {
          synthRef.current?.triggerAttackRelease(option.candidateNotesWithOctave, "2n");
        }, 10);
      }
    },
    []
  );

  const handleSubstitutionApply = useCallback(
    (option: SubstitutionOption) => {
      if (substitutionTarget === null) return;
      applySubstitution(option, substitutionTarget);
      // Preview the applied chord
      if (synthRef.current) {
        synthRef.current.releaseAll();
        setTimeout(() => {
          synthRef.current?.triggerAttackRelease(option.candidateNotesWithOctave, "2n");
        }, 10);
      }
    },
    [substitutionTarget, applySubstitution]
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
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Music className="w-5 h-5 text-accent" />
            <h1 className="text-lg font-semibold tracking-tight">Harmonia</h1>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted hidden sm:block">
              Chord Progression Generator
            </p>
            <FeedbackChart />
            
            <div className="flex items-center gap-2 border-r border-border-subtle pr-4 mr-1">
              {currentProgression && (
                <button
                  onClick={() => {
                    const name = `${rootKey} ${mode} — ${currentProgression.chords.map((c) => c.symbol).join(" · ")}`;
                    addFavorite({ name, progression: currentProgression, rootKey, mode, complexity, bpm });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-subtle bg-surface hover:bg-surface-muted text-xs font-medium transition-colors text-muted hover:text-foreground"
                  title="Save to favorites"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
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
                  Export MIDI
                </button>
              )}
              {melodyEnabled && melody && (
                <button
                  onClick={exportMelodyMidi}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/30 bg-surface hover:bg-amber-500/10 text-xs font-medium transition-colors text-amber-500 hover:text-amber-400"
                  title="Export Melody MIDI"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Melody
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
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        {/* ── Controls Bar ── */}
        <section className="bg-surface/40 backdrop-blur-xl border border-white/10 dark:border-white/5 rounded-3xl p-5 shadow-xl relative overflow-visible z-20">
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
          
          <div className="relative z-10 flex flex-wrap lg:flex-nowrap items-start justify-between gap-6">
            
            {/* Foundation Group */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-[240px]">
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted uppercase tracking-widest pl-1">
                <Music className="w-3 h-3 text-accent/70" />
                Foundation
              </label>
              <div className="flex items-center bg-background/50 border border-border-subtle rounded-xl shadow-inner p-1">
                <select
                  value={rootKey}
                  onChange={(e) => setSettings({ rootKey: e.target.value })}
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
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
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Scale Mode"
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <div className="relative flex-1 group" title="BPM (Tempo)">
                  <input
                    type="number"
                    min={60}
                    max={180}
                    value={bpm}
                    onChange={(e) => setSettings({ bpm: Number(e.target.value) })}
                    className="w-full bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none text-center rounded-lg transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted opacity-50 pointer-events-none group-hover:opacity-100 transition-opacity">BPM</span>
                </div>
              </div>
            </div>

            {/* Generation Group */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-[260px]">
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted uppercase tracking-widest pl-1">
                <Settings2 className="w-3 h-3 text-purple-500/70" />
                Generation
              </label>
              <div className="flex items-center bg-background/50 border border-border-subtle rounded-xl shadow-inner p-1">
                <select
                  value={numChords}
                  onChange={(e) => setSettings({ numChords: Number(e.target.value) as 3 | 4 | 5 | 6 | 7 | 8 })}
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
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
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
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
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Voicing Style"
                >
                  {VOICING_STYLES.map((vs) => (
                    <option key={vs.value} value={vs.value}>{vs.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Textures Group */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-[280px]">
              <label className="flex items-center justify-between w-full pl-1">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted uppercase tracking-widest">
                  <Layers className="w-3 h-3 text-emerald-500/70" />
                  Textures
                </div>
                <span className="text-[9px] text-muted/40 uppercase tracking-widest font-medium">Changes apply on Gen</span>
              </label>
              <div className="flex items-center bg-background/50 border border-border-subtle rounded-xl shadow-inner p-1">
                <select
                  value={voiceCount}
                  onChange={(e) => setSettings({ voiceCount: Number(e.target.value) as 3 | 4 | 5 })}
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
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
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Melodic Rhythm Style"
                >
                  {MELODY_STYLES.map((ms) => (
                    <option key={ms.value} value={ms.value}>{ms.label}</option>
                  ))}
                </select>
                <div className="w-px h-4 bg-border-subtle mx-1" />
                <select
                  value={soundPreset}
                  onChange={(e) => setSoundPreset(e.target.value as SoundPresetId)}
                  className="flex-1 bg-transparent hover:bg-surface px-2 py-1.5 text-sm font-medium outline-none appearance-none rounded-lg cursor-pointer transition-colors text-center"
                  title="Synth Preset"
                >
                  {SOUND_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
              </div>
            </div>

          </div>
        </section>

        {/* ── Favorites Panel ── */}
        {showFavorites && (
          <section className="surface-section rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Heart className="w-4 h-4 text-accent" />
              Saved Progressions
            </h3>
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

        {/* ── Action Controls Bar ── */}
        <section className="flex justify-center mb-6">
          <div className="flex flex-wrap items-center gap-3 bg-surface/50 backdrop-blur-xl border border-white/10 dark:border-white/5 rounded-full p-2 shadow-xl relative z-10 before:absolute before:inset-0 before:rounded-full before:bg-gradient-to-b before:from-white/5 before:to-transparent before:pointer-events-none">
            
            {/* Play / Stop */}
            <button
              onClick={handleTogglePlayback}
              disabled={!currentProgression || isSynthLoading}
              className={`relative flex items-center justify-center gap-2 w-28 py-2.5 rounded-full font-semibold text-sm transition-all duration-300 disabled:opacity-40 overflow-hidden group ${
                isPlaying
                  ? "bg-surface text-foreground shadow-inner border border-border-subtle"
                  : "bg-accent text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
              }`}
            >
              {!isPlaying && (
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              )}
              <div className="relative flex items-center gap-2">
                {isSynthLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Loading
                  </>
                ) : isPlaying ? (
                  <>
                    <Square className="w-4 h-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 ml-0.5 fill-current" />
                    Play
                  </>
                )}
              </div>
            </button>

            <div className="w-px h-8 bg-border-subtle/50 mx-1" />

            {/* Chords Group */}
            <div className="flex items-center bg-surface-muted/50 rounded-full border border-border-subtle p-0.5">
              <button
                onClick={handleGenerate}
                className="flex items-center gap-2 px-5 py-2 rounded-full hover:bg-surface text-foreground font-medium transition-all active:scale-95 text-sm"
              >
                <Sparkles className="w-4 h-4 text-accent" />
                Gen Chords
              </button>
              <div className="w-px h-5 bg-border-subtle mx-0.5" />
              <button
                onClick={() => setChordsEnabled(!chordsEnabled)}
                className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
                  chordsEnabled
                    ? "bg-transparent text-muted hover:bg-surface hover:text-foreground"
                    : "bg-accent/10 text-accent/50 hover:bg-accent/20 hover:text-accent"
                }`}
                title={chordsEnabled ? "Mute chords" : "Unmute chords"}
              >
                {chordsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>

            {/* Melody Group */}
            <div className="flex items-center bg-surface-muted/50 rounded-full border border-border-subtle p-0.5">
              <button
                onClick={generateMelodyForProgression}
                disabled={!currentProgression}
                className="flex items-center gap-2 px-5 py-2 rounded-full hover:bg-surface text-foreground font-medium transition-all active:scale-95 text-sm disabled:opacity-40"
              >
                <Sparkles className="w-4 h-4 text-accent" />
                Gen Melody
              </button>
              <div className="w-px h-5 bg-border-subtle mx-0.5" />
              <button
                onClick={() => setMelodyEnabled(!melodyEnabled)}
                disabled={!melody}
                className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors disabled:opacity-40 ${
                  melodyEnabled
                    ? "bg-transparent text-muted hover:bg-surface hover:text-foreground"
                    : "bg-accent/10 text-accent/50 hover:bg-accent/20 hover:text-accent"
                }`}
                title={melodyEnabled ? "Mute melody" : "Unmute melody"}
              >
                {melodyEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>

            <div className="w-px h-8 bg-border-subtle/50 mx-1" />

            {/* Rate Voicing Inline */}
            {currentProgression && (
              <VoicingFeedback
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

                {/* Chord cards row — offset by piano key width, flex-matched to roll columns */}
                <div className="flex" style={{ paddingLeft: 53 }}>
                  <div className="flex flex-1 gap-1.5">
                    {currentProgression.chords.map((chord, index) => {
                      const isActive = playbackIndex === index;
                      const previewNotes =
                        chord.notesWithOctave && chord.notesWithOctave.length > 0
                          ? chord.notesWithOctave
                          : chord.notes.map((n) => `${n}3`);
                      const colFlex = durationToFlex(chord.durationClass);
                      const sourceType: ChordSourceType = chordSourceTypes[index] ?? "generated";

                      const SOURCE_BADGE: Record<ChordSourceType, { color: string; label: string }> = {
                        generated: { color: "", label: "" },
                        substituted: { color: "bg-purple-500/20 text-purple-300", label: "Substituted" },
                        manual: { color: "bg-emerald-500/20 text-emerald-300", label: "Edited" },
                      };

                      return (
                        <motion.div
                          key={`${chord.romanNumeral}-${index}`}
                          initial={{ opacity: 0, y: 16, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{
                            delay: index * 0.06,
                            duration: 0.35,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          style={{ flex: colFlex, minWidth: 0 }}
                          onClick={() => handleChordClick(previewNotes, index)}
                          className={`relative flex flex-col items-center justify-center rounded-xl px-3 py-5 border transition-all duration-200 cursor-pointer select-none ${
                            isActive
                              ? "bg-accent/10 border-accent shadow-md ring-2 ring-accent/20"
                              : selectedChordIndex === index
                                ? "bg-surface border-accent/50 ring-2 ring-accent/15 shadow-sm"
                                : chord.isLocked
                                  ? "bg-surface border-accent/30 ring-1 ring-accent/10"
                                  : "bg-surface border-border-subtle shadow-sm hover:border-accent/60 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm"
                          }`}
                        >
                          {/* Playback glow pulse */}
                          {isActive && (
                            <motion.div
                              className="absolute inset-0 rounded-xl bg-accent/5"
                              animate={{ opacity: [0.3, 0.08, 0.3] }}
                              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                            />
                          )}

                          {/* Top-left: source badge */}
                          {sourceType !== "generated" && (
                            <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[8px] font-semibold ${SOURCE_BADGE[sourceType].color}`}>
                              {SOURCE_BADGE[sourceType].label}
                            </div>
                          )}

                          {/* Top-right: Lock toggle + Substitute button */}
                          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openSubstitution(index);
                                setSelectedChordIndex(index);
                              }}
                              className="p-1 rounded-md text-muted/30 hover:text-accent/70 transition-colors"
                              title="Substitute chord"
                            >
                              <Shuffle className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLock(index);
                              }}
                              className={`p-1 rounded-md transition-colors ${
                                chord.isLocked
                                  ? "text-accent hover:text-accent/80"
                                  : "text-muted/30 hover:text-muted/60"
                              }`}
                              title={chord.isLocked ? "Unlock chord" : "Lock chord"}
                            >
                              {chord.isLocked ? (
                                <Lock className="w-3 h-3" />
                              ) : (
                                <Unlock className="w-3 h-3" />
                              )}
                            </button>
                          </div>

                          <div className="text-xs font-mono text-muted mb-1 tracking-wider">
                            {chord.romanNumeral}
                          </div>
                          <div className="text-xl font-semibold mb-1.5">{chord.symbol}</div>
                          <div className="text-[10px] text-muted opacity-70">
                            {chord.notes.join(" · ")}
                          </div>
                          {chord.midiNotes && chord.root && (
                            <div className="mt-1 text-[9px] font-mono text-accent/60">
                              {getInversionLabel(chord.midiNotes, chord.root)}
                            </div>
                          )}
                          {chord.durationClass && chord.durationClass !== "full" && (
                            <div className="mt-1 text-[9px] font-mono text-muted/50 uppercase tracking-widest">
                              {chord.durationClass === "half" ? "2 beats" : chord.durationClass === "quarter" ? "1 beat" : "\u00BD beat"}
                            </div>
                          )}

                          {/* Revert indicator for modified chords */}
                          {sourceType !== "generated" && originalChords.has(index) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                revertChord(index);
                              }}
                              className="mt-1.5 flex items-center gap-1 text-[9px] text-muted/50 hover:text-accent transition-colors"
                              title="Revert to original"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              revert
                            </button>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>

                {/* Voicing feedback removed and added to controls bar */}

                {/* Interactive Piano Roll */}
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
                  chordSourceTypes={chordSourceTypes}
                  playheadRef={playheadRef}
                  melodyNotes={melodyEnabled && melody ? melody.notes : undefined}
                  showMelody={melodyEnabled && showMelodyOnRoll}
                  onMoveMelodyNote={melodyEnabled && melody ? (noteId, toMidi) => {
                    const note = melody.notes.find(n => n.id === noteId);
                    if (note) useProgressionStore.getState().moveMelodyNote(noteId, toMidi, note.startBeat);
                  } : undefined}
                />

                {/* Substitution Panel */}
                {substitutionTarget !== null && currentProgression.chords[substitutionTarget] && (
                  <div className="mt-4 max-w-md">
                    <SubstitutionPanel
                      chord={currentProgression.chords[substitutionTarget]}
                      chordIndex={substitutionTarget}
                      substitutions={substitutionOptions}
                      onPreview={handleSubstitutionPreview}
                      onApply={handleSubstitutionApply}
                      onRevert={handleSubstitutionRevert}
                      onClose={closeSubstitution}
                      canRevert={originalChords.has(substitutionTarget)}
                    />
                  </div>
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

      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-8 text-xs text-muted">
        Built with harmonic intention
      </footer>
    </div>
  );
}
