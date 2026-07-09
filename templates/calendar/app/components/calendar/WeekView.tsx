import type { CalendarEvent } from "@shared/api";
import { IconAlertTriangleFilled } from "@tabler/icons-react";
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
  addMinutes,
  min,
} from "date-fns";
import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";

import { useCalendarSetters } from "@/components/layout/AppLayout";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEventDrag } from "@/hooks/use-event-drag";
import { useGridCreateDrag } from "@/hooks/use-grid-create-drag";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useViewPreferences,
  type ViewPreferences,
} from "@/hooks/use-view-preferences";
import { getEventDisplayColor, allOtherDeclined } from "@/lib/event-colors";
import {
  shouldSuppressAfterPopoverClose,
  shouldSuppressCreatePointerDown,
} from "@/lib/popover-click-guard";
import { EventStatusIcon } from "@/lib/rsvp-status";
import { cn } from "@/lib/utils";

import { EventDetailPopover } from "./EventDetailPopover";
import { shouldRenderWeekDragSegment } from "./week-drag-segment";

interface WeekViewProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onDeleteEvent: (eventId: string) => void;
  onEventTimeChange?: (eventId: string, newStart: Date, newEnd: Date) => void;
  onClickTimeSlot?: (
    date: Date,
    startTime: string,
    endTime: string,
    options?: { explicitDuration?: boolean },
  ) => void;
  quickEditEventId?: string | null;
  onQuickEditSave?: (eventId: string, title: string) => void;
  onQuickEditCancel?: (eventId: string) => void;
  draftEventIds?: string[];
  onDraftUpdate?: (
    eventId: string,
    updates: Partial<CalendarEvent> & {
      addGoogleMeet?: boolean;
      addZoom?: boolean;
      workingLocationType?: "homeOffice" | "officeLocation" | "customLocation";
      workingLocationLabel?: string;
    },
  ) => void;
  onDraftCreate?: (
    eventId: string,
    updates?: Partial<CalendarEvent> & {
      addGoogleMeet?: boolean;
      addZoom?: boolean;
    },
  ) => void;
  onDraftDiscard?: (eventId: string) => void;
  isLoading?: boolean;
}

// [startHour, startMin, durationMin, widthPct] per day column (Sun–Sat)
const WEEK_SKELETONS: [number, number, number, number][][] = [
  [
    [9, 0, 60, 78],
    [14, 0, 30, 62],
  ],
  [[10, 0, 90, 82]],
  [
    [8, 30, 45, 74],
    [15, 0, 60, 68],
  ],
  [[10, 0, 60, 80]],
  [
    [9, 0, 45, 70],
    [13, 0, 90, 78],
  ],
  [[11, 0, 30, 65]],
  [[9, 30, 60, 72]],
];

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 60;
const DESKTOP_GUTTER_WIDTH = 60;
const MOBILE_GUTTER_WIDTH = 40;

/** Convert minutes-from-START_HOUR on a given day into a zero-padded "HH:mm" string, clamped to 23:59 */
function minutesToTimeString(totalMinutes: number): string {
  const clamped = Math.min(totalMinutes, 24 * 60 - 1);
  const h = Math.min(23, Math.floor(clamped / 60));
  const m = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

/** Convert minutes-from-START_HOUR on a given day into a Date, for ghost label formatting */
function minutesToDate(day: Date, totalMinutes: number): Date {
  return addMinutes(
    set(startOfDay(day), { hours: START_HOUR, minutes: 0, seconds: 0 }),
    totalMinutes,
  );
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
 * Stacking layout — like the user's drawing and Google Cal.
 *
 * Every event is nearly full width. Overlapping events get a small left
 * indent per nesting depth and stack on top with opaque backgrounds.
 * Text at the top stays readable; the card beneath is covered.
 */
function computeLayout(
  dayEvents: CalendarEvent[],
  day: Date,
): Map<string, LayoutInfo> {
  const result = new Map<string, LayoutInfo>();
  if (dayEvents.length === 0) return result;

  const dayStartMs = startOfDay(day).getTime();
  const dayEndMs = addDays(startOfDay(day), 1).getTime();

  // Cap each event's times to this day's boundaries once, reuse in sort + overlap
  const times = new Map(
    dayEvents.map((ev) => [
      ev.id,
      {
        start: Math.max(parseISO(ev.start).getTime(), dayStartMs),
        end: Math.min(parseISO(ev.end).getTime(), dayEndMs),
      },
    ]),
  );

  const sorted = [...dayEvents].sort((a, b) => {
    const ta = times.get(a.id)!;
    const tb = times.get(b.id)!;
    if (ta.start !== tb.start) return ta.start - tb.start;
    return tb.end - ta.end; // later end first when starts are equal
  });

  const INDENT_PX = 16;

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

function getSegmentStyle(event: CalendarEvent, day: Date) {
  const evStart = parseISO(event.start);
  const evEnd = parseISO(event.end);
  const dayBase = set(startOfDay(day), { hours: START_HOUR });
  const dayEnd = addDays(dayBase, 1);
  const segStart = evStart > dayBase ? evStart : dayBase;
  const segEnd = min([evEnd, dayEnd]);
  const topMinutes = Math.max(0, differenceInMinutes(segStart, dayBase));
  const durationMinutes = Math.max(15, differenceInMinutes(segEnd, segStart));
  return {
    top: `${(topMinutes / 60) * HOUR_HEIGHT}px`,
    height: `${(durationMinutes / 60) * HOUR_HEIGHT}px`,
  };
}

interface WeekEventCardProps {
  event: CalendarEvent;
  day: Date;
  dayIndex: number;
  layout: Map<string, LayoutInfo>;
  now: Date;
  prefs: ViewPreferences;
  focusedEventId: string | null;
  isBeingDragged: boolean;
  isDragging: boolean;
  isDraggedIntoThisColumn: boolean;
  /** Drag overrides flattened to primitives — only the dragged event gets non-null values, so untouched events keep an all-null (referentially trivial) prop shape every frame. */
  overrideTop: number | null;
  overrideHeight: number | null;
  overrideDayIndex: number | null;
  canDrag: boolean;
  onPointerDownEvent: (
    e: React.PointerEvent,
    event: CalendarEvent,
    isStart: boolean,
    dayIndex: number,
  ) => void;
  onResizeTopPointerDown: (
    e: React.PointerEvent,
    eventId: string,
    dayIndex: number,
  ) => void;
  onResizeBottomPointerDown: (
    e: React.PointerEvent,
    eventId: string,
    dayIndex: number,
  ) => void;
  shouldSuppressClick: () => boolean;
  onDeleteEvent: (eventId: string) => void;
  isDraft: boolean;
  defaultOpen: boolean;
  onQuickEditSave?: (eventId: string, title: string) => void;
  onQuickEditCancel?: (eventId: string) => void;
  onDraftUpdate?: WeekViewProps["onDraftUpdate"];
  onDraftCreate?: WeekViewProps["onDraftCreate"];
  onDraftDiscard?: WeekViewProps["onDraftDiscard"];
}

/**
 * A single event's rendered segment within a day column. Memoized so that
 * during a drag/resize (which updates overrideTop/overrideHeight every
 * frame only for the dragged event's own card), every other event's card
 * bails out of re-rendering via the default shallow prop comparison.
 */
const WeekEventCard = memo(function WeekEventCard({
  event,
  day,
  dayIndex,
  layout,
  now,
  prefs,
  focusedEventId,
  isBeingDragged,
  isDragging,
  isDraggedIntoThisColumn,
  overrideTop,
  overrideHeight,
  overrideDayIndex,
  canDrag,
  onPointerDownEvent,
  onResizeTopPointerDown,
  onResizeBottomPointerDown,
  shouldSuppressClick,
  onDeleteEvent,
  isDraft,
  defaultOpen,
  onQuickEditSave,
  onQuickEditCancel,
  onDraftUpdate,
  onDraftCreate,
  onDraftDiscard,
}: WeekEventCardProps) {
  const li = layout.get(event.id) ?? {
    left: 0,
    width: 0,
    col: 0,
    totalCols: 1,
  };
  const overrides =
    overrideTop !== null && overrideHeight !== null && overrideDayIndex !== null
      ? { top: overrideTop, height: overrideHeight, dayIndex: overrideDayIndex }
      : null;
  const start = parseISO(event.start);
  const end = parseISO(event.end);
  const dayBase = startOfDay(day);
  const segDayEnd = addDays(dayBase, 1);
  const isStart = isSameDay(start, day);
  const isEnd = end <= segDayEnd;
  const isDragPreviewSegment =
    isBeingDragged && overrides?.dayIndex === dayIndex;
  const segmentStartsHere = isStart || isDragPreviewSegment;

  // Hide from original column if dragged to a different day
  if (
    isBeingDragged &&
    overrides &&
    overrides.dayIndex !== dayIndex &&
    !isDraggedIntoThisColumn
  ) {
    return null;
  }
  // Hide continuation segments during active drag to avoid ghost overlap
  if (
    !shouldRenderWeekDragSegment({
      isBeingDragged,
      isDragging,
      isStart,
      overrideDayIndex: overrides?.dayIndex,
      dayIndex,
    })
  ) {
    return null;
  }

  const style = overrides
    ? {
        top: `${overrides.top}px`,
        height: `${overrides.height}px`,
      }
    : getSegmentStyle(event, day);
  const color = getEventDisplayColor(event, prefs);
  const segStart = isStart ? start : dayBase;
  const segEnd = min([end, segDayEnd]);
  const durationMin = overrides
    ? (overrides.height / HOUR_HEIGHT) * 60
    : differenceInMinutes(segEnd, segStart);
  // Compute display times (use drag overrides if active)
  const displayStart = overrides
    ? addMinutes(
        set(startOfDay(day), {
          hours: START_HOUR,
          minutes: 0,
          seconds: 0,
        }),
        (overrides.top / HOUR_HEIGHT) * 60,
      )
    : start;
  const displayEnd = overrides ? addMinutes(displayStart, durationMin) : end;
  const isPast = end < now;
  const isDeclined = event.responseStatus === "declined";
  const allOthersOut = allOtherDeclined(event);

  const eventButton = (
    <button
      onPointerDown={(e) => onPointerDownEvent(e, event, isStart, dayIndex)}
      onClick={(e) => {
        if (shouldSuppressClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={cn(
        "absolute overflow-hidden px-1.5 py-0.5 text-left text-[11px] flex flex-col hover:brightness-110 hover:shadow-md group",
        segmentStartsHere ? "rounded-t-md" : "rounded-t-none",
        isEnd ? "rounded-b-md" : "rounded-b-none",
        durationMin <= 30 ? "justify-center" : "justify-start",
        isDeclined && "saturate-[0.3]",
        isBeingDragged && isDragging && "shadow-lg z-[100]",
        isBeingDragged && isDragging && "ring-2 ring-primary/40",
        canDrag && segmentStartsHere && "cursor-grab",
        isBeingDragged && isDragging && "cursor-grabbing",
        event.ownerColor && "pr-4",
      )}
      aria-label={
        event.ownerName || event.overlayEmail
          ? `${event.title}, ${
              event.ownerName || event.overlayEmail
            }'s calendar`
          : event.title
      }
      style={{
        ...style,
        left: `${li.left}px`,
        width: `calc(min(85%, 100% - ${li.left + 2}px))`,
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
        borderTop: !segmentStartsHere
          ? `2px dashed ${
              isPast || isDeclined
                ? `color-mix(in srgb, ${color ?? "hsl(var(--primary))"} 30%, transparent)`
                : `color-mix(in srgb, ${color ?? "hsl(var(--primary))"} 60%, transparent)`
            }`
          : undefined,
        opacity: isBeingDragged && isDragging ? 0.9 : undefined,
      }}
    >
      {event.ownerColor && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full ring-1 ring-background/70"
          style={{ backgroundColor: event.ownerColor }}
        />
      )}
      {durationMin <= 30 ? (
        <div className="flex items-baseline gap-1 truncate">
          {allOthersOut && (
            <IconAlertTriangleFilled
              size={10}
              className="shrink-0 text-current opacity-70 relative top-[1px]"
            />
          )}
          <EventStatusIcon
            event={event}
            className="relative top-[1px] shrink-0"
          />
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
                size={10}
                className="shrink-0 text-current opacity-70"
              />
            )}
            <EventStatusIcon event={event} className="shrink-0" />
            <span className="truncate">{event.title}</span>
          </div>
          {segmentStartsHere && (
            <div
              className={cn(
                "mt-0.5 truncate text-[9px] leading-tight",
                isPast || isDeclined
                  ? "text-muted-foreground/50"
                  : "text-foreground/60",
              )}
            >
              {formatEventTime(displayStart, displayEnd)}
            </div>
          )}
        </>
      )}
      {/* Top resize handle */}
      {canDrag && isStart && (
        <div
          data-resize-handle="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeTopPointerDown(e, event.id, dayIndex);
          }}
          className="absolute left-0 right-0 top-0 h-2 cursor-n-resize"
          style={{ touchAction: "none" }}
        />
      )}
      {/* Bottom resize handle — only on single-day segments; multi-day end segments need segment-aware drag math */}
      {canDrag && isEnd && isStart && (
        <div
          data-resize-handle="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeBottomPointerDown(e, event.id, dayIndex);
          }}
          className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize"
          style={{ touchAction: "none" }}
        />
      )}
    </button>
  );

  // Don't wrap in popover while dragging
  if (isBeingDragged && isDragging) {
    return <div className="contents">{eventButton}</div>;
  }

  return (
    <EventDetailPopover
      event={event}
      onDelete={onDeleteEvent}
      isDraft={isDraft}
      defaultOpen={defaultOpen}
      onTitleSave={onQuickEditSave}
      onDismissNew={onQuickEditCancel}
      onDraftUpdate={onDraftUpdate}
      onDraftCreate={onDraftCreate}
      onDraftDiscard={onDraftDiscard}
    >
      {eventButton}
    </EventDetailPopover>
  );
});

interface WeekCreateGhostProps {
  top: number;
  height: number;
  label: string;
}

/**
 * Isolated ghost layer for an in-progress drag-to-create. Rendered as its own
 * memoized component so the rAF-driven position updates never touch the
 * surrounding day column's render output.
 */
const WeekCreateGhost = memo(function WeekCreateGhost({
  top,
  height,
  label,
}: WeekCreateGhostProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-[90] rounded-md border-2 border-primary bg-primary/15 px-1.5 py-0.5"
      style={{ top: `${top}px`, height: `${height}px` }}
    >
      <span className="truncate text-[11px] font-semibold text-primary">
        {label}
      </span>
    </div>
  );
});

export const WeekView = memo(function WeekView({
  events,
  selectedDate,
  onDateSelect,
  onDeleteEvent,
  onEventTimeChange,
  onClickTimeSlot,
  quickEditEventId,
  onQuickEditSave,
  onQuickEditCancel,
  draftEventIds = [],
  onDraftUpdate,
  onDraftCreate,
  onDraftDiscard,
  isLoading = false,
}: WeekViewProps) {
  const { setFocusedEvent } = useCalendarSetters();
  const isMobile = useIsMobile();
  const GUTTER_WIDTH = isMobile ? MOBILE_GUTTER_WIDTH : DESKTOP_GUTTER_WIDTH;
  const [now, setNow] = useState(new Date());
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const currentTimeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const allDayContainerRef = useRef<HTMLDivElement>(null);
  const [timeGridScrollbarWidth, setTimeGridScrollbarWidth] = useState(0);
  const [allDayScrollbarWidth, setAllDayScrollbarWidth] = useState(0);

  // Escape clears the highlighted/elevated event so it drops behind others
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFocusedEventId(null);
        setFocusedEvent(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setFocusedEvent]);

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

  const { prefs } = useViewPreferences();
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekEnd = useMemo(() => endOfWeek(selectedDate), [selectedDate]);
  // Stable day/hour arrays — recomputed only when the week or weekend
  // visibility actually changes, so memoized children (event buttons) don't
  // see a new array identity on every drag/focus re-render.
  const days = useMemo(() => {
    const fullWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });
    return prefs.hideWeekends
      ? fullWeek.filter((d) => d.getDay() !== 0 && d.getDay() !== 6)
      : fullWeek;
  }, [weekStart, weekEnd, prefs.hideWeekends]);
  const hours = useMemo(
    () =>
      eachHourOfInterval({
        start: set(weekStart, { hours: START_HOUR, minutes: 0 }),
        end: set(weekStart, { hours: END_HOUR - 1, minutes: 0 }),
      }),
    [weekStart],
  );

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

  // Pre-compute timed events per day with layout — include events spanning into this day
  const dayData = useMemo(() => {
    return days.map((day) => {
      const dayStart = startOfDay(day);
      const dayEnd = addDays(dayStart, 1);
      const dayEvents = timedEvents.filter((e) => {
        const evStart = parseISO(e.start);
        const evEnd = parseISO(e.end);
        return evStart < dayEnd && evEnd > dayStart;
      });
      const layout = computeLayout(dayEvents, day);
      return { day, events: dayEvents, layout };
    });
  }, [days, timedEvents]);

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
        // i18n-ignore scanner false positive for layout property access
        const hasConflict = row.some(
          (existing) =>
            /* i18n-ignore scanner false positive */ span.startCol <=
              existing.endCol && span.endCol >= existing.startCol,
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
        // i18n-ignore scanner false positive for layout property access
        const hasConflict = rows[r].some(
          (existing) =>
            /* i18n-ignore scanner false positive */ span.startCol <=
              existing.endCol && span.endCol >= existing.startCol,
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

  const allDayRowHeight = 20;
  const allDaySectionHeight = hasAnyAllDay
    ? allDayRows * allDayRowHeight + 6
    : 0;
  const allDayHeaderSpacerWidth = Math.max(
    0,
    timeGridScrollbarWidth - allDayScrollbarWidth,
  );

  useEffect(() => {
    const measureScrollbars = () => {
      const timeGrid = scrollContainerRef.current;
      const allDayGrid = allDayContainerRef.current;

      setTimeGridScrollbarWidth(
        timeGrid ? Math.max(0, timeGrid.offsetWidth - timeGrid.clientWidth) : 0,
      );
      setAllDayScrollbarWidth(
        allDayGrid
          ? Math.max(0, allDayGrid.offsetWidth - allDayGrid.clientWidth)
          : 0,
      );
    };

    measureScrollbars();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measureScrollbars)
        : null;

    if (scrollContainerRef.current) {
      resizeObserver?.observe(scrollContainerRef.current);
    }
    if (allDayContainerRef.current) {
      resizeObserver?.observe(allDayContainerRef.current);
    }

    window.addEventListener("resize", measureScrollbars);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureScrollbars);
    };
  }, [allDaySectionHeight, hasAnyAllDay]);

  // Timezone label: prefer the short generic name (e.g. "PT", "ET")
  // over the offset form ("GMT-7"), and fall back to the IANA id when
  // the locale data has no friendlier rendering.
  const { tzShort, tzLong, tzIana } = useMemo(() => {
    function nameForToken(token: "shortGeneric" | "longGeneric" | "short") {
      try {
        return (
          new Intl.DateTimeFormat("en-US", { timeZoneName: token })
            .formatToParts(now)
            .find((p) => p.type === "timeZoneName")?.value ?? ""
        );
      } catch {
        return "";
      }
    }

    let iana = "";
    try {
      iana = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {}

    const longGeneric = nameForToken("longGeneric");
    let shortGeneric = nameForToken("shortGeneric");

    // shortGeneric falls back to the offset form for zones with no short name
    // (e.g. "Etc/GMT-7" → "GMT-7"). When that happens, the IANA city is more
    // useful than the offset.
    if (!shortGeneric || /^GMT[+-]/.test(shortGeneric)) {
      const city = iana.split("/").pop()?.replace(/_/g, " ") ?? "";
      shortGeneric = city || nameForToken("short") || shortGeneric;
    }

    return {
      tzShort: shortGeneric,
      tzLong: longGeneric || iana,
      tzIana: iana,
    };
  }, []);

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
    days,
    onEventTimeChange: handleEventTimeChange,
    events,
  });

  const canDrag = !!onEventTimeChange;

  const handleEventPointerDown = useCallback(
    (
      e: React.PointerEvent,
      event: CalendarEvent,
      isStart: boolean,
      dayIndex: number,
    ) => {
      setFocusedEventId(event.id);
      setFocusedEvent(event);
      if (
        isStart &&
        canDrag &&
        !(e.target as HTMLElement).dataset.resizeHandle
      ) {
        startDrag(e, event.id, "move", dayIndex);
      }
    },
    [canDrag, setFocusedEvent, startDrag],
  );

  const handleResizeTopPointerDown = useCallback(
    (e: React.PointerEvent, eventId: string, dayIndex: number) => {
      startDrag(e, eventId, "resize-top", dayIndex);
    },
    [startDrag],
  );

  const handleResizeBottomPointerDown = useCallback(
    (e: React.PointerEvent, eventId: string, dayIndex: number) => {
      startDrag(e, eventId, "resize", dayIndex);
    },
    [startDrag],
  );

  // Drag-to-create: pointer-down-drag-up on empty grid background
  const handleCreateDrag = useCallback(
    (dayIndex: number, startMinutes: number, endMinutes: number) => {
      const day = days[dayIndex];
      if (!day || !onClickTimeSlot) return;
      onClickTimeSlot(
        day,
        minutesToTimeString(startMinutes),
        minutesToTimeString(endMinutes),
        { explicitDuration: true },
      );
    },
    [days, onClickTimeSlot],
  );

  const {
    startCreateDrag,
    ghost: createGhost,
    shouldSuppressClick: shouldSuppressCreateClick,
  } = useGridCreateDrag({
    hourHeight: HOUR_HEIGHT,
    startHour: START_HOUR,
    scrollContainerRef,
    onCreate: handleCreateDrag,
  });

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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default truncate px-1 text-[11px] font-medium text-muted-foreground">
                  {tzShort}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{tzLong}</p>
                {tzIana && tzIana !== tzLong ? (
                  <p className="text-[10px] text-muted-foreground">{tzIana}</p>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Day columns */}
          {days.map((day) => (
            <div
              key={day.toISOString()}
              onClick={() => onDateSelect(day)}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-r border-border py-1.5 sm:flex-row sm:gap-1.5 sm:py-2.5 last:border-r-0",
                isToday(day) ? "bg-primary/5" : "hover:bg-accent/40",
              )}
            >
              <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">
                {isMobile ? format(day, "EEEEE") : format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold sm:h-7 sm:w-7 sm:text-sm",
                  isToday(day)
                    ? "bg-foreground text-background"
                    : "text-foreground",
                )}
              >
                {format(day, "d")}
              </span>
            </div>
          ))}
          {timeGridScrollbarWidth > 0 && (
            <div
              aria-hidden="true"
              className="shrink-0"
              style={{ width: `${timeGridScrollbarWidth}px` }}
            />
          )}
        </div>

        {/* All-day events row */}
        {hasAnyAllDay && (
          <div
            ref={allDayContainerRef}
            className="relative flex border-t border-border overflow-y-auto"
            style={{ maxHeight: 88, height: `${allDaySectionHeight}px` }}
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
                const color = getEventDisplayColor(event, prefs);
                const rowIdx = allDayRowAssignments.get(event.id) ?? 0;
                const colCount = days.length;
                const leftPct = (startCol / colCount) * 100;
                const widthPct = ((endCol - startCol + 1) / colCount) * 100;

                return (
                  <EventDetailPopover
                    key={event.id}
                    event={event}
                    onDelete={onDeleteEvent}
                    isDraft={draftEventIds.includes(event.id)}
                    defaultOpen={quickEditEventId === event.id}
                    onTitleSave={onQuickEditSave}
                    onDismissNew={onQuickEditCancel}
                    onDraftUpdate={onDraftUpdate}
                    onDraftCreate={onDraftCreate}
                    onDraftDiscard={onDraftDiscard}
                  >
                    <button
                      className={cn(
                        "absolute flex items-center gap-1 truncate rounded px-1.5 text-left text-[11px] font-medium text-foreground transition-opacity hover:opacity-80",
                        event.ownerColor && "pr-3.5",
                      )}
                      aria-label={
                        event.ownerName || event.overlayEmail
                          ? `${event.title}, ${
                              event.ownerName || event.overlayEmail
                            }'s calendar`
                          : event.title
                      }
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
                      {allOtherDeclined(event) && (
                        <IconAlertTriangleFilled
                          size={10}
                          className="shrink-0 text-current opacity-70"
                        />
                      )}
                      <EventStatusIcon event={event} className="shrink-0" />
                      <span className="truncate">{event.title}</span>
                      {event.ownerColor && (
                        <span
                          aria-hidden="true"
                          className="absolute right-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full ring-1 ring-background/70"
                          style={{ backgroundColor: event.ownerColor }}
                        />
                      )}
                    </button>
                  </EventDetailPopover>
                );
              })}
            </div>
            {allDayHeaderSpacerWidth > 0 && (
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ width: `${allDayHeaderSpacerWidth}px` }}
              />
            )}
          </div>
        )}
      </div>

      {/* Scrollable time grid */}
      <div
        ref={scrollContainerRef}
        className={cn("flex-1 overflow-y-auto", isDragging && "select-none")}
      >
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
                  <span className="absolute -top-[9px] right-1 text-[10px] font-medium text-muted-foreground sm:right-2 sm:text-[11px]">
                    {isMobile
                      ? format(hour, "ha").toLowerCase()
                      : format(hour, "h a")}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {dayData.map(({ day, events: dayEvents, layout }, dayIndex) => {
            const isCurrentDay = isToday(day);

            // Collect events that were dragged into this column from another day
            const draggedInEvents: CalendarEvent[] = [];
            if (isDragging && dragEventId) {
              const overrides = getDragOverrides(dragEventId);
              if (
                overrides &&
                overrides.dayIndex === dayIndex &&
                !dayEvents.find((e) => e.id === dragEventId)
              ) {
                const draggedEvent = events.find((e) => e.id === dragEventId);
                if (draggedEvent) draggedInEvents.push(draggedEvent);
              }
            }

            return (
              <div
                key={day.toISOString()}
                data-calendar-create-surface="true"
                className={cn(
                  "relative flex-1 border-r border-border last:border-r-0",
                  isCurrentDay && "bg-primary/[0.02]",
                )}
                onPointerDown={(e) => {
                  // Only start a create-drag from empty space, not on an event or its resize handles
                  if ((e.target as HTMLElement).closest("button")) return;
                  if (
                    !onClickTimeSlot ||
                    e.button !== 0 ||
                    shouldSuppressCreatePointerDown()
                  )
                    return;
                  startCreateDrag(e, dayIndex);
                }}
                onClick={(e) => {
                  // Only fire on empty space (not on event buttons or after drags)
                  if ((e.target as HTMLElement).closest("button")) return;
                  if (
                    !onClickTimeSlot ||
                    isDragging ||
                    shouldSuppressClick() ||
                    shouldSuppressCreateClick() ||
                    shouldSuppressAfterPopoverClose()
                  )
                    return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const totalMinutes =
                    Math.floor(((y / HOUR_HEIGHT) * 60) / 15) * 15 +
                    START_HOUR * 60;
                  const endMinutes = totalMinutes + 60;
                  onClickTimeSlot(
                    day,
                    minutesToTimeString(totalMinutes),
                    minutesToTimeString(endMinutes),
                  );
                }}
              >
                {/* Hour grid lines */}
                {hours.map((hour) => (
                  <div
                    key={hour.toISOString()}
                    className="border-b border-border/50"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* Live drag-to-create ghost */}
                {createGhost && createGhost.dayIndex === dayIndex && (
                  <WeekCreateGhost
                    top={createGhost.top}
                    height={createGhost.height}
                    label={formatEventTime(
                      minutesToDate(day, createGhost.startMinutes),
                      minutesToDate(day, createGhost.endMinutes),
                    )}
                  />
                )}

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
                {!isLoading &&
                  [...dayEvents, ...draggedInEvents].map((event) => {
                    const isBeingDragged = dragEventId === event.id;
                    const overrides = getDragOverrides(event.id);
                    return (
                      <WeekEventCard
                        key={event._tempId ?? event.id}
                        event={event}
                        day={day}
                        dayIndex={dayIndex}
                        layout={layout}
                        now={now}
                        prefs={prefs}
                        focusedEventId={focusedEventId}
                        isBeingDragged={isBeingDragged}
                        isDragging={isDragging}
                        isDraggedIntoThisColumn={draggedInEvents.includes(
                          event,
                        )}
                        overrideTop={overrides?.top ?? null}
                        overrideHeight={overrides?.height ?? null}
                        overrideDayIndex={overrides?.dayIndex ?? null}
                        canDrag={canDrag}
                        onPointerDownEvent={handleEventPointerDown}
                        onResizeTopPointerDown={handleResizeTopPointerDown}
                        onResizeBottomPointerDown={
                          handleResizeBottomPointerDown
                        }
                        shouldSuppressClick={shouldSuppressClick}
                        onDeleteEvent={onDeleteEvent}
                        isDraft={draftEventIds.includes(event.id)}
                        defaultOpen={quickEditEventId === event.id}
                        onQuickEditSave={onQuickEditSave}
                        onQuickEditCancel={onQuickEditCancel}
                        onDraftUpdate={onDraftUpdate}
                        onDraftCreate={onDraftCreate}
                        onDraftDiscard={onDraftDiscard}
                      />
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
