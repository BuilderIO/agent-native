import { useEffect, useState } from "react";
import { IconCheck, IconLoader2, IconCloudOff } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  /**
   * True while a save is in flight or pending (debounced).
   * The indicator transitions: idle → saving → saved (briefly) → idle.
   */
  saving: boolean;
  /** True when offline / save errored. Shows the warning state. */
  offline?: boolean;
  className?: string;
}

/**
 * "All changes saved" / "Saving…" / "Offline" indicator.
 *
 * Why this exists: Rochkind reported losing a full deck because there was no
 * clear save indicator. The agent-native slides debounced save (DeckContext.tsx
 * line 135) is invisible — users had no signal that work was committed. This
 * surfaces it.
 *
 * The "Saved" state lingers for ~1.5s after `saving` flips back to false so
 * users notice the confirmation; otherwise the UI would flash and look idle.
 */
export function SaveStatusIndicator({
  saving,
  offline,
  className,
}: SaveStatusIndicatorProps) {
  const [showSaved, setShowSaved] = useState(false);
  const [wasSaving, setWasSaving] = useState(false);

  useEffect(() => {
    if (saving) {
      setWasSaving(true);
      setShowSaved(false);
      return;
    }
    if (wasSaving) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 1500);
      return () => clearTimeout(t);
    }
  }, [saving, wasSaving]);

  // The text labels (Saved / Saving… / Offline) used to render alongside the
  // icon, but in the deck-editor toolbar that wrapped vertically at narrower
  // widths because the flex container had to shrink each child. Keep the icon
  // only — the tooltip on hover still describes the state — and only restore
  // the label on truly wide screens (xl+).
  if (offline) {
    return (
      <div
        data-save-status="offline"
        title="Changes will save when reconnected"
        className={cn(
          "flex items-center gap-1 text-[11px] text-amber-500 whitespace-nowrap",
          className,
        )}
      >
        <IconCloudOff className="w-3 h-3" />
        <span className="hidden xl:inline">Offline</span>
      </div>
    );
  }

  if (saving) {
    return (
      <div
        data-save-status="saving"
        title="Saving your changes…"
        className={cn(
          "flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap",
          className,
        )}
      >
        <IconLoader2 className="w-3 h-3 animate-spin" />
        <span className="hidden xl:inline">Saving…</span>
      </div>
    );
  }

  if (showSaved) {
    return (
      <div
        data-save-status="saved"
        title="All changes saved"
        className={cn(
          "flex items-center gap-1 text-[11px] text-emerald-500 whitespace-nowrap",
          className,
        )}
      >
        <IconCheck className="w-3 h-3" />
        <span className="hidden xl:inline">Saved</span>
      </div>
    );
  }

  return (
    <div
      data-save-status="idle"
      title="All changes saved"
      className={cn(
        "flex items-center gap-1 text-[11px] text-muted-foreground/60 whitespace-nowrap",
        className,
      )}
    >
      <IconCheck className="w-3 h-3" />
      <span className="hidden xl:inline">Saved</span>
    </div>
  );
}
