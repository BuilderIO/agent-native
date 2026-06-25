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
  if (offline) {
    return (
      <div
        data-save-status="offline"
        title="Changes will save when reconnected"
        className={cn(
          "flex items-center gap-1 text-[11px] text-amber-500",
          className,
        )}
      >
        <IconCloudOff className="w-3 h-3" />
        <span className="hidden sm:inline">Offline</span>
      </div>
    );
  }

  return null;
}
