"use client";

import { useEffect, useRef } from "react";
import * as Tone from "tone";
import ScaleSelector from "@/components/progression/ScaleSelector";
import MoodControl from "@/components/progression/MoodControl";
import ComplexitySlider from "@/components/progression/ComplexitySlider";
import ProgressionDisplay from "@/components/progression/ProgressionDisplay";
import ActionButtons from "@/components/progression/ActionButtons";
import { useProgressionStore } from "@/lib/state/progressionStore";
import { ChevronLeft, Download, Play, Pause } from "lucide-react";
import Link from "next/link";

export default function ProgressionPage() {
  const {
    isPlaying,
    bpm,
    currentProgression,
    setSettings,
    setIsPlaying,
    exportMidi
  } = useProgressionStore();

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const playbackIndexRef = useRef(0);
  const scheduleIdRef = useRef<number | null>(null);

  // Audio initialization
  useEffect(() => {
    const synth = new Tone.PolySynth(Tone.Synth, {
      volume: -10,
      oscillator: { type: "triangle" },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.8, release: 1.5 }
    }).toDestination();

    synthRef.current = synth;

    return () => {
      synth.dispose();
      synthRef.current = null;
    };
  }, []);

  // Transport sync
  useEffect(() => {
    Tone.Transport.bpm.value = bpm;
  }, [bpm]);

  // Playback logic
  useEffect(() => {
    if (!isPlaying || !currentProgression) {
      if (scheduleIdRef.current !== null) {
        Tone.Transport.clear(scheduleIdRef.current);
        scheduleIdRef.current = null;
      }
      Tone.Transport.stop();
      playbackIndexRef.current = 0;
      if (synthRef.current) synthRef.current.releaseAll();
      return;
    }

    const id = Tone.Transport.scheduleRepeat((time) => {
      const idx = playbackIndexRef.current;
      const chord = currentProgression.chords[idx];
      if (!chord || !synthRef.current) return;

      const notes = chord.notes.map(n => `${n}3`);
      synthRef.current.releaseAll(time);
      synthRef.current.triggerAttack(notes, time + 0.05);

      playbackIndexRef.current = (idx + 1) % currentProgression.chords.length;
    }, "1n", 0);

    scheduleIdRef.current = id;
    Tone.Transport.start();

    return () => {
      if (scheduleIdRef.current !== null) {
        Tone.Transport.clear(scheduleIdRef.current);
      }
    };
  }, [isPlaying, currentProgression]);

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="border-b border-border-subtle bg-surface/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </Link>
          <h1 className="text-lg font-medium">Chord Generator</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={exportMidi}
              disabled={!currentProgression}
              className="p-2 rounded-full hover:bg-surface-muted transition text-muted hover:text-foreground disabled:opacity-40"
              title="Export MIDI"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12 max-w-4xl">
        <section className="mb-12 text-center flex flex-col items-center gap-8">
          <div>
            <h2 className="text-3xl font-light mb-2">Generate Progressions</h2>
            <p className="text-muted">AI-driven harmonic exploration</p>
          </div>

          <ScaleSelector />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          <div className="bg-surface rounded-3xl p-8 border border-border-subtle shadow-sm hover:shadow-md transition-shadow">
            <MoodControl />
          </div>
          <div className="bg-surface rounded-3xl p-8 border border-border-subtle shadow-sm hover:shadow-md transition-shadow">
            <ComplexitySlider />
          </div>
        </section>

        <section className="flex flex-col items-center gap-12">
          <ProgressionDisplay />
          <div className="flex items-center gap-6">
            <ActionButtons />
            <div className="flex items-center gap-3 bg-surface border border-border-subtle rounded-full px-6 py-3 shadow-sm">
              <span className="text-xs font-medium text-muted uppercase">BPM</span>
              <input
                type="range"
                min={60}
                max={180}
                value={bpm}
                onChange={(e) => setSettings({ bpm: Number(e.target.value) })}
                className="w-24 h-1.5 bg-surface-muted rounded-full appearance-none cursor-pointer accent-accent"
              />
              <span className="text-sm font-medium w-8 text-center">{bpm}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
