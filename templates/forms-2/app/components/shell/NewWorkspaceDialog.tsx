import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

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

export function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const create = useActionMutation("create-workspace");
  const trimmed = name.trim();

  function submit() {
    if (!trimmed || create.isPending) return;
    create.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("forms.shell.newWorkspace")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("forms.shell.newWorkspaceDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            aria-label={t("forms.shell.workspaceName")}
            placeholder={t("forms.shell.workspaceName")}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("forms.shell.createWorkspaceFailed")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("forms.common.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || create.isPending}>
              {t("forms.shell.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
