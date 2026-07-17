import { useT } from "@agent-native/core/client";
import { IconLoader2 } from "@tabler/icons-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

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
import { useCreateFolder } from "@/hooks/use-library";

interface CreatedFolder {
  id: string;
}

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId?: string | null;
  parentId?: string | null;
  onCreated?: (folder: CreatedFolder) => void;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  spaceId,
  parentId,
  onCreated,
}: CreateFolderDialogProps) {
  const t = useT();
  const createFolder = useCreateFolder();
  const [name, setName] = useState("");

  function reset() {
    setName("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createFolder.isPending) return;

    createFolder.mutate(
      {
        name: trimmed,
        ...(spaceId ? { spaceId } : {}),
        ...(parentId ? { parentId } : {}),
      },
      {
        onSuccess: (folder) => {
          toast.success(t("navigation.folderCreated"));
          onCreated?.(folder);
          reset();
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast.error(err?.message ?? t("navigation.createFolderError"));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("navigation.newFolder")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("navigation.folderNamePlaceholder")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="new-folder-name">
              {t("navigation.folderNamePlaceholder")}
            </Label>
            <Input
              id="new-folder-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("navigation.folderNamePlaceholder")}
              disabled={createFolder.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createFolder.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createFolder.isPending}
            >
              {createFolder.isPending && (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              )}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
