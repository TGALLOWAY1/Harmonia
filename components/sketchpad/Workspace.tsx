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
import { usePlaybackSettingsStore } from "@/lib/state/playbackSettingsStore";
import { beatsToSeconds, buildChordEvents, noteDurationWithinEvent } from "@/lib/audio/humanization";
import { applyDynamics, chordVoiceWeights, metricAccent } from "@/lib/audio/dynamics";

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
    masterVolume,
    space,
    setInstrument: setSoundPreset,
    setMasterVolume,
    setSpace,
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

  /**
   * Trigger one harmonic event's notes at a scheduled transport time, using
   * the same dynamics model as the main page: the playback settings store's
   * velocity/humanize/style and tempo-aware arpeggio spread, voice weights
   * (bass/top/inner voicing), the position's metric accent, and an exact
   * note duration in seconds — any beat count, not just 4/2/1/0.5 — so a
   * dotted or triplet-length event rings for as long as it's actually meant
   * to instead of snapping to a whole note.
   */
  const triggerHarmonicEvent = useCallback((time: number, event: HarmonicEvent, beats: number, accent: number) => {
    if (!synthRef.current) return;
    const notes = event.notesWithOctave.length > 0 ? event.notesWithOctave : event.notes.map((n) => `${n}3`);
    const noteMidiNumbers =
      event.midiNotes.length > 0 ? event.midiNotes : notes.map((n) => Tone.Frequency(n).toMidi());
    const weights = chordVoiceWeights(noteMidiNumbers);

    const ps = usePlaybackSettingsStore.getState();
    const liveBpm = Tone.getTransport().bpm.value || 120;
    const durationSeconds = beatsToSeconds(beats, liveBpm);
    const baseVelocity = applyDynamics(ps.chordVelocity, accent);
    const chordEvents = buildChordEvents(notes, {
      baseVelocity,
      humanize: ps.humanize,
      style: ps.playbackStyle,
      spreadSeconds: beats * (60 / liveBpm),
      weights,
    });
    // Cut whatever the previous event left ringing at this exact boundary —
    // the same safeguard as the main page — so a sampled instrument's long
    // sustain, a release dropped at the loop boundary, or a note shared with
    // the next event never piles up across events. Then each voice plays
    // only until the event ends, however late its strum/arpeggio offset made
    // it start.
    synthRef.current.releaseAll(time);
    for (const ev of chordEvents) {
      synthRef.current.triggerAttackRelease(
        ev.note,
        noteDurationWithinEvent(durationSeconds, ev.timeOffset),
        time + ev.timeOffset,
        ev.velocity,
      );
    }
  }, []);

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
        const evIdx = i;
        const accent = metricAccent(((beatOffset % 4) + 4) % 4);

        const bars = Math.floor(beatOffset / 4);
        const quarters = Math.floor(beatOffset % 4);
        const sixteenths = (beatOffset % 1) * 4;
        const timeStr = `${bars}:${quarters}:${sixteenths}`;

        const id = Tone.getTransport().schedule((time) => {
          if (!synthRef.current) return;
          triggerHarmonicEvent(time, ev, beats, accent);
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
    [setPlaybackPosition, playbackSectionIndex, triggerHarmonicEvent]
  );

  // Play single chord
  const playChord = useCallback(
    async (event: HarmonicEvent) => {
      // If the unlock failed or timed out, stop what was playing but schedule
      // nothing new: the audio status badge says why, and the next tap retries.
      const ready = await ensureAudioReady();
      stopPlayback();
      if (!ready || !synthRef.current) return;
      const notes = event.notesWithOctave.length > 0 ? event.notesWithOctave : event.notes.map((n) => `${n}3`);
      const noteMidiNumbers =
        event.midiNotes.length > 0 ? event.midiNotes : notes.map((n) => Tone.Frequency(n).toMidi());
      const weights = chordVoiceWeights(noteMidiNumbers);
      const ps = usePlaybackSettingsStore.getState();
      const chordEvents = buildChordEvents(notes, {
        baseVelocity: ps.chordVelocity,
        humanize: ps.humanize,
        style: "block",
        weights,
      });
      const now = Tone.now();
      for (const ev of chordEvents) {
        // Jitter can make timeOffset negative; clamp so an immediate preview
        // never schedules a note earlier than `now`.
        synthRef.current.triggerAttackRelease(ev.note, "2n", now + Math.max(0, ev.timeOffset), ev.velocity);
      }
    },
    [stopPlayback]
  );

  // Play section
  const playSection = useCallback(
    async (section: HarmonicSection, loop: boolean = false) => {
      const ready = await ensureAudioReady();
      stopPlayback();
      if (!ready) return;
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
      const ready = await ensureAudioReady();
      stopPlayback();
      if (!ready) return;

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
        const accent = metricAccent(((beatOffset % 4) + 4) % 4);

        const bars = Math.floor(beatOffset / 4);
        const quarters = Math.floor(beatOffset % 4);
        const sixteenths = (beatOffset % 1) * 4;
        const timeStr = `${bars}:${quarters}:${sixteenths}`;

        const si = sectionIndex;
        const ei = eventIndex;
        const id = Tone.getTransport().schedule((time) => {
          if (!synthRef.current) return;
          triggerHarmonicEvent(time, event, beats, accent);
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
    [project.sections, stopPlayback, setPlaybackMode, setPlaybackPosition, triggerHarmonicEvent]
  );

  // Play transition preview between two sections
  const playTransition = useCallback(
    async (fromSection: HarmonicSection, toSection: HarmonicSection) => {
      const ready = await ensureAudioReady();
      stopPlayback();
      if (!ready) return;
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
      const ready = await ensureAudioReady();
      if (!ready || !synthRef.current) return;
      const ps = usePlaybackSettingsStore.getState();
      const weights = chordVoiceWeights([Tone.Frequency(noteWithOctave).toMidi()]);
      const [ev] = buildChordEvents([noteWithOctave], {
        baseVelocity: ps.chordVelocity,
        humanize: ps.humanize,
        style: "block",
        weights,
      });
      const now = Tone.now();
      // Jitter can make timeOffset negative; clamp so an immediate preview
      // never schedules a note earlier than `now`.
      synthRef.current.triggerAttackRelease(noteWithOctave, "4n", now + Math.max(0, ev.timeOffset), ev.velocity);
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
        masterVolume={masterVolume}
        onMasterVolumeChange={setMasterVolume}
        space={space}
        onSpaceChange={setSpace}
        isSynthLoading={isSynthLoading}
        synthLoadError={synthLoadError}
        onDismissSynthError={dismissSynthError}
      />
    </div>
  );
}
