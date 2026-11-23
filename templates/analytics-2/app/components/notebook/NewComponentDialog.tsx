import { useT } from "@agent-native/core/client/i18n";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { toNotebookError } from "./utils";

export type ComponentDialogCellPreview = {
  id: string;
  kind: string;
  label: string | null;
};

/** Names the component to save from the cells that were selected for it. */
export function NewComponentDialog({
  cellCount,
  cells,
  onCreate,
  onClose,
}: {
  cellCount: number;
  cells?: readonly ComponentDialogCellPreview[] | undefined;
  onCreate: (name: string) => Promise<{ omittedOutputs?: number } | void>;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [omitted, setOmitted] = useState(false);
  const submitting = useRef(false);
  const trimmed = name.trim();

  async function create() {
    if (submitting.current || trimmed === "") return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onCreate(trimmed);
      // Saved, but with results left out: say so instead of closing quietly.
      if ((result?.omittedOutputs ?? 0) > 0) setOmitted(true);
      else onClose();
    } catch (cause) {
      setError(
        t("notebook.component.createFailed", {
          message: toNotebookError(cause).message.replace(/[.\s]+$/, ""),
        }),
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open || pending ? undefined : onClose())}
    >
      <DialogContent aria-busy={pending || undefined}>
        <DialogHeader>
          <DialogTitle>{t("notebook.component.title")}</DialogTitle>
          <DialogDescription>
            {cellCount === 1
              ? t("notebook.component.one")
              : t("notebook.component.many", { count: cellCount })}
          </DialogDescription>
        </DialogHeader>
        {omitted ? (
          <div className="grid gap-4">
            <p role="status" className="text-sm text-muted-foreground">
              {t("notebook.component.omitted")}
            </p>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {t("notebook.component.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor={id}>{t("notebook.component.name")}</Label>
              <Input
                id={id}
                className="nb-component-name"
                value={name}
                maxLength={120}
                autoFocus
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {cells && cells.length > 0 ? (
              <div
                data-testid="component-selected-cells"
                className="grid gap-1.5 rounded-md border border-border bg-muted/30 p-3"
              >
                <p className="text-xs font-medium text-muted-foreground">
                  Selected cells ({cells.length})
                </p>
                <ul className="m-0 flex max-h-36 list-none flex-col gap-1 overflow-y-auto p-0">
                  {cells.map((cell) => (
                    <li
                      key={cell.id}
                      className="flex items-center justify-between gap-2 text-xs text-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {cell.label?.trim() || cell.kind}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {cell.kind}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!pending) onClose();
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending || trimmed === ""}>
                {t("notebook.component.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
