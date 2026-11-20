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

export function NewFolderDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const create = useActionMutation("create-folder");
  const trimmed = name.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName("");
          create.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("forms.organize.newFolderTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("forms.organize.newFolderDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            create.mutate(
              { workspaceId, name: trimmed },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <Input
            autoFocus
            aria-label={t("forms.organize.folderName")}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("forms.organize.createFolderFailed")}
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
              {t("forms.organize.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
