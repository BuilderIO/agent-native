import { actionErrorMessage } from "@agent-native/core/client/hooks";
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
import { Spinner } from "@/components/ui/spinner";
import { useDisconnectContentDatabaseSource } from "@/hooks/use-content-database";

import { dbText } from "./text";

/**
 * Asks before unlinking a GitHub folder: the pages stay and become editable,
 * and the folder can't come back into this collection, so it says both.
 */
export function GitHubUnlinkDialog({
  open,
  onOpenChange,
  documentId,
  sourceId,
  pageCount,
  onUnlinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  sourceId: string;
  pageCount: number;
  onUnlinked?: () => void;
}) {
  const unlink = useDisconnectContentDatabaseSource(documentId);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (unlink.isPending && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dbText("githubUnlinkTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {pageCount === 1
              ? dbText("githubUnlinkBodyOne")
              : dbText("githubUnlinkBody", { count: pageCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={unlink.isPending}>
            {dbText("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={unlink.isPending}
            onClick={(event) => {
              // Stays open until the unlink is saved, so a failure is seen here.
              event.preventDefault();
              unlink.mutate(
                { documentId, sourceId },
                {
                  onSuccess: () => {
                    toast.success(dbText("githubUnlinkedToast"));
                    onOpenChange(false);
                    onUnlinked?.();
                  },
                  onError: (error) => {
                    toast.error(dbText("githubUnlinkFailed"), {
                      description:
                        actionErrorMessage(error) ??
                        (error instanceof Error
                          ? error.message
                          : dbText("tryAgain")),
                    });
                  },
                },
              );
            }}
          >
            {unlink.isPending ? <Spinner className="mr-1 size-3.5" /> : null}
            {unlink.isPending
              ? dbText("githubUnlinking")
              : dbText("githubUnlink")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
