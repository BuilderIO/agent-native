import { useT } from "@agent-native/core/client/i18n";
import { getWeekdayOrder, getWeekStartsOn } from "@shared/calendar-week";
import {
  IconChevronUp,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  setMonth,
  setYear,
  getMonth,
  getYear,
} from "date-fns";
import { useState, useMemo } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function MonthYearPicker({
  viewMonth,
  onPick,
  onClose,
}: {
  viewMonth: Date;
  onPick: (date: Date) => void;
  onClose: () => void;
}) {
  const [year, setYearState] = useState(() => getYear(viewMonth));
  const today = new Date();
  const todayMonth = getMonth(today);
  const todayYear = getYear(today);
  const viewedMonthIdx = getMonth(viewMonth);
  const viewedYear = getYear(viewMonth);
  const t = useT();

  return (
    <div className="w-56 p-2">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYearState(year - 1)}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("sidebar.previousYear")}
        >
          <IconChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
        <span className="text-sm font-semibold">{year}</span>
        <button
          type="button"
          onClick={() => setYearState(year + 1)}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("sidebar.nextYear")}
        >
          <IconChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_LABELS.map((label, idx) => {
          const isCurrent = idx === todayMonth && year === todayYear;
          const isSelected = idx === viewedMonthIdx && year === viewedYear;
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                onPick(setMonth(setYear(viewMonth, year), idx));
                onClose();
              }}
              className={cn(
                "flex h-8 items-center justify-center rounded text-xs",
                isSelected
                  ? "bg-primary text-primary-foreground font-semibold"
                  : isCurrent
                    ? "ring-1 ring-primary text-foreground hover:bg-accent"
                    : "text-foreground hover:bg-accent",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MiniCalendar({
  selectedDate,
  onDateSelect,
}: {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate));
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: settings } = useSettings();
  const weekStartsOn = getWeekStartsOn(settings?.weekStart);
  const t = useT();

  // Follow `selectedDate` only when its month actually changes. Comparing the
  // Date by identity instead would re-run on every render that rebuilds an
  // equal Date (agent navigation, a settings refetch) and snap the browsed
  // month back, which is what made the month chevrons look like no-ops.
  const selectedMonthKey = format(selectedDate, "yyyy-MM");
  const [syncedMonthKey, setSyncedMonthKey] = useState(selectedMonthKey);
  if (syncedMonthKey !== selectedMonthKey) {
    setSyncedMonthKey(selectedMonthKey);
    setViewMonth(startOfMonth(selectedDate));
  }

  const days = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn });

    const result: Date[] = [];
    let current = calStart;
    while (current <= calEnd) {
      result.push(current);
      current = addDays(current, 1);
    }
    return result;
  }, [viewMonth, weekStartsOn]);

  const weekdays = getWeekdayOrder(weekStartsOn).map(
    (day) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][day],
  );

  return (
    <div className="px-3 py-3">
      {/* Month header with navigation */}
      <div className="mb-2 flex items-center justify-between">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="-ms-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              {format(viewMonth, "MMMM yyyy")}
              <IconChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
            <MonthYearPicker
              viewMonth={viewMonth}
              onPick={(d) => setViewMonth(startOfMonth(d))}
              onClose={() => setPickerOpen(false)}
            />
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setViewMonth((month) => subMonths(month, 1))}
            aria-label={t("sidebar.previousMonth")}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMonth((month) => addMonths(month, 1))}
            aria-label={t("sidebar.nextMonth")}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="mb-0.5 grid grid-cols-7">
        {weekdays.map((d) => (
          <div
            key={d}
            className="flex h-6 items-center justify-center text-[10px] font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = isSameMonth(day, viewMonth);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDateSelect(day)}
              className={cn(
                "flex h-6 w-full items-center justify-center rounded-full text-[11px] transition-colors",
                !inMonth && "text-muted-foreground/40",
                inMonth &&
                  !today &&
                  !selected &&
                  "text-foreground/80 hover:bg-accent",
                today &&
                  !selected &&
                  "bg-primary font-semibold text-primary-foreground",
                selected &&
                  !today &&
                  "ring-1 ring-primary font-semibold text-primary",
                selected &&
                  today &&
                  "bg-primary font-semibold text-primary-foreground ring-1 ring-primary ring-offset-1 ring-offset-card",
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
