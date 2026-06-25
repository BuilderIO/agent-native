import { useActionMutation } from "@agent-native/core/client";
import { IconDots, IconDownload, IconTrash } from "@tabler/icons-react";
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
  /** Whether to show the Delete item. Defaults to true. */
  canDelete?: boolean;
  /** Whether to show the Download item. Requires `videoUrl`. */
  canDownload?: boolean;
  videoUrl?: string | null;
  recordingTitle?: string | null;
  videoFormat?: string | null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "clip";
}

export function DeleteRecordingMenu({
  recordingId,
  onDeleted,
  canDelete = true,
  canDownload = false,
  videoUrl,
  recordingTitle,
  videoFormat,
}: DeleteRecordingMenuProps) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
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

  const handleDownload = useCallback(async () => {
    if (!videoUrl || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(recordingTitle ?? "clip")}.${videoFormat ?? "mp4"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Cross-origin URLs that block fetch still open in a new tab so the
      // viewer can save the file from there.
      window.open(videoUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }, [videoUrl, recordingTitle, videoFormat, downloading]);

  const showDownload = canDownload && Boolean(videoUrl);

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
          {showDownload ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void handleDownload();
              }}
              disabled={downloading}
            >
              <IconDownload className="mr-2 h-4 w-4" />
              {downloading ? "Downloading…" : "Download video"}
            </DropdownMenuItem>
          ) : null}
          {showDownload && canDelete ? <DropdownMenuSeparator /> : null}
          {canDelete ? (
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
          ) : null}
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
