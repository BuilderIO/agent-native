import { useActionMutation, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconCut } from "@tabler/icons-react";
import { toast } from "sonner";

export interface SplitButtonProps {
  recordingId: string;
  playheadMs: number;
  disabled?: boolean;
}

/** Adds a split marker at the current playhead. Part of the editor toolbar. */
export function SplitButton({
  recordingId,
  playheadMs,
  disabled,
}: SplitButtonProps) {
  const t = useT();
  const split = useActionMutation("split-recording");

  const handleClick = async () => {
    try {
      await split.mutateAsync({
        recordingId,
        atMs: Math.round(playheadMs),
      });
      toast.success(t("editorToolbar.splitAdded"));
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? t("editorToolbar.splitFailed"));
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleClick}
          disabled={disabled || split.isPending}
        >
          <IconCut className="w-4 h-4 mr-1" />
          {t("editorLayout.split")}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("clipsFinalRaw.splitAtPlayhead")}</TooltipContent>
    </Tooltip>
  );
}
