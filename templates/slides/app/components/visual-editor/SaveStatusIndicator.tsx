import { useT } from "@agent-native/core/client";
import { IconCloudOff } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  /** True while a save is in flight or pending (debounced). */
  saving: boolean;
  /** True when offline / save errored. Shows the warning state. */
  offline?: boolean;
  className?: string;
}

export function SaveStatusIndicator({
  offline,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
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

  return null;
}
