"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Play, Square, Download, Sparkles, Music, Lock, Unlock, LayoutDashboard, Replace, Undo2, RotateCcw, ChevronDown } from "lucide-react";
import { useProgressionStore, COMPLEXITY_LABELS, type ComplexityLevel } from "@/lib/state/progressionStore";
import { InteractivePianoRoll } from "@/components/creative/InteractivePianoRoll";
import { SubstitutionPanel } from "@/components/creative/SubstitutionPanel";
import { MutationControls } from "@/components/creative/MutationControls";
import { VoicingFeedback } from "@/components/feedback/VoicingFeedback";
import { FeedbackChart } from "@/components/feedback/FeedbackChart";
import { getInversionLabel } from "@/lib/theory/inversionLabel";
import {
  SOUND_PRESETS,
  createSynthForPreset,
  presetNeedsLoading,
  type SoundPresetId,
  type Synth,
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
    // Creative iteration
    chordSourceTypes,
    originalChords,
    substitutionTarget,
    substitutionOptions,
    lastMutationChanges,
    undoStack,
    openSubstitution,
    closeSubstitution,
    applySubstitution,
    revertChord,
    mutate,
    undoMutation,
    addNote,
    removeNote,
    moveNote,
    resetChord,
    // Melody
    melody,
    melodyEnabled,
    melodyStyle,
    setMelodyEnabled,
    setMelodyStyle,
    generateMelodyForProgression,
  } = useProgressionStore();

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [soundPreset, setSoundPreset] = useState<SoundPresetId>("piano");
  const [generationKey, setGenerationKey] = useState(0);
  const [isSynthLoading, setIsSynthLoading] = useState(false);
  const [selectedChordIndex, setSelectedChordIndex] = useState<number | null>(null);
  const [showVoicingControls, setShowVoicingControls] = useState(false);

  const synthRef = useRef<Synth | null>(null);
  const melodySynthRef = useRef<Tone.Synth | null>(null);
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
    const synth = new Tone.Synth({
      volume: -8,
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.15, sustain: 0.3, release: 0.4 },
    }).toDestination();
    melodySynthRef.current = synth;
    return () => {
      synth.dispose();
      melodySynthRef.current = null;
    };
  }, [melodyEnabled]);

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
    const totalMeasures = totalBeats / 4; // in Tone.js "measures" at 4/4

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

        const notes =
          chord.notesWithOctave && chord.notesWithOctave.length > 0
            ? chord.notesWithOctave
            : chord.notes.map((n) => `${n}3`);
        synthRef.current.triggerAttackRelease(notes, duration, time);

        Tone.getDraw().schedule(() => {
          setPlaybackIndex(chordIdx);
          playbackIndexRef.current = chordIdx;
        }, time);
      }, timeStr);

      ids.push(id);
      beatOffset += beats;
    }

    // Schedule melody notes
    if (melody && melodyEnabled && melodySynthRef.current) {
      for (const mn of melody.notes) {
        const mBars = Math.floor(mn.startBeat / 4);
        const mQuarters = Math.floor(mn.startBeat % 4);
        const mSixteenths = (mn.startBeat % 1) * 4;
        const mTimeStr = `${mBars}:${mQuarters}:${mSixteenths}`;
        const mDuration = beatsToDuration(mn.durationBeats);

        const mid = Tone.getTransport().schedule((time) => {
          melodySynthRef.current?.triggerAttackRelease(mn.noteWithOctave, mDuration, time);
        }, mTimeStr);
        ids.push(mid);
      }
    }

    scheduleIdsRef.current = ids;

    // Set loop points so the progression repeats
    Tone.getTransport().loop = true;
    Tone.getTransport().loopStart = 0;
    Tone.getTransport().loopEnd = `${totalMeasures}m`;
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
  }, [isPlaying, currentProgression, durationToBeats, beatsToDuration, melody, melodyEnabled]);

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

  // ─── Mutation handler ───
  const handleMutate = useCallback(
    (intensity: number) => {
      if (isPlaying) setIsPlaying(false);
      mutate(intensity);
    },
    [isPlaying, setIsPlaying, mutate]
  );

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
        <section className="bg-surface rounded-2xl border border-border-subtle p-6 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            {/* Key */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Key
              </label>
              <select
                value={rootKey}
                onChange={(e) => setSettings({ rootKey: e.target.value })}
                className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 w-20 appearance-none cursor-pointer"
              >
                {NOTES.map((note) => (
                  <option key={note} value={note}>
                    {note}
                  </option>
                ))}
              </select>
            </div>

            {/* Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setSettings({ mode: e.target.value as Mode })}
                className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 w-32 appearance-none cursor-pointer"
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Chord Count */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Chords
              </label>
              <select
                value={numChords}
                onChange={(e) => setSettings({ numChords: Number(e.target.value) as 3 | 4 | 5 | 6 | 7 | 8 })}
                className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 w-20 appearance-none cursor-pointer"
              >
                {CHORD_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            {/* Complexity */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Complexity
              </label>
              <div className="flex rounded-lg border border-border-subtle overflow-hidden">
                {([1, 2, 3, 4] as ComplexityLevel[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => setSettings({ complexity: level })}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      complexity === level
                        ? "bg-accent text-white"
                        : "bg-surface-muted hover:bg-surface text-muted"
                    }`}
                  >
                    {COMPLEXITY_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>

            {/* BPM */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                BPM
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={60}
                  max={180}
                  value={bpm}
                  onChange={(e) => setSettings({ bpm: Number(e.target.value) })}
                  className="w-24 accent-accent"
                />
                <span className="text-sm font-mono font-medium w-8 text-center">
                  {bpm}
                </span>
              </div>
            </div>

            {/* Sound Preset */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Sound
              </label>
              <select
                value={soundPreset}
                onChange={(e) => setSoundPreset(e.target.value as SoundPresetId)}
                className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 appearance-none cursor-pointer"
              >
                {SOUND_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Voicing toggle */}
            <button
              onClick={() => setShowVoicingControls(!showVoicingControls)}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                showVoicingControls
                  ? "border-accent/30 bg-accent/5 text-foreground"
                  : "border-border-subtle bg-surface-muted text-muted hover:text-foreground"
              }`}
            >
              Voicing
              <ChevronDown className={`w-3 h-3 transition-transform ${showVoicingControls ? "rotate-180" : ""}`} />
            </button>

            {/* Melody toggle */}
            <button
              onClick={() => setMelodyEnabled(!melodyEnabled)}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                melodyEnabled
                  ? "border-accent/30 bg-accent/5 text-foreground"
                  : "border-border-subtle bg-surface-muted text-muted hover:text-foreground"
              }`}
            >
              Melody
              {melodyEnabled && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Play / Stop */}
            <button
              onClick={handleTogglePlayback}
              disabled={!currentProgression || isSynthLoading}
              className={`flex items-center gap-2 px-5 py-2 rounded-full font-medium text-sm transition-all disabled:opacity-40 ${
                isPlaying
                  ? "bg-surface-muted border border-border-subtle text-foreground"
                  : "bg-accent text-white shadow-sm"
              }`}
            >
              {isSynthLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Loading
                </>
              ) : isPlaying ? (
                <>
                  <Square className="w-3.5 h-3.5" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Play
                </>
              )}
            </button>

            {/* Generate */}
            <button
              onClick={handleGenerate}
              className="flex items-center gap-2 px-6 py-2 rounded-full bg-accent text-white font-medium transition-all hover:opacity-90 active:scale-[0.97] shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              Generate
            </button>
          </div>

          {/* Voicing controls (collapsible) */}
          {showVoicingControls && (
            <div className="mt-4 pt-4 border-t border-border-subtle flex flex-wrap items-end gap-4">
              {/* Voicing Style */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  Style
                </label>
                <div className="flex rounded-lg border border-border-subtle overflow-hidden">
                  {VOICING_STYLES.map((vs) => (
                    <button
                      key={vs.value}
                      onClick={() => setSettings({ voicingStyle: vs.value })}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        voicingStyle === vs.value
                          ? "bg-accent text-white"
                          : "bg-surface-muted hover:bg-surface text-muted"
                      }`}
                    >
                      {vs.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice Count / Density */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  Density
                </label>
                <div className="flex rounded-lg border border-border-subtle overflow-hidden">
                  {VOICE_COUNTS.map((vc) => (
                    <button
                      key={vc.value}
                      onClick={() => setSettings({ voiceCount: vc.value })}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        voiceCount === vc.value
                          ? "bg-accent text-white"
                          : "bg-surface-muted hover:bg-surface text-muted"
                      }`}
                    >
                      {vc.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-muted/50 self-end pb-1">
                Changes apply on next Generate
              </p>
            </div>
          )}

          {/* Melody controls (collapsible) */}
          {melodyEnabled && (
            <div className="mt-4 pt-4 border-t border-border-subtle flex flex-wrap items-end gap-4">
              {/* Melody Style */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  Melody Style
                </label>
                <div className="flex rounded-lg border border-border-subtle overflow-hidden">
                  {MELODY_STYLES.map((ms) => (
                    <button
                      key={ms.value}
                      onClick={() => setMelodyStyle(ms.value)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        melodyStyle === ms.value
                          ? "bg-accent text-white"
                          : "bg-surface-muted hover:bg-surface text-muted"
                      }`}
                    >
                      {ms.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Regenerate melody */}
              <button
                onClick={generateMelodyForProgression}
                disabled={!currentProgression}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-muted hover:bg-accent/10 hover:border-accent/30 text-xs font-medium text-muted hover:text-foreground transition-all disabled:opacity-40"
              >
                <Sparkles className="w-3 h-3" />
                Regenerate Melody
              </button>
            </div>
          )}
        </section>

        {/* ── Chord Cards + Piano Roll + Creative Tools ── */}
        <section>
          <AnimatePresence mode="wait">
            {currentProgression && currentProgression.chords.length > 0 ? (
              <motion.div
                key={generationKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
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
                        mutated: { color: "bg-amber-500/20 text-amber-300", label: "Mutated" },
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
                              <Replace className="w-3 h-3" />
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

                {/* Voicing feedback */}
                <div className="flex justify-end px-1">
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
                </div>

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
                  melodyNotes={melodyEnabled ? melody?.notes : undefined}
                />

                {/* Creative Iteration Tools */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  {/* Substitution Panel */}
                  {substitutionTarget !== null && currentProgression.chords[substitutionTarget] && (
                    <div className="lg:col-span-1">
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

                  {/* Mutation Controls */}
                  <div className={substitutionTarget !== null ? "lg:col-span-1" : "lg:col-span-2 max-w-md"}>
                    <MutationControls
                      onMutate={handleMutate}
                      onUndo={undoMutation}
                      canUndo={undoStack.length > 0}
                      lastChanges={lastMutationChanges}
                      disabled={!currentProgression}
                    />
                  </div>
                </div>
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
