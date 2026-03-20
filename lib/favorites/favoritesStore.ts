import { create } from "zustand";
import type { Progression } from "../theory/progressionTypes";

export interface SavedProgression {
  id: string;
  name: string;
  progression: Progression;
  rootKey: string;
  mode: string;
  complexity: number;
  bpm: number;
  savedAt: number;
}

interface FavoritesState {
  favorites: SavedProgression[];
  addFavorite: (entry: Omit<SavedProgression, "id" | "savedAt">) => void;
  removeFavorite: (id: string) => void;
  renameFavorite: (id: string, name: string) => void;
}

const STORAGE_KEY = "harmonia-favorite-progressions";

function loadFavorites(): SavedProgression[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: SavedProgression[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // localStorage full or unavailable
  }
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: loadFavorites(),

  addFavorite: (entry) => {
    const saved: SavedProgression = {
      ...entry,
      id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
    };
    const updated = [saved, ...get().favorites];
    saveFavorites(updated);
    set({ favorites: updated });
  },

  removeFavorite: (id) => {
    const updated = get().favorites.filter((f) => f.id !== id);
    saveFavorites(updated);
    set({ favorites: updated });
  },

  renameFavorite: (id, name) => {
    const updated = get().favorites.map((f) =>
      f.id === id ? { ...f, name } : f
    );
    saveFavorites(updated);
    set({ favorites: updated });
  },
}));
