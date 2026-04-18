/**
 * Month calendar grid — marks days that have available slots and lets the
 * user click into a day. Cal.com-style: subtle dot under each available day.
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
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i}>{d}</div>
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
                "relative aspect-square rounded-md text-sm transition-none",
                !inMonth && "opacity-0 pointer-events-none",
                disabled && inMonth && "text-muted-foreground/40",
                !disabled && "hover:bg-muted",
                !disabled && !isSelected && "bg-muted/40",
                !disabled && !isSelected && "font-medium",
                isSelected && "booker-accent-bg font-semibold",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              {inMonth ? d.getDate() : ""}
              {hasSlots && !isSelected && !disabled && (
                <span
                  className="booker-accent pointer-events-none absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ background: "currentColor" }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
      {props.isLoading && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Loading availability…
        </p>
      )}
    </div>
  );
}
