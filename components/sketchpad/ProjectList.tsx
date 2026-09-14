"use client";

import { useState } from "react";
import { Plus, Copy, Trash2, Music, FolderOpen } from "lucide-react";
import { useSketchpadStore } from "@/lib/sketchpad/store";
import type { HarmonicSketchProject } from "@/lib/sketchpad/types";
import type { PitchClass } from "@/lib/theory/midiUtils";
import type { Mode } from "@/lib/theory/harmonyEngine";

const NOTES: PitchClass[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES: { value: Mode; label: string }[] = [
  { value: "ionian", label: "Major" },
  { value: "aeolian", label: "Minor" },
  { value: "dorian", label: "Dorian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "phrygian", label: "Phrygian" },
  { value: "major_pentatonic", label: "Major Pentatonic" },
];

export function SketchpadProjectList({
  projects,
  onSelectProject,
}: {
  projects: HarmonicSketchProject[];
  onSelectProject: (id: string) => void;
}) {
  const { createProject, duplicateProject, deleteProject, setActiveProject } = useSketchpadStore();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("New Sketch");
  const [keyRoot, setKeyRoot] = useState<PitchClass>("C");
  const [scaleType, setScaleType] = useState<Mode>("ionian");

  const handleCreate = () => {
    if (!title.trim()) return;
    const id = createProject(title.trim(), keyRoot, scaleType);
    setActiveProject(id);
    setShowCreate(false);
    setTitle("New Sketch");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-12">
      {projects.length === 0 && !showCreate ? (
        // Empty state
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-full bg-surface-muted border border-border-subtle flex items-center justify-center mx-auto mb-6">
            <Music className="w-9 h-9 text-muted" />
          </div>
          <h2 className="text-xl font-semibold mb-2">
            Sketch your song&apos;s harmony before the DAW
          </h2>
          <p className="text-sm text-muted mb-8">
            Create sections like Verse, Chorus, and Bridge. Build and compare
            progressions. Hear how they flow together.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-accent text-white font-medium text-sm transition-all hover:opacity-90 active:scale-[0.97] shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Create New Sketch
          </button>
        </div>
      ) : (
        // Project list
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold">Your Sketches</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent text-white font-medium text-sm transition-all hover:opacity-90 active:scale-[0.97] shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              New Sketch
            </button>
          </div>

          {showCreate && (
            <div className="bg-surface rounded-xl border border-border-subtle p-5 mb-4 shadow-sm">
              <h3 className="text-sm font-semibold mb-3">Create New Sketch</h3>
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted uppercase tracking-wider font-medium">Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 w-48"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted uppercase tracking-wider font-medium">Key</label>
                  <select
                    value={keyRoot}
                    onChange={(e) => setKeyRoot(e.target.value as PitchClass)}
                    className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 w-20 appearance-none cursor-pointer"
                  >
                    {NOTES.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted uppercase tracking-wider font-medium">Scale</label>
                  <select
                    value={scaleType}
                    onChange={(e) => setScaleType(e.target.value as Mode)}
                    className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 w-32 appearance-none cursor-pointer"
                  >
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-sm font-medium text-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="bg-surface rounded-xl border border-border-subtle p-4 shadow-sm hover:border-accent/40 transition-colors cursor-pointer group"
                onClick={() => onSelectProject(project.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-4 h-4 text-muted" />
                    <div>
                      <h3 className="text-sm font-semibold">{project.title}</h3>
                      <p className="text-xs text-muted">
                        {project.globalKeyRoot}{" "}
                        {MODES.find((m) => m.value === project.globalScaleType)?.label ?? project.globalScaleType}
                        {" · "}
                        {project.sections.length} section{project.sections.length !== 1 ? "s" : ""}
                        {" · "}
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const newId = duplicateProject(project.id);
                        if (newId) onSelectProject(newId);
                      }}
                      className="p-1.5 rounded-md hover:bg-surface-muted text-muted hover:text-foreground"
                      title="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${project.title}"?`)) {
                          deleteProject(project.id);
                        }
                      }}
                      className="p-1.5 rounded-md hover:bg-red-50 text-muted hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
