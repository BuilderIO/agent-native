import { useT } from "@agent-native/core/client/i18n";
import { type ReactNode } from "react";

import {
  AlertDialog,
  type AlertDialogProps,
} from "@/components/shared/AlertDialog";

type DeleteItemDialogProps = Omit<AlertDialogProps, "title" | "description"> & {
  entityLabel: string;
  itemTitle: string | null;
  description?: ReactNode;
};

export function DeleteItemDialog({
  open,
  onOpenChange,
  entityLabel,
  itemTitle,
  description,
  pending,
  onConfirm,
}: DeleteItemDialogProps) {
  const t = useT();
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title={t("dialogs.deleteEntityTitle", { entity: entityLabel })}
      description={
        description ??
        (itemTitle
          ? t("dialogs.deleteItemDescriptionWithTitle", { title: itemTitle })
          : t("dialogs.deleteItemDescription", { entity: entityLabel }))
      }
      onConfirm={onConfirm}
    />
  );
}
