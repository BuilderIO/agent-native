import { Button } from "../ui/button";
import { Copy, RotateCcw, Trash2 } from "lucide-react";

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
  resetTooltip = "Reset to defaults"
}: KeyframeActionButtonsProps) {
  if (!isOnKeyframe) return null;

  return (
    <div className="flex gap-2 pt-2 border-t border-border/50">
      <Button
        variant="outline"
        size="sm"
        onClick={onDuplicate}
        className="text-xs border-muted-foreground/30 hover:bg-secondary/50"
        title="Duplicate keyframe +30 frames ahead"
      >
        <Copy className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        className="text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30"
        title={resetTooltip}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onRemove}
        className="text-destructive/80 border-destructive/30 hover:bg-destructive/10 text-xs ml-auto"
        title="Remove keyframe"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
