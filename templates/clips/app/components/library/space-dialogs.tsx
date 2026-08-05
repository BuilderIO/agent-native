import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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
  const t = useT();
  const renameSpace = useActionMutation("rename-space");
  const deleteSpace = useActionMutation("delete-space");

  const handleRename = async () => {
    if (!renameSpaceId) return;
    try {
      await renameSpace.mutateAsync({
        id: renameSpaceId,
        name: renameValue.trim(),
      });
      toast.success(t("spaceDialog.renamed"));
      setRenameSpaceId(null);
      setRenameValue("");
      onMutationSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("spaceDialog.renameFailed"),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteSpaceId) return;
    try {
      await deleteSpace.mutateAsync({ id: deleteSpaceId });
      toast.success(t("spaceDialog.deleted", { name: deleteSpaceName }));
      setDeleteSpaceId(null);
      onMutationSuccess?.(deleteSpaceId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("spaceDialog.deleteFailed"),
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
          <AlertDialogTitle>{t("spaceDialog.renameSpace")}</AlertDialogTitle>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRename}
              disabled={renameSpace.isPending || !renameValue.trim()}
            >
              {renameSpace.isPending
                ? t("spaceDialog.renaming")
                : t("spaceDialog.renameSpace")}
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
          <AlertDialogTitle>
            {t("spaceDialog.deleteTitle", { name: deleteSpaceName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("spaceDialog.deleteDescription")}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteSpace.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSpace.isPending
                ? t("spaceDialog.deleting")
                : t("spaceDialog.deleteSpace")}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
