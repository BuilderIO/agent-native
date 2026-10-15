import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import {
  formatPanelEventDate,
  formatPanelEventTime,
  panelEventInstant,
} from "@shared/panel-events";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import {
  useDeleteKeyDate,
  useDeleteKeyDateSet,
  useRenameKeyDateSet,
} from "@/components/dashboard/annotation-mutations";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function SetName({ set }: { set: KeyDateSet }) {
  const t = useT();
  const rename = useRenameKeyDateSet();
  const [name, setName] = useState<string | null>(null);

  const commit = () => {
    const next = name?.trim();
    setName(null);
    if (!next || next === set.name) return;
    rename.mutate({ id: set.id, name: next });
  };

  if (name !== null) {
    return (
      <Input
        aria-label={t("annotations.setName")}
        value={name}
        maxLength={80}
        className="h-7 text-sm"
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setName(null);
        }}
        autoFocus
      />
    );
  }
  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-1.5 text-sm font-medium"
      onClick={() => setName(set.name)}
      aria-label={t("annotations.renameSet", { name: set.name })}
    >
      <span className="truncate">{set.name}</span>
      <IconPencil className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
    </button>
  );
}

function DateRow({
  keyDate,
  onEdit,
}: {
  keyDate: KeyDate;
  onEdit: (keyDate: KeyDate) => void;
}) {
  const t = useT();
  const deleteKeyDate = useDeleteKeyDate();
  const time = formatPanelEventTime(keyDate);
  return (
    <li className="group flex items-center gap-2 rounded px-1 hover:bg-accent/50">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left text-xs"
        onClick={() => onEdit(keyDate)}
      >
        <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
          {formatPanelEventDate(keyDate.date)}
        </span>
        <span className="min-w-0 flex-1 truncate">{keyDate.label}</span>
        {time ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {time}
          </span>
        ) : null}
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t("annotations.deleteKeyDate", {
              label: keyDate.label,
            })}
            onClick={() => deleteKeyDate.mutate({ id: keyDate.id })}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("annotations.deleteKeyDate", { label: keyDate.label })}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Every key-date set, to rename or delete sets and edit their dates. */
export function KeyDateSetsDialog({
  open,
  onOpenChange,
  onEditKeyDate,
  onAddKeyDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditKeyDate: (keyDate: KeyDate) => void;
  onAddKeyDate: (setId: string) => void;
}) {
  const t = useT();
  const { data } = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  const deleteSet = useDeleteKeyDateSet();
  const [deleteTarget, setDeleteTarget] = useState<KeyDateSet | null>(null);
  const sets = data?.sets ?? [];

  const handleDeleteSet = () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    deleteSet.mutate({ id });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("annotations.keyDates")}</DialogTitle>
          </DialogHeader>
          {sets.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {t("annotations.noKeyDates")}
            </p>
          ) : (
            <div className="space-y-4">
              {sets.map((set) => (
                <section key={set.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <SetName set={set} />
                    <div className="flex shrink-0 gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={t("annotations.addKeyDate")}
                            onClick={() => onAddKeyDate(set.id)}
                          >
                            <IconPlus className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("annotations.addKeyDate")}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={t("annotations.deleteSet", {
                              name: set.name,
                            })}
                            onClick={() => setDeleteTarget(set)}
                          >
                            <IconTrash className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("annotations.deleteSet", { name: set.name })}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <ul>
                    {[...set.dates]
                      .sort(
                        (a, b) => panelEventInstant(b) - panelEventInstant(a),
                      )
                      .map((keyDate) => (
                        <DateRow
                          key={keyDate.id}
                          keyDate={keyDate}
                          onEdit={onEditKeyDate}
                        />
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("annotations.deleteSetTitle", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("annotations.deleteSetDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSet}>
              {t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
