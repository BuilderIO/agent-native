import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { useId, useRef, useState } from "react";

import {
  editedVersion,
  isPendingAnnotation,
  useDeleteKeyDate,
  useSaveKeyDate,
  type KeyDateInput,
} from "@/components/dashboard/annotation-mutations";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** An existing key date to edit, or the set a new one goes in. */
export type KeyDateDraft = { keyDate?: KeyDate; setId?: string };

const NEW_SET = "__new__";

/** The set a new date starts in: the list's first confirmed one, or a new one. */
const firstSetId = (sets: readonly KeyDateSet[]) =>
  sets.find((set) => !isPendingAnnotation(set.id))?.id ?? NEW_SET;

const COMMON_TIME_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function timeZoneOptions(current: string): string[] {
  return [
    ...new Set(
      [current, viewerTimeZone(), ...COMMON_TIME_ZONES].filter(Boolean),
    ),
  ];
}

interface KeyDateDialogProps {
  draft: KeyDateDraft | null;
  onClose: () => void;
}

export function KeyDateDialog({ draft, ...props }: KeyDateDialogProps) {
  // Mounted per open, so each open starts from its own draft.
  return draft ? <KeyDateForm draft={draft} {...props} /> : null;
}

function KeyDateForm({
  draft,
  onClose,
}: KeyDateDialogProps & { draft: KeyDateDraft }) {
  const t = useT();
  const ids = useId();
  const { data, isError } = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  const sets = data?.sets;
  const saveKeyDate = useSaveKeyDate();
  const deleteKeyDate = useDeleteKeyDate();
  const existing = draft.keyDate;
  const [initial, setInitial] = useState(() => ({
    setId: existing?.setId ?? draft.setId ?? (sets && firstSetId(sets)),
    label: existing?.label ?? "",
    date: existing?.date ?? "",
    time: existing?.time ?? "",
    // A saved time without a zone is UTC; only a time added here starts in
    // the viewer's zone.
    timeZone: existing?.time ? (existing.timeZone ?? "UTC") : viewerTimeZone(),
  }));
  // The list can arrive after the dialog opens. Its first set is taken then
  // and kept: taken again from a later list, it could swap the set out from
  // under someone naming a new one.
  if (initial.setId === undefined && sets) {
    setInitial({ ...initial, setId: firstSetId(sets) });
  }
  const [pickedSetId, setPickedSetId] = useState<string>();
  const setId = pickedSetId ?? initial.setId;
  const [setName, setSetName] = useState("");
  const [label, setLabel] = useState(initial.label);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const labelRef = useRef<HTMLInputElement>(null);
  const dirty =
    setId !== initial.setId ||
    setName !== "" ||
    label !== initial.label ||
    date !== initial.date ||
    time !== initial.time ||
    timeZone !== initial.timeZone;

  const chosenSet = sets?.find((set) => set.id === setId);
  const canSave =
    sets !== undefined &&
    label.trim() !== "" &&
    date !== "" &&
    (chosenSet !== undefined || setName.trim() !== "");

  const handleSave = () => {
    if (!canSave) return;
    const input: KeyDateInput = {
      ...(existing
        ? {
            id: existing.id,
            expectedUpdatedAt: editedVersion(existing.id, existing.updatedAt),
          }
        : {}),
      ...(chosenSet ? { setId: chosenSet.id } : { setName: setName.trim() }),
      date,
      label: label.trim(),
      // An edit keeps a time it leaves out, so a cleared time is sent as null.
      time: time || null,
      timeZone: time ? timeZone : null,
    };
    onClose();
    saveKeyDate.mutate(input);
  };

  const handleDelete = () => {
    if (!existing) return;
    onClose();
    deleteKeyDate.mutate({ id: existing.id });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-[420px]"
        // Radix focuses the first control, the Set select, over autoFocus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          labelRef.current?.focus();
        }}
        // Escape, Cancel and the close button still discard an edit; a stray
        // click beside the dialog must not.
        onInteractOutside={(event) => {
          if (dirty) event.preventDefault();
        }}
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>
            {existing
              ? t("annotations.editKeyDate")
              : t("annotations.addKeyDate")}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-1">
          <div className="space-y-1.5">
            <Label>{t("annotations.set")}</Label>
            {sets ? (
              <>
                <Select
                  value={chosenSet?.id ?? NEW_SET}
                  onValueChange={setPickedSetId}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sets.map((set) => (
                      <SelectItem
                        key={set.id}
                        value={set.id}
                        disabled={isPendingAnnotation(set.id)}
                      >
                        {set.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SET}>
                      {t("annotations.newSet")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {chosenSet ? null : (
                  <Input
                    aria-label={t("annotations.setName")}
                    placeholder={t("annotations.setName")}
                    value={setName}
                    maxLength={80}
                    onChange={(event) => setSetName(event.target.value)}
                  />
                )}
              </>
            ) : isError ? (
              <p className="flex h-8 items-center text-xs text-destructive">
                {t("dashboard.keyDatesUnavailable")}
              </p>
            ) : (
              <Skeleton className="h-8 w-full" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-label`}>{t("annotations.label")}</Label>
            <Input
              ref={labelRef}
              id={`${ids}-label`}
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("annotations.date")}</Label>
              <DatePicker
                value={date}
                onChange={setDate}
                placeholder={t("annotations.date")}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-time`}>{t("annotations.time")}</Label>
              <Input
                id={`${ids}-time`}
                type="time"
                className="h-8 text-xs"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
          </div>
          {/* Holds its place without a time, so typing one doesn't grow and
              re-center the dialog. */}
          <div className={cn("space-y-1.5", !time && "invisible")}>
            <Label>{t("annotations.timeZone")}</Label>
            <Select value={timeZone} onValueChange={setTimeZone}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeZoneOptions(timeZone).map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 border-t border-border/60 px-6 py-4 sm:justify-between">
          {existing ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              {t("sidebar.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t("sidebar.cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!canSave}>
              {t("sqlDashboard.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
