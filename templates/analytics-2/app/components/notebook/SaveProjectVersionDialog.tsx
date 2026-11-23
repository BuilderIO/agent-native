import {
  actionErrorCode,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { DraftHead } from "../../../shared/notebook-snapshot-contract";
import { toNotebookError } from "./utils";

export function SaveProjectVersionDialog({
  projectId,
  captureHead,
  onClose,
}: {
  projectId: string;
  captureHead: () => Promise<DraftHead>;
  onClose: () => void;
}) {
  const t = useT();
  const inputId = useId();
  const save = useActionMutation("save-project-version", {
    errorNotification: "caller",
  });
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const intent = useRef<{
    name: string;
    observedHead: DraftHead;
    opId: string;
  } | null>(null);
  const submit = async () => {
    const title = name.trim();
    if (!title || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (intent.current?.name !== title) {
        intent.current = {
          name: title,
          observedHead: await captureHead(),
          opId: crypto.randomUUID(),
        };
      }
      await save.mutateAsync({ ...intent.current, projectId });
      onClose();
    } catch (failure) {
      if (actionErrorCode(failure)) intent.current = null;
      setError(
        toNotebookError(failure).message || t("notebook.history.saveFailed"),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("notebook.history.saveTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={inputId}>
            <span>
              {t("notebook.history.versionNameLabel")}{" "}
              <span className="text-muted-foreground">
                {t("notebook.history.required")}
              </span>
            </span>
          </Label>
          <Input
            id={inputId}
            placeholder={t("notebook.history.versionPrompt")}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={200}
            required
            disabled={pending}
          />
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t(pending ? "notebook.history.saving" : "notebook.history.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
