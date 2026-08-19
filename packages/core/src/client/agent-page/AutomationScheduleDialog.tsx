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
import { ScheduledTriggerNotice } from "./ScheduledTriggerNotice.js";
import { TimezoneSelect, browserTimezone } from "./TimezoneSelect.js";
import type { ScheduledTriggerStatus } from "./use-jobs.js";

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
  timezone: string | null;
  saving: boolean;
  error?: string | null;
  /**
   * Passed in rather than queried here so this dialog stays presentational, the
   * way the rest of its props already are. Undefined renders nothing.
   */
  scheduledTriggerStatus?: ScheduledTriggerStatus;
  onCancel: () => void;
  onSave: (next: { schedule: string; timezone: string }) => void;
}

export function AutomationScheduleDialog({
  open,
  name,
  schedule,
  timezone,
  saving,
  error,
  scheduledTriggerStatus,
  onCancel,
  onSave,
}: AutomationScheduleDialogProps) {
  const t = useT();
  const [value, setValue] = useState(schedule);
  const [zone, setZone] = useState(timezone || browserTimezone());

  useEffect(() => {
    if (!open) return;
    setValue(schedule);
    setZone(timezone || browserTimezone());
  }, [open, schedule, timezone]);

  const trimmed = value.trim();
  const valid = looksLikeCron(trimmed);
  const changed =
    trimmed !== schedule.trim() || zone !== (timezone || browserTimezone());

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
                "The clock time below is read in the timezone you pick, so 8:00 means 8:00 there.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ScheduledTriggerNotice
            status={scheduledTriggerStatus}
            variant="inline"
          />
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

          <div>
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="automation-timezone"
            >
              {t("jobs.timezone", { defaultValue: "Timezone" })}
            </label>
            <div className="mt-1">
              <TimezoneSelect
                id="automation-timezone"
                value={zone}
                disabled={saving}
                onChange={setZone}
                suggested={[browserTimezone()]}
              />
            </div>
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
            disabled={saving || !valid || !changed}
            onClick={() => onSave({ schedule: trimmed, timezone: zone })}
          >
            {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("jobs.saveSchedule", { defaultValue: "Save schedule" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
