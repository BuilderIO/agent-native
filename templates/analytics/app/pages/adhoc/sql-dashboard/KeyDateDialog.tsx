import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { KeyDate } from "@shared/key-dates";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import {
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

/** An existing key date to edit, or the set a new one goes in. */
export type KeyDateDraft = { keyDate?: KeyDate; setId?: string };

const NEW_SET = "__new__";

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

function timeZoneOptions(current: string): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([current, own, ...COMMON_TIME_ZONES].filter(Boolean))];
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
  const { data } = useActionQuery("list-key-dates", undefined, {
    staleTime: 60_000,
  });
  const sets = useMemo(() => data?.sets ?? [], [data]);
  const saveKeyDate = useSaveKeyDate();
  const deleteKeyDate = useDeleteKeyDate();
  const existing = draft.keyDate;
  const [setId, setSetId] = useState(
    existing?.setId ?? draft.setId ?? sets[0]?.id ?? NEW_SET,
  );
  const [setName, setSetName] = useState("");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [date, setDate] = useState(existing?.date ?? "");
  const [time, setTime] = useState(existing?.time ?? "");
  const [timeZone, setTimeZone] = useState(
    existing?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const newSet = setId === NEW_SET || !sets.some((set) => set.id === setId);
  const canSave =
    label.trim() !== "" && date !== "" && (!newSet || setName.trim() !== "");

  const handleSave = () => {
    if (!canSave) return;
    const input: KeyDateInput = {
      ...(existing ? { id: existing.id } : {}),
      ...(newSet ? { setName: setName.trim() } : { setId }),
      date,
      label: label.trim(),
      ...(time ? { time, timeZone } : {}),
    };
    onClose();
    saveKeyDate.mutate(input, {
      onError: (error) =>
        toast.error(t("annotations.saveFailed", { message: error.message })),
    });
  };

  const handleDelete = () => {
    if (!existing) return;
    onClose();
    deleteKeyDate.mutate(
      { id: existing.id },
      {
        onError: (error) =>
          toast.error(
            t("annotations.deleteFailed", { message: error.message }),
          ),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? t("annotations.editKeyDate")
              : t("annotations.addKeyDate")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>{t("annotations.set")}</Label>
            <Select value={newSet ? NEW_SET : setId} onValueChange={setSetId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_SET}>
                  {t("annotations.newSet")}
                </SelectItem>
              </SelectContent>
            </Select>
            {newSet ? (
              <Input
                aria-label={t("annotations.setName")}
                placeholder={t("annotations.setName")}
                value={setName}
                maxLength={80}
                onChange={(event) => setSetName(event.target.value)}
              />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-label`}>{t("annotations.label")}</Label>
            <Input
              id={`${ids}-label`}
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
              autoFocus
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
          {time ? (
            <div className="space-y-1.5">
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
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
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
