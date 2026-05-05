import { Button } from "../ui/button";
import { IconCopy, IconRotate, IconTrash } from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  resetTooltip = "Reset to defaults",
}: KeyframeActionButtonsProps) {
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
            aria-label="Duplicate keyframe +30 frames ahead"
          >
            <IconCopy className="w-3 h-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Duplicate keyframe +30 frames ahead</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30"
            aria-label={resetTooltip}
          >
            <IconRotate className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{resetTooltip}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            className="text-destructive/80 border-destructive/30 hover:bg-destructive/10 text-xs ml-auto"
            aria-label="Remove keyframe"
          >
            <IconTrash className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove keyframe</TooltipContent>
      </Tooltip>
    </div>
  );
}
