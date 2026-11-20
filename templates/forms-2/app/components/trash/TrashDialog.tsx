import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { trashItemSchema } from "@shared/form-contract";
import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { z } from "zod";

import { ConfirmDeleteDialog } from "@/components/form-menu/ConfirmDeleteDialog";
import { formatSubmittedAt } from "@/components/forms/submission-format";
import { relativeTime } from "@/components/shell/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type TrashItem = z.infer<typeof trashItemSchema>;

const KIND_LABEL_KEY = {
  form: "forms.trash.kindForm",
  submission: "forms.trash.kindSubmission",
  workspace: "forms.trash.kindWorkspace",
  folder: "forms.organize.kindFolder",
} as const;

function ItemName({ item }: { item: TrashItem }) {
  const t = useT();
  if (item.kind === "submission")
    return (
      <span>
        {t("forms.trash.submissionAt")}{" "}
        <span className="font-normal text-muted-foreground">
          {formatSubmittedAt(item.name)}
        </span>
      </span>
    );
  return <span>{item.name || t("forms.common.untitled")}</span>;
}

export function TrashDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const trash = useActionQuery("list-trash", {}, { enabled: open });
  const restore = useActionMutation("restore-item");
  const empty = useActionMutation("empty-trash");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [restoring, setRestoring] = useState<string[]>([]);
  const [restoreRefused, setRestoreRefused] = useState(false);
  const items = (trash.data?.items ?? []).filter(
    (item) => !restoring.includes(`${item.kind}:${item.id}`),
  );

  function restoreItem(item: TrashItem) {
    const key = `${item.kind}:${item.id}`;
    setRestoring((current) => [...current, key]);
    setRestoreRefused(false);
    restore.mutate(
      { kind: item.kind, id: item.id },
      {
        onError: () => {
          setRestoring((current) => current.filter((k) => k !== key));
          setRestoreRefused(item.kind === "submission");
        },
      },
    );
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setRestoring([]);
            setRestoreRefused(false);
          }
          onOpenChange(next);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("forms.shell.trash")}</DialogTitle>
            <DialogDescription>
              {t("forms.trash.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
            {trash.isPending ? (
              <div
                role="status"
                aria-label={t("forms.common.loading")}
                className="flex flex-col gap-2"
              >
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : trash.isError ? (
              <div className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="text-muted-foreground">
                  {t("forms.trash.loadFailed")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void trash.refetch()}
                >
                  {t("forms.common.retry")}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                <IconTrash aria-hidden className="size-8" stroke={1.4} />
                {t("forms.trash.empty")}
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={`${item.kind}:${item.id}`}
                  className="flex items-center gap-3 rounded-[7px] border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      <ItemName item={item} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        t(KIND_LABEL_KEY[item.kind]),
                        item.parentName,
                        t("forms.trash.deletedAgo", {
                          time: relativeTime(item.deletedAt, t),
                        }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restoreItem(item)}
                  >
                    {t("forms.trash.restore")}
                  </Button>
                </div>
              ))
            )}
          </div>
          {restoreRefused ? (
            <p role="alert" className="text-sm text-destructive">
              {t("forms.trash.restoreConflict")}
            </p>
          ) : null}
          {items.length > 0 ? (
            <DialogFooter className="sm:justify-start">
              <Button variant="ghost" onClick={() => setConfirmEmpty(true)}>
                {t("forms.trash.emptyAction")}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDeleteDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title={t("forms.trash.confirmTitle")}
        description={t("forms.trash.confirmDescription")}
        confirmLabel={t("forms.trash.emptyAction")}
        onConfirm={() => empty.mutate({})}
      />
    </>
  );
}
