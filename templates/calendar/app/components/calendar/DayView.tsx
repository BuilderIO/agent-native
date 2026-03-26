import { useState, useEffect, useRef, useMemo } from "react";
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
import { EventDetailPopover } from "./EventDetailPopover";
import type { CalendarEvent } from "@shared/api";

interface DayViewProps {
  events: CalendarEvent[];
  date: Date;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (eventId: string) => void;
  isLoading?: boolean;
}

// [startHour, startMin, durationMin, widthPct]
const DAY_SKELETONS: [number, number, number, number][] = [
  [9, 0, 60, 82],
  [11, 0, 45, 68],
  [14, 0, 90, 76],
  [16, 30, 30, 60],
];

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 72;

function getEventColor(event: CalendarEvent) {
  if (event.color) return event.color;
  return event.source === "google" ? "#5085C0" : null;
}

interface LayoutInfo {
  left: number; // percentage 0-100
  width: number; // percentage 0-100
  col: number;
  totalCols: number;
}

function computeLayout(dayEvents: CalendarEvent[]): Map<string, LayoutInfo> {
  const result = new Map<string, LayoutInfo>();
  if (dayEvents.length === 0) return result;

  const sorted = [...dayEvents].sort((a, b) => {
    const aStart = parseISO(a.start).getTime();
    const bStart = parseISO(b.start).getTime();
    if (aStart !== bStart) return aStart - bStart;
    return parseISO(b.end).getTime() - parseISO(a.end).getTime();
  });

  const times = new Map<string, { start: number; end: number }>();
  for (const ev of sorted) {
    times.set(ev.id, {
      start: parseISO(ev.start).getTime(),
      end: parseISO(ev.end).getTime(),
    });
  }

  const overlaps = (a: string, b: string) => {
    const ta = times.get(a)!;
    const tb = times.get(b)!;
    return ta.start < tb.end && tb.start < ta.end;
  };

  const INDENT_PCT = 14;
  const MIN_WIDTH_PCT = 45;

  for (const ev of sorted) {
    let depth = 0;
    for (const other of sorted) {
      if (other.id === ev.id) break;
      if (overlaps(other.id, ev.id)) depth++;
    }

    const leftPct = Math.min(depth * INDENT_PCT, 100 - MIN_WIDTH_PCT);
    const widthPct = Math.max(100 - leftPct, MIN_WIDTH_PCT);

    result.set(ev.id, {
      left: leftPct,
      width: widthPct,
      col: depth,
      totalCols: depth + 1,
    });
  }

  return result;
}

export function DayView({
  events,
  date,
  onEditEvent,
  onDeleteEvent,
  isLoading = false,
}: DayViewProps) {
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

  const allDayEvents = useMemo(() => events.filter((e) => e.allDay), [events]);
  const timedEvents = useMemo(() => events.filter((e) => !e.allDay), [events]);
  const layout = useMemo(() => computeLayout(timedEvents), [timedEvents]);

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
                <EventDetailPopover
                  key={event.id}
                  event={event}
                  onEdit={onEditEvent}
                  onDelete={onDeleteEvent}
                >
                  <button
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
                </EventDetailPopover>
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
              <div className="h-3 w-3 shrink-0 rounded-full bg-foreground -ml-1.5" />
              <div className="h-px flex-1 bg-foreground" />
            </div>
          )}

          {/* Skeleton events when loading */}
          {isLoading &&
            DAY_SKELETONS.map(
              ([startHour, startMin, duration, widthPct], i) => {
                const topPx =
                  ((startHour - START_HOUR) * 60 + startMin) *
                  (HOUR_HEIGHT / 60);
                const heightPx = Math.max((duration / 60) * HOUR_HEIGHT, 20);
                return (
                  <div
                    key={i}
                    className="absolute animate-pulse rounded-lg bg-muted"
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                      left: "2px",
                      width: `calc(${widthPct}% - 4px)`,
                    }}
                  />
                );
              },
            )}

          {/* Timed events */}
          {!isLoading &&
            timedEvents.map((event) => {
              const posStyle = getEventStyle(event);
              const li = layout.get(event.id) ?? {
                left: 0,
                width: 100,
                col: 0,
                totalCols: 1,
              };
              const color = getEventColor(event);
              const durationMin = differenceInMinutes(
                parseISO(event.end),
                parseISO(event.start),
              );
              return (
                <EventDetailPopover
                  key={event.id}
                  event={event}
                  onEdit={onEditEvent}
                  onDelete={onDeleteEvent}
                >
                  <button
                    className="absolute overflow-hidden rounded-lg px-2.5 py-1.5 text-left text-sm transition-all hover:z-30 hover:brightness-110 hover:shadow-lg"
                    style={{
                      ...posStyle,
                      left: `calc(${li.left}% + ${li.col > 0 ? 2 : 0}px)`,
                      width: `calc(${li.width}% - ${li.col > 0 ? 4 : 2}px)`,
                      zIndex: li.col + 1,
                      backgroundColor: color
                        ? `color-mix(in srgb, ${color} 18%, hsl(var(--background)))`
                        : `color-mix(in srgb, hsl(var(--primary)) 12%, hsl(var(--background)))`,
                      borderLeft: `3px solid ${color ?? "hsl(var(--primary))"}`,
                    }}
                  >
                    <div className="truncate font-semibold leading-tight text-foreground">
                      {event.title}
                    </div>
                    {durationMin >= 30 && (
                      <div className="mt-0.5 truncate text-[11px] text-foreground/60">
                        {format(parseISO(event.start), "h:mm a")} –{" "}
                        {format(parseISO(event.end), "h:mm a")}
                      </div>
                    )}
                    {durationMin >= 45 && event.location && (
                      <div className="mt-0.5 truncate text-[11px] text-foreground/50">
                        📍 {event.location}
                      </div>
                    )}
                  </button>
                </EventDetailPopover>
              );
            })}
        </div>
      </div>
    </div>
  );
}
