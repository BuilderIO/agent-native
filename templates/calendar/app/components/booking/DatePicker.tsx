import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isBefore,
  addDays,
  addMonths,
  subMonths,
  format,
  startOfDay,
  getDay,
} from "date-fns";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AvailabilityConfig } from "@shared/api";

interface DatePickerProps {
  selectedDate: Date | null;
  onSelect: (date: Date) => void;
  availability: AvailabilityConfig;
  availableDates: string[];
  availabilityLoading?: boolean;
  viewMonth: Date;
  onViewMonthChange: (month: Date) => void;
}

const WEEKDAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const DAY_MAP: Record<number, keyof AvailabilityConfig["weeklySchedule"]> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export function DatePicker({
  selectedDate,
  onSelect,
  availability,
  availableDates,
  availabilityLoading = false,
  viewMonth,
  onViewMonthChange,
}: DatePickerProps) {
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const availableDateSet = useMemo(
    () => new Set(availableDates),
    [availableDates],
  );

  const today = startOfDay(new Date());
  const maxDate = addDays(today, availability.maxAdvanceDays);

  function isDayDisabled(day: Date) {
    const dateKey = format(day, "yyyy-MM-dd");
    if (isBefore(day, today)) return true;
    if (isBefore(maxDate, day)) return true;
    const dayName = DAY_MAP[getDay(day)];
    if (!availability.weeklySchedule[dayName]?.enabled) return true;
    if (availabilityLoading) return true;
    if (!availableDateSet.has(dateKey)) return true;
    return false;
  }

  return (
    <div className="w-full max-w-sm">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onViewMonthChange(subMonths(viewMonth, 1))}
        >
          <IconChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(viewMonth, "MMMM yyyy")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onViewMonthChange(addMonths(viewMonth, 1))}
        >
          <IconChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAY_HEADERS.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-xs font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = isSameMonth(day, viewMonth);
          const disabled = !inMonth || isDayDisabled(day);
          const selected = selectedDate && isSameDay(day, selectedDate);
          const todayMark = isToday(day);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelect(day)}
              disabled={disabled}
              className={cn(
                "flex h-10 w-full items-center justify-center rounded-md text-sm transition-colors",
                !inMonth && "opacity-0 pointer-events-none",
                inMonth && !disabled && "hover:bg-accent cursor-pointer",
                disabled && "opacity-30 cursor-not-allowed",
                selected &&
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                todayMark && !selected && "border border-primary/50",
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
      {availabilityLoading && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Checking availability…
        </p>
      )}
    </div>
  );
}
