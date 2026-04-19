/**
 * AvailabilityEditor — weekly schedule grid with per-day toggles and time
 * pickers. Matches the calendar template's visual baseline.
 *
 * This is the "schedule body" — for the full per-day intervals +
 * date-override grid, compose this with a `DateOverridesEditor`
 * (not included yet; scheduling's existing per-page implementation
 * remains canonical for v0.1).
 *
 * Shadcn primitives expected in the consumer: input, label, switch.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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

const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

export interface AvailabilityEditorProps {
  value: WeeklySchedule;
  onChange: (next: WeeklySchedule) => void;
}

export function AvailabilityEditor({
  value,
  onChange,
}: AvailabilityEditorProps) {
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
      {DAYS.map(({ key, label, short }) => {
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
                aria-label={`Toggle ${label}`}
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
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={slot.end}
                  onChange={(e) => setSlot(key, "end", e.target.value)}
                  className="w-28 sm:w-32"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Unavailable</span>
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
export function summarizeAvailability(ws: WeeklySchedule): string {
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
  if (enabled.length === 0) return "No availability set";

  const weekdaysOn = weekdayKeys.every((d) => ws[d]?.enabled);
  const weekendsOn = weekendKeys.every((d) => ws[d]?.enabled);
  const weekdaysOff = weekdayKeys.every((d) => !ws[d]?.enabled);
  const weekendsOff = weekendKeys.every((d) => !ws[d]?.enabled);

  let dayLabel: string;
  if (weekdaysOn && weekendsOn) dayLabel = "Every day";
  else if (weekdaysOn && weekendsOff) dayLabel = "Weekdays";
  else if (weekdaysOff && weekendsOn) dayLabel = "Weekends";
  else {
    const shortNames: Record<DayKey, string> = {
      monday: "Mon",
      tuesday: "Tue",
      wednesday: "Wed",
      thursday: "Thu",
      friday: "Fri",
      saturday: "Sat",
      sunday: "Sun",
    };
    dayLabel = enabled.map((d) => shortNames[d]).join(", ");
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
