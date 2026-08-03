import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_EDITOR_PREFERENCES,
  DESIGN_EDITOR_PREFERENCES_STORAGE_KEY,
  parseEditorPreferences,
  serializeEditorPreferences,
  type DesignEditorPreferences,
} from "@/pages/design-editor/editor-preferences";

function readStoredPreferences(): DesignEditorPreferences {
  if (typeof window === "undefined") return DEFAULT_EDITOR_PREFERENCES;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(DESIGN_EDITOR_PREFERENCES_STORAGE_KEY);
  } catch {
    return DEFAULT_EDITOR_PREFERENCES;
  }
  const result = parseEditorPreferences(raw);
  if (result.status === "invalid") {
    console.warn(
      `[design] discarding corrupt editor preferences: ${result.reason}`,
    );
    try {
      window.localStorage.removeItem(DESIGN_EDITOR_PREFERENCES_STORAGE_KEY);
    } catch (error) {
      console.warn("[design] could not clear editor preferences", error);
    }
  }
  return result.preferences;
}

export interface UseEditorPreferences {
  preferences: DesignEditorPreferences;
  setPreferences: (next: DesignEditorPreferences) => void;
}

/** Editor-chrome preferences (nudge amounts today) live in localStorage, not
 * SQL: they are per-device input tuning, and a shared design opened by a
 * collaborator must keep that collaborator's own nudge amounts. */
export function useEditorPreferences(): UseEditorPreferences {
  const [preferences, setPreferencesState] = useState<DesignEditorPreferences>(
    DEFAULT_EDITOR_PREFERENCES,
  );

  useEffect(() => {
    setPreferencesState(readStoredPreferences());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DESIGN_EDITOR_PREFERENCES_STORAGE_KEY) return;
      setPreferencesState(readStoredPreferences());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreferences = useCallback((next: DesignEditorPreferences) => {
    const serialized = serializeEditorPreferences(next);
    setPreferencesState(parseEditorPreferences(serialized).preferences);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        DESIGN_EDITOR_PREFERENCES_STORAGE_KEY,
        serialized,
      );
    } catch (error) {
      console.warn("[design] could not persist editor preferences", error);
    }
  }, []);

  return { preferences, setPreferences };
}
