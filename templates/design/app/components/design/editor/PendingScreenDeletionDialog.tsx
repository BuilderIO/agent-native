import { useT } from "@agent-native/core/client/i18n";

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
import type { DesignFile } from "@/pages/design-editor/types";

export function PendingScreenDeletionDialog({
  pendingScreenDeletion,
  onCancel,
  onConfirm,
  confirming = false,
}: {
  pendingScreenDeletion: { files: DesignFile[] } | null;
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  const t = useT();
  return (
    <AlertDialog open={pendingScreenDeletion !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingScreenDeletion?.files.length === 1
              ? t("designEditor.screenDeletion.titleOne")
              : t("designEditor.screenDeletion.titleMany", {
                  count: pendingScreenDeletion?.files.length ?? 0,
                })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingScreenDeletion?.files.length === 1
              ? t("designEditor.screenDeletion.descriptionOne", {
                  filename: pendingScreenDeletion.files[0]?.filename ?? "",
                })
              : t("designEditor.screenDeletion.descriptionMany")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={confirming}>
            {t("designEditor.screenDeletion.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={confirming}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirming
              ? "Removing…" /* i18n-ignore */
              : t("designEditor.screenDeletion.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
