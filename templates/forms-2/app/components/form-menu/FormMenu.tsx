import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDots } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { publicFormUrl } from "@/components/forms/form-data";
import { paths } from "@/components/shell/paths";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sonnerToast } from "@/components/ui/sonner";
import type { Translate } from "@/lib/translate";

import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { MoveFormDialog } from "./MoveFormDialog";
import { RenameFormDialog } from "./RenameFormDialog";

export function copyFormLink(formId: string, t: Translate) {
  navigator.clipboard
    .writeText(publicFormUrl(formId))
    .then(() => sonnerToast.success(t("forms.menu.linkCopied")))
    .catch(() => sonnerToast.error(t("forms.common.copyLinkFailed")));
}

export function FormMenu({
  form,
  label,
  triggerClassName,
  onDeleted,
}: {
  form: {
    id: string;
    name: string;
    workspaceId: string;
    folderId: string | null;
  };
  label?: string;
  triggerClassName?: string;
  onDeleted?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const duplicate = useActionMutation("duplicate-form");
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const workspaces = useActionQuery("list-workspaces", { formLimit: 0 });
  const remove = useActionMutation("delete-form");
  const destinations = (workspaces.data?.workspaces ?? []).reduce(
    (count, workspace) => count + 1 + workspace.folders.length,
    0,
  );
  const canMove = destinations > 1;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label ?? t("forms.common.moreActions")}
            className={triggerClassName}
          >
            <IconDots />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* An existing form is edited from its own menu: the row opens results, and
              nothing on the list says where the editor is. */}
          <DropdownMenuItem onSelect={() => void navigate(paths.edit(form.id))}>
            {t("forms.routes.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            {t("forms.common.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={duplicate.isPending}
            onSelect={() =>
              duplicate.mutate(
                { id: form.id },
                {
                  onSuccess: (result) => void navigate(paths.edit(result.id)),
                  onError: () =>
                    sonnerToast.error(t("forms.menu.duplicateFailed")),
                },
              )
            }
          >
            {t("forms.common.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyFormLink(form.id, t)}>
            {t("forms.menu.copyLink")}
          </DropdownMenuItem>
          {canMove ? (
            <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
              {t("forms.common.move")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            {t("forms.common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameFormDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        formId={form.id}
        currentName={form.name}
      />
      <MoveFormDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        formId={form.id}
        workspaceId={form.workspaceId}
        folderId={form.folderId}
      />
      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("forms.menu.deleteTitle")}
        description={t("forms.menu.deleteDescription")}
        onConfirm={() =>
          remove.mutate({ id: form.id }, { onSuccess: () => onDeleted?.() })
        }
      />
    </>
  );
}
