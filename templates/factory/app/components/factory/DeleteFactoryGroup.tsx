import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/toolkit/app/settings";
import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeleteFactoryGroup({
  factoryId,
  factoryName,
  onDeleted,
}: {
  factoryId: string;
  factoryName: string;
  onDeleted: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const mutation = useActionMutation("delete-factory", { method: "DELETE" });

  const deleteFactory = async () => {
    try {
      await mutation.mutateAsync({ factoryId, confirmName: confirmation });
      toast.success(t("factoryRoute.factoryDeleted"));
      setOpen(false);
      onDeleted();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.factoryDeleteFailed"),
      );
    }
  };

  return (
    <>
      <SettingsGroup variant="soft">
        <SettingsRow
          label={t("factoryRoute.deleteFactory")}
          control={
            <Button
              type="button"
              variant="destructive"
              onClick={() => setOpen(true)}
              disabled={mutation.isPending}
            >
              <IconTrash />
              {t("settings.factory.delete")}
            </Button>
          }
        />
      </SettingsGroup>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (mutation.isPending) return;
          setOpen(next);
          if (!next) setConfirmation("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("factoryRoute.deleteFactoryTitle", { name: factoryName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("factoryRoute.deleteFactoryWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <label
              htmlFor="delete-factory-confirmation"
              className="text-sm font-medium"
            >
              {t("factoryRoute.deleteFactoryConfirmation", {
                name: factoryName,
              })}
            </label>
            <Input
              id="delete-factory-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              {t("factoryRoute.deleteFactoryCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={confirmation !== factoryName || mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                void deleteFactory();
              }}
            >
              {mutation.isPending ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconTrash />
              )}
              {t("factoryRoute.deleteFactoryConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
