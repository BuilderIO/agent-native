import { useState, useEffect, useRef } from "react";
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
const END_HOUR = 23;
const HOUR_HEIGHT = 72;

function getEventColor(event: CalendarEvent) {
  if (event.color) return event.color;
  return event.source === "google" ? "#5085C0" : null;
}

export function DayView({ events, date, onEventClick }: DayViewProps) {
  const [now, setNow] = useState(new Date());
  const currentTimeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to current time (or 8am) on mount
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const indicator = currentTimeRef.current;
    if (indicator) {
      const offset = indicator.offsetTop - container.clientHeight / 2;
      container.scrollTop = Math.max(0, offset);
    } else {
      // Scroll to 8am if today isn't shown
      container.scrollTop = (2 / 1) * HOUR_HEIGHT; // 2 hours after START_HOUR (8am)
    }
  }, []);

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

  const today = isToday(date);
  const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
  const showNowIndicator =
    today && nowMinutes >= 0 && nowMinutes <= (END_HOUR - START_HOUR) * 60;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
        <div className="text-xs font-medium text-muted-foreground">
          {format(date, "EEEE")}
        </div>
        <div
          className={cn(
            "text-2xl font-bold tracking-tight",
            today ? "text-primary" : "text-foreground",
          )}
        >
          {format(date, "MMMM d, yyyy")}
        </div>
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-border bg-card/50 px-4 py-2">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            All day
          </p>
          <div className="space-y-1">
            {allDayEvents.map((event) => {
              const color = getEventColor(event);
              return (
                <button
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className="block w-full rounded-md px-3 py-1.5 text-left text-sm font-medium text-foreground transition-all hover:brightness-110"
                  style={
                    color
                      ? {
                          backgroundColor: `${color}30`,
                          borderLeft: `3px solid ${color}`,
                        }
                      : {
                          backgroundColor: "hsl(var(--primary) / 0.15)",
                          borderLeft: "3px solid hsl(var(--primary))",
                        }
                  }
                >
                  {event.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollContainerRef} className="relative flex-1 overflow-y-auto">
        <div className="grid grid-cols-[56px_1fr]">
          {/* Hour labels + grid lines */}
          {hours.map((hour) => (
            <div key={hour.toISOString()} className="contents">
              <div
                className="border-b border-r border-border pr-2 text-right"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                <span className="relative -top-2 text-[11px] text-muted-foreground">
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

        {/* Positioned events overlay */}
        <div className="absolute inset-0 ml-[56px] mr-4">
          {/* Current time indicator */}
          {showNowIndicator && (
            <div
              ref={currentTimeRef}
              className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
              style={{ top: `${nowTop}px` }}
            >
              <div className="h-3 w-3 shrink-0 rounded-full bg-red-500 -ml-1.5 shadow-sm shadow-red-500/50" />
              <div className="h-px flex-1 bg-red-500" />
            </div>
          )}

          {/* Timed events */}
          {timedEvents.map((event) => {
            const style = getEventStyle(event);
            const color = getEventColor(event);
            return (
              <button
                key={event.id}
                onClick={() => onEventClick(event)}
                className="absolute left-0 right-0 overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition-all hover:brightness-110 hover:shadow-lg"
                style={{
                  ...style,
                  backgroundColor: color
                    ? `${color}30`
                    : "hsl(var(--primary) / 0.15)",
                  borderLeft: `3px solid ${color ?? "hsl(var(--primary))"}`,
                }}
              >
                <div className="font-semibold leading-tight text-foreground">
                  {event.title}
                </div>
                <div className="mt-0.5 text-[11px] text-foreground/60">
                  {format(parseISO(event.start), "h:mm a")} –{" "}
                  {format(parseISO(event.end), "h:mm a")}
                </div>
                {event.location && (
                  <div className="mt-0.5 text-[11px] text-foreground/50">
                    📍 {event.location}
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
