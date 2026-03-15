import { useState, useEffect, useRef, useMemo } from "react";
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
  addDays,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@shared/api";

interface WeekViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 60;
const GUTTER_WIDTH = 60;

function getEventColor(event: CalendarEvent) {
  if (event.color) return event.color;
  return event.source === "google" ? "#10b981" : null;
}

/** Format an event's time range in compact Notion style: "8–10:30 AM" or "9 AM" */
function formatEventTime(start: Date, end: Date): string {
  const startMin = start.getMinutes();
  const endMin = end.getMinutes();
  const sameAmPm =
    (start.getHours() < 12 && end.getHours() < 12) ||
    (start.getHours() >= 12 && end.getHours() >= 12);

  const startStr = startMin === 0
    ? format(start, "h")
    : format(start, "h:mm");

  const endStr = endMin === 0
    ? format(end, "h a")
    : format(end, "h:mm a");

  if (sameAmPm) {
    return `${startStr}\u2013${endStr}`;
  }
  const startWithAmPm = startMin === 0
    ? format(start, "h a")
    : format(start, "h:mm a");
  return `${startWithAmPm}\u2013${endStr}`;
}

interface OverlapInfo {
  index: number;
  total: number;
}

/** Calculate overlap groups for a list of events in one day */
function computeOverlaps(dayEvents: CalendarEvent[]): Map<string, OverlapInfo> {
  const result = new Map<string, OverlapInfo>();
  if (dayEvents.length === 0) return result;

  const sorted = [...dayEvents].sort((a, b) => {
    const aStart = parseISO(a.start).getTime();
    const bStart = parseISO(b.start).getTime();
    return aStart - bStart || parseISO(a.end).getTime() - parseISO(b.end).getTime();
  });

  // Build overlap groups using a sweep approach
  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [sorted[0]];
  let groupEnd = parseISO(sorted[0].end).getTime();

  for (let i = 1; i < sorted.length; i++) {
    const evStart = parseISO(sorted[i].start).getTime();
    if (evStart < groupEnd) {
      // Overlaps with current group
      currentGroup.push(sorted[i]);
      groupEnd = Math.max(groupEnd, parseISO(sorted[i].end).getTime());
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
      groupEnd = parseISO(sorted[i].end).getTime();
    }
  }
  groups.push(currentGroup);

  for (const group of groups) {
    const total = group.length;
    group.forEach((ev, idx) => {
      result.set(ev.id, { index: idx, total });
    });
  }

  return result;
}

/** Determine which day columns an all-day event spans within a given week */
function getAllDaySpan(
  event: CalendarEvent,
  days: Date[],
): { startCol: number; endCol: number } | null {
  const evStart = parseISO(event.start);
  const evEnd = event.end ? parseISO(event.end) : addDays(evStart, 1);

  let startCol = -1;
  let endCol = -1;

  for (let i = 0; i < days.length; i++) {
    const dayStart = startOfDay(days[i]);
    const dayEnd = addDays(dayStart, 1);
    // Event overlaps this day if it starts before day ends and ends after day starts
    if (evStart < dayEnd && evEnd > dayStart) {
      if (startCol === -1) startCol = i;
      endCol = i;
    }
  }

  if (startCol === -1) return null;
  return { startCol, endCol };
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

  // Scroll to ~7am on mount
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollTo7am = 7 * HOUR_HEIGHT;
      container.scrollTop = scrollTo7am - 40;
    }
  }, []);

  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const hours = eachHourOfInterval({
    start: set(weekStart, { hours: START_HOUR, minutes: 0 }),
    end: set(weekStart, { hours: END_HOUR - 1, minutes: 0 }),
  });

  // Separate all-day and timed events
  const allDayEvents = useMemo(
    () => events.filter((e) => e.allDay),
    [events],
  );

  const timedEvents = useMemo(
    () => events.filter((e) => !e.allDay),
    [events],
  );

  // Pre-compute all-day event spans
  const allDaySpans = useMemo(() => {
    const spans: { event: CalendarEvent; startCol: number; endCol: number }[] = [];
    for (const ev of allDayEvents) {
      const span = getAllDaySpan(ev, days);
      if (span) {
        spans.push({ event: ev, ...span });
      }
    }
    return spans;
  }, [allDayEvents, days]);

  // Pre-compute timed events per day with overlaps
  const dayData = useMemo(() => {
    return days.map((day) => {
      const dayEvents = timedEvents.filter((e) =>
        isSameDay(parseISO(e.start), day),
      );
      const overlaps = computeOverlaps(dayEvents);
      return { day, events: dayEvents, overlaps };
    });
  }, [days, timedEvents]);

  function getEventStyle(event: CalendarEvent, overlap: OverlapInfo) {
    const start = parseISO(event.start);
    const end = parseISO(event.end);
    const dayStart = set(startOfDay(start), { hours: START_HOUR });
    const topMinutes = Math.max(0, differenceInMinutes(start, dayStart));
    const durationMinutes = Math.max(15, differenceInMinutes(end, start));
    const widthPercent = 100 / overlap.total;
    const leftPercent = overlap.index * widthPercent;

    return {
      top: `${(topMinutes / 60) * HOUR_HEIGHT}px`,
      height: `${(durationMinutes / 60) * HOUR_HEIGHT}px`,
      left: `${leftPercent}%`,
      width: `calc(${widthPercent}% - 2px)`,
    };
  }

  // Current time indicator
  const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
  const showNowIndicator =
    nowMinutes >= 0 && nowMinutes <= (END_HOUR - START_HOUR) * 60;

  const hasAnyAllDay = allDaySpans.length > 0;

  // Compute the number of "rows" needed for all-day events (to handle stacking)
  const allDayRows = useMemo(() => {
    if (allDaySpans.length === 0) return 0;
    // Simple row-packing algorithm
    const rows: { startCol: number; endCol: number }[][] = [];
    for (const span of allDaySpans) {
      let placed = false;
      for (const row of rows) {
        const hasConflict = row.some(
          (existing) =>
            span.startCol <= existing.endCol && span.endCol >= existing.startCol,
        );
        if (!hasConflict) {
          row.push(span);
          placed = true;
          break;
        }
      }
      if (!placed) {
        rows.push([span]);
      }
    }
    return rows.length;
  }, [allDaySpans]);

  // Assign row index to each all-day span
  const allDayRowAssignments = useMemo(() => {
    const assignments = new Map<string, number>();
    if (allDaySpans.length === 0) return assignments;
    const rows: { startCol: number; endCol: number; id: string }[][] = [];
    for (const span of allDaySpans) {
      let placed = false;
      for (let r = 0; r < rows.length; r++) {
        const hasConflict = rows[r].some(
          (existing) =>
            span.startCol <= existing.endCol && span.endCol >= existing.startCol,
        );
        if (!hasConflict) {
          rows[r].push({ ...span, id: span.event.id });
          assignments.set(span.event.id, r);
          placed = true;
          break;
        }
      }
      if (!placed) {
        rows.push([{ ...span, id: span.event.id }]);
        assignments.set(span.event.id, rows.length - 1);
      }
    }
    return assignments;
  }, [allDaySpans]);

  const allDayRowHeight = 26;
  const allDaySectionHeight = hasAnyAllDay
    ? allDayRows * allDayRowHeight + 8
    : 0;

  // Timezone abbreviation
  const tzAbbr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    } catch {
      return "";
    }
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky day headers */}
      <div className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="flex">
          {/* Gutter: timezone label */}
          <div
            className="flex shrink-0 items-center justify-center border-r border-border"
            style={{ width: `${GUTTER_WIDTH}px` }}
          >
            <span className="text-[11px] font-medium text-muted-foreground">
              {tzAbbr}
            </span>
          </div>

          {/* Day columns */}
          {days.map((day) => (
            <div
              key={day.toISOString()}
              onClick={() => onDateSelect(day)}
              className={cn(
                "flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-r border-border py-2.5 transition-colors last:border-r-0",
                isToday(day) ? "bg-primary/5" : "hover:bg-accent/40",
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                  isToday(day)
                    ? "bg-red-500 text-white"
                    : "text-foreground",
                )}
              >
                {format(day, "d")}
              </span>
            </div>
          ))}
        </div>

        {/* All-day events row */}
        {hasAnyAllDay && (
          <div
            className="relative flex border-t border-border"
            style={{ height: `${allDaySectionHeight}px` }}
          >
            {/* Gutter label */}
            <div
              className="flex shrink-0 items-start justify-end border-r border-border pr-2 pt-1"
              style={{ width: `${GUTTER_WIDTH}px` }}
            >
              <span className="text-[10px] text-muted-foreground">all day</span>
            </div>

            {/* All-day columns container (relative, for absolute-positioned spans) */}
            <div className="relative flex flex-1">
              {/* Column dividers */}
              {days.map((day, i) => (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "flex-1",
                    i < days.length - 1 && "border-r border-border",
                  )}
                />
              ))}

              {/* Spanning all-day event bars */}
              {allDaySpans.map(({ event, startCol, endCol }) => {
                const color = getEventColor(event);
                const rowIdx = allDayRowAssignments.get(event.id) ?? 0;
                const colCount = days.length;
                const leftPct = (startCol / colCount) * 100;
                const widthPct = ((endCol - startCol + 1) / colCount) * 100;

                return (
                  <button
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className="absolute truncate rounded px-2 py-0.5 text-left text-xs font-medium transition-opacity hover:opacity-80"
                    style={{
                      top: `${rowIdx * allDayRowHeight + 4}px`,
                      left: `${leftPct}%`,
                      width: `calc(${widthPct}% - 4px)`,
                      height: `${allDayRowHeight - 4}px`,
                      backgroundColor: color ? `${color}40` : "hsl(var(--primary) / 0.2)",
                      color: color ?? "hsl(var(--primary))",
                      borderLeft: `3px solid ${color ?? "hsl(var(--primary))"}`,
                      marginLeft: "2px",
                    }}
                  >
                    {event.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="relative flex">
          {/* Hour gutter */}
          <div
            className="shrink-0 border-r border-border"
            style={{ width: `${GUTTER_WIDTH}px` }}
          >
            {hours.map((hour, i) => (
              <div
                key={hour.toISOString()}
                className="relative border-b border-border/50"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {i > 0 && (
                  <span className="absolute -top-[9px] right-2 text-[11px] font-medium text-muted-foreground">
                    {format(hour, "h a")}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {dayData.map(({ day, events: dayEvents, overlaps }) => {
            const isCurrentDay = isToday(day);

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "relative flex-1 border-r border-border last:border-r-0",
                  isCurrentDay && "bg-primary/[0.02]",
                )}
              >
                {/* Hour grid lines */}
                {hours.map((hour) => (
                  <div
                    key={hour.toISOString()}
                    className="border-b border-border/50"
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
                    <div className="-ml-[5px] h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                    <div className="h-[2px] flex-1 bg-red-500" />
                  </div>
                )}

                {/* Timed events */}
                {dayEvents.map((event) => {
                  const overlap = overlaps.get(event.id) ?? {
                    index: 0,
                    total: 1,
                  };
                  const style = getEventStyle(event, overlap);
                  const color = getEventColor(event);
                  const start = parseISO(event.start);
                  const end = parseISO(event.end);
                  const durationMin = differenceInMinutes(end, start);

                  return (
                    <button
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      className="absolute overflow-hidden rounded-md px-2 py-1 text-left text-xs transition-all hover:brightness-110 hover:shadow-md"
                      style={{
                        ...style,
                        backgroundColor: color
                          ? `${color}4D`
                          : "hsl(var(--primary) / 0.3)",
                        borderLeft: `3px solid ${color ?? "hsl(var(--primary))"}`,
                        color: color ?? "hsl(var(--primary))",
                      }}
                    >
                      <div className="truncate font-semibold leading-tight">
                        {event.title}
                      </div>
                      {durationMin >= 30 && (
                        <div className="mt-0.5 truncate text-[10px] opacity-75">
                          {formatEventTime(start, end)}
                        </div>
                      )}
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
