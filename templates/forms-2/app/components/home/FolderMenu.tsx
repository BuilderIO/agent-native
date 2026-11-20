import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDots } from "@tabler/icons-react";
import { useState } from "react";

import { ConfirmDeleteDialog } from "@/components/form-menu/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

function RenameFolderDialog({
  folderId,
  currentName,
  open,
  onOpenChange,
}: {
  folderId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState(currentName);
  const rename = useActionMutation("rename-folder");
  const trimmed = name.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(currentName);
          rename.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("forms.organize.renameFolderTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("forms.organize.renameFolderDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            rename.mutate(
              { id: folderId, name: trimmed },
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
          {rename.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("forms.organize.renameFolderFailed")}
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
            <Button type="submit" disabled={!trimmed || rename.isPending}>
              {t("forms.common.rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FolderMenu({
  folder,
  label,
  triggerClassName,
  onDeleted,
}: {
  folder: { id: string; name: string };
  label: string;
  triggerClassName?: string;
  onDeleted?: () => void;
}) {
  const t = useT();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const remove = useActionMutation("delete-folder");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={triggerClassName}
          >
            <IconDots />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            {t("forms.common.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            {t("forms.common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameFolderDialog
        folderId={folder.id}
        currentName={folder.name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("forms.organize.deleteFolderTitle")}
        description={t("forms.organize.deleteFolderDescription")}
        onConfirm={() =>
          remove.mutate({ id: folder.id }, { onSuccess: () => onDeleted?.() })
        }
      />
    </>
  );
}
