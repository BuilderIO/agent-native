import { useId } from "react";

import { useWorkflowCanvasStrings } from "../../strings";
import { Field, SelectInput, TextInput } from "../fields";
import type { FormProps } from "./types";
import { withOptional } from "./types";

type Settings = FormProps<"trigger">["settings"];
type Schedule = Settings["schedule"];
type ScheduleKind = "every" | "daily" | "weekdays" | "weekly";

const TIMEZONE_EXAMPLE = "America/New_York";
const INTERVALS = ["5m", "10m", "15m", "30m", "60m"] as const;

function kindOf(schedule: Schedule): ScheduleKind {
  if ("every" in schedule) return "every";
  if ("daily" in schedule) return "daily";
  if ("weekdays" in schedule) return "weekdays";
  return "weekly";
}

function timeOf(schedule: Schedule): string {
  if ("daily" in schedule) return schedule.daily.at;
  if ("weekdays" in schedule) return schedule.weekdays.at;
  if ("weekly" in schedule) return schedule.weekly.at;
  return "09:00";
}

function withTime(schedule: Schedule, at: string): Schedule {
  if ("daily" in schedule) return { daily: { at } };
  if ("weekdays" in schedule) return { weekdays: { at } };
  if ("weekly" in schedule) return { weekly: { ...schedule.weekly, at } };
  return schedule;
}

function scheduleFor(kind: ScheduleKind, previous: Schedule): Schedule {
  const at = timeOf(previous);
  switch (kind) {
    case "every":
      return { every: "15m" };
    case "daily":
      return { daily: { at } };
    case "weekdays":
      return { weekdays: { at } };
    case "weekly":
      return { weekly: { day: 1, at } };
  }
}

export function TriggerForm({ settings, onChange }: FormProps<"trigger">) {
  const s = useWorkflowCanvasStrings();
  const kindOptions = (
    Object.keys(s.inspector.trigger.kinds) as ScheduleKind[]
  ).map((value) => ({ value, label: s.inspector.trigger.kinds[value] }));
  const intervalOptions = INTERVALS.map((value) => ({
    value,
    label: s.inspector.trigger.intervals[value],
  }));
  const dayOptions = s.weekday.map((label, index) => ({
    value: String(index),
    label,
  }));

  const id = useId();
  const { schedule } = settings;
  const kind = kindOf(schedule);
  return (
    <div className="flex flex-col gap-4">
      <Field label={s.inspector.trigger.schedule} htmlFor={`${id}-kind`}>
        <SelectInput
          id={`${id}-kind`}
          value={kind}
          options={kindOptions}
          onChange={(next) =>
            onChange({ ...settings, schedule: scheduleFor(next, schedule) })
          }
        />
      </Field>
      {"every" in schedule && (
        <Field label={s.inspector.trigger.every} htmlFor={`${id}-every`}>
          <SelectInput
            id={`${id}-every`}
            value={schedule.every}
            options={intervalOptions}
            onChange={(every) => onChange({ ...settings, schedule: { every } })}
          />
        </Field>
      )}
      {"weekly" in schedule && (
        <Field label={s.inspector.trigger.day} htmlFor={`${id}-day`}>
          <SelectInput
            id={`${id}-day`}
            value={String(schedule.weekly.day)}
            options={dayOptions}
            onChange={(day) =>
              onChange({
                ...settings,
                schedule: { weekly: { ...schedule.weekly, day: Number(day) } },
              })
            }
          />
        </Field>
      )}
      {kind !== "every" && (
        <Field label={s.inspector.trigger.at} htmlFor={`${id}-at`}>
          <TextInput
            id={`${id}-at`}
            type="time"
            value={timeOf(schedule)}
            onChange={(at) => {
              if (at !== "")
                onChange({ ...settings, schedule: withTime(schedule, at) });
            }}
          />
        </Field>
      )}
      <Field label={s.inspector.trigger.timezone} htmlFor={`${id}-tz`}>
        <TextInput
          id={`${id}-tz`}
          value={settings.timezone ?? ""}
          placeholder={TIMEZONE_EXAMPLE}
          onChange={(timezone) =>
            onChange(withOptional(settings, "timezone", timezone))
          }
        />
      </Field>
    </div>
  );
}
