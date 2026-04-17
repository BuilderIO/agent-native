import { IconCut } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useActionMutation } from "@agent-native/core/client";
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
  const split = useActionMutation("split-recording" as any);

  const handleClick = async () => {
    try {
      await split.mutateAsync({
        recordingId,
        atMs: Math.round(playheadMs),
      } as any);
      toast.success("Split added");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Failed to add split");
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      disabled={disabled || split.isPending}
      title="Split at playhead (S)"
    >
      <IconCut className="w-4 h-4 mr-1" />
      Split
    </Button>
  );
}
