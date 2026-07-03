import { useT } from "@agent-native/core/client";
import { IconCheck, IconCloudOff, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  /** True while a save is in flight or pending (debounced). */
  saving: boolean;
  /** True when offline / save errored. Shows the warning state. */
  offline?: boolean;
  className?: string;
}

/** How long the "Saved" confirmation lingers after a save settles. */
const SAVED_LINGER_MS = 2000;

export function SaveStatusIndicator({
  saving,
  offline,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();

  // Show a brief "Saved" confirmation for a moment after `saving` flips false,
  // but only if we were actually saving (avoid a spurious "Saved" on mount).
  const [showSaved, setShowSaved] = useState(false);
  const wasSavingRef = useRef(false);

  useEffect(() => {
    if (saving) {
      wasSavingRef.current = true;
      setShowSaved(false);
      return;
    }
    if (!wasSavingRef.current) return;
    wasSavingRef.current = false;
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), SAVED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [saving]);

  // Offline takes precedence — it's the actionable state.
  if (offline) {
    return (
      <div
        data-save-status="offline"
        title={t("raw.saveReconnect")}
        className={cn(
          "flex items-center gap-1 text-[11px] text-amber-500 whitespace-nowrap",
          className,
        )}
      >
        <IconCloudOff className="w-3 h-3" />
        <span className="hidden xl:inline">{t("raw.offline")}</span>
      </div>
    );
  }

  if (saving) {
    return (
      <div
        data-save-status="saving"
        title={t("raw.saving")}
        className={cn(
          "flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap",
          className,
        )}
      >
        <IconLoader2 className="w-3 h-3 animate-spin" />
        <span className="hidden xl:inline">{t("raw.saving")}</span>
      </div>
    );
  }

  if (showSaved) {
    return (
      <div
        data-save-status="saved"
        title={t("raw.saved")}
        className={cn(
          "flex items-center gap-1 text-[11px] text-muted-foreground/70 whitespace-nowrap",
          className,
        )}
      >
        <IconCheck className="w-3 h-3" />
        <span className="hidden xl:inline">{t("raw.saved")}</span>
      </div>
    );
  }

  return null;
}
