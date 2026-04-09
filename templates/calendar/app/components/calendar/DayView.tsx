import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  eachHourOfInterval,
  format,
  parseISO,
  differenceInMinutes,
  startOfDay,
  set,
  isToday,
  addMinutes,
} from "date-fns";
import { cn } from "@/lib/utils";
import { shouldSuppressAfterPopoverClose } from "@/lib/popover-click-guard";
import { getEventAutoColor, allOtherDeclined } from "@/lib/event-colors";
import { IconAlertTriangleFilled } from "@tabler/icons-react";
import { EventDetailPopover } from "./EventDetailPopover";
import type { CalendarEvent } from "@shared/api";
import { useEventDrag } from "@/hooks/use-event-drag";

interface DayViewProps {
  events: CalendarEvent[];
  date: Date;
  onDeleteEvent: (eventId: string) => void;
  onEventTimeChange?: (eventId: string, newStart: Date, newEnd: Date) => void;
  onClickTimeSlot?: (date: Date, startTime: string, endTime: string) => void;
  quickEditEventId?: string | null;
  onQuickEditSave?: (eventId: string, title: string) => void;
  onQuickEditCancel?: (eventId: string) => void;
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
  return getEventAutoColor(event);
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

  const INDENT_PX = 20; // DayView has wider columns, more indent room

  for (const ev of sorted) {
    let depth = 0;
    for (const other of sorted) {
      if (other.id === ev.id) break;
      const ta = times.get(other.id)!;
      const tb = times.get(ev.id)!;
      if (ta.start < tb.end && tb.start < ta.end) depth++;
    }

    result.set(ev.id, {
      left: depth * INDENT_PX,
      width: 0,
      col: depth,
      totalCols: depth + 1,
    });
  }

  return result;
}

export function DayView({
  events,
  date,
  onDeleteEvent,
  onEventTimeChange,
  onClickTimeSlot,
  quickEditEventId,
  onQuickEditSave,
  onQuickEditCancel,
  isLoading = false,
}: DayViewProps) {
  const [now, setNow] = useState(new Date());
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
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

  // Drag-to-move and drag-to-resize
  const handleEventTimeChange = useCallback(
    (eventId: string, newStart: Date, newEnd: Date) => {
      onEventTimeChange?.(eventId, newStart, newEnd);
    },
    [onEventTimeChange],
  );

  const {
    startDrag,
    getDragOverrides,
    isDragging,
    dragEventId,
    shouldSuppressClick,
  } = useEventDrag({
    hourHeight: HOUR_HEIGHT,
    startHour: START_HOUR,
    scrollContainerRef,
    onEventTimeChange: handleEventTimeChange,
    events,
  });

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
                  onDelete={onDeleteEvent}
                >
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm font-medium text-foreground transition-all hover:brightness-110"
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
                    {allOtherDeclined(event) && (
                      <IconAlertTriangleFilled
                        size={14}
                        className="shrink-0 text-current opacity-70"
                      />
                    )}
                    <span className="truncate">{event.title}</span>
                  </button>
                </EventDetailPopover>
              );
            })}
          </div>
        </div>
      )}

      {/* Scrollable time grid */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "relative flex-1 overflow-y-auto",
          isDragging && "select-none",
        )}
      >
        <div className="grid grid-cols-[40px_1fr] sm:grid-cols-[56px_1fr]">
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
        <div
          className="absolute inset-0 ml-[40px] mr-2 sm:ml-[56px] sm:mr-4"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            if (
              !onClickTimeSlot ||
              isDragging ||
              shouldSuppressClick() ||
              shouldSuppressAfterPopoverClose()
            )
              return;
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const totalMinutes =
              Math.floor(((y / HOUR_HEIGHT) * 60) / 15) * 15 + START_HOUR * 60;
            const startH = Math.floor(totalMinutes / 60);
            const startM = totalMinutes % 60;
            const endMinutes = totalMinutes + 60;
            const endH = Math.min(Math.floor(endMinutes / 60), 23);
            const endM = endMinutes % 60;
            const pad = (n: number) => String(n).padStart(2, "0");
            onClickTimeSlot(
              date,
              `${pad(startH)}:${pad(startM)}`,
              `${pad(endH)}:${pad(endM)}`,
            );
          }}
        >
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
              const li = layout.get(event.id) ?? {
                left: 0,
                width: 100,
                col: 0,
                totalCols: 1,
              };
              const overrides = getDragOverrides(event.id);
              const isBeingDragged = dragEventId === event.id;
              const posStyle = overrides
                ? {
                    top: `${overrides.top}px`,
                    height: `${overrides.height}px`,
                  }
                : getEventStyle(event);
              const color = getEventColor(event);
              const durationMin = overrides
                ? (overrides.height / HOUR_HEIGHT) * 60
                : differenceInMinutes(
                    parseISO(event.end),
                    parseISO(event.start),
                  );
              // Compute display times (use drag overrides if active)
              const displayStart = overrides
                ? addMinutes(
                    set(startOfDay(date), {
                      hours: START_HOUR,
                      minutes: 0,
                      seconds: 0,
                    }),
                    (overrides.top / HOUR_HEIGHT) * 60,
                  )
                : parseISO(event.start);
              const displayEnd = overrides
                ? addMinutes(displayStart, durationMin)
                : parseISO(event.end);
              const isPast = parseISO(event.end) < now;
              const isDeclined = event.responseStatus === "declined";
              const allOthersOut = allOtherDeclined(event);
              const canDrag = !!onEventTimeChange;

              const eventButton = (
                <button
                  onPointerDown={(e) => {
                    setFocusedEventId(event.id);
                    if (
                      canDrag &&
                      !(e.target as HTMLElement).dataset.resizeHandle
                    ) {
                      startDrag(e, event.id, "move", 0);
                    }
                  }}
                  onClick={(e) => {
                    if (shouldSuppressClick()) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  className={cn(
                    "absolute overflow-hidden rounded-lg px-2 py-0.5 text-left text-xs flex flex-col hover:brightness-110 hover:shadow-lg group",
                    durationMin <= 30 ? "justify-center" : "justify-start",
                    isDeclined && "saturate-[0.3]",
                    isBeingDragged && isDragging && "shadow-lg z-[100]",
                    isBeingDragged && isDragging && "ring-2 ring-primary/40",
                    canDrag && "cursor-grab",
                    isBeingDragged && isDragging && "cursor-grabbing",
                  )}
                  style={{
                    ...posStyle,
                    left: `${li.left}px`,
                    width: `calc(100% - ${li.left + 2}px)`,
                    zIndex:
                      isBeingDragged && isDragging
                        ? 100
                        : focusedEventId === event.id
                          ? 50
                          : li.col + 1,
                    backgroundColor: color
                      ? `color-mix(in srgb, ${color} ${isPast || isDeclined ? 8 : 18}%, hsl(var(--background)))`
                      : `color-mix(in srgb, hsl(var(--primary)) ${isPast || isDeclined ? 5 : 12}%, hsl(var(--background)))`,
                    borderLeft: `3px solid ${
                      isPast || isDeclined
                        ? `color-mix(in srgb, ${color ?? "hsl(var(--primary))"} 30%, transparent)`
                        : (color ?? "hsl(var(--primary))")
                    }`,
                    opacity: isBeingDragged && isDragging ? 0.9 : undefined,
                  }}
                >
                  {durationMin <= 30 ? (
                    <div className="flex items-baseline gap-1.5 truncate">
                      {allOthersOut && (
                        <IconAlertTriangleFilled
                          size={12}
                          className="shrink-0 text-current opacity-70 relative top-[1px]"
                        />
                      )}
                      <span
                        className={cn(
                          "truncate leading-tight",
                          isPast || isDeclined
                            ? "text-muted-foreground"
                            : "text-foreground",
                          isDeclined && "line-through",
                          !isPast && !isDeclined && "font-semibold",
                        )}
                      >
                        {event.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] leading-tight",
                          isPast || isDeclined
                            ? "text-muted-foreground/50"
                            : "text-foreground/60",
                        )}
                      >
                        {format(
                          displayStart,
                          displayStart.getMinutes() === 0 ? "h a" : "h:mm a",
                        )}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div
                        className={cn(
                          "mt-0.5 flex items-center gap-1 truncate leading-tight",
                          isPast || isDeclined
                            ? "text-muted-foreground"
                            : "text-foreground",
                          isDeclined && "line-through",
                          !isPast && !isDeclined && "font-semibold",
                        )}
                      >
                        {allOthersOut && (
                          <IconAlertTriangleFilled
                            size={12}
                            className="shrink-0 text-current opacity-70"
                          />
                        )}
                        <span className="truncate">{event.title}</span>
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 truncate text-[10px] leading-tight",
                          isPast || isDeclined
                            ? "text-muted-foreground/50"
                            : "text-foreground/60",
                        )}
                      >
                        {format(displayStart, "h:mm a")} –{" "}
                        {format(displayEnd, "h:mm a")}
                      </div>
                      {durationMin >= 45 && event.location && (
                        <div className="truncate text-[11px] leading-tight text-foreground/50">
                          {event.location}
                        </div>
                      )}
                    </>
                  )}
                  {/* Top resize handle */}
                  {canDrag && (
                    <div
                      data-resize-handle="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        startDrag(e, event.id, "resize-top", 0);
                      }}
                      className="absolute left-0 right-0 top-0 h-2.5 cursor-n-resize"
                      style={{ touchAction: "none" }}
                    />
                  )}
                  {/* Bottom resize handle */}
                  {canDrag && (
                    <div
                      data-resize-handle="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        startDrag(e, event.id, "resize", 0);
                      }}
                      className="absolute bottom-0 left-0 right-0 h-2.5 cursor-s-resize"
                      style={{ touchAction: "none" }}
                    />
                  )}
                </button>
              );

              // Don't wrap in popover while dragging
              if (isBeingDragged && isDragging) {
                return (
                  <div key={event.id} className="contents">
                    {eventButton}
                  </div>
                );
              }

              return (
                <EventDetailPopover
                  key={event.id}
                  event={event}
                  onDelete={onDeleteEvent}
                  defaultOpen={quickEditEventId === event.id}
                  onTitleSave={onQuickEditSave}
                  onDismissNew={onQuickEditCancel}
                >
                  {eventButton}
                </EventDetailPopover>
              );
            })}
        </div>
      </div>
    </div>
  );
}
