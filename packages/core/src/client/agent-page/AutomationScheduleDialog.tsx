import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconCode, IconLoader2 } from "@tabler/icons-react";
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
import {
  AUTOMATION_WEEKDAYS,
  automationScheduleDraftFromCron,
  automationScheduleToCron,
  formatAutomationTime,
  type AutomationScheduleDraft,
  type AutomationSchedulePreset,
  type AutomationScheduleUnit,
} from "./automation-schedule.js";
import type { ScheduledTriggerState } from "./scheduled-trigger-state.js";
import { ScheduledTriggerNotice } from "./ScheduledTriggerNotice.js";
import { TimezoneSelect, browserTimezone } from "./TimezoneSelect.js";

const FRIENDLY_PRESETS: {
  value: AutomationSchedulePreset;
  label: string;
  detail: string;
  draft: Partial<AutomationScheduleDraft>;
}[] = [
  {
    value: "hourly",
    label: "Every hour",
    detail: "At the top of the hour",
    draft: { preset: "hourly" },
  },
  {
    value: "daily-midnight",
    label: "Every day at midnight",
    detail: "12:00 AM",
    draft: { preset: "daily-midnight" },
  },
  {
    value: "daily-noon",
    label: "Every day at noon",
    detail: "12:00 PM",
    draft: { preset: "daily-noon" },
  },
  {
    value: "weekdays",
    label: "Every weekday",
    detail: "Monday to Friday at 9:00 AM",
    draft: { preset: "weekdays", time: "09:00" },
  },
  {
    value: "weekly",
    label: "Every week",
    detail: "Sunday at 9:00 AM",
    draft: { preset: "weekly", weekday: 0, time: "09:00" },
  },
];

const CRON_FIELD_COUNT = 5;

function looksLikeCron(value: string): boolean {
  return value.trim().split(/\s+/).length === CRON_FIELD_COUNT;
}

function updateTime(draft: AutomationScheduleDraft, value: string) {
  return { ...draft, time: value };
}

type Translate = ReturnType<typeof useT>;

function schedulePresetLabel(
  t: Translate,
  value: AutomationSchedulePreset,
  fallback: string,
): string {
  switch (value) {
    case "hourly":
      return t("jobs.schedulePreset.hourly", { defaultValue: fallback });
    case "daily-midnight":
      return t("jobs.schedulePreset.dailyMidnight", {
        defaultValue: fallback,
      });
    case "daily-noon":
      return t("jobs.schedulePreset.dailyNoon", { defaultValue: fallback });
    case "weekdays":
      return t("jobs.schedulePreset.weekdays", { defaultValue: fallback });
    case "weekly":
      return t("jobs.schedulePreset.weekly", { defaultValue: fallback });
    case "custom":
      return t("jobs.schedulePreset.custom", { defaultValue: fallback });
  }
}

export interface AutomationScheduleDialogProps {
  open: boolean;
  name: string;
  schedule: string;
  timezone: string | null;
  saving: boolean;
  error?: string | null;
  scheduledTriggerState: ScheduledTriggerState;
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
  scheduledTriggerState,
  onCancel,
  onSave,
}: AutomationScheduleDialogProps) {
  const t = useT();
  const [draft, setDraft] = useState<AutomationScheduleDraft>(
    () => automationScheduleDraftFromCron(schedule).draft,
  );
  const [advanced, setAdvanced] = useState(
    () => !automationScheduleDraftFromCron(schedule).recognized,
  );
  const [advancedValue, setAdvancedValue] = useState(schedule);
  const [zone, setZone] = useState(timezone || browserTimezone());

  useEffect(() => {
    if (!open) return;
    const parsed = automationScheduleDraftFromCron(schedule);
    setDraft(parsed.draft);
    setAdvanced(!parsed.recognized);
    setAdvancedValue(schedule);
    setZone(timezone || browserTimezone());
  }, [open, schedule, timezone]);

  const friendly = automationScheduleToCron(draft);
  const activeSchedule = advanced
    ? advancedValue.trim()
    : (friendly.schedule ?? "");
  const valid = looksLikeCron(activeSchedule) && (advanced || !friendly.error);
  const changed =
    activeSchedule !== schedule.trim() ||
    zone !== (timezone || browserTimezone());
  const customMinute = Number(draft.time.split(":")[1] ?? 0);

  function choosePreset(
    value: AutomationSchedulePreset,
    presetDraft: Partial<AutomationScheduleDraft>,
  ) {
    setDraft((current) => ({ ...current, ...presetDraft, preset: value }));
    setAdvanced(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-xl">
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
                "Choose a cadence in plain language. Times use the timezone you pick.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ScheduledTriggerNotice
            state={scheduledTriggerState}
            variant="inline"
          />

          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground">
              {t("jobs.repeat", { defaultValue: "Repeat" })}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {FRIENDLY_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={!advanced && draft.preset === preset.value}
                  disabled={saving}
                  className={
                    "rounded-lg border px-3 py-2 text-left transition-colors " +
                    (!advanced && draft.preset === preset.value
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border/70 bg-background hover:bg-muted/50")
                  }
                  onClick={() => choosePreset(preset.value, preset.draft)}
                >
                  <span className="block text-sm font-medium">
                    {schedulePresetLabel(t, preset.value, preset.label)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {preset.detail}
                  </span>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={!advanced && draft.preset === "custom"}
                disabled={saving}
                className={
                  "rounded-lg border px-3 py-2 text-left transition-colors " +
                  (!advanced && draft.preset === "custom"
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border/70 bg-background hover:bg-muted/50")
                }
                onClick={() =>
                  choosePreset("custom", {
                    preset: "custom",
                    unit: draft.unit || "day",
                  })
                }
              >
                <span className="block text-sm font-medium">
                  {t("jobs.schedulePreset.custom", {
                    defaultValue: "Custom",
                  })}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("jobs.schedulePreset.customDetail", {
                    defaultValue: "Set your own repeat pattern",
                  })}
                </span>
              </button>
            </div>
          </div>

          {!advanced && draft.preset === "custom" ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                <label className="space-y-1.5 text-xs text-muted-foreground">
                  <span>
                    {t("jobs.repeatEvery", { defaultValue: "Repeat every" })}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={draft.interval}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        interval: Math.max(1, Number(event.target.value) || 1),
                      }))
                    }
                    className="h-9 bg-background text-sm"
                  />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground">
                  <span>
                    {t("jobs.scheduleUnit", { defaultValue: "Unit" })}
                  </span>
                  <Select
                    value={draft.unit}
                    disabled={saving}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        unit: value as AutomationScheduleUnit,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 bg-background text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hour">
                        {t("jobs.hours", { defaultValue: "hour(s)" })}
                      </SelectItem>
                      <SelectItem value="day">
                        {t("jobs.days", { defaultValue: "day(s)" })}
                      </SelectItem>
                      <SelectItem value="week">
                        {t("jobs.weeks", { defaultValue: "week(s)" })}
                      </SelectItem>
                      <SelectItem value="month">
                        {t("jobs.months", { defaultValue: "month(s)" })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {draft.unit === "hour" ? (
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>
                    {t("jobs.atMinute", { defaultValue: "At minute" })}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={customMinute}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) =>
                        updateTime(
                          current,
                          "00:" +
                            String(
                              Math.min(
                                59,
                                Math.max(0, Number(event.target.value) || 0),
                              ),
                            ).padStart(2, "0"),
                        ),
                      )
                    }
                    className="h-9 bg-background text-sm"
                  />
                </label>
              ) : null}

              {draft.unit === "week" ? (
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>{t("jobs.onDay", { defaultValue: "On" })}</span>
                  <Select
                    value={String(draft.weekday)}
                    disabled={saving}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        weekday: Number(value),
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 bg-background text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTOMATION_WEEKDAYS.map((day) => (
                        <SelectItem key={day.value} value={String(day.value)}>
                          {day.short}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : null}

              {draft.unit === "month" ? (
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>
                    {t("jobs.dayOfMonth", { defaultValue: "Day of month" })}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={draft.monthDay}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        monthDay: Math.min(
                          31,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      }))
                    }
                    className="h-9 bg-background text-sm"
                  />
                </label>
              ) : null}

              {draft.unit !== "hour" ? (
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>{t("jobs.atTime", { defaultValue: "At" })}</span>
                  <Input
                    type="time"
                    value={draft.time}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) =>
                        updateTime(current, event.target.value),
                      )
                    }
                    className="h-9 bg-background text-sm"
                  />
                </label>
              ) : null}

              {friendly.error === "weekly-interval" ? (
                <p className="text-xs text-destructive">
                  {t("jobs.weeklyIntervalAdvanced", {
                    defaultValue:
                      "Every few weeks needs the Advanced cron editor below.",
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {!advanced && friendly.schedule ? (
            <p className="text-xs text-muted-foreground">
              {t("jobs.schedulePreview", {
                defaultValue: "Runs {{time}}.",
                time:
                  draft.preset === "hourly"
                    ? "at the start of every hour"
                    : draft.preset === "daily-midnight"
                      ? "every day at midnight"
                      : draft.preset === "daily-noon"
                        ? "every day at noon"
                        : "at " + formatAutomationTime(draft.time),
              })}
            </p>
          ) : null}
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

          <details
            className="group rounded-lg border border-border/70 bg-muted/20"
            open={advanced}
            onToggle={(event) => {
              const next = event.currentTarget.open;
              if (next && !advanced && friendly.schedule) {
                setAdvancedValue(friendly.schedule);
              }
              setAdvanced(next);
            }}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <IconCode className="size-4 text-muted-foreground" />
              {t("jobs.advancedSchedule", {
                defaultValue: "Advanced - cron expression",
              })}
              <span className="ms-auto text-muted-foreground group-open:hidden">
                {t("jobs.show", { defaultValue: "Show" })}
              </span>
              <span className="ms-auto hidden text-muted-foreground group-open:inline">
                {t("jobs.hide", { defaultValue: "Hide" })}
              </span>
            </summary>
            <div className="border-t border-border/60 px-3 pb-3 pt-2.5">
              <Input
                id="automation-schedule"
                className="font-mono text-sm"
                value={advancedValue}
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
                onFocus={() => setAdvanced(true)}
                onChange={(event) => {
                  setAdvanced(true);
                  setAdvancedValue(event.target.value);
                }}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("jobs.cronFormatHint", {
                  defaultValue: "minute hour day-of-month month day-of-week",
                })}
              </p>
            </div>
          </details>

          {activeSchedule && !valid ? (
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
            onClick={() => onSave({ schedule: activeSchedule, timezone: zone })}
          >
            {saving ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("jobs.saveSchedule", { defaultValue: "Save schedule" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
