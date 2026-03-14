import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachHourOfInterval,
  isSameDay,
  isToday,
  format,
  parseISO,
  differenceInMinutes,
  startOfDay,
  set,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

interface WeekViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const START_HOUR = 6;
const END_HOUR = 22;
const HOUR_HEIGHT = 60; // px per hour

export function WeekView({ events, selectedDate, onDateSelect, onEventClick }: WeekViewProps) {
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const hours = eachHourOfInterval({
    start: set(weekStart, { hours: START_HOUR, minutes: 0 }),
    end: set(weekStart, { hours: END_HOUR, minutes: 0 }),
  });

  function getEventsForDay(day: Date) {
    return events.filter((e) => isSameDay(parseISO(e.start), day));
  }

  function getEventStyle(event: CalendarEvent) {
    const start = parseISO(event.start);
    const end = parseISO(event.end);
    const dayStart = set(startOfDay(start), { hours: START_HOUR });
    const topMinutes = Math.max(0, differenceInMinutes(start, dayStart));
    const durationMinutes = Math.max(15, differenceInMinutes(end, start));
    return {
      top: `${(topMinutes / 60) * HOUR_HEIGHT}px`,
      height: `${(durationMinutes / 60) * HOUR_HEIGHT}px`,
    };
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-10 grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background">
        <div className="border-r border-border" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            onClick={() => onDateSelect(day)}
            className={cn(
              "cursor-pointer border-r border-border py-2 text-center transition-colors hover:bg-accent/50",
              isToday(day) && "bg-primary/5"
            )}
          >
            <div className="text-xs text-muted-foreground">{format(day, "EEE")}</div>
            <div
              className={cn(
                "mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
                isToday(day) && "bg-primary text-primary-foreground"
              )}
            >
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="grid flex-1 grid-cols-[60px_repeat(7,1fr)]">
        {/* Hour labels */}
        <div className="border-r border-border">
          {hours.map((hour) => (
            <div
              key={hour.toISOString()}
              className="relative border-b border-border"
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              <span className="absolute -top-2.5 right-2 text-xs text-muted-foreground">
                {format(hour, "h a")}
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const dayEvents = getEventsForDay(day);
          return (
            <div
              key={day.toISOString()}
              className="relative border-r border-border"
            >
              {/* Hour grid lines */}
              {hours.map((hour) => (
                <div
                  key={hour.toISOString()}
                  className="border-b border-border"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                />
              ))}

              {/* Events */}
              {dayEvents.map((event) => {
                if (event.allDay) return null;
                const style = getEventStyle(event);
                return (
                  <button
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className={cn(
                      "absolute left-0.5 right-1 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs transition-opacity hover:opacity-80",
                      event.source === "google"
                        ? "bg-green-500/20 border-l-2 border-l-green-500 text-green-300"
                        : "bg-primary/20 border-l-2 border-l-primary text-primary"
                    )}
                    style={style}
                  >
                    <div className="font-medium truncate">{event.title}</div>
                    <div className="text-[10px] opacity-70">
                      {format(parseISO(event.start), "h:mm a")}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
