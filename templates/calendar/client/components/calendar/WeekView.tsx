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
  return event.source === "google" ? "#5085C0" : null;
}

/** Format an event's time range in compact Notion style: "8–10:30 AM" or "9 AM" */
function formatEventTime(start: Date, end: Date): string {
  const startMin = start.getMinutes();
  const endMin = end.getMinutes();
  const sameAmPm =
    (start.getHours() < 12 && end.getHours() < 12) ||
    (start.getHours() >= 12 && end.getHours() >= 12);

  const startStr = startMin === 0 ? format(start, "h") : format(start, "h:mm");

  const endStr = endMin === 0 ? format(end, "h a") : format(end, "h:mm a");

  if (sameAmPm) {
    return `${startStr}\u2013${endStr}`;
  }
  const startWithAmPm =
    startMin === 0 ? format(start, "h a") : format(start, "h:mm a");
  return `${startWithAmPm}\u2013${endStr}`;
}

interface LayoutInfo {
  left: number; // percentage 0-100
  width: number; // percentage 0-100
}

/**
 * Google Calendar-style overlap layout.
 * Events are assigned columns. Each event spans from its column to the right
 * edge unless a later-starting event needs the space. Events cascade/overlap
 * rather than being squeezed into tiny equal-width slots.
 */
function computeLayout(dayEvents: CalendarEvent[]): Map<string, LayoutInfo> {
  const result = new Map<string, LayoutInfo>();
  if (dayEvents.length === 0) return result;

  const sorted = [...dayEvents].sort((a, b) => {
    const aStart = parseISO(a.start).getTime();
    const bStart = parseISO(b.start).getTime();
    if (aStart !== bStart) return aStart - bStart;
    // Longer events first so they form the "background"
    return parseISO(b.end).getTime() - parseISO(a.end).getTime();
  });

  // For each event, track its column and the events it directly collides with
  const columns: { id: string; end: number }[][] = [];
  const eventCol = new Map<string, number>();

  for (const ev of sorted) {
    const evStart = parseISO(ev.start).getTime();
    const evEnd = parseISO(ev.end).getTime();

    // Find the first column where no event overlaps
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      // Column is free if all events in it have ended
      const isFree = columns[c].every((slot) => slot.end <= evStart);
      if (isFree) {
        columns[c].push({ id: ev.id, end: evEnd });
        eventCol.set(ev.id, c);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([{ id: ev.id, end: evEnd }]);
      eventCol.set(ev.id, columns.length - 1);
    }
  }

  // Now compute layout: each event starts at its column and expands right
  // as far as possible (until it hits another event that starts at the same time
  // or a column that's occupied at the same time)
  for (const ev of sorted) {
    const col = eventCol.get(ev.id)!;
    const evStart = parseISO(ev.start).getTime();
    const evEnd = parseISO(ev.end).getTime();
    const totalCols = columns.length;

    // How far right can this event expand?
    let span = 1;
    for (let c = col + 1; c < totalCols; c++) {
      const isBlocked = columns[c].some((slot) => {
        const slotEv = sorted.find((e) => e.id === slot.id)!;
        const slotStart = parseISO(slotEv.start).getTime();
        const slotEnd = parseISO(slotEv.end).getTime();
        return slotStart < evEnd && slotEnd > evStart;
      });
      if (isBlocked) break;
      span++;
    }

    const leftPct = (col / totalCols) * 100;
    const widthPct = (span / totalCols) * 100;

    result.set(ev.id, { left: leftPct, width: widthPct });
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
  const allDayEvents = useMemo(() => events.filter((e) => e.allDay), [events]);

  const timedEvents = useMemo(() => events.filter((e) => !e.allDay), [events]);

  // Pre-compute all-day event spans
  const allDaySpans = useMemo(() => {
    const spans: { event: CalendarEvent; startCol: number; endCol: number }[] =
      [];
    for (const ev of allDayEvents) {
      const span = getAllDaySpan(ev, days);
      if (span) {
        spans.push({ event: ev, ...span });
      }
    }
    return spans;
  }, [allDayEvents, days]);

  // Pre-compute timed events per day with layout
  const dayData = useMemo(() => {
    return days.map((day) => {
      const dayEvents = timedEvents.filter((e) =>
        isSameDay(parseISO(e.start), day),
      );
      const layout = computeLayout(dayEvents);
      return { day, events: dayEvents, layout };
    });
  }, [days, timedEvents]);

  function getEventStyle(event: CalendarEvent, layoutInfo: LayoutInfo) {
    const start = parseISO(event.start);
    const end = parseISO(event.end);
    const dayStart = set(startOfDay(start), { hours: START_HOUR });
    const topMinutes = Math.max(0, differenceInMinutes(start, dayStart));
    const durationMinutes = Math.max(15, differenceInMinutes(end, start));

    return {
      top: `${(topMinutes / 60) * HOUR_HEIGHT}px`,
      height: `${(durationMinutes / 60) * HOUR_HEIGHT}px`,
      left: `${layoutInfo.left}%`,
      width: `calc(${layoutInfo.width}% - 2px)`,
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
            span.startCol <= existing.endCol &&
            span.endCol >= existing.startCol,
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
            span.startCol <= existing.endCol &&
            span.endCol >= existing.startCol,
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
      return (
        new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
          .formatToParts(now)
          .find((p) => p.type === "timeZoneName")?.value ?? ""
      );
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
                    ? "bg-foreground text-background"
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
                    className="absolute truncate rounded px-2 py-0.5 text-left text-xs font-medium text-foreground transition-opacity hover:opacity-80"
                    style={{
                      top: `${rowIdx * allDayRowHeight + 4}px`,
                      left: `${leftPct}%`,
                      width: `calc(${widthPct}% - 4px)`,
                      height: `${allDayRowHeight - 4}px`,
                      backgroundColor: color
                        ? `${color}30`
                        : "hsl(var(--primary) / 0.15)",
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
          {dayData.map(({ day, events: dayEvents, layout }) => {
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
                    <div className="-ml-[5px] h-2.5 w-2.5 shrink-0 rounded-full bg-foreground" />
                    <div className="h-[2px] flex-1 bg-foreground" />
                  </div>
                )}

                {/* Timed events */}
                {dayEvents.map((event) => {
                  const li = layout.get(event.id) ?? {
                    left: 0,
                    width: 100,
                  };
                  const style = getEventStyle(event, li);
                  const color = getEventColor(event);
                  const start = parseISO(event.start);
                  const end = parseISO(event.end);
                  const durationMin = differenceInMinutes(end, start);

                  return (
                    <button
                      key={event.id}
                      onClick={() => onEventClick(event)}
                      className="absolute overflow-hidden rounded-md px-2 py-1 text-left text-xs transition-all hover:z-30 hover:brightness-110 hover:shadow-md"
                      style={{
                        ...style,
                        zIndex: li.left > 0 ? Math.round(li.left) + 1 : 1,
                        backgroundColor: color
                          ? `${color}30`
                          : "hsl(var(--primary) / 0.2)",
                        borderLeft: `3px solid ${color ?? "hsl(var(--primary))"}`,
                      }}
                    >
                      <div
                        className={cn(
                          "font-semibold leading-tight text-foreground",
                          durationMin < 90 && "truncate",
                        )}
                      >
                        {event.title}
                        {durationMin < 45 && (
                          <span className="font-normal text-foreground/60">
                            {" "}
                            {format(start, "h:mm a")}
                          </span>
                        )}
                      </div>
                      {durationMin >= 45 && (
                        <div className="truncate text-[10px] text-foreground/60">
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
