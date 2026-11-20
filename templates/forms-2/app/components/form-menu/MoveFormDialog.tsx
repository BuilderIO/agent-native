import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function MoveFormDialog({
  open,
  onOpenChange,
  formId,
  workspaceId,
  folderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  workspaceId: string;
  folderId: string | null;
}) {
  const t = useT();
  const workspaces = useActionQuery(
    "list-workspaces",
    { formLimit: 0 },
    { enabled: open },
  );
  const currentKey = folderId ?? workspaceId;
  const [target, setTarget] = useState(currentKey);
  const move = useActionMutation("move-form");
  const destinations = (workspaces.data?.workspaces ?? []).flatMap(
    (workspace) => [
      {
        key: workspace.id,
        label: workspace.name,
        workspaceId: workspace.id,
        folderId: null,
      },
      ...workspace.folders.map((folder) => ({
        key: folder.id,
        label: folder.name,
        workspaceId: workspace.id,
        folderId: folder.id,
      })),
    ],
  );
  const destination = destinations.find((item) => item.key === target);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setTarget(currentKey);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("forms.menu.moveTitle")}</DialogTitle>
          <DialogDescription>
            {t("forms.menu.moveDescription")}
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger aria-label={t("forms.organize.moveTo")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {destinations.map((item) => (
              <SelectItem
                key={item.key}
                value={item.key}
                className={item.folderId ? "pl-8" : undefined}
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {move.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("forms.menu.moveFailed")}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("forms.common.cancel")}
          </Button>
          <Button
            disabled={!destination || target === currentKey || move.isPending}
            onClick={() =>
              destination
                ? move.mutate(
                    {
                      id: formId,
                      workspaceId: destination.workspaceId,
                      folderId: destination.folderId,
                    },
                    { onSuccess: () => onOpenChange(false) },
                  )
                : undefined
            }
          >
            {t("forms.common.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
