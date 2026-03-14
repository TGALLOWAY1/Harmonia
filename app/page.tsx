"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Download, Sparkles, Music, Lock, Unlock } from "lucide-react";
import { useProgressionStore, COMPLEXITY_LABELS, type ComplexityLevel } from "@/lib/state/progressionStore";
import { VerticalPianoRoll } from "@/components/progression/VerticalPianoRoll";
import type { Mode } from "@/lib/theory/harmonyEngine";

/* ─── Sound Presets ─── */

type SoundPresetId = "piano" | "mellow" | "bell" | "bright";
type Synth = Tone.PolySynth | Tone.Sampler;

const SOUND_PRESETS: Array<{ id: SoundPresetId; label: string }> = [
  { id: "piano", label: "Piano" },
  { id: "mellow", label: "Mellow" },
  { id: "bell", label: "Bell" },
  { id: "bright", label: "Bright" },
];

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES: { value: Mode; label: string }[] = [
  { value: "ionian", label: "Major" },
  { value: "aeolian", label: "Minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
];
const CHORD_COUNTS = [3, 4, 5, 6, 7, 8];

/* ─── Effects Chain (shared) ─── */

let masterReverb: Tone.Reverb | null = null;
let masterCompressor: Tone.Compressor | null = null;
let masterLimiter: Tone.Limiter | null = null;
let pianoReverbNode: Tone.Reverb | null = null;

function getEffectsChain(): { reverb: Tone.Reverb; compressor: Tone.Compressor; limiter: Tone.Limiter } {
  if (!masterLimiter) {
    masterLimiter = new Tone.Limiter(-3).toDestination();
  }
  if (!masterReverb) {
    masterReverb = new Tone.Reverb({ decay: 1.8, wet: 0.2 }).connect(masterLimiter);
  }
  if (!masterCompressor) {
    masterCompressor = new Tone.Compressor({
      threshold: -18,
      ratio: 4,
      attack: 0.003,
      release: 0.15,
    }).connect(masterReverb);
  }
  return { reverb: masterReverb, compressor: masterCompressor, limiter: masterLimiter };
}

function getPianoReverb(): Tone.Reverb {
  if (!pianoReverbNode) {
    const { limiter } = getEffectsChain();
    pianoReverbNode = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(limiter);
  }
  return pianoReverbNode;
}

function createSynthForPreset(
  preset: SoundPresetId,
  onLoaded?: () => void,
): Synth {
  const { compressor } = getEffectsChain();

  switch (preset) {
    case "piano": {
      // Real piano samples (Salamander Grand Piano) via Tone.Sampler
      const sampler = new Tone.Sampler({
        urls: {
          A1: "A1.mp3",
          A2: "A2.mp3",
          A3: "A3.mp3",
          A4: "A4.mp3",
          A5: "A5.mp3",
          C2: "C2.mp3",
          C3: "C3.mp3",
          C4: "C4.mp3",
          C5: "C5.mp3",
          C6: "C6.mp3",
          "D#2": "Ds2.mp3",
          "D#3": "Ds3.mp3",
          "D#4": "Ds4.mp3",
          "D#5": "Ds5.mp3",
          "F#2": "Fs2.mp3",
          "F#3": "Fs3.mp3",
          "F#4": "Fs4.mp3",
          "F#5": "Fs5.mp3",
        },
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        release: 1,
        volume: -6,
        onload: () => onLoaded?.(),
      });
      sampler.connect(compressor);
      sampler.connect(getPianoReverb());
      return sampler;
    }
    case "mellow":
      onLoaded?.();
      return new Tone.PolySynth(Tone.Synth, {
        volume: -14,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.8 },
      }).connect(compressor);
    case "bell":
      onLoaded?.();
      return new Tone.PolySynth(Tone.Synth, {
        volume: -12,
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.6 },
      }).connect(compressor);
    case "bright":
      onLoaded?.();
      return new Tone.PolySynth(Tone.Synth, {
        volume: -16,
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.4 },
      }).connect(compressor);
    default:
      onLoaded?.();
      return new Tone.PolySynth(Tone.Synth, {
        volume: -14,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.8 },
      }).connect(compressor);
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
    setSettings,
    generateNew,
    toggleLock,
    deleteChord,
    shiftNote,
    setIsPlaying,
    exportMidi,
  } = useProgressionStore();

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [soundPreset, setSoundPreset] = useState<SoundPresetId>("piano");
  const [generationKey, setGenerationKey] = useState(0);
  const [isSynthLoading, setIsSynthLoading] = useState(false);
  const [selectedChordIndex, setSelectedChordIndex] = useState<number | null>(null);

  const synthRef = useRef<Synth | null>(null);
  const playbackIndexRef = useRef(0);

  /* ─── Synth lifecycle ─── */

  useEffect(() => {
    setIsSynthLoading(soundPreset === "piano");
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
  }, [isPlaying, currentProgression, durationToBeats, beatsToDuration]);

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
          <p className="text-sm text-muted hidden sm:block">
            Chord Progression Generator
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        {/* ── Controls Bar (two rows) ── */}
        <section className="bg-surface rounded-2xl border border-border-subtle p-6 shadow-sm space-y-4">
          {/* Row 1: Key, Mode, Chords, BPM, Sound, Play, Generate, Export */}
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
                  className="w-20 h-1.5 bg-surface-muted rounded-full appearance-none cursor-pointer accent-accent"
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

          {/* Row 2: Complexity + Export */}
          <div className="flex flex-wrap items-center gap-4">
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

            <div className="flex-1" />

            <button
              onClick={exportMidi}
              disabled={!currentProgression}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-surface hover:bg-surface-muted text-sm font-medium transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Export MIDI
            </button>
          </div>
        </section>

        {/* ── Chord Cards ── */}
        <section>
          <AnimatePresence mode="wait">
            {currentProgression && currentProgression.chords.length > 0 ? (
              <motion.div
                key={generationKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-wrap justify-center gap-4"
              >
                {currentProgression.chords.map((chord, index) => {
                  const isActive = playbackIndex === index;
                  const previewNotes =
                    chord.notesWithOctave && chord.notesWithOctave.length > 0
                      ? chord.notesWithOctave
                      : chord.notes.map((n) => `${n}3`);

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
                      onClick={() => handleChordClick(previewNotes, index)}
                      className={`relative flex flex-col items-center justify-center rounded-2xl px-8 py-8 min-w-[130px] border transition-all duration-200 cursor-pointer select-none ${
                        isActive
                          ? "bg-accent/10 border-accent shadow-md ring-2 ring-accent/20"
                          : selectedChordIndex === index
                            ? "bg-surface border-accent/50 ring-2 ring-accent/15 shadow-sm"
                            : chord.isLocked
                              ? "bg-surface border-accent/30 ring-1 ring-accent/10"
                              : "bg-surface border-border-subtle hover:border-accent/40 hover:shadow-sm"
                      }`}
                    >
                      {/* Playback glow pulse */}
                      {isActive && (
                        <motion.div
                          className="absolute inset-0 rounded-2xl bg-accent/5"
                          animate={{ opacity: [0.3, 0.08, 0.3] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}

                      {/* Lock toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLock(index);
                        }}
                        className={`absolute top-2 right-2 p-1 rounded-md transition-colors ${
                          chord.isLocked
                            ? "text-accent hover:text-accent/80"
                            : "text-muted/30 hover:text-muted/60"
                        }`}
                        title={chord.isLocked ? "Unlock chord" : "Lock chord"}
                      >
                        {chord.isLocked ? (
                          <Lock className="w-3.5 h-3.5" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <div className="text-xs font-mono text-muted mb-1 uppercase tracking-wider">
                        {chord.romanNumeral}
                      </div>
                      <div className="text-2xl font-semibold mb-2">{chord.symbol}</div>
                      <div className="text-xs text-muted opacity-70">
                        {chord.notes.join(" · ")}
                      </div>
                      {chord.durationClass && chord.durationClass !== "full" && (
                        <div className="mt-1.5 text-[10px] font-mono text-muted/50 uppercase tracking-widest">
                          {chord.durationClass === "half" ? "2 beats" : chord.durationClass === "quarter" ? "1 beat" : "½ beat"}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
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

        {/* ── Piano Roll ── */}
        {currentProgression && currentProgression.chords.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
          >
            <VerticalPianoRoll
              chords={currentProgression.chords}
              playingIndex={playbackIndex}
              selectedIndex={selectedChordIndex}
              onPlayNote={handlePlayNote}
              onDeleteChord={deleteChord}
              onShiftNote={shiftNote}
              onSelectChord={setSelectedChordIndex}
            />
          </motion.section>
        )}

      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-8 text-xs text-muted">
        Built with harmonic intention
      </footer>
    </div>
  );
}
