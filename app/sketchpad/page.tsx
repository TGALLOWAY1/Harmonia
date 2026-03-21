import { useEffect, useMemo, useState } from "react";
import * as Tone from "tone";
import Link from "next/link";
import { Music, ArrowLeft, Heart, Trash2, Import } from "lucide-react";
import { useSketchpadStore } from "@/lib/sketchpad/store";
import { useFavoritesStore } from "@/lib/favorites/favoritesStore";
import { SketchpadProjectList } from "@/components/sketchpad/ProjectList";
import { SketchpadWorkspace } from "@/components/sketchpad/Workspace";

export default function SketchpadPage() {
  const {
    projects,
    activeProjectId,
    loadFromStorage,
    setActiveProject,
    addSectionFromProgression,
  } = useSketchpadStore();

  const { favorites, removeFavorite } = useFavoritesStore();
  const [loaded, setLoaded] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);

  useEffect(() => {
    loadFromStorage();
    setLoaded(true);
  }, [loadFromStorage]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  if (!loaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden relative">
      {/* Header */}
      <header className="border-b border-border-subtle bg-surface/80 backdrop-blur-md flex-shrink-0 z-50 relative">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="w-px h-5 bg-border-subtle" />
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-accent" />
              <h1 className="text-sm font-semibold tracking-tight">Harmonia</h1>
            </div>
            <span className="text-xs text-muted">Harmonic Sketchpad</span>
          </div>
          <div className="flex items-center gap-3">
            {activeProject && (
              <div className="text-sm text-muted mr-3">
                {activeProject.title}
              </div>
            )}
            
            <div className="relative">
              <button
                onClick={() => setShowFavorites(!showFavorites)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  showFavorites ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground hover:bg-surface-muted"
                }`}
              >
                <Heart className={`w-4 h-4 ${favorites.length > 0 ? "fill-current" : ""}`} />
                Favorites {favorites.length > 0 && `(${favorites.length})`}
              </button>

              {/* Favorites Dropdown */}
              {showFavorites && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border-subtle rounded-xl shadow-xl z-50 p-3 flex flex-col max-h-[400px]">
                  <h3 className="text-sm font-semibold mb-3">Saved Progressions</h3>
                  {favorites.length === 0 ? (
                    <p className="text-xs text-muted py-4 text-center">
                      No favorites yet. Save a progression on the main page to see it here.
                    </p>
                  ) : (
                    <div className="flex-1 overflow-y-auto pr-1 space-y-2 no-scrollbar">
                      {favorites.map((fav) => (
                        <div
                          key={fav.id}
                          className="flex items-center justify-between p-2 rounded-lg border border-border-subtle bg-surface-muted/50 hover:bg-surface-muted transition-colors group"
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="text-xs font-medium truncate">{fav.name}</div>
                            <div className="text-[10px] text-muted truncate">
                              {fav.rootKey} {fav.mode} · {fav.progression.chords.length} chords
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (activeProject) {
                                  addSectionFromProgression(fav.progression, fav.name);
                                  setShowFavorites(false);
                                } else {
                                  alert("Please open or create a project first to import a progression.");
                                }
                              }}
                              className={`p-1.5 rounded transition-colors ${
                                activeProject 
                                  ? "text-accent bg-accent/10 hover:bg-accent/20" 
                                  : "text-muted/50 bg-surface-muted cursor-not-allowed"
                              }`}
                              title={activeProject ? "Import as new section" : "Open a project first"}
                            >
                              <Import className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => removeFavorite(fav.id)}
                              className="p-1.5 rounded text-muted/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Remove from favorites"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {activeProject ? (
          <SketchpadWorkspace project={activeProject} />
        ) : (
          <SketchpadProjectList
            projects={projects}
            onSelectProject={setActiveProject}
          />
        )}
      </div>
    </div>
  );
}
