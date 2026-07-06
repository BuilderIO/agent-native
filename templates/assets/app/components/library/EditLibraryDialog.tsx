import { useActionMutation, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";

type EditableLibrary = {
  id: string;
  title: string;
  description?: string | null;
};

export function EditLibraryDialog({
  library,
  open,
  onOpenChange,
}: {
  library: EditableLibrary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const updateLibrary = useActionMutation("update-library");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open && library) {
      setTitle(library.title ?? "");
      setDescription(library.description ?? "");
    }
  }, [open, library]);

  const id = library?.id;
  const trimmedTitle = title.trim();
  const dirty =
    !!library &&
    (trimmedTitle !== (library.title ?? "").trim() ||
      description.trim() !== (library.description ?? "").trim());

  function submit() {
    if (!id || !trimmedTitle) return;
    updateLibrary.mutate(
      {
        id,
        title: trimmedTitle,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t("brandKits.updated"));
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          toast.error(
            err instanceof Error ? err.message : t("brandKits.updateFailed"),
          );
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("brandKits.editDialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-library-title">
              {t("brandKitDetail.name")}
            </Label>
            <Input
              id="edit-library-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("brandKits.namePlaceholder")}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-library-description">
              {t("assetDetail.description")}
            </Label>
            <Textarea
              id="edit-library-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("brandKits.editDescriptionPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("brandKitDetail.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={!trimmedTitle || !dirty || updateLibrary.isPending}
          >
            {updateLibrary.isPending
              ? t("settings.saving")
              : t("brandKitDetail.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
