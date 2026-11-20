import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

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

export function RenameFormDialog({
  open,
  onOpenChange,
  formId,
  currentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  currentName: string;
}) {
  const t = useT();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const rename = useActionMutation("update-form");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("forms.menu.nameRequired"));
      return;
    }
    setError(null);
    rename.mutate(
      { id: formId, name: trimmed },
      {
        onSuccess: () => onOpenChange(false),
        onError: () => setError(t("forms.menu.renameFailed")),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(currentName);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("forms.menu.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="form-name">{t("forms.menu.formName")}</Label>
            <Input
              id="form-name"
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "form-name-error" : undefined}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            {error ? (
              <p id="form-name-error" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("forms.common.cancel")}
            </Button>
            <Button type="submit" disabled={rename.isPending}>
              {t("forms.common.rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
