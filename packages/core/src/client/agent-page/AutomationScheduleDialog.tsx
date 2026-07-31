import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { useT } from "../i18n.js";

const PRESETS: { label: string; cron: string }[] = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every day at 8:00", cron: "0 8 * * *" },
  { label: "Every weekday at 9:00", cron: "0 9 * * 1-5" },
  { label: "Every Monday at 8:00", cron: "0 8 * * 1" },
];

const CRON_FIELD_COUNT = 5;

function looksLikeCron(value: string): boolean {
  return value.trim().split(/\s+/).length === CRON_FIELD_COUNT;
}

export interface AutomationScheduleDialogProps {
  open: boolean;
  name: string;
  schedule: string;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (schedule: string) => void;
}

export function AutomationScheduleDialog({
  open,
  name,
  schedule,
  saving,
  error,
  onCancel,
  onSave,
}: AutomationScheduleDialogProps) {
  const t = useT();
  const [value, setValue] = useState(schedule);

  useEffect(() => {
    if (open) setValue(schedule);
  }, [open, schedule]);

  const trimmed = value.trim();
  const valid = looksLikeCron(trimmed);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("jobs.editScheduleTitle", {
              defaultValue: "Edit schedule — {{name}}",
              name: name.replace(/-/g, " "),
            })}
          </DialogTitle>
          <DialogDescription>
            {t("jobs.editScheduleDescription", {
              defaultValue:
                "Cron fields are evaluated in the server's timezone, so the next run below may land at a different local time.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="automation-schedule"
            >
              {t("jobs.cronExpression", { defaultValue: "Cron expression" })}
            </label>
            <Input
              id="automation-schedule"
              className="mt-1 font-mono text-sm"
              value={value}
              spellCheck={false}
              autoComplete="off"
              disabled={saving}
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("jobs.cronFormatHint", {
                defaultValue: "minute hour day-of-month month day-of-week",
              })}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Button
                key={preset.cron}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 cursor-pointer text-[11px]"
                disabled={saving}
                onClick={() => setValue(preset.cron)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {trimmed && !valid ? (
            <p className="text-xs text-destructive">
              {t("jobs.cronFieldCount", {
                defaultValue: "A cron expression needs exactly 5 fields.",
              })}
            </p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            disabled={saving}
            onClick={onCancel}
          >
            {t("jobs.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            disabled={saving || !valid || trimmed === schedule.trim()}
            onClick={() => onSave(trimmed)}
          >
            {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("jobs.saveSchedule", { defaultValue: "Save schedule" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
