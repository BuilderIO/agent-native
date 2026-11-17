import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { useDisconnectContentDatabaseSource } from "@/hooks/use-content-database";

import { dbText, type DatabaseMessageKey } from "./text";

export type SourceUnlinkProvider = "github" | "builder" | "notion";

const UNLINK_TEXT: Record<
  SourceUnlinkProvider,
  {
    title: DatabaseMessageKey;
    bodyOne: DatabaseMessageKey;
    body: DatabaseMessageKey;
  }
> = {
  github: {
    title: "githubUnlinkTitle",
    bodyOne: "githubUnlinkBodyOne",
    body: "githubUnlinkBody",
  },
  builder: {
    title: "sourceUnlinkBuilderTitle",
    bodyOne: "sourceUnlinkBuilderBodyOne",
    body: "sourceUnlinkBuilderBody",
  },
  notion: {
    title: "sourceUnlinkNotionTitle",
    bodyOne: "sourceUnlinkNotionBodyOne",
    body: "sourceUnlinkNotionBody",
  },
};

/**
 * Asks before unlinking a source. Every source promises the same thing, that
 * the pages stay and are the collection's own to edit, plus what it stops.
 */
export function SourceUnlinkDialog({
  open,
  onOpenChange,
  provider,
  documentId,
  sourceId,
  pageCount,
  onUnlinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: SourceUnlinkProvider;
  documentId: string;
  sourceId: string;
  pageCount: number;
  onUnlinked?: (() => void) | undefined;
}) {
  const unlink = useDisconnectContentDatabaseSource(documentId);
  const text = UNLINK_TEXT[provider];
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
          <AlertDialogTitle>{dbText(text.title)}</AlertDialogTitle>
          <AlertDialogDescription>
            {pageCount === 1
              ? dbText(text.bodyOne)
              : dbText(text.body, { count: pageCount })}
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
                    toast.success(dbText("sourceUnlinkedToast"));
                    onOpenChange(false);
                    onUnlinked?.();
                  },
                  onError: (error) => {
                    toast.error(dbText("sourceUnlinkFailed"), {
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
            {unlink.isPending ? <Spinner className="me-1 size-3.5" /> : null}
            {unlink.isPending
              ? dbText("sourceUnlinking")
              : dbText("sourceUnlinkConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Unlink…" where a source's own page in Sources offers it, with its dialog. */
export function SourceUnlinkButton({
  disabled,
  ...unlink
}: {
  provider: SourceUnlinkProvider;
  documentId: string;
  sourceId: string;
  pageCount: number;
  disabled?: boolean | undefined;
  onUnlinked?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline-destructive"
        className="justify-self-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {dbText("sourceUnlink")}
      </Button>
      <SourceUnlinkDialog open={open} onOpenChange={setOpen} {...unlink} />
    </>
  );
}
