import { create } from "zustand";
import type {
  HarmonicSketchProject,
  HarmonicSection,
  HarmonicVariant,
  HarmonicEvent,
  SectionType,
  PlaybackMode,
} from "./types";
import type { PitchClass } from "../theory/midiUtils";
import type { Mode } from "../theory/harmonyEngine";

const STORAGE_KEY = "harmonia-sketchpad-projects";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadProjects(): HarmonicSketchProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: HarmonicSketchProject[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Storage full or unavailable
  }
}

export function createDefaultVariant(sectionId: string, name: string = "A"): HarmonicVariant {
  return {
    id: uid(),
    sectionId,
    name,
    events: [],
    createdAt: Date.now(),
  };
}

export function createDefaultSection(
  projectId: string,
  order: number,
  sectionType: SectionType = "Verse",
  keyRoot: PitchClass = "C",
  scaleType: Mode = "ionian"
): HarmonicSection {
  const sectionId = uid();
  const variant = createDefaultVariant(sectionId);
  return {
    id: sectionId,
    projectId,
    name: sectionType === "Custom" ? "Section" : sectionType,
    sectionType,
    order,
    bars: 4,
    keyRoot,
    scaleType,
    activeVariantId: variant.id,
    variants: [variant],
    createdAt: Date.now(),
  };
}

export function createDefaultEvent(
  variantId: string,
  order: number,
  chordRoot: PitchClass = "C",
  chordQuality: string = "maj",
  chordSymbol: string = "C",
  romanNumeral: string = "I",
  notes: PitchClass[] = ["C", "E", "G"],
  notesWithOctave: string[] = ["C3", "E3", "G3"],
  midiNotes: number[] = [48, 52, 55],
  durationBeats: number = 4
): HarmonicEvent {
  return {
    id: uid(),
    variantId,
    order,
    chordSymbol,
    chordRoot,
    chordQuality,
    romanNumeral,
    durationBeats,
    inversion: 0,
    notes,
    notesWithOctave,
    midiNotes,
  };
}

interface SketchpadState {
  // Data
  projects: HarmonicSketchProject[];
  activeProjectId: string | null;
  activeSectionId: string | null;

  // Playback
  playbackMode: PlaybackMode;
  playbackSectionIndex: number;
  playbackEventIndex: number;
  isLooping: boolean;

  // Derived getters (computed in components, not stored)

  // Actions - Projects
  loadFromStorage: () => void;
  createProject: (title: string, keyRoot?: PitchClass, scaleType?: Mode) => string;
  renameProject: (id: string, title: string) => void;
  duplicateProject: (id: string) => string;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  updateProjectKey: (keyRoot: PitchClass, scaleType: Mode) => void;
  updateProjectBpm: (bpm: number) => void;

  // Actions - Sections
  addSection: (sectionType?: SectionType) => void;
  addSectionFromProgression: (progression: any, name: string) => void;
  renameSection: (sectionId: string, name: string) => void;
  updateSectionType: (sectionId: string, sectionType: SectionType) => void;
  updateSectionBars: (sectionId: string, bars: number) => void;
  updateSectionKey: (sectionId: string, keyRoot: PitchClass, scaleType: Mode) => void;
  duplicateSection: (sectionId: string) => void;
  deleteSection: (sectionId: string) => void;
  reorderSections: (fromIndex: number, toIndex: number) => void;
  setActiveSection: (sectionId: string | null) => void;

  // Actions - Variants
  addVariant: (sectionId: string) => void;
  renameVariant: (sectionId: string, variantId: string, name: string) => void;
  duplicateVariant: (sectionId: string, variantId: string) => void;
  deleteVariant: (sectionId: string, variantId: string) => void;
  setActiveVariant: (sectionId: string, variantId: string) => void;

  // Actions - Events
  addEvent: (sectionId: string, variantId: string, event: Omit<HarmonicEvent, "id" | "variantId" | "order">) => void;
  updateEvent: (sectionId: string, variantId: string, eventId: string, updates: Partial<HarmonicEvent>) => void;
  deleteEvent: (sectionId: string, variantId: string, eventId: string) => void;
  reorderEvents: (sectionId: string, variantId: string, fromIndex: number, toIndex: number) => void;

  // Actions - Playback
  setPlaybackMode: (mode: PlaybackMode) => void;
  setPlaybackPosition: (sectionIndex: number, eventIndex: number) => void;

  // Internal
  _persist: () => void;
}

function updateProject(
  state: SketchpadState,
  projectId: string,
  updater: (project: HarmonicSketchProject) => HarmonicSketchProject
): Partial<SketchpadState> {
  const projects = state.projects.map((p) =>
    p.id === projectId ? updater({ ...p, updatedAt: Date.now() }) : p
  );
  return { projects };
}

function getActiveProject(state: SketchpadState): HarmonicSketchProject | null {
  if (!state.activeProjectId) return null;
  return state.projects.find((p) => p.id === state.activeProjectId) ?? null;
}

export const useSketchpadStore = create<SketchpadState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeSectionId: null,
  playbackMode: "stopped",
  playbackSectionIndex: 0,
  playbackEventIndex: 0,
  isLooping: false,

  loadFromStorage: () => {
    const projects = loadProjects();
    set({ projects });
  },

  createProject: (title, keyRoot = "C", scaleType = "ionian") => {
    const id = uid();
    const project: HarmonicSketchProject = {
      id,
      title,
      description: "",
      globalKeyRoot: keyRoot,
      globalScaleType: scaleType,
      bpm: 120,
      sections: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => {
      const projects = [...state.projects, project];
      saveProjects(projects);
      return { projects, activeProjectId: id, activeSectionId: null };
    });
    return id;
  },

  renameProject: (id, title) => {
    set((state) => {
      const result = updateProject(state, id, (p) => ({ ...p, title }));
      saveProjects(result.projects!);
      return result;
    });
  },

  duplicateProject: (id) => {
    const state = get();
    const source = state.projects.find((p) => p.id === id);
    if (!source) return "";
    const newId = uid();
    const newProject: HarmonicSketchProject = {
      ...JSON.parse(JSON.stringify(source)),
      id: newId,
      title: `${source.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Regenerate IDs for sections, variants, events
    for (const section of newProject.sections) {
      const oldSectionId = section.id;
      section.id = uid();
      section.projectId = newId;
      for (const variant of section.variants) {
        const oldVariantId = variant.id;
        variant.id = uid();
        variant.sectionId = section.id;
        if (section.activeVariantId === oldVariantId) {
          section.activeVariantId = variant.id;
        }
        for (const event of variant.events) {
          event.id = uid();
          event.variantId = variant.id;
        }
      }
    }
    set((state) => {
      const projects = [...state.projects, newProject];
      saveProjects(projects);
      return { projects };
    });
    return newId;
  },

  deleteProject: (id) => {
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id);
      saveProjects(projects);
      const activeProjectId = state.activeProjectId === id ? null : state.activeProjectId;
      return { projects, activeProjectId, activeSectionId: activeProjectId ? state.activeSectionId : null };
    });
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id, activeSectionId: null, playbackMode: "stopped" });
  },

  updateProjectKey: (keyRoot, scaleType) => {
    const state = get();
    if (!state.activeProjectId) return;
    set((state) => {
      const result = updateProject(state, state.activeProjectId!, (p) => ({
        ...p,
        globalKeyRoot: keyRoot,
        globalScaleType: scaleType,
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  updateProjectBpm: (bpm) => {
    const state = get();
    if (!state.activeProjectId) return;
    set((state) => {
      const result = updateProject(state, state.activeProjectId!, (p) => ({ ...p, bpm }));
      saveProjects(result.projects!);
      return result;
    });
  },

  // Sections
  addSection: (sectionType = "Verse") => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    const section = createDefaultSection(
      project.id,
      project.sections.length,
      sectionType,
      project.globalKeyRoot,
      project.globalScaleType
    );
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: [...p.sections, section],
      }));
      saveProjects(result.projects!);
      return { ...result, activeSectionId: section.id };
    });
  },

  addSectionFromProgression: (progression, name) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    const section = createDefaultSection(
      project.id,
      project.sections.length,
      "Custom",
      project.globalKeyRoot,
      project.globalScaleType
    );
    section.name = name;
    
    // Replace the default variant with the progression's chords
    const variantId = section.variants[0].id;
    const events: HarmonicEvent[] = progression.chords.map((c: any, i: number) => {
      let durationBeats = 4;
      if (c.durationClass === "half") durationBeats = 2;
      else if (c.durationClass === "quarter") durationBeats = 1;
      
      return {
        id: uid(),
        variantId,
        order: i,
        chordRoot: c.root as PitchClass,
        chordQuality: c.quality,
        chordSymbol: `${c.root}${c.quality === "maj" ? "" : c.quality === "min" ? "m" : c.quality}`,
        romanNumeral: c.numeral,
        durationBeats,
        inversion: 0,
        notes: c.notes,
        notesWithOctave: c.notesWithOctave || c.notes.map((n: string) => `${n}3`),
        midiNotes: c.midiNotes || []
      };
    });
    
    section.variants[0].events = events;
    // Guess bars based on total beats
    const totalBeats = events.reduce((sum, e) => sum + e.durationBeats, 0);
    section.bars = Math.ceil(totalBeats / 4);

    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: [...p.sections, section],
      }));
      saveProjects(result.projects!);
      return { ...result, activeSectionId: section.id };
    });
  },

  renameSection: (sectionId, name) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  updateSectionType: (sectionId, sectionType) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? { ...s, sectionType, name: sectionType === "Custom" ? s.name : sectionType }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  updateSectionBars: (sectionId, bars) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) => (s.id === sectionId ? { ...s, bars } : s)),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  updateSectionKey: (sectionId, keyRoot, scaleType) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId ? { ...s, keyRoot, scaleType } : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  duplicateSection: (sectionId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    const source = project.sections.find((s) => s.id === sectionId);
    if (!source) return;
    const newSection: HarmonicSection = JSON.parse(JSON.stringify(source));
    newSection.id = uid();
    newSection.name = `${source.name} (Copy)`;
    newSection.order = project.sections.length;
    newSection.createdAt = Date.now();
    // Regenerate variant/event IDs
    for (const variant of newSection.variants) {
      const oldId = variant.id;
      variant.id = uid();
      variant.sectionId = newSection.id;
      if (newSection.activeVariantId === oldId) {
        newSection.activeVariantId = variant.id;
      }
      for (const event of variant.events) {
        event.id = uid();
        event.variantId = variant.id;
      }
    }
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: [...p.sections, newSection],
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  deleteSection: (sectionId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections
          .filter((s) => s.id !== sectionId)
          .map((s, i) => ({ ...s, order: i })),
      }));
      saveProjects(result.projects!);
      const activeSectionId = state.activeSectionId === sectionId ? null : state.activeSectionId;
      return { ...result, activeSectionId };
    });
  },

  reorderSections: (fromIndex, toIndex) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => {
        const sections = [...p.sections];
        const [moved] = sections.splice(fromIndex, 1);
        sections.splice(toIndex, 0, moved);
        return { ...p, sections: sections.map((s, i) => ({ ...s, order: i })) };
      });
      saveProjects(result.projects!);
      return result;
    });
  },

  setActiveSection: (sectionId) => {
    set({ activeSectionId: sectionId });
  },

  // Variants
  addVariant: (sectionId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    const section = project.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const variantNames = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const name = variantNames[section.variants.length] || `Variant ${section.variants.length + 1}`;
    const variant = createDefaultVariant(sectionId, name);
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? { ...s, variants: [...s.variants, variant], activeVariantId: variant.id }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  renameVariant: (sectionId, variantId, name) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                variants: s.variants.map((v) => (v.id === variantId ? { ...v, name } : v)),
              }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  duplicateVariant: (sectionId, variantId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    const section = project.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const source = section.variants.find((v) => v.id === variantId);
    if (!source) return;
    const variantNames = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const name = variantNames[section.variants.length] || `Variant ${section.variants.length + 1}`;
    const newVariant: HarmonicVariant = {
      ...JSON.parse(JSON.stringify(source)),
      id: uid(),
      sectionId,
      name,
      createdAt: Date.now(),
    };
    for (const event of newVariant.events) {
      event.id = uid();
      event.variantId = newVariant.id;
    }
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? { ...s, variants: [...s.variants, newVariant], activeVariantId: newVariant.id }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  deleteVariant: (sectionId, variantId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    const section = project.sections.find((s) => s.id === sectionId);
    if (!section || section.variants.length <= 1) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) => {
          if (s.id !== sectionId) return s;
          const variants = s.variants.filter((v) => v.id !== variantId);
          const activeVariantId =
            s.activeVariantId === variantId ? variants[0]?.id ?? "" : s.activeVariantId;
          return { ...s, variants, activeVariantId };
        }),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  setActiveVariant: (sectionId, variantId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId ? { ...s, activeVariantId: variantId } : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  // Events
  addEvent: (sectionId, variantId, eventData) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                variants: s.variants.map((v) => {
                  if (v.id !== variantId) return v;
                  const event: HarmonicEvent = {
                    ...eventData,
                    id: uid(),
                    variantId,
                    order: v.events.length,
                  };
                  return { ...v, events: [...v.events, event] };
                }),
              }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  updateEvent: (sectionId, variantId, eventId, updates) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                variants: s.variants.map((v) =>
                  v.id === variantId
                    ? {
                        ...v,
                        events: v.events.map((e) =>
                          e.id === eventId ? { ...e, ...updates } : e
                        ),
                      }
                    : v
                ),
              }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  deleteEvent: (sectionId, variantId, eventId) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                variants: s.variants.map((v) =>
                  v.id === variantId
                    ? {
                        ...v,
                        events: v.events
                          .filter((e) => e.id !== eventId)
                          .map((e, i) => ({ ...e, order: i })),
                      }
                    : v
                ),
              }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  reorderEvents: (sectionId, variantId, fromIndex, toIndex) => {
    const state = get();
    const project = getActiveProject(state);
    if (!project) return;
    set((state) => {
      const result = updateProject(state, project.id, (p) => ({
        ...p,
        sections: p.sections.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                variants: s.variants.map((v) => {
                  if (v.id !== variantId) return v;
                  const events = [...v.events];
                  const [moved] = events.splice(fromIndex, 1);
                  events.splice(toIndex, 0, moved);
                  return { ...v, events: events.map((e, i) => ({ ...e, order: i })) };
                }),
              }
            : s
        ),
      }));
      saveProjects(result.projects!);
      return result;
    });
  },

  // Playback
  setPlaybackMode: (mode) => {
    set({ playbackMode: mode });
  },

  setPlaybackPosition: (sectionIndex, eventIndex) => {
    set({ playbackSectionIndex: sectionIndex, playbackEventIndex: eventIndex });
  },

  _persist: () => {
    saveProjects(get().projects);
  },
}));
