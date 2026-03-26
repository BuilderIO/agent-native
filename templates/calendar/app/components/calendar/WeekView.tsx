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
import { EventDetailPopover } from "./EventDetailPopover";
import type { CalendarEvent } from "@shared/api";

interface WeekViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (eventId: string) => void;
  isLoading?: boolean;
}

// [startHour, startMin, durationMin, widthPct] per day column (Sun–Sat)
const WEEK_SKELETONS: [number, number, number, number][][] = [
  [[9, 0, 60, 78], [14, 0, 30, 62]],
  [[10, 0, 90, 82]],
  [[8, 30, 45, 74], [15, 0, 60, 68]],
  [[10, 0, 60, 80]],
  [[9, 0, 45, 70], [13, 0, 90, 78]],
  [[11, 0, 30, 65]],
  [[9, 30, 60, 72]],
];

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
  col: number;
  totalCols: number;
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

  // Sort: earliest start first, then longest duration first
  const sorted = [...dayEvents].sort((a, b) => {
    const aStart = parseISO(a.start).getTime();
    const bStart = parseISO(b.start).getTime();
    if (aStart !== bStart) return aStart - bStart;
    return parseISO(b.end).getTime() - parseISO(a.end).getTime();
  });

  // Parse times once
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

  // Google Calendar-style hybrid layout:
  // 1. Build overlap clusters (events transitively connected by overlap)
  // 2. Within each cluster, assign columns
  // 3. Give each event its column's width, but let events expand right
  //    into unused space — so non-overlapping events get full width

  // Step 1: Build overlap clusters
  const clusters: CalendarEvent[][] = [];
  let clusterEnd = -Infinity;
  let currentCluster: CalendarEvent[] = [];

  for (const ev of sorted) {
    const t = times.get(ev.id)!;
    if (t.start >= clusterEnd && currentCluster.length > 0) {
      clusters.push(currentCluster);
      currentCluster = [];
      clusterEnd = -Infinity;
    }
    currentCluster.push(ev);
    clusterEnd = Math.max(clusterEnd, t.end);
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  // Step 2: Lay out each cluster
  for (const cluster of clusters) {
    // Assign columns — each event goes to the leftmost free column
    const columns: string[][] = [];
    const eventCol = new Map<string, number>();

    for (const ev of cluster) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].every((id) => !overlaps(id, ev.id))) {
          columns[c].push(ev.id);
          eventCol.set(ev.id, c);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([ev.id]);
        eventCol.set(ev.id, columns.length - 1);
      }
    }

    const totalCols = columns.length;

    // For each event, find its "forward" neighbor count: the max number of
    // columns simultaneously used at any point during this event's time span.
    // This determines the width — the event gets 1/forwardCols of the space
    // starting from its column, but only relative to events it actually overlaps.
    for (const ev of cluster) {
      const col = eventCol.get(ev.id)!;

      // Expand rightward into columns that have no overlapping event
      let span = 1;
      for (let c = col + 1; c < totalCols; c++) {
        if (columns[c].some((id) => overlaps(id, ev.id))) break;
        span++;
      }

      // Width: span / totalCols, but cap the right edge so the event
      // doesn't extend past the rightmost occupied column at its time.
      // This prevents an event from being needlessly wide when there's
      // empty space to its right that belongs to a different time slice.
      const leftPct = (col / totalCols) * 100;
      const widthPct = (span / totalCols) * 100;

      result.set(ev.id, {
        left: leftPct,
        width: widthPct,
        col,
        totalCols,
      });
    }
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
  onEditEvent,
  onDeleteEvent,
  isLoading = false,
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
                  <EventDetailPopover
                    key={event.id}
                    event={event}
                    onEdit={onEditEvent}
                    onDelete={onDeleteEvent}
                  >
                    <button
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
                  </EventDetailPopover>
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
          {dayData.map(({ day, events: dayEvents, layout }, dayIndex) => {
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

                {/* Skeleton events when loading */}
                {isLoading &&
                  WEEK_SKELETONS[dayIndex]?.map(
                    ([startHour, startMin, duration, widthPct], i) => {
                      const topPx =
                        ((startHour - START_HOUR) * 60 + startMin) *
                        (HOUR_HEIGHT / 60);
                      const heightPx = Math.max(
                        (duration / 60) * HOUR_HEIGHT,
                        20,
                      );
                      return (
                        <div
                          key={i}
                          className="absolute animate-pulse rounded-md bg-muted"
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
                {!isLoading && dayEvents.map((event) => {
                  const li = layout.get(event.id) ?? {
                    left: 0,
                    width: 100,
                    col: 0,
                    totalCols: 1,
                  };
                  const style = getEventStyle(event);
                  const color = getEventColor(event);
                  const start = parseISO(event.start);
                  const end = parseISO(event.end);
                  const durationMin = differenceInMinutes(end, start);

                  return (
                    <EventDetailPopover
                      key={event.id}
                      event={event}
                      onEdit={onEditEvent}
                      onDelete={onDeleteEvent}
                    >
                      <button
                        className="absolute overflow-hidden rounded-md px-2 py-1 text-left text-xs transition-all hover:z-30 hover:brightness-110 hover:shadow-md"
                        style={{
                          ...style,
                          left: `calc(${li.left}% + ${li.col > 0 ? 2 : 0}px)`,
                          width: `calc(${li.width}% - ${li.col > 0 ? 4 : 2}px)`,
                          zIndex: li.col + 1,
                          backgroundColor: color
                            ? `color-mix(in srgb, ${color} 18%, hsl(var(--background)))`
                            : "hsl(var(--primary) / 0.12)",
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
                    </EventDetailPopover>
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
