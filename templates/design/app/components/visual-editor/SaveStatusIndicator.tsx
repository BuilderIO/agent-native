import { useT } from "@agent-native/core/client/i18n";
import { IconCloudExclamation, IconCloudOff } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  offline?: boolean;
  /** Edits the server has not accepted yet; each is retried automatically. */
  unsavedChangeCount?: number;
  onRetry?: () => void;
  className?: string;
}

export function SaveStatusIndicator({
  offline,
  unsavedChangeCount = 0,
  onRetry,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  if (offline) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-save-status="offline"
            className={cn(
              "flex items-center gap-1 !text-[11px] text-amber-500",
              className,
            )}
          >
            <IconCloudOff className="w-3 h-3" />
            <span className="hidden sm:inline">
              {t("visualEditor.offline")}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {t("visualEditor.changesSaveWhenReconnected")}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (unsavedChangeCount > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-save-status="unsaved"
            aria-label={t("visualEditor.saveRetrying")}
            onClick={onRetry}
            className={cn(
              "flex items-center gap-1 rounded-md px-1 !text-[11px] text-amber-500 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <IconCloudExclamation className="w-3 h-3" />
            <span className="hidden sm:inline">
              {t("visualEditor.unsaved")}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.saveRetrying")}</TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
