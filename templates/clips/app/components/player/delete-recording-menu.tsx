import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArchive,
  IconArchiveOff,
  IconDots,
  IconDownload,
  IconGif,
  IconTrash,
} from "@tabler/icons-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  canDownloadGif?: boolean;
  gifPending?: boolean;
  onDownloadGif?: () => void;
  canArchive?: boolean;
  isArchived?: boolean;
  onArchiveChanged?: () => void;
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
  canDownloadGif = false,
  gifPending = false,
  onDownloadGif,
  canArchive = false,
  isArchived = false,
  onArchiveChanged,
}: RecordingOptionsMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showDownload = canDownload && Boolean(onDownload);
  const showDownloadGif = canDownloadGif && Boolean(onDownloadGif);
  const showArchive = canArchive;
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

  const archiveRecording = useActionMutation<any, { id: string }>(
    "archive-recording",
    {
      onSuccess: () => {
        toast.success(t("deleteRecordingMenu.archived"));
        onArchiveChanged?.();
      },
      onError: (err: any) =>
        toast.error(err?.message ?? t("deleteRecordingMenu.archiveFailed")),
    },
  );
  const restoreRecording = useActionMutation<any, { id: string }>(
    "restore-recording",
    {
      onSuccess: () => {
        toast.success(t("deleteRecordingMenu.restoredFromArchive"));
        onArchiveChanged?.();
      },
      onError: (err: any) =>
        toast.error(err?.message ?? t("deleteRecordingMenu.unarchiveFailed")),
    },
  );
  const archivePending =
    archiveRecording.isPending || restoreRecording.isPending;

  const handleDownload = useCallback(() => {
    setMenuOpen(false);
    onDownload?.();
  }, [onDownload]);

  const handleDownloadGif = useCallback(() => {
    setMenuOpen(false);
    onDownloadGif?.();
  }, [onDownloadGif]);

  const handleArchive = useCallback(() => {
    if (archivePending) return;
    setMenuOpen(false);
    if (isArchived) restoreRecording.mutate({ id: recordingId });
    else archiveRecording.mutate({ id: recordingId });
  }, [
    archivePending,
    archiveRecording,
    isArchived,
    recordingId,
    restoreRecording,
  ]);

  if (!showDownload && !showDownloadGif && !showArchive && !showDelete) {
    return null;
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!trashRecording.isPending) setOpen(nextOpen);
      }}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
              onSelect={handleDownload}
              disabled={downloadPending}
            >
              <IconDownload className="me-2 h-4 w-4" />
              {downloadPending
                ? (downloadingLabel ?? t("sharePage.downloading"))
                : (downloadLabel ?? t("recordRoute.downloadRecording"))}
            </DropdownMenuItem>
          ) : null}
          {showDownloadGif ? (
            <DropdownMenuItem
              onSelect={handleDownloadGif}
              disabled={gifPending}
            >
              <IconGif className="me-2 h-4 w-4" />
              {gifPending
                ? t("deleteRecordingMenu.buildingGif")
                : t("deleteRecordingMenu.downloadAsGif")}
            </DropdownMenuItem>
          ) : null}
          {showArchive ? (
            <DropdownMenuItem
              onSelect={handleArchive}
              disabled={archivePending}
            >
              {isArchived ? (
                <IconArchiveOff className="me-2 h-4 w-4" />
              ) : (
                <IconArchive className="me-2 h-4 w-4" />
              )}
              {isArchived
                ? t("deleteRecordingMenu.unarchive")
                : t("deleteRecordingMenu.archive")}
            </DropdownMenuItem>
          ) : null}
          {(showDownload || showDownloadGif || showArchive) && showDelete ? (
            <DropdownMenuSeparator />
          ) : null}
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
