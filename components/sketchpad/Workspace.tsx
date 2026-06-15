"use client";

import { useMemo, useCallback, useRef, useEffect } from "react";
import * as Tone from "tone";
import type { HarmonicSketchProject, HarmonicSection, HarmonicEvent, PlaybackMode } from "@/lib/sketchpad/types";
import { useSketchpadStore } from "@/lib/sketchpad/store";
import { SongStructurePanel } from "./SongStructurePanel";
import { SectionEditorPanel } from "./SectionEditorPanel";
import { HarmonicPreviewPanel } from "./HarmonicPreviewPanel";
import { type Synth } from "@/lib/audio/synthPresets";
import { useAudioSettingsStore } from "@/lib/state/audioSettingsStore";
import { useInstrument } from "@/lib/audio/useInstrument";
import { ensureAudioReady } from "@/lib/audio/audioEngine";

function beatsToDuration(beats: number): string {
  switch (beats) {
    case 4: return "1n";
    case 2: return "2n";
    case 1: return "4n";
    case 0.5: return "8n";
    default: return "1n";
  }
}

export function SketchpadWorkspace({ project }: { project: HarmonicSketchProject }) {
  const {
    activeSectionId,
    setActiveSection,
    setActiveProject,
    playbackMode,
    setPlaybackMode,
    playbackSectionIndex,
    playbackEventIndex,
    setPlaybackPosition,
  } = useSketchpadStore();

  const {
    instrumentId: soundPreset,
    quality: audioQuality,
    setInstrument: setSoundPreset,
  } = useAudioSettingsStore();
  const synthRef = useRef<Synth | null>(null);
  const {
    isLoading: isSynthLoading,
    loadError: synthLoadError,
    dismissError: dismissSynthError,
  } = useInstrument(soundPreset, { quality: audioQuality, synthRef });
  const scheduleIdsRef = useRef<number[]>([]);

  const activeSection = useMemo(
    () => project.sections.find((s) => s.id === activeSectionId) ?? null,
    [project.sections, activeSectionId]
  );

  const activeVariant = useMemo(() => {
    if (!activeSection) return null;
    return activeSection.variants.find((v) => v.id === activeSection.activeVariantId) ?? null;
  }, [activeSection]);


  // BPM sync
  useEffect(() => {
    Tone.getTransport().bpm.value = project.bpm;
  }, [project.bpm]);

  // Stop playback helper
  const stopPlayback = useCallback(() => {
    for (const id of scheduleIdsRef.current) {
      Tone.getTransport().clear(id);
    }
    scheduleIdsRef.current = [];
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
    Tone.getTransport().loop = false;
    Tone.getDraw().cancel(0);
    synthRef.current?.releaseAll();
    setPlaybackMode("stopped");
    setPlaybackPosition(0, 0);
  }, [setPlaybackMode, setPlaybackPosition]);

  // Schedule events for playback
  const scheduleEvents = useCallback(
    (events: HarmonicEvent[], loop: boolean, onComplete?: () => void) => {
      if (!synthRef.current || events.length === 0) return;

      const ids: number[] = [];
      let totalBeats = 0;
      for (const ev of events) totalBeats += ev.durationBeats;

      let beatOffset = 0;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const beats = ev.durationBeats;
        const duration = beatsToDuration(beats);
        const evIdx = i;

        const bars = Math.floor(beatOffset / 4);
        const quarters = Math.floor(beatOffset % 4);
        const sixteenths = (beatOffset % 1) * 4;
        const timeStr = `${bars}:${quarters}:${sixteenths}`;

        const id = Tone.getTransport().schedule((time) => {
          if (!synthRef.current) return;
          const notes = ev.notesWithOctave.length > 0 ? ev.notesWithOctave : ev.notes.map((n) => `${n}3`);
          synthRef.current.triggerAttackRelease(notes, duration, time);
          Tone.getDraw().schedule(() => {
            setPlaybackPosition(playbackSectionIndex, evIdx);
          }, time);
        }, timeStr);
        ids.push(id);
        beatOffset += beats;
      }

      scheduleIdsRef.current = ids;

      const endBars = Math.floor(totalBeats / 4);
      const endQuarters = Math.floor(totalBeats % 4);
      const endSixteenths = (totalBeats % 1) * 4;
      Tone.getTransport().loop = loop;
      Tone.getTransport().loopStart = 0;
      Tone.getTransport().loopEnd = `${endBars}:${endQuarters}:${endSixteenths}`;
      Tone.getTransport().position = 0;
      Tone.getTransport().start();
    },
    [setPlaybackPosition, playbackSectionIndex]
  );

  // Play single chord
  const playChord = useCallback(
    async (event: HarmonicEvent) => {
      await ensureAudioReady();
      stopPlayback();
      if (!synthRef.current) return;
      const notes = event.notesWithOctave.length > 0 ? event.notesWithOctave : event.notes.map((n) => `${n}3`);
      synthRef.current.triggerAttackRelease(notes, "2n");
    },
    [stopPlayback]
  );

  // Play section
  const playSection = useCallback(
    async (section: HarmonicSection, loop: boolean = false) => {
      await ensureAudioReady();
      stopPlayback();
      const variant = section.variants.find((v) => v.id === section.activeVariantId);
      if (!variant || variant.events.length === 0) return;
      const sIdx = project.sections.findIndex((s) => s.id === section.id);
      setPlaybackPosition(sIdx, 0);
      setPlaybackMode(loop ? "section-loop" : "section");
      scheduleEvents(variant.events, loop);
    },
    [project.sections, stopPlayback, scheduleEvents, setPlaybackMode, setPlaybackPosition]
  );

  // Play full song
  const playFullSong = useCallback(
    async (startFromSectionIndex: number = 0) => {
      await ensureAudioReady();
      stopPlayback();

      const allEvents: { event: HarmonicEvent; sectionIndex: number; eventIndex: number }[] = [];
      for (let si = startFromSectionIndex; si < project.sections.length; si++) {
        const section = project.sections[si];
        const variant = section.variants.find((v) => v.id === section.activeVariantId);
        if (!variant) continue;
        for (let ei = 0; ei < variant.events.length; ei++) {
          allEvents.push({ event: variant.events[ei], sectionIndex: si, eventIndex: ei });
        }
      }

      if (allEvents.length === 0) return;

      const ids: number[] = [];
      let beatOffset = 0;
      for (const { event, sectionIndex, eventIndex } of allEvents) {
        const beats = event.durationBeats;
        const duration = beatsToDuration(beats);

        const bars = Math.floor(beatOffset / 4);
        const quarters = Math.floor(beatOffset % 4);
        const sixteenths = (beatOffset % 1) * 4;
        const timeStr = `${bars}:${quarters}:${sixteenths}`;

        const si = sectionIndex;
        const ei = eventIndex;
        const id = Tone.getTransport().schedule((time) => {
          if (!synthRef.current) return;
          const notes = event.notesWithOctave.length > 0 ? event.notesWithOctave : event.notes.map((n) => `${n}3`);
          synthRef.current.triggerAttackRelease(notes, duration, time);
          Tone.getDraw().schedule(() => {
            setPlaybackPosition(si, ei);
          }, time);
        }, timeStr);
        ids.push(id);
        beatOffset += beats;
      }

      // Schedule stop at end
      const endBars = Math.floor(beatOffset / 4);
      const endQuarters = Math.floor(beatOffset % 4);
      const endSixteenths = (beatOffset % 1) * 4;
      const endId = Tone.getTransport().schedule(() => {
        Tone.getDraw().schedule(() => {
          stopPlayback();
        }, Tone.now());
      }, `${endBars}:${endQuarters}:${endSixteenths}`);
      ids.push(endId);

      scheduleIdsRef.current = ids;
      setPlaybackMode("full-song");
      setPlaybackPosition(allEvents[0].sectionIndex, 0);
      Tone.getTransport().loop = false;
      Tone.getTransport().position = 0;
      Tone.getTransport().start();
    },
    [project.sections, stopPlayback, setPlaybackMode, setPlaybackPosition]
  );

  // Play transition preview between two sections
  const playTransition = useCallback(
    async (fromSection: HarmonicSection, toSection: HarmonicSection) => {
      await ensureAudioReady();
      stopPlayback();
      const fromVariant = fromSection.variants.find((v) => v.id === fromSection.activeVariantId);
      const toVariant = toSection.variants.find((v) => v.id === toSection.activeVariantId);
      if (!fromVariant || !toVariant) return;

      // Play last 2 events of from + first 2 events of to
      const fromEvents = fromVariant.events.slice(-2);
      const toEvents = toVariant.events.slice(0, 2);
      const combined = [...fromEvents, ...toEvents];
      if (combined.length === 0) return;

      setPlaybackMode("transition-preview");
      scheduleEvents(combined, false);
    },
    [stopPlayback, scheduleEvents, setPlaybackMode]
  );

  const playNote = useCallback(
    async (noteWithOctave: string) => {
      await ensureAudioReady();
      if (synthRef.current) {
        synthRef.current.triggerAttackRelease(noteWithOctave, "4n");
      }
    },
    []
  );

  return (
    <div className="flex h-full">
      {/* Left Panel - Song Structure */}
      <SongStructurePanel
        project={project}
        activeSectionId={activeSectionId}
        onSelectSection={setActiveSection}
        playbackMode={playbackMode}
        playbackSectionIndex={playbackSectionIndex}
        onPlaySection={(section) => playSection(section, false)}
        onPlayFullSong={() => playFullSong(0)}
        onStop={stopPlayback}
        onBackToProjects={() => setActiveProject(null)}
      />

      {/* Center Panel - Section Editor */}
      <SectionEditorPanel
        project={project}
        section={activeSection}
        variant={activeVariant}
        playbackMode={playbackMode}
        playbackEventIndex={playbackEventIndex}
        onPlayChord={playChord}
        onPlaySection={(loop) => activeSection && playSection(activeSection, loop)}
        onStop={stopPlayback}
      />

      {/* Right Panel - Harmonic Preview */}
      <HarmonicPreviewPanel
        project={project}
        section={activeSection}
        variant={activeVariant}
        playbackMode={playbackMode}
        playbackEventIndex={playbackEventIndex}
        playbackSectionIndex={playbackSectionIndex}
        onPlayChord={playChord}
        onPlaySection={(loop) => activeSection && playSection(activeSection, loop)}
        onPlayFullSong={(fromIdx) => playFullSong(fromIdx)}
        onPlayTransition={() => {
          if (!activeSection) return;
          const idx = project.sections.findIndex((s) => s.id === activeSection.id);
          if (idx < project.sections.length - 1) {
            playTransition(project.sections[idx], project.sections[idx + 1]);
          }
        }}
        onStop={stopPlayback}
        onPlayNote={playNote}
        soundPreset={soundPreset}
        onSoundPresetChange={setSoundPreset}
        isSynthLoading={isSynthLoading}
        synthLoadError={synthLoadError}
        onDismissSynthError={dismissSynthError}
      />
    </div>
  );
}
