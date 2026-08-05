import { useActionMutation } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SpaceDialogsProps {
  renameSpaceId: string | null;
  renameSpaceName: string;
  setRenameSpaceId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
  deleteSpaceId: string | null;
  deleteSpaceName: string;
  setDeleteSpaceId: (id: string | null) => void;
  onMutationSuccess?: (deletedSpaceId?: string) => void;
}

export function SpaceDialogs({
  renameSpaceId,
  renameSpaceName,
  setRenameSpaceId,
  renameValue,
  setRenameValue,
  deleteSpaceId,
  deleteSpaceName,
  setDeleteSpaceId,
  onMutationSuccess,
}: SpaceDialogsProps) {
  const renameSpace = useActionMutation("rename-space");
  const deleteSpace = useActionMutation("delete-space");

  const handleRename = async () => {
    if (!renameSpaceId) return;
    try {
      await renameSpace.mutateAsync({
        id: renameSpaceId,
        name: renameValue.trim(),
      });
      toast.success("Space renamed");
      setRenameSpaceId(null);
      setRenameValue("");
      onMutationSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename space",
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteSpaceId) return;
    try {
      await deleteSpace.mutateAsync({ id: deleteSpaceId });
      toast.success(`Deleted "${deleteSpaceName}"`);
      setDeleteSpaceId(null);
      onMutationSuccess?.(deleteSpaceId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete space",
      );
    }
  };

  return (
    <>
      {/* Rename space dialog */}
      <AlertDialog
        open={renameSpaceId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameSpaceId(null);
            setRenameValue("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Rename space</AlertDialogTitle>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRename}
              disabled={renameSpace.isPending || !renameValue.trim()}
            >
              {renameSpace.isPending ? "Renaming..." : "Rename"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete space dialog */}
      <AlertDialog
        open={deleteSpaceId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSpaceId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete "{deleteSpaceName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete the space and remove it from all recordings. This
            action cannot be undone.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteSpace.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSpace.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
