"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as Tone from "tone";
import { Lock, Unlock, RefreshCcw, Play, Pause } from "lucide-react";
import type { PitchClass, ScaleType } from "@/lib/theory";
import { progressionToMidi } from "@/lib/progressionMidiExport";

const PITCH_CLASSES: PitchClass[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

const SCALE_TYPES: { value: ScaleType; label: string }[] = [
  { value: "major", label: "Major" },
  { value: "natural_minor", label: "Natural minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
];

type ChordItem = {
  degree: string;
  symbol: string;
  quality: string;
  notes: string[];
  notesWithOctave: string[];
};

export default function ProgressionPage() {
  const [root, setRoot] = useState<PitchClass>("D");
  const [scaleType, setScaleType] = useState<ScaleType>("natural_minor");
  const [chords, setChords] = useState<ChordItem[]>([]);
  const [lockedChords, setLockedChords] = useState<boolean[]>([false, false, false, false]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [currentChordIndex, setCurrentChordIndex] = useState(0);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const scheduleIdRef = useRef<number | null>(null);
  const playbackIndexRef = useRef(0);
  const audioStartedRef = useRef(false);

  const buildUrl = useCallback(() => {
    return `/api/theory/progression?root=${encodeURIComponent(root)}&scaleType=${encodeURIComponent(scaleType)}`;
  }, [root, scaleType]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      setChords(data.chords ?? []);
      setLockedChords([false, false, false, false]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate progression");
      setChords([]);
    } finally {
      setLoading(false);
    }
  }

  async function regenerateChordAt(index: number) {
    if (lockedChords[index]) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error("Regenerate failed");
      const data = await res.json();
      const newChords = data.chords ?? [];
      setChords((prev) => {
        const next = [...prev];
        if (next[index] && newChords[index]) {
          next[index] = newChords[index];
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate chord");
    } finally {
      setLoading(false);
    }
  }

  function toggleLock(index: number) {
    setLockedChords((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }

  function handleExportMidi() {
    if (chords.length === 0) return;
    const blob = progressionToMidi(
      chords.map((c) => ({ symbol: c.symbol, notesWithOctave: c.notesWithOctave })),
      bpm
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "harmonia-progression.mid";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Initialize Tone.js synth
  useEffect(() => {
    if (synthRef.current) return;
    const synth = new Tone.PolySynth(Tone.Synth, {
      volume: -8,
      oscillator: { type: "triangle" },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 1 },
    }).toDestination();
    synthRef.current = synth;
    return () => {
      synth.dispose();
      synthRef.current = null;
    };
  }, []);

  // Start audio on first interaction
  const ensureAudioStarted = useCallback(async () => {
    if (audioStartedRef.current) return;
    await Tone.start();
    audioStartedRef.current = true;
  }, []);

  // BPM sync
  useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  // Playback schedule
  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      if (scheduleIdRef.current != null) {
        Tone.Transport.clear(scheduleIdRef.current);
        scheduleIdRef.current = null;
      }
      Tone.Transport.stop();
      playbackIndexRef.current = 0;
      if (synthRef.current) synthRef.current.releaseAll();
      return;
    }

    const id = Tone.Transport.scheduleRepeat(
      (time) => {
        const idx = playbackIndexRef.current;
        const chord = chords[idx];
        if (!chord?.notesWithOctave?.length || !synthRef.current) return;

        synthRef.current.releaseAll(time);
        synthRef.current.triggerAttack(chord.notesWithOctave, time + 0.02);
        setCurrentChordIndex(idx);
        playbackIndexRef.current = (idx + 1) % 4;
      },
      "1n",
      0
    );
    scheduleIdRef.current = id;
    Tone.Transport.start();

    return () => {
      if (scheduleIdRef.current != null) {
        Tone.Transport.clear(scheduleIdRef.current);
      }
    };
  }, [isPlaying, chords]);

  function togglePlay() {
    if (chords.length === 0) return;
    ensureAudioStarted().then(() => {
      setIsPlaying((p) => !p);
    });
  }

  function playFromChord(index: number) {
    if (chords.length === 0) return;
    ensureAudioStarted().then(() => {
      Tone.Transport.stop();
      if (synthRef.current) synthRef.current.releaseAll();
      playbackIndexRef.current = index;
      setCurrentChordIndex(index);
      setIsPlaying(true);
    });
  }

  return (
    <main className="min-h-screen bg-background text-foreground pb-32">
      <div className="max-w-4xl mx-auto px-6 py-16 space-y-8">
        <section className="bg-surface border border-subtle rounded-2xl shadow-sm p-8">
          <h1 className="text-2xl font-semibold mb-2">Chord progression generator</h1>
          <p className="text-muted text-sm mb-6">
            Generate random 4-chord progressions from diatonic triads (I, ii, iii, IV, V, vi, vii°).
            Notes are sharps-only (e.g. A# not Bb).
          </p>

          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Root</label>
              <select
                value={root}
                onChange={(e) => setRoot(e.target.value as PitchClass)}
                className="rounded-lg border border-subtle bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 min-w-[72px]"
              >
                {PITCH_CLASSES.map((pc) => (
                  <option key={pc} value={pc}>{pc}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Scale</label>
              <select
                value={scaleType}
                onChange={(e) => setScaleType(e.target.value as ScaleType)}
                className="rounded-lg border border-subtle bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 min-w-[140px]"
              >
                {SCALE_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={generate}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-medium bg-foreground text-surface hover:opacity-90 disabled:opacity-50 transition focus:outline-none focus:ring-2 focus:ring-foreground/20"
            >
              {loading ? "Generating…" : "Generate"}
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {chords.length > 0 && (
          <>
            <section className="space-y-4">
              <h2 className="text-sm font-medium text-muted">Progression</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {chords.map((chord, i) => (
                  <div
                    key={`${i}-${chord.symbol}`}
                    onClick={() => playFromChord(i)}
                    className={`relative flex flex-col items-center justify-center rounded-2xl border border-subtle bg-surface p-6 min-h-[160px] cursor-pointer transition-all ${
                      currentChordIndex === i && isPlaying
                        ? "ring-2 ring-foreground/30 scale-[1.02] shadow-lg"
                        : "hover:border-foreground/20"
                    }`}
                  >
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLock(i);
                        }}
                        className="p-1.5 rounded hover:bg-surface-muted transition"
                        aria-label={lockedChords[i] ? "Unlock" : "Lock"}
                      >
                        {lockedChords[i] ? (
                          <Lock className="w-4 h-4 text-foreground" />
                        ) : (
                          <Unlock className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          regenerateChordAt(i);
                        }}
                        disabled={lockedChords[i] || loading}
                        className="p-1.5 rounded hover:bg-surface-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Regenerate chord"
                      >
                        <RefreshCcw className="w-4 h-4 text-muted" />
                      </button>
                    </div>
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">{chord.degree}</div>
                    <div className="text-2xl font-semibold mb-1">{chord.symbol}</div>
                    <div className="text-xs text-muted font-mono">{chord.notes.join(" ")}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="fixed bottom-0 left-0 right-0 bg-surface border-t border-subtle px-6 py-4">
              <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4">
                <button
                  onClick={togglePlay}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 border border-subtle bg-surface hover:bg-surface-muted transition"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                  <span className="text-sm font-medium">{isPlaying ? "Pause" : "Play"}</span>
                </button>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted">BPM</label>
                  <input
                    type="range"
                    min={60}
                    max={180}
                    value={bpm}
                    onChange={(e) => setBpm(Number(e.target.value))}
                    className="w-24 h-2 bg-surface-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
                  />
                  <span className="text-sm font-medium w-8">{bpm}</span>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={generate}
                    disabled={loading}
                    className="rounded-full px-5 py-2.5 border border-subtle bg-surface hover:bg-surface-muted transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">Regenerate</span>
                  </button>
                  <button
                    onClick={handleExportMidi}
                    className="rounded-full px-5 py-2.5 border border-subtle bg-surface hover:bg-surface-muted transition"
                  >
                    <span className="text-sm font-medium">Export MIDI</span>
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
