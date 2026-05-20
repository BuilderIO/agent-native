import { useCallback, useState } from "react";
import { toast } from "sonner";
import { IconDots, IconTrash } from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DeleteRecordingMenuProps {
  recordingId: string;
  onDeleted?: () => void;
}

export function DeleteRecordingMenu({
  recordingId,
  onDeleted,
}: DeleteRecordingMenuProps) {
  const [open, setOpen] = useState(false);
  const trashRecording = useActionMutation<any, { id: string }>(
    "trash-recording",
    {
      onSuccess: () => {
        toast.success("Clip moved to trash");
        setOpen(false);
        onDeleted?.();
      },
      onError: (err: any) =>
        toast.error(err?.message ?? "Failed to delete clip"),
    },
  );

  const handleTrashRecording = useCallback(() => {
    if (trashRecording.isPending) return;
    trashRecording.mutate({ id: recordingId });
  }, [recordingId, trashRecording]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!trashRecording.isPending) setOpen(nextOpen);
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Clip options"
          >
            <IconDots className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
            className="text-destructive focus:text-destructive"
          >
            <IconTrash className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move this clip to trash?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the clip from your library. You can restore it from
            Trash or delete it forever later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={trashRecording.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={trashRecording.isPending}
            onClick={(event) => {
              event.preventDefault();
              handleTrashRecording();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {trashRecording.isPending ? "Deleting..." : "Move to trash"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
