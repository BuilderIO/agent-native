import {
  eachHourOfInterval,
  format,
  parseISO,
  differenceInMinutes,
  startOfDay,
  set,
  isToday,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

interface DayViewProps {
  events: CalendarEvent[];
  date: Date;
  onEventClick: (event: CalendarEvent) => void;
}

const START_HOUR = 6;
const END_HOUR = 22;
const HOUR_HEIGHT = 64;

export function DayView({ events, date, onEventClick }: DayViewProps) {
  const hours = eachHourOfInterval({
    start: set(date, { hours: START_HOUR, minutes: 0, seconds: 0 }),
    end: set(date, { hours: END_HOUR, minutes: 0, seconds: 0 }),
  });

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

  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
        <div className="text-sm text-muted-foreground">{format(date, "EEEE")}</div>
        <div
          className={cn(
            "text-2xl font-semibold",
            isToday(date) && "text-primary"
          )}
        >
          {format(date, "MMMM d, yyyy")}
        </div>
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-border px-4 py-2 space-y-1">
          <span className="text-xs text-muted-foreground">All day</span>
          {allDayEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className={cn(
                "block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:opacity-80",
                event.source === "google"
                  ? "bg-green-500/20 text-green-300"
                  : "bg-primary/20 text-primary"
              )}
            >
              {event.title}
            </button>
          ))}
        </div>
      )}

      {/* Time grid */}
      <div className="relative flex-1">
        <div className="grid grid-cols-[60px_1fr]">
          {hours.map((hour) => (
            <div key={hour.toISOString()} className="contents">
              <div
                className="border-b border-r border-border pr-2 text-right"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                <span className="relative -top-2 text-xs text-muted-foreground">
                  {format(hour, "h a")}
                </span>
              </div>
              <div
                className="border-b border-border"
                style={{ height: `${HOUR_HEIGHT}px` }}
              />
            </div>
          ))}
        </div>

        {/* Positioned events */}
        <div className="absolute inset-0 ml-[60px]">
          {timedEvents.map((event) => {
            const style = getEventStyle(event);
            return (
              <button
                key={event.id}
                onClick={() => onEventClick(event)}
                className={cn(
                  "absolute left-1 right-4 overflow-hidden rounded-md px-3 py-1.5 text-left text-sm transition-opacity hover:opacity-80",
                  event.source === "google"
                    ? "bg-green-500/20 border-l-2 border-l-green-500 text-green-300"
                    : "bg-primary/20 border-l-2 border-l-primary text-primary"
                )}
                style={style}
              >
                <div className="font-medium truncate">{event.title}</div>
                <div className="text-xs opacity-70">
                  {format(parseISO(event.start), "h:mm a")} -{" "}
                  {format(parseISO(event.end), "h:mm a")}
                </div>
                {event.location && (
                  <div className="text-xs opacity-60 truncate mt-0.5">
                    {event.location}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
