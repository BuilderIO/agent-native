import { useActionMutation, useT } from "@agent-native/core/client";
import { IconDots, IconTrash } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const trashRecording = useActionMutation<any, { id: string }>(
    "trash-recording",
    {
      onSuccess: () => {
        toast.success(t("deleteRecordingMenu.movedToTrash"));
        setOpen(false);
        onDeleted?.();
      },
      onError: (err: any) =>
        toast.error(err?.message ?? t("deleteRecordingMenu.deleteFailed")),
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
            aria-label={t("deleteRecordingMenu.clipOptions")}
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
            {t("deleteRecordingMenu.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("deleteRecordingMenu.moveTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteRecordingMenu.moveDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={trashRecording.isPending}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={trashRecording.isPending}
            onClick={(event) => {
              event.preventDefault();
              handleTrashRecording();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {trashRecording.isPending
              ? t("deleteRecordingMenu.deleting")
              : t("deleteRecordingMenu.moveToTrash")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
