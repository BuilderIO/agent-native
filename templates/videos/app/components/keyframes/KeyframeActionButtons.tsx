import { useT } from "@agent-native/core/client";
import { IconCopy, IconRotate, IconTrash } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Button } from "../ui/button";

interface KeyframeActionButtonsProps {
  isOnKeyframe: boolean;
  onDuplicate: () => void;
  onReset: () => void;
  onRemove: () => void;
  resetTooltip?: string;
}

export function KeyframeActionButtons({
  isOnKeyframe,
  onDuplicate,
  onReset,
  onRemove,
  resetTooltip,
}: KeyframeActionButtonsProps) {
  const t = useT();
  const resetLabel = resetTooltip ?? t("raw.keyframes.resetDefaults");

  if (!isOnKeyframe) return null;

  return (
    <div className="flex gap-2 pt-2 border-t border-border/50">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicate}
            className="text-xs border-muted-foreground/30 hover:bg-secondary/50"
            aria-label={t("raw.keyframes.duplicateAhead")}
          >
            <IconCopy className="w-3 h-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("raw.keyframes.duplicateAhead")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30"
            aria-label={resetLabel}
          >
            <IconRotate className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{resetLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            className="text-destructive/80 border-destructive/30 hover:bg-destructive/10 text-xs ml-auto"
            aria-label={t("raw.keyframes.remove")}
          >
            <IconTrash className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("raw.keyframes.remove")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
