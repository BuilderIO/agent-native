import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDots, IconDownload, IconTrash } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const deletedWhileOpenRef = useRef(false);
  const pendingDeleteConfirmRef = useRef(false);
  const showDownload = canDownload && Boolean(onDownload);
  const showDelete = canDelete;
  const trashRecording = useActionMutation<any, { id: string }>(
    "trash-recording",
    {
      onSuccess: () => {
        toast.success(t("deleteRecordingMenu.movedToTrash"));
        // Keep the route mounted until Radix has finished removing the
        // dialog portal. Navigating in the mutation callback can leave its
        // body lock behind, which makes the destination look unclickable.
        deletedWhileOpenRef.current = true;
        setOpen(false);
      },
      onError: (err: any) =>
        toast.error(err?.message ?? t("deleteRecordingMenu.deleteFailed")),
    },
  );

  const handleTrashRecording = useCallback(() => {
    if (trashRecording.isPending) return;
    trashRecording.mutate({ id: recordingId });
  }, [recordingId, trashRecording]);

  const handleDownload = useCallback(() => {
    setMenuOpen(false);
    onDownload?.();
  }, [onDownload]);

  if (!showDownload && !showDelete) return null;

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
        <DropdownMenuContent
          align="end"
          className="w-44"
          onCloseAutoFocus={(event) => {
            // Opening the AlertDialog while this menu is still tearing down
            // leaves `pointer-events: none` stuck on <body>: two dismissable
            // layers overlap and the survivor never restores the style. Wait
            // for the menu to finish closing, and keep focus off the trigger
            // so the dialog owns it.
            if (pendingDeleteConfirmRef.current) {
              event.preventDefault();
              pendingDeleteConfirmRef.current = false;
              setOpen(true);
            }
          }}
        >
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
          {showDownload && showDelete ? <DropdownMenuSeparator /> : null}
          {showDelete ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                pendingDeleteConfirmRef.current = true;
                setMenuOpen(false);
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
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            setTimeout(() => {
              if (!deletedWhileOpenRef.current) return;
              deletedWhileOpenRef.current = false;
              event.preventDefault();
            }, 0);
            onDeleted?.();
          }}
        >
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
