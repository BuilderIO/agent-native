import { useState, useEffect, useRef } from "react";
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
const END_HOUR = 23;
const HOUR_HEIGHT = 64; // px per hour

function getEventColor(event: CalendarEvent) {
  if (event.color) return event.color;
  return event.source === "google" ? "#10b981" : null; // emerald-500 for google
}

export function WeekView({
  events,
  selectedDate,
  onDateSelect,
  onEventClick,
}: WeekViewProps) {
  const [now, setNow] = useState(new Date());
  const currentTimeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to current time on mount
  useEffect(() => {
    const container = scrollContainerRef.current;
    const indicator = currentTimeRef.current;
    if (container && indicator) {
      const offset = indicator.offsetTop - container.clientHeight / 2;
      container.scrollTop = Math.max(0, offset);
    }
  }, []);

  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const hours = eachHourOfInterval({
    start: set(weekStart, { hours: START_HOUR, minutes: 0 }),
    end: set(weekStart, { hours: END_HOUR, minutes: 0 }),
  });

  // All-day events
  const allDayEvents = events.filter((e) => e.allDay);

  function getEventsForDay(day: Date) {
    return events.filter((e) => !e.allDay && isSameDay(parseISO(e.start), day));
  }

  function getAllDayForDay(day: Date) {
    return allDayEvents.filter((e) => isSameDay(parseISO(e.start), day));
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

  // Current time indicator position
  const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
  const showNowIndicator =
    nowMinutes >= 0 && nowMinutes <= (END_HOUR - START_HOUR) * 60;

  const hasAnyAllDay = allDayEvents.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky day headers */}
      <div className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          <div className="border-r border-border" />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              onClick={() => onDateSelect(day)}
              className={cn(
                "cursor-pointer border-r border-border py-2.5 text-center transition-colors last:border-r-0",
                isToday(day) ? "bg-primary/5" : "hover:bg-accent/40",
              )}
            >
              <div className="text-xs font-medium text-muted-foreground">
                {format(day, "EEE")}
              </div>
              <div
                className={cn(
                  "mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                  isToday(day)
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent",
                )}
              >
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>

        {/* All-day row */}
        {hasAnyAllDay && (
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-t border-border">
            <div className="flex items-center justify-end border-r border-border pr-2 py-1">
              <span className="text-[10px] text-muted-foreground">all day</span>
            </div>
            {days.map((day) => {
              const dayAllDay = getAllDayForDay(day);
              return (
                <div
                  key={day.toISOString()}
                  className="min-h-[28px] border-r border-border p-0.5 last:border-r-0"
                >
                  {dayAllDay.map((event) => {
                    const color = getEventColor(event);
                    return (
                      <button
                        key={event.id}
                        onClick={() => onEventClick(event)}
                        className="mb-0.5 block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium transition-opacity hover:opacity-80"
                        style={
                          color
                            ? {
                                backgroundColor: `${color}30`,
                                color,
                                borderLeft: `2px solid ${color}`,
                              }
                            : {
                                backgroundColor: "hsl(var(--primary) / 0.2)",
                                color: "hsl(var(--primary))",
                                borderLeft: "2px solid hsl(var(--primary))",
                              }
                        }
                      >
                        {event.title}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          {/* Hour labels */}
          <div className="border-r border-border">
            {hours.map((hour) => (
              <div
                key={hour.toISOString()}
                className="relative border-b border-border"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                <span className="absolute -top-2.5 right-2 text-[11px] text-muted-foreground">
                  {format(hour, "h a")}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayEvents = getEventsForDay(day);
            const isCurrentDay = isToday(day);

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "relative border-r border-border last:border-r-0",
                  isCurrentDay && "bg-primary/[0.02]",
                )}
              >
                {/* Hour grid lines */}
                {hours.map((hour, i) => (
                  <div
                    key={hour.toISOString()}
                    className={cn(
                      "border-b border-border",
                      i % 2 === 0 ? "border-border" : "border-border/40",
                    )}
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* Current time indicator */}
                {isCurrentDay && showNowIndicator && (
                  <div
                    ref={currentTimeRef}
                    className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: `${nowTop}px` }}
                  >
                    <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 -ml-[5px]" />
                    <div className="h-px flex-1 bg-red-500" />
                  </div>
                )}

                {/* Timed events */}
                {dayEvents.map((event) => {
                  const style = getEventStyle(event);
                  const color = getEventColor(event);
                  return (
                    <button
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      className="absolute left-0.5 right-1 overflow-hidden rounded-md px-2 py-1 text-left text-xs transition-all hover:brightness-110 hover:shadow-md"
                      style={{
                        ...style,
                        backgroundColor: color
                          ? `${color}25`
                          : "hsl(var(--primary) / 0.18)",
                        borderLeft: `2px solid ${color ?? "hsl(var(--primary))"}`,
                        color: color ?? "hsl(var(--primary))",
                      }}
                    >
                      <div className="truncate font-medium leading-tight">
                        {event.title}
                      </div>
                      <div className="mt-0.5 text-[10px] opacity-70">
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
    </div>
  );
}
