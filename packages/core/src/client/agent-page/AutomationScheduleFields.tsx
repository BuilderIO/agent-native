import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useT } from "../i18n.js";
import {
  DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE,
  friendlyAutomationScheduleToCron,
  parseFriendlyAutomationSchedule,
  timeValue,
  withTimeValue,
  type AutomationFrequency,
  type FriendlyAutomationSchedule,
} from "./automation-schedule-fields.js";
import { TimezoneSelect, browserTimezone } from "./TimezoneSelect.js";

const FREQUENCIES: AutomationFrequency[] = [
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
];

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export interface AutomationScheduleFieldsProps {
  schedule: string;
  timezone: string;
  disabled?: boolean;
  onScheduleChange: (schedule: string) => void;
  onTimezoneChange: (timezone: string) => void;
}

export function AutomationScheduleFields({
  schedule,
  timezone,
  disabled,
  onScheduleChange,
  onTimezoneChange,
}: AutomationScheduleFieldsProps) {
  const t = useT();
  const friendly = parseFriendlyAutomationSchedule(schedule);
  const [advancedOpen, setAdvancedOpen] = useState(() => friendly === null);

  useEffect(() => {
    if (!friendly) setAdvancedOpen(true);
  }, [friendly]);

  const frequencyLabels: Record<AutomationFrequency, string> = {
    hourly: t("jobs.scheduleFrequencyHourly", { defaultValue: "Hourly" }),
    daily: t("jobs.scheduleFrequencyDaily", { defaultValue: "Daily" }),
    weekdays: t("jobs.scheduleFrequencyWeekdays", {
      defaultValue: "Weekdays",
    }),
    weekly: t("jobs.scheduleFrequencyWeekly", { defaultValue: "Weekly" }),
    monthly: t("jobs.scheduleFrequencyMonthly", { defaultValue: "Monthly" }),
  };
  const weekdayLabels = [
    t("jobs.weekdaySunday", { defaultValue: "Sunday" }),
    t("jobs.weekdayMonday", { defaultValue: "Monday" }),
    t("jobs.weekdayTuesday", { defaultValue: "Tuesday" }),
    t("jobs.weekdayWednesday", { defaultValue: "Wednesday" }),
    t("jobs.weekdayThursday", { defaultValue: "Thursday" }),
    t("jobs.weekdayFriday", { defaultValue: "Friday" }),
    t("jobs.weekdaySaturday", { defaultValue: "Saturday" }),
  ];

  function updateFriendly(next: FriendlyAutomationSchedule) {
    onScheduleChange(friendlyAutomationScheduleToCron(next));
  }

  function chooseFrequency(frequency: AutomationFrequency) {
    updateFriendly({
      ...(friendly ?? DEFAULT_FRIENDLY_AUTOMATION_SCHEDULE),
      frequency,
    });
  }

  const friendlySummary = friendly
    ? scheduleSummary(friendly, timezone, frequencyLabels, weekdayLabels, t)
    : null;

  return (
    <div className="space-y-4">
      {friendly ? (
        <>
          <div>
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="automation-frequency"
            >
              {t("jobs.scheduleFrequency", { defaultValue: "Frequency" })}
            </label>
            <Select
              value={friendly.frequency}
              disabled={disabled}
              onValueChange={(value) =>
                chooseFrequency(value as AutomationFrequency)
              }
            >
              <SelectTrigger id="automation-frequency" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {frequencyLabels[frequency]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {friendly.frequency === "hourly" ? (
              <div>
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="automation-minute"
                >
                  {t("jobs.scheduleMinute", { defaultValue: "Minute" })}
                </label>
                <Input
                  id="automation-minute"
                  className="mt-1 tabular-nums"
                  type="number"
                  min={0}
                  max={59}
                  value={friendly.minute}
                  disabled={disabled}
                  onChange={(event) => {
                    const minute = event.currentTarget.valueAsNumber;
                    if (
                      Number.isInteger(minute) &&
                      minute >= 0 &&
                      minute <= 59
                    ) {
                      updateFriendly({ ...friendly, minute });
                    }
                  }}
                />
              </div>
            ) : (
              <div>
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="automation-time"
                >
                  {t("jobs.scheduleTime", { defaultValue: "Time" })}
                </label>
                <Input
                  id="automation-time"
                  className="mt-1 tabular-nums"
                  type="time"
                  value={timeValue(friendly)}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = withTimeValue(
                      friendly,
                      event.currentTarget.value,
                    );
                    if (next) updateFriendly(next);
                  }}
                />
              </div>
            )}

            {friendly.frequency === "weekly" ? (
              <div>
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="automation-weekday"
                >
                  {t("jobs.scheduleWeekday", { defaultValue: "Day" })}
                </label>
                <Select
                  value={String(friendly.weekday)}
                  disabled={disabled}
                  onValueChange={(value) =>
                    updateFriendly({ ...friendly, weekday: Number(value) })
                  }
                >
                  <SelectTrigger id="automation-weekday" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((weekday) => (
                      <SelectItem key={weekday} value={String(weekday)}>
                        {weekdayLabels[weekday]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {friendly.frequency === "monthly" ? (
              <div>
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="automation-month-day"
                >
                  {t("jobs.scheduleMonthDay", {
                    defaultValue: "Day of month",
                  })}
                </label>
                <Input
                  id="automation-month-day"
                  className="mt-1 tabular-nums"
                  type="number"
                  min={1}
                  max={31}
                  value={friendly.dayOfMonth}
                  disabled={disabled}
                  onChange={(event) => {
                    const dayOfMonth = event.currentTarget.valueAsNumber;
                    if (
                      Number.isInteger(dayOfMonth) &&
                      dayOfMonth >= 1 &&
                      dayOfMonth <= 31
                    ) {
                      updateFriendly({ ...friendly, dayOfMonth });
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("jobs.scheduleAdvancedDetected", {
            defaultValue:
              "This schedule uses a custom cron pattern. Edit it in Advanced mode.",
          })}
        </p>
      )}

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
            value={timezone}
            disabled={disabled}
            onChange={onTimezoneChange}
            suggested={[browserTimezone()]}
          />
        </div>
      </div>

      {friendlySummary ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">
            {t("jobs.scheduleSummaryLabel", { defaultValue: "Runs" })}
          </span>{" "}
          <span className="text-muted-foreground">{friendlySummary}</span>
        </div>
      ) : null}

      <div className="border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 cursor-pointer gap-1 px-1 text-xs"
          disabled={disabled || (!advancedOpen && !friendly)}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? (
            <IconChevronDown className="size-3.5" />
          ) : (
            <IconChevronRight className="size-3.5 rtl:rotate-180" />
          )}
          {t("jobs.scheduleAdvanced", { defaultValue: "Advanced" })}
        </Button>

        {advancedOpen ? (
          <div className="mt-2">
            <label
              className="text-xs font-medium text-foreground"
              htmlFor="automation-schedule"
            >
              {t("jobs.cronExpression", { defaultValue: "Cron expression" })}
            </label>
            <Input
              id="automation-schedule"
              className="mt-1 font-mono text-sm"
              value={schedule}
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              onChange={(event) => onScheduleChange(event.currentTarget.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("jobs.cronFormatHint", {
                defaultValue: "minute hour day-of-month month day-of-week",
              })}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function scheduleSummary(
  schedule: FriendlyAutomationSchedule,
  timezone: string,
  frequencyLabels: Record<AutomationFrequency, string>,
  weekdayLabels: string[],
  t: ReturnType<typeof useT>,
): string {
  const time = timeValue(schedule);
  switch (schedule.frequency) {
    case "hourly":
      return t("jobs.scheduleSummaryHourly", {
        defaultValue: "hourly at minute {{minute}} ({{timezone}})",
        minute: String(schedule.minute).padStart(2, "0"),
        timezone,
      });
    case "weekly":
      return t("jobs.scheduleSummaryWeekly", {
        defaultValue: "every {{weekday}} at {{time}} ({{timezone}})",
        weekday: weekdayLabels[schedule.weekday],
        time,
        timezone,
      });
    case "monthly":
      return t("jobs.scheduleSummaryMonthly", {
        defaultValue: "monthly on day {{day}} at {{time}} ({{timezone}})",
        day: String(schedule.dayOfMonth),
        time,
        timezone,
      });
    default:
      return t("jobs.scheduleSummaryTimed", {
        defaultValue: "{{frequency}} at {{time}} ({{timezone}})",
        frequency: frequencyLabels[schedule.frequency],
        time,
        timezone,
      });
  }
}
