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
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title={`Delete ${entityLabel}?`}
      description={
        description ??
        (itemTitle ? (
          <>This removes &quot;{itemTitle}&quot; permanently.</>
        ) : (
          `This removes the ${entityLabel} permanently.`
        ))
      }
      onConfirm={onConfirm}
    />
  );
}
