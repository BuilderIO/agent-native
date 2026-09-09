import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTrash } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useRestoreDocument } from "@/hooks/use-documents";
import { useTrashPages, type TrashPagesResult } from "@/hooks/use-trash-pages";

export interface TrashPageTarget {
  id: string;
  title: string;
}

export function usePageTrashControl({
  pages,
  onTrashed,
}: {
  pages: TrashPageTarget[];
  onTrashed?: (result: TrashPagesResult) => void;
}) {
  const t = useT();
  const trash = useTrashPages();
  const restore = useRestoreDocument();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<TrashPageTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const request = (invoker?: HTMLElement) => {
    const element =
      invoker ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const menu = element?.closest('[role="menu"]');
    returnFocus.current = menu
      ? (Array.from(
          document.querySelectorAll<HTMLElement>("[aria-controls]"),
        ).find(
          (trigger) => trigger.getAttribute("aria-controls") === menu.id,
        ) ?? null)
      : element;
    setTargets([...new Map(pages.map((page) => [page.id, page])).values()]);
    setError(null);
    setOpen(true);
  };

  const confirm = async () => {
    setError(null);
    let result: TrashPagesResult;
    try {
      result = await trash.mutateAsync({ ids: targets.map((page) => page.id) });
    } catch (caught) {
      setError(actionErrorMessage(caught) ?? t("pageTrash.failed"));
      return;
    }

    const roots = result.results.filter((item) => item.status === "trashed");
    const failures = result.results.filter((item) => item.status === "failed");
    if (roots.length > 0) {
      toast(
        t("pageTrash.trashed", { count: result.affectedDocumentIds.length }),
        {
          action: {
            label: t("pageTrash.undo"),
            onClick: () => {
              void Promise.allSettled(
                roots.map((item) => restore.mutateAsync({ id: item.id })),
              ).then((outcomes) => {
                const failed = outcomes.filter(
                  (outcome) => outcome.status === "rejected",
                );
                if (failed.length > 0)
                  toast.error(
                    t("pageTrash.restoreFailed", { count: failed.length }),
                  );
              });
            },
          },
        },
      );
    }
    if (failures.length > 0) {
      const message = failures
        .map((item) => {
          const title =
            targets.find((page) => page.id === item.id)?.title ||
            t("pageTrash.untitled");
          return `${title}: ${item.error?.message ?? t("pageTrash.failed")}`;
        })
        .join("\n");
      setError(message);
      setTargets(
        targets.filter((page) => failures.some((item) => item.id === page.id)),
      );
      toast.error(t("pageTrash.partialFailure", { count: failures.length }), {
        description: message,
      });
    } else {
      setOpen(false);
    }
    onTrashed?.(result);
  };

  return {
    open,
    setOpen,
    request,
    confirm,
    targets,
    error,
    pending: trash.isPending,
    disabled: pages.length === 0,
    onCloseAutoFocus: (event: Event) => {
      if (returnFocus.current?.isConnected) {
        event.preventDefault();
        returnFocus.current.focus();
      }
    },
  };
}

export type PageTrashControl = ReturnType<typeof usePageTrashControl>;

export function PageTrashMenuItem({ control }: { control: PageTrashControl }) {
  const t = useT();
  return (
    <DropdownMenuItem
      disabled={control.disabled || control.pending}
      className="text-destructive focus:text-destructive"
      onSelect={(event) =>
        control.request(
          event.currentTarget instanceof HTMLElement
            ? event.currentTarget
            : undefined,
        )
      }
    >
      <IconTrash />
      {t("pageTrash.actionSingle")}
    </DropdownMenuItem>
  );
}

export function PageTrashSelectionButton({
  control,
}: {
  control: PageTrashControl;
}) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={control.disabled || control.pending}
      onClick={(event) => control.request(event.currentTarget)}
    >
      <IconTrash />
      {t("pageTrash.action")}
    </Button>
  );
}

export function PageTrashDialog({ control }: { control: PageTrashControl }) {
  const t = useT();
  return (
    <Dialog
      open={control.open}
      onOpenChange={(open) => {
        if (!control.pending) control.setOpen(open);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={control.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              control.targets.length === 1
                ? "pageTrash.confirmSingle"
                : "pageTrash.confirm",
            )}
          </DialogTitle>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto text-sm">
          {control.targets.map((page) => (
            <li
              key={page.id}
              className="truncate"
              title={page.title || t("pageTrash.untitled")}
            >
              {page.title || t("pageTrash.untitled")}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t("pageTrash.scope")}</p>
        {control.error && (
          <p
            role="alert"
            className="whitespace-pre-wrap text-sm text-destructive"
          >
            {control.error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={control.pending}
            onClick={() => control.setOpen(false)}
          >
            {t("pageTrash.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={control.pending || control.targets.length === 0}
            onClick={() => void control.confirm()}
          >
            {t(
              control.targets.length === 1
                ? "pageTrash.actionSingle"
                : "pageTrash.action",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
