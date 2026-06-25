import type { LocaleCode } from "@agent-native/core/client";

/**
 * AvailabilityEditor — weekly schedule grid with per-day toggles and time
 * pickers. Matches the calendar template's visual baseline.
 *
 * This is the "schedule body" — for the full per-day intervals +
 * date-override grid, compose this with a `DateOverridesEditor`
 * (not included yet; scheduling's existing per-page implementation
 * remains canonical for v0.1).
 *
 * Shadcn primitives expected in the consumer: input, switch.
 */
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { schedulingMessage, useSchedulingT } from "../../i18n.js";

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface TimeSlot {
  start: string;
  end: string;
}

export interface DaySchedule {
  enabled: boolean;
  slots: TimeSlot[];
}

export type WeeklySchedule = Record<DayKey, DaySchedule>;

const DAYS: {
  key: DayKey;
  labelKey: Parameters<ReturnType<typeof useSchedulingT>>[0];
  shortKey: Parameters<ReturnType<typeof useSchedulingT>>[0];
}[] = [
  { key: "monday", labelKey: "monday", shortKey: "mon" },
  { key: "tuesday", labelKey: "tuesday", shortKey: "tue" },
  { key: "wednesday", labelKey: "wednesday", shortKey: "wed" },
  { key: "thursday", labelKey: "thursday", shortKey: "thu" },
  { key: "friday", labelKey: "friday", shortKey: "fri" },
  { key: "saturday", labelKey: "saturday", shortKey: "sat" },
  { key: "sunday", labelKey: "sunday", shortKey: "sun" },
];

export interface AvailabilityEditorProps {
  value: WeeklySchedule;
  onChange: (next: WeeklySchedule) => void;
}

export function AvailabilityEditor({
  value,
  onChange,
}: AvailabilityEditorProps) {
  const t = useSchedulingT();
  const setDay = (day: DayKey, patch: Partial<DaySchedule>) => {
    onChange({
      ...value,
      [day]: { ...value[day], ...patch },
    });
  };

  const setSlot = (day: DayKey, field: "start" | "end", next: string) => {
    const prevSlots = value[day].slots.length
      ? value[day].slots
      : [{ start: "09:00", end: "17:00" }];
    onChange({
      ...value,
      [day]: {
        ...value[day],
        slots: [{ ...prevSlots[0], [field]: next }],
      },
    });
  };

  return (
    <div className="space-y-2.5">
      {DAYS.map(({ key, labelKey, shortKey }) => {
        const label = t(labelKey);
        const short = t(shortKey);
        const day = value[key] ?? { enabled: false, slots: [] };
        const slot = day.slots[0] ?? { start: "09:00", end: "17:00" };
        return (
          <div
            key={key}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-3 sm:gap-4 sm:px-4"
          >
            <div className="flex w-28 items-center gap-3 sm:w-40">
              <Switch
                checked={day.enabled}
                onCheckedChange={(checked) => setDay(key, { enabled: checked })}
                aria-label={t("toggleDay", { day: label })}
              />
              <span className="text-sm font-medium">
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{short}</span>
              </span>
            </div>

            {day.enabled ? (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={slot.start}
                  onChange={(e) => setSlot(key, "start", e.target.value)}
                  className="w-28 sm:w-32"
                />
                <span className="text-muted-foreground">{t("to")}</span>
                <Input
                  type="time"
                  value={slot.end}
                  onChange={(e) => setSlot(key, "end", e.target.value)}
                  className="w-28 sm:w-32"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("unavailable")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Summarize a `WeeklySchedule` in a short phrase, e.g. "Weekdays, 9 am - 5 pm".
 * Useful for list-row subtitles.
 */
export function summarizeAvailability(
  ws: WeeklySchedule,
  locale: LocaleCode = "en-US",
): string {
  const weekdayKeys: DayKey[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ];
  const weekendKeys: DayKey[] = ["saturday", "sunday"];
  const allDays: DayKey[] = [...weekdayKeys, ...weekendKeys];

  const enabled = allDays.filter((d) => ws[d]?.enabled);
  if (enabled.length === 0)
    return schedulingMessage(locale, "noAvailabilitySet");

  const weekdaysOn = weekdayKeys.every((d) => ws[d]?.enabled);
  const weekendsOn = weekendKeys.every((d) => ws[d]?.enabled);
  const weekdaysOff = weekdayKeys.every((d) => !ws[d]?.enabled);
  const weekendsOff = weekendKeys.every((d) => !ws[d]?.enabled);

  let dayLabel: string;
  if (weekdaysOn && weekendsOn)
    dayLabel = schedulingMessage(locale, "everyDay");
  else if (weekdaysOn && weekendsOff)
    dayLabel = schedulingMessage(locale, "weekdays");
  else if (weekdaysOff && weekendsOn)
    dayLabel = schedulingMessage(locale, "weekends");
  else {
    const shortNames: Record<DayKey, Parameters<typeof schedulingMessage>[1]> =
      {
        monday: "mon",
        tuesday: "tue",
        wednesday: "wed",
        thursday: "thu",
        friday: "fri",
        saturday: "sat",
        sunday: "sun",
      };
    dayLabel = enabled
      .map((d) => schedulingMessage(locale, shortNames[d]))
      .join(", ");
  }

  const slot = ws[enabled[0]].slots[0];
  if (!slot) return dayLabel;

  return `${dayLabel}, ${formatTime12(slot.start)} - ${formatTime12(slot.end)}`;
}

function formatTime12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m
    ? `${hour}:${String(m).padStart(2, "0")} ${suffix}`
    : `${hour} ${suffix}`;
}
