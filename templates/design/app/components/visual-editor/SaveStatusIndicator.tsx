import { useT } from "@agent-native/core/client/i18n";
import { IconCloudOff } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  saving: boolean;
  offline?: boolean;
  className?: string;
}

export function SaveStatusIndicator({
  saving: _saving,
  offline,
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

  return null;
}
