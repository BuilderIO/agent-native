import { Button } from "@agent-native/toolkit/ui/button";
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
import { isValidAutomationSchedule } from "./automation-schedule-fields.js";
import { AutomationScheduleFields } from "./AutomationScheduleFields.js";
import { browserTimezone } from "./TimezoneSelect.js";

export interface AutomationScheduleDialogProps {
  open: boolean;
  name: string;
  schedule: string;
  timezone: string | null;
  saving: boolean;
  error?: string | null;
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

  const valid = isValidAutomationSchedule(value);
  const changed =
    value !== schedule || zone !== (timezone || browserTimezone());

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
          <AutomationScheduleFields
            schedule={value}
            timezone={zone}
            disabled={saving}
            onScheduleChange={setValue}
            onTimezoneChange={setZone}
          />

          {value && !valid ? (
            <p className="text-xs text-destructive">
              {t("jobs.cronInvalid", {
                defaultValue: "Enter a valid cron expression.",
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
            onClick={() => onSave({ schedule: value, timezone: zone })}
          >
            {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("jobs.saveSchedule", { defaultValue: "Save schedule" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
