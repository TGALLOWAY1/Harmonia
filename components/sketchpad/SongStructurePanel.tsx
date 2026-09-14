"use client";

import { useState } from "react";
import {
  Plus,
  Play,
  Square,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  ArrowLeft,
  ListMusic,
} from "lucide-react";
import { useSketchpadStore } from "@/lib/sketchpad/store";
import type { HarmonicSketchProject, HarmonicSection, SectionType, PlaybackMode } from "@/lib/sketchpad/types";
import type { PitchClass } from "@/lib/theory/midiUtils";
import type { Mode } from "@/lib/theory/harmonyEngine";

const SECTION_PRESETS: SectionType[] = [
  "Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Drop", "Outro", "Custom",
];

const NOTES: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES: { value: Mode; label: string }[] = [
  { value: "ionian", label: "Major" },
  { value: "aeolian", label: "Minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
  { value: "major_pentatonic", label: "Major Pentatonic" },
];

function modeLabel(m: Mode): string {
  return MODES.find((x) => x.value === m)?.label ?? m;
}

export function SongStructurePanel({
  project,
  activeSectionId,
  onSelectSection,
  playbackMode,
  playbackSectionIndex,
  onPlaySection,
  onPlayFullSong,
  onStop,
  onBackToProjects,
}: {
  project: HarmonicSketchProject;
  activeSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  playbackMode: PlaybackMode;
  playbackSectionIndex: number;
  onPlaySection: (section: HarmonicSection) => void;
  onPlayFullSong: () => void;
  onStop: () => void;
  onBackToProjects: () => void;
}) {
  const {
    addSection,
    renameSection,
    deleteSection,
    duplicateSection,
    reorderSections,
    renameProject,
    updateProjectKey,
    updateProjectBpm,
  } = useSketchpadStore();

  const [addingSection, setAddingSection] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(project.title);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionNameValue, setSectionNameValue] = useState("");

  const handleAddSection = (type: SectionType) => {
    addSection(type);
    setAddingSection(false);
  };

  const isPlaying = playbackMode !== "stopped";

  return (
    <div className="w-64 flex-shrink-0 border-r border-border-subtle bg-surface flex flex-col h-full">
      {/* Project Header */}
      <div className="p-4 border-b border-border-subtle">
        <button
          onClick={onBackToProjects}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          All Sketches
        </button>

        {editingTitle ? (
          <input
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={() => {
              renameProject(project.id, titleValue.trim() || project.title);
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameProject(project.id, titleValue.trim() || project.title);
                setEditingTitle(false);
              }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="text-sm font-semibold w-full bg-surface-muted border border-border-subtle rounded px-2 py-1 outline-none focus:ring-2 focus:ring-accent/30"
            autoFocus
          />
        ) : (
          <h2
            className="text-sm font-semibold cursor-pointer hover:text-accent transition-colors truncate"
            onClick={() => {
              setTitleValue(project.title);
              setEditingTitle(true);
            }}
            title="Click to rename"
          >
            {project.title}
          </h2>
        )}

        {/* Global key/scale */}
        <div className="flex gap-2 mt-2">
          <select
            value={project.globalKeyRoot}
            onChange={(e) =>
              updateProjectKey(e.target.value as PitchClass, project.globalScaleType)
            }
            className="bg-surface-muted border border-border-subtle rounded px-2 py-1 text-xs outline-none w-16 appearance-none cursor-pointer"
          >
            {NOTES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={project.globalScaleType}
            onChange={(e) =>
              updateProjectKey(project.globalKeyRoot, e.target.value as Mode)
            }
            className="bg-surface-muted border border-border-subtle rounded px-2 py-1 text-xs outline-none flex-1 appearance-none cursor-pointer"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* BPM */}
        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs text-muted">BPM</label>
          <input
            type="range"
            min={60}
            max={180}
            value={project.bpm}
            onChange={(e) => updateProjectBpm(Number(e.target.value))}
            className="flex-1 accent-accent h-1"
          />
          <span className="text-xs font-mono w-8 text-center">{project.bpm}</span>
        </div>
      </div>

      {/* Sections List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Sections</span>
          </div>

          {project.sections.length === 0 ? (
            <div className="text-xs text-muted text-center py-6">
              No sections yet. Add one to get started.
            </div>
          ) : (
            <div className="space-y-1">
              {project.sections.map((section, index) => {
                const isActive = section.id === activeSectionId;
                const isPlayingSection =
                  isPlaying && playbackSectionIndex === index;
                const variant = section.variants.find(
                  (v) => v.id === section.activeVariantId
                );
                const eventCount = variant?.events.length ?? 0;

                return (
                  <div
                    key={section.id}
                    className={`group rounded-lg border transition-all cursor-pointer ${
                      isActive
                        ? "bg-accent/10 border-accent/30"
                        : isPlayingSection
                        ? "bg-accent/5 border-accent/20"
                        : "bg-surface border-border-subtle hover:border-accent/20"
                    }`}
                    onClick={() => onSelectSection(section.id)}
                  >
                    <div className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {isPlayingSection && (
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
                          )}
                          {editingSectionId === section.id ? (
                            <input
                              value={sectionNameValue}
                              onChange={(e) => setSectionNameValue(e.target.value)}
                              onBlur={() => {
                                renameSection(section.id, sectionNameValue.trim() || section.name);
                                setEditingSectionId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  renameSection(section.id, sectionNameValue.trim() || section.name);
                                  setEditingSectionId(null);
                                }
                                if (e.key === "Escape") setEditingSectionId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs font-medium bg-surface-muted border border-border-subtle rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-accent/30 w-24"
                              autoFocus
                            />
                          ) : (
                            <span
                              className="text-xs font-medium truncate"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setSectionNameValue(section.name);
                                setEditingSectionId(section.id);
                              }}
                            >
                              {section.name}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPlaySection(section);
                            }}
                            className="p-1 rounded hover:bg-surface-muted text-muted hover:text-foreground"
                            title="Play section"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                          {index > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderSections(index, index - 1);
                              }}
                              className="p-1 rounded hover:bg-surface-muted text-muted hover:text-foreground"
                              title="Move up"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                          )}
                          {index < project.sections.length - 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderSections(index, index + 1);
                              }}
                              className="p-1 rounded hover:bg-surface-muted text-muted hover:text-foreground"
                              title="Move down"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateSection(section.id);
                            }}
                            className="p-1 rounded hover:bg-surface-muted text-muted hover:text-foreground"
                            title="Duplicate"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSection(section.id);
                            }}
                            className="p-1 rounded hover:bg-red-50 text-muted hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted">
                          {section.bars} bars
                        </span>
                        <span className="text-[10px] text-muted">
                          {eventCount} chord{eventCount !== 1 ? "s" : ""}
                        </span>
                        {section.keyRoot !== project.globalKeyRoot ||
                        section.scaleType !== project.globalScaleType ? (
                          <span className="text-[10px] text-accent font-medium">
                            {section.keyRoot} {modeLabel(section.scaleType)}
                          </span>
                        ) : null}
                      </div>

                      {section.variants.length > 1 && (
                        <div className="flex gap-1 mt-1">
                          {section.variants.map((v) => (
                            <span
                              key={v.id}
                              className={`text-[9px] px-1.5 py-0.5 rounded ${
                                v.id === section.activeVariantId
                                  ? "bg-accent/20 text-accent font-medium"
                                  : "bg-surface-muted text-muted"
                              }`}
                            >
                              {v.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Section */}
          {addingSection ? (
            <div className="mt-2 bg-surface-muted rounded-lg border border-border-subtle p-2">
              <div className="text-xs font-medium text-muted mb-1.5">Section type</div>
              <div className="grid grid-cols-2 gap-1">
                {SECTION_PRESETS.map((type) => (
                  <button
                    key={type}
                    onClick={() => handleAddSection(type)}
                    className="text-xs px-2 py-1.5 rounded bg-surface border border-border-subtle hover:border-accent/40 hover:bg-accent/5 transition-colors text-left"
                  >
                    {type}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setAddingSection(false)}
                className="text-xs text-muted hover:text-foreground mt-2 w-full text-center"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingSection(true)}
              className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-muted hover:text-foreground py-2 rounded-lg border border-dashed border-border-subtle hover:border-accent/40 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add Section
            </button>
          )}
        </div>
      </div>

      {/* Playback Controls */}
      <div className="p-3 border-t border-border-subtle">
        <div className="flex gap-2">
          {isPlaying ? (
            <button
              onClick={onStop}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm font-medium hover:bg-accent/10 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={onPlayFullSong}
              disabled={project.sections.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-all disabled:opacity-40"
            >
              <ListMusic className="w-3.5 h-3.5" />
              Play All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
