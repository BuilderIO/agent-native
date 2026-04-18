/**
 * Month calendar grid — marks days that have available slots and lets the
 * user click into a day.
 */
import { useMemo } from "react";
import { TZDate } from "@date-fns/tz";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isBefore,
  startOfDay,
} from "date-fns";
import type { Slot } from "@agent-native/scheduling/shared";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  slots: Slot[];
  timezone: string;
  month: Date;
  selectedDate?: string;
  onSelectDate: (date: string) => void;
  isLoading?: boolean;
}

export function DatePicker(props: DatePickerProps) {
  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of props.slots) {
      const local = format(
        new TZDate(new Date(s.start).getTime(), props.timezone),
        "yyyy-MM-dd",
      );
      set.add(local);
    }
    return set;
  }, [props.slots, props.timezone]);

  const days = useMemo(() => {
    const ms = startOfMonth(props.month);
    const me = endOfMonth(props.month);
    const start = startOfWeek(ms, { weekStartsOn: 0 });
    const end = endOfWeek(me, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [props.month]);

  const todayLocal = startOfDay(new TZDate(Date.now(), props.timezone));

  return (
    <div role="grid" aria-label="Pick a date">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const iso = format(d, "yyyy-MM-dd");
          const inMonth = isSameMonth(d, props.month);
          const hasSlots = availableDays.has(iso);
          const isPast = isBefore(d, todayLocal);
          const isSelected = props.selectedDate === iso;
          const disabled = !inMonth || isPast || !hasSlots;
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              disabled={disabled}
              onClick={() => props.onSelectDate(iso)}
              className={cn(
                "aspect-square rounded-md text-sm",
                disabled && "text-muted-foreground/40",
                !disabled &&
                  "hover:bg-[color:var(--brand-accent)]/10 focus-visible:outline focus-visible:outline-2",
                isSelected &&
                  "bg-[color:var(--brand-accent)] text-white hover:bg-[color:var(--brand-accent)]",
                hasSlots && !isSelected && "font-medium",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      {props.isLoading && (
        <p className="mt-2 text-xs text-muted-foreground">
          Loading availability…
        </p>
      )}
    </div>
  );
}
