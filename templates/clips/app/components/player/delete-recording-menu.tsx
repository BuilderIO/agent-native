import { useActionMutation, useT } from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { IconDots, IconDownload, IconTrash } from "@tabler/icons-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

interface DeleteRecordingMenuProps {
  recordingId: string;
  onDeleted?: () => void;
}

interface RecordingOptionsMenuProps extends DeleteRecordingMenuProps {
  canDelete?: boolean;
  canDownload?: boolean;
  downloadPending?: boolean;
  downloadLabel?: string;
  downloadingLabel?: string;
  onDownload?: () => void;
}

export function RecordingOptionsMenu({
  recordingId,
  onDeleted,
  canDelete = true,
  canDownload = false,
  downloadPending = false,
  downloadLabel,
  downloadingLabel,
  onDownload,
}: RecordingOptionsMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const showDownload = canDownload && Boolean(onDownload);
  const showDelete = canDelete;
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

  if (!showDownload && !showDelete) return null;

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
          {showDownload ? (
            <DropdownMenuItem
              onSelect={() => onDownload?.()}
              disabled={downloadPending}
            >
              <IconDownload className="me-2 h-4 w-4" />
              {downloadPending
                ? (downloadingLabel ?? t("sharePage.downloading"))
                : (downloadLabel ?? t("sharePage.downloadMp4"))}
            </DropdownMenuItem>
          ) : null}
          {showDownload && showDelete ? <DropdownMenuSeparator /> : null}
          {showDelete ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setOpen(true);
              }}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash className="me-2 h-4 w-4" />
              {t("deleteRecordingMenu.delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {showDelete ? (
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
      ) : null}
    </AlertDialog>
  );
}

export function DeleteRecordingMenu(props: DeleteRecordingMenuProps) {
  return <RecordingOptionsMenu {...props} canDelete />;
}
