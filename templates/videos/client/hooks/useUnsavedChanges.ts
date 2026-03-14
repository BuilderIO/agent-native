import { useState, useEffect } from "react";
import { useComposition } from "@/contexts/CompositionContext";
import { useTimeline } from "@/contexts/TimelineContext";

/**
 * Detects if there are unsaved changes in localStorage that differ from registry.
 * Returns true if localStorage has overrides (meaning Save button should be green).
 */
export function useUnsavedChanges(): boolean {
  const { compositionId } = useComposition();
  const { tracks } = useTimeline();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!compositionId || compositionId === "new") {
      setHasUnsavedChanges(false);
      return;
    }

    const tracksKey = `videos-tracks:${compositionId}`;
    const propsKey = `videos-props:${compositionId}`;
    const settingsKey = `videos-comp-settings:${compositionId}`;

    // Check if any localStorage keys exist for this composition
    const hasOverrides =
      !!localStorage.getItem(tracksKey) ||
      !!localStorage.getItem(propsKey) ||
      !!localStorage.getItem(settingsKey);

    setHasUnsavedChanges(hasOverrides);

    // Listen for storage changes (from other tabs or direct edits)
    const handleStorageChange = () => {
      const newHasOverrides =
        !!localStorage.getItem(tracksKey) ||
        !!localStorage.getItem(propsKey) ||
        !!localStorage.getItem(settingsKey);

      setHasUnsavedChanges(newHasOverrides);
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [compositionId, tracks]); // Re-check when tracks change

  return hasUnsavedChanges;
}
