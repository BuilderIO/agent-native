import { useState, useEffect } from "react";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { useComposition } from "@/contexts/CompositionContext";
import { Button } from "@/components/ui/button";

/**
 * Visual indicator that appears when localStorage has user overrides.
 * Shows a badge in the UI so users know they're not seeing the registry defaults.
 */
export function LocalStorageIndicator() {
  const { compositionId, selected } = useComposition();
  const [hasOverrides, setHasOverrides] = useState(false);
  const [overrideTypes, setOverrideTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!compositionId || compositionId === "new") {
      setHasOverrides(false);
      return;
    }

    const tracksKey = `videos-tracks:${compositionId}`;
    const propsKey = `videos-props:${compositionId}`;
    const settingsKey = `videos-comp-settings:${compositionId}`;

    const types: string[] = [];

    if (localStorage.getItem(tracksKey)) {
      types.push("tracks");
    }
    if (localStorage.getItem(propsKey)) {
      types.push("props");
    }
    if (localStorage.getItem(settingsKey)) {
      types.push("settings");
    }

    setHasOverrides(types.length > 0);
    setOverrideTypes(types);
  }, [compositionId]);

  if (!hasOverrides) return null;

  const handleReset = () => {
    if (!compositionId) return;

    const confirmed = window.confirm(
      `Reset "${selected?.title}" to registry defaults?\n\n` +
        `This will clear your local changes to: ${overrideTypes.join(", ")}\n\n` +
        `The page will reload automatically.`,
    );

    if (!confirmed) return;

    localStorage.removeItem(`videos-tracks:${compositionId}`);
    localStorage.removeItem(`videos-props:${compositionId}`);
    localStorage.removeItem(`videos-comp-settings:${compositionId}`);
    localStorage.removeItem(`videos-tracks-version:${compositionId}`);

    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
      <IconAlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-amber-200/90 font-medium">
          Using local overrides
        </p>
        <p className="text-[10px] text-amber-200/60">
          {overrideTypes.join(", ")} modified
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleReset}
        className="h-6 px-2 text-xs text-amber-200 hover:text-amber-100 hover:bg-amber-500/20"
      >
        <IconRefresh className="w-3 h-3 mr-1" />
        Reset
      </Button>
    </div>
  );
}
