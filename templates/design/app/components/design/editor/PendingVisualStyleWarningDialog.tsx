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

export function PendingVisualStyleWarningDialog({
  open,
  pendingVisualEditCount,
  onStay,
  onDiscardAndNavigate,
}: {
  open: boolean;
  pendingVisualEditCount: number;
  onStay: () => void;
  onDiscardAndNavigate: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("designEditor.pendingVisualStyles.leaveTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              pendingVisualEditCount === 1
                ? "designEditor.pendingVisualStyles.leaveDescriptionOne"
                : "designEditor.pendingVisualStyles.leaveDescriptionOther",
              { count: pendingVisualEditCount },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>
            {t("designEditor.pendingVisualStyles.stay")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDiscardAndNavigate}
          >
            {t("designEditor.pendingVisualStyles.leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
