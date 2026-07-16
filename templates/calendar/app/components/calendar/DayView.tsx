import { useT } from "@agent-native/core/client";
import type { CalendarEvent } from "@shared/api";
import { IconAlertTriangleFilled, IconMapPin } from "@tabler/icons-react";
import {
  eachHourOfInterval,
  format,
  parseISO,
  differenceInMinutes,
  startOfDay,
  isSameDay,
  set,
  isToday,
  addMinutes,
  addDays,
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
import {
  useViewPreferences,
  type ViewPreferences,
} from "@/hooks/use-view-preferences";
import { partitionAllDayEvents } from "@/lib/all-day-layout";
import { getEventDisplayColor, allOtherDeclined } from "@/lib/event-colors";
import { isOutOfOfficeEvent } from "@/lib/out-of-office";
import {
  shouldSuppressAfterPopoverClose,
  shouldSuppressCreatePointerDown,
} from "@/lib/popover-click-guard";
import { EventStatusIcon } from "@/lib/rsvp-status";
import { cn } from "@/lib/utils";
import {
  createWorkingLocationDisplayLabels,
  getWorkingLocationChipLabel,
  getWorkingLocationTitle,
  isWorkingLocationEvent,
} from "@/lib/working-location";

import { EventDetailPopover } from "./EventDetailPopover";
import { OutOfOfficeEvent } from "./OutOfOfficeEvent";

interface DayViewProps {
  events: CalendarEvent[];
  date: Date;
  onDeleteEvent: (eventId: string) => void;
  onEventTimeChange?: (eventId: string, newStart: Date, newEnd: Date) => void;
  onClickTimeSlot?: (
    date: Date,
    startTime: string,
    endTime: string,
    options?: { explicitDuration?: boolean },
  ) => void;
  quickEditEventId?: string | null;
  onQuickEditSave?: (
    eventId: string,
    title: string,
    accountEmail?: string,
  ) => void;
  onQuickEditCancel?: (eventId: string, accountEmail?: string) => void;
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

// [startHour, startMin, durationMin, widthPct]
const DAY_SKELETONS: [number, number, number, number][] = [
  [9, 0, 60, 82],
  [11, 0, 45, 68],
  [14, 0, 90, 76],
  [16, 30, 30, 60],
];

const START_HOUR = 0;
const END_HOUR = 23;
const HOUR_HEIGHT = 72;

/** Convert minutes-from-START_HOUR into a zero-padded "HH:mm" string, clamped to 23:59 */
function minutesToTimeString(totalMinutes: number): string {
  const clamped = Math.min(totalMinutes, 24 * 60 - 1);
  const h = Math.min(23, Math.floor(clamped / 60));
  const m = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

/** Convert minutes-from-START_HOUR on a given day into a Date, for ghost label formatting */
function minutesToDate(date: Date, totalMinutes: number): Date {
  return addMinutes(
    set(startOfDay(date), { hours: START_HOUR, minutes: 0, seconds: 0 }),
    totalMinutes,
  );
}

/** Format a time range in compact Notion style: "8–10:30 AM" or "9 AM" */
function formatEventTime(start: Date, end: Date): string {
  const startMin = start.getMinutes();
  const endMin = end.getMinutes();
  const sameAmPm =
    (start.getHours() < 12 && end.getHours() < 12) ||
    (start.getHours() >= 12 && end.getHours() >= 12);

  const startStr = startMin === 0 ? format(start, "h") : format(start, "h:mm");
  const endStr = endMin === 0 ? format(end, "h a") : format(end, "h:mm a");

  if (sameAmPm) {
    return `${startStr}–${endStr}`;
  }
  const startWithAmPm =
    startMin === 0 ? format(start, "h a") : format(start, "h:mm a");
  return `${startWithAmPm}–${endStr}`;
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

function getEventStyleForDate(event: CalendarEvent, date: Date) {
  const start = parseISO(event.start);
  const end = parseISO(event.end);
  const dayStart = set(startOfDay(date), { hours: START_HOUR });
  const dayEnd = addDays(startOfDay(date), 1);
  const cappedEnd = min([end, dayEnd]);
  const segStart = start > dayStart ? start : dayStart;
  const topMinutes = Math.max(0, differenceInMinutes(segStart, dayStart));
  const durationMinutes = Math.max(
    15,
    differenceInMinutes(cappedEnd, segStart),
  );
  return {
    top: `${(topMinutes / 60) * HOUR_HEIGHT}px`,
    height: `${(durationMinutes / 60) * HOUR_HEIGHT}px`,
  };
}

interface DayEventCardProps {
  event: CalendarEvent;
  date: Date;
  layout: Map<string, LayoutInfo>;
  now: Date;
  prefs: ViewPreferences;
  focusedEventId: string | null;
  isBeingDragged: boolean;
  isDragging: boolean;
  overrideTop: number | null;
  overrideHeight: number | null;
  canDrag: boolean;
  onPointerDownEvent: (
    e: React.PointerEvent,
    event: CalendarEvent,
    isStart: boolean,
  ) => void;
  onResizeTopPointerDown: (e: React.PointerEvent, eventId: string) => void;
  onResizeBottomPointerDown: (e: React.PointerEvent, eventId: string) => void;
  shouldSuppressClick: () => boolean;
  onDeleteEvent: (eventId: string) => void;
  isDraft: boolean;
  defaultOpen: boolean;
  onQuickEditSave?: (
    eventId: string,
    title: string,
    accountEmail?: string,
  ) => void;
  onQuickEditCancel?: (eventId: string, accountEmail?: string) => void;
  onDraftUpdate?: DayViewProps["onDraftUpdate"];
  onDraftCreate?: DayViewProps["onDraftCreate"];
  onDraftDiscard?: DayViewProps["onDraftDiscard"];
  onPopoverOpenChange: (event: CalendarEvent, open: boolean) => void;
}

/**
 * A single event's rendered block in the day grid. Memoized so that during a
 * drag/resize (which updates overrideTop/overrideHeight every frame only for
 * the dragged event's own card), every other event's card bails out of
 * re-rendering via the default shallow prop comparison.
 */
const DayEventCard = memo(function DayEventCard({
  event,
  date,
  layout,
  now,
  prefs,
  focusedEventId,
  isBeingDragged,
  isDragging,
  overrideTop,
  overrideHeight,
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
  onPopoverOpenChange,
}: DayEventCardProps) {
  const t = useT();
  const workingLocationLabels = createWorkingLocationDisplayLabels(t);
  const li = layout.get(event.id) ?? {
    left: 0,
    width: 100,
    col: 0,
    totalCols: 1,
  };
  const overrides =
    overrideTop !== null && overrideHeight !== null
      ? { top: overrideTop, height: overrideHeight }
      : null;
  const posStyle = overrides
    ? {
        top: `${overrides.top}px`,
        height: `${overrides.height}px`,
      }
    : getEventStyleForDate(event, date);
  const color = getEventDisplayColor(event, prefs);
  const evStart = parseISO(event.start);
  const rawEnd = parseISO(event.end);
  const midnight = addDays(startOfDay(date), 1);
  const evEnd = min([rawEnd, midnight]);
  const isOvernightCapped = rawEnd > midnight;
  const isStart = isSameDay(evStart, date);
  const isEnd = rawEnd <= midnight;
  const dayGridStart = set(startOfDay(date), { hours: START_HOUR });
  // For continuation segments (started a prior day), measure visible
  // duration from the grid start, not from the event's true start.
  const visibleSegStart = isStart ? evStart : dayGridStart;
  const durationMin = overrides
    ? (overrides.height / HOUR_HEIGHT) * 60
    : differenceInMinutes(evEnd, visibleSegStart);
  // Compute display times (use drag overrides if active)
  const displayStart = overrides
    ? addMinutes(dayGridStart, (overrides.top / HOUR_HEIGHT) * 60)
    : visibleSegStart;
  const displayEnd = overrides
    ? addMinutes(displayStart, durationMin)
    : isEnd
      ? evEnd
      : midnight;
  const isPast = parseISO(event.end) < now;
  const isDeclined = event.responseStatus === "declined";
  const allOthersOut = allOtherDeclined(event);

  const eventButton = (
    <button
      onPointerDown={(e) => onPointerDownEvent(e, event, isStart)}
      onClick={(e) => {
        if (shouldSuppressClick()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={cn(
        "absolute overflow-hidden rounded-lg px-2 py-0.5 text-left text-xs flex flex-col hover:brightness-110 hover:shadow-lg group",
        durationMin <= 30 ? "justify-center" : "justify-start",
        !isStart && "rounded-t-none",
        isOvernightCapped && "rounded-b-none",
        isDeclined && "saturate-[0.3]",
        isBeingDragged && isDragging && "shadow-lg z-[100]",
        isBeingDragged && isDragging && "ring-2 ring-primary/40",
        canDrag && isStart && "cursor-grab",
        isBeingDragged && isDragging && "cursor-grabbing",
        event.ownerColor && "pr-4",
      )}
      aria-label={
        event.ownerName || event.overlayEmail
          ? `${getWorkingLocationTitle(event, workingLocationLabels)}, ${
              event.ownerName || event.overlayEmail
            }'s calendar`
          : getWorkingLocationTitle(event, workingLocationLabels)
      }
      style={{
        ...posStyle,
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
        borderTop: !isStart
          ? `2px dashed ${color ?? "hsl(var(--primary))"}`
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
        <div className="flex items-baseline gap-1.5 truncate">
          {allOthersOut && (
            <IconAlertTriangleFilled
              size={12}
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
            {getWorkingLocationChipLabel(event, workingLocationLabels)}
          </span>
          {isWorkingLocationEvent(event) && (
            <span className="shrink-0 text-[10px] font-normal text-foreground/55">
              {t("eventForm.workingLocation")}
            </span>
          )}
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
            <EventStatusIcon event={event} className="shrink-0" />
            <span className="truncate">
              {getWorkingLocationChipLabel(event, workingLocationLabels)}
            </span>
          </div>
          {isWorkingLocationEvent(event) && isStart && (
            <div className="mt-0.5 truncate text-[10px] leading-tight text-foreground/60">
              {t("eventForm.workingLocation")}
            </div>
          )}
          {isStart && (
            <div
              className={cn(
                "mt-0.5 truncate text-[10px] leading-tight",
                isPast || isDeclined
                  ? "text-muted-foreground/50"
                  : "text-foreground/60",
              )}
            >
              {format(displayStart, "h:mm a")} – {format(displayEnd, "h:mm a")}
            </div>
          )}
          {durationMin >= 45 && event.location && (
            <div className="truncate text-[11px] leading-tight text-foreground/50">
              {event.location}
            </div>
          )}
        </>
      )}
      {/* Top resize handle — only on segments that start today */}
      {canDrag && isStart && (
        <div
          data-resize-handle="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeTopPointerDown(e, event.id);
          }}
          className="absolute left-0 right-0 top-0 h-2.5 cursor-n-resize"
          style={{ touchAction: "none" }}
        />
      )}
      {/* Bottom resize handle — only when event both starts and ends today */}
      {canDrag && isEnd && isStart && (
        <div
          data-resize-handle="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeBottomPointerDown(e, event.id);
          }}
          className="absolute bottom-0 left-0 right-0 h-2.5 cursor-s-resize"
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
      onOpenChange={(open) => onPopoverOpenChange(event, open)}
    >
      {eventButton}
    </EventDetailPopover>
  );
});

interface DayCreateGhostProps {
  top: number;
  height: number;
  label: string;
}

/**
 * Isolated ghost layer for an in-progress drag-to-create. Rendered as its own
 * memoized component so the rAF-driven position updates never touch the
 * surrounding grid's render output.
 */
const DayCreateGhost = memo(function DayCreateGhost({
  top,
  height,
  label,
}: DayCreateGhostProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-[90] rounded-lg border-2 border-primary bg-primary/15 px-2 py-0.5"
      style={{ top: `${top}px`, height: `${height}px` }}
    >
      <span className="truncate text-xs font-semibold text-primary">
        {label}
      </span>
    </div>
  );
});

export const DayView = memo(function DayView({
  events,
  date,
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
}: DayViewProps) {
  const t = useT();
  const workingLocationLabels = createWorkingLocationDisplayLabels(t);
  const { setFocusedEvent } = useCalendarSetters();
  const { prefs } = useViewPreferences();
  const [now, setNow] = useState(new Date());
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const focusedEventIdRef = useRef<string | null>(null);
  const currentTimeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Escape clears the highlighted/elevated event so it drops behind others
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        focusedEventIdRef.current = null;
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

  // Stable hours array — recomputed only when the date actually changes, so
  // memoized children don't see a new array identity on every render.
  const hours = useMemo(
    () =>
      eachHourOfInterval({
        start: set(date, { hours: START_HOUR, minutes: 0, seconds: 0 }),
        end: set(date, { hours: END_HOUR, minutes: 0, seconds: 0 }),
      }),
    [date],
  );

  const allDayEvents = useMemo(() => events.filter((e) => e.allDay), [events]);
  const { workingLocations, regularEvents: regularAllDayEvents } = useMemo(
    () => partitionAllDayEvents(allDayEvents),
    [allDayEvents],
  );
  const outOfOfficeEvents = useMemo(
    () => events.filter((event) => !event.allDay && isOutOfOfficeEvent(event)),
    [events],
  );
  const timedEvents = useMemo(
    () => events.filter((event) => !event.allDay && !isOutOfOfficeEvent(event)),
    [events],
  );
  const layout = useMemo(() => computeLayout(timedEvents), [timedEvents]);

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

  const canDrag = !!onEventTimeChange;

  const handleEventPopoverOpenChange = useCallback(
    (event: CalendarEvent, open: boolean) => {
      if (open) {
        focusedEventIdRef.current = event.id;
        setFocusedEventId(event.id);
        setFocusedEvent(event);
        return;
      }
      if (focusedEventIdRef.current !== event.id) return;
      focusedEventIdRef.current = null;
      setFocusedEventId(null);
      setFocusedEvent(null);
    },
    [setFocusedEvent],
  );

  const handleEventPointerDown = useCallback(
    (e: React.PointerEvent, event: CalendarEvent, isStart: boolean) => {
      focusedEventIdRef.current = event.id;
      setFocusedEventId(event.id);
      setFocusedEvent(event);
      if (
        canDrag &&
        isStart &&
        !(e.target as HTMLElement).dataset.resizeHandle
      ) {
        startDrag(e, event.id, "move", 0);
      }
    },
    [canDrag, setFocusedEvent, startDrag],
  );

  const handleResizeTopPointerDown = useCallback(
    (e: React.PointerEvent, eventId: string) => {
      startDrag(e, eventId, "resize-top", 0);
    },
    [startDrag],
  );

  const handleResizeBottomPointerDown = useCallback(
    (e: React.PointerEvent, eventId: string) => {
      startDrag(e, eventId, "resize", 0);
    },
    [startDrag],
  );

  // Drag-to-create: pointer-down-drag-up on empty grid background
  const handleCreateDrag = useCallback(
    (_dayIndex: number, startMinutes: number, endMinutes: number) => {
      if (!onClickTimeSlot) return;
      onClickTimeSlot(
        date,
        minutesToTimeString(startMinutes),
        minutesToTimeString(endMinutes),
        { explicitDuration: true },
      );
    },
    [date, onClickTimeSlot],
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
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border bg-card px-4 py-3">
        <div>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default truncate px-1 pt-1 text-[11px] font-medium text-muted-foreground">
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

      {/* Working locations and ordinary all-day events */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-border bg-card/50">
          {workingLocations.length > 0 && (
            <div data-working-location-lane className="px-4 py-1.5">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
                <IconMapPin aria-hidden="true" className="size-3" />
                {t("eventForm.workingLocation")}
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                {workingLocations.map((event) => {
                  const color = getEventDisplayColor(event, prefs);
                  return (
                    <EventDetailPopover
                      key={`${event.overlayEmail ?? event.accountEmail ?? "primary"}:${event.id}`}
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
                          "relative flex h-6 w-full items-center gap-1.5 truncate rounded-sm px-2 text-left text-xs font-medium text-foreground transition-opacity hover:opacity-80",
                          event.ownerColor && "pr-5",
                        )}
                        aria-label={
                          event.ownerName || event.overlayEmail
                            ? `${getWorkingLocationTitle(event, workingLocationLabels)}, ${
                                event.ownerName || event.overlayEmail
                              }'s calendar`
                            : getWorkingLocationTitle(
                                event,
                                workingLocationLabels,
                              )
                        }
                        style={{
                          backgroundColor: color
                            ? `${color}1f`
                            : "hsl(var(--muted))",
                          borderLeft: `2px solid ${
                            color ?? "hsl(var(--muted-foreground))"
                          }`,
                        }}
                      >
                        <IconMapPin
                          aria-hidden="true"
                          className="size-3 shrink-0 opacity-70"
                        />
                        <span className="truncate">
                          {getWorkingLocationChipLabel(
                            event,
                            workingLocationLabels,
                          )}
                        </span>
                        {event.ownerColor && (
                          <span
                            aria-hidden="true"
                            className="absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full ring-1 ring-background/70"
                            style={{ backgroundColor: event.ownerColor }}
                          />
                        )}
                      </button>
                    </EventDetailPopover>
                  );
                })}
              </div>
            </div>
          )}

          {regularAllDayEvents.length > 0 && (
            <div
              data-all-day-event-lane
              className={cn(
                "px-4 py-2",
                workingLocations.length > 0 && "border-t border-border/60",
              )}
            >
              <p className="mb-1.5 text-[11px] font-medium uppercase text-muted-foreground">
                {t("eventForm.allDay")}
              </p>
              <div className="flex flex-col gap-1">
                {regularAllDayEvents.map((event) => {
                  const color = getEventDisplayColor(event, prefs);
                  return (
                    <EventDetailPopover
                      key={`${event.overlayEmail ?? event.accountEmail ?? "primary"}:${event.id}`}
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
                          "relative flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm font-medium text-foreground transition-all hover:brightness-110",
                          event.ownerColor && "pr-5",
                        )}
                        aria-label={
                          event.ownerName || event.overlayEmail
                            ? `${getWorkingLocationTitle(event, workingLocationLabels)}, ${
                                event.ownerName || event.overlayEmail
                              }'s calendar`
                            : getWorkingLocationTitle(
                                event,
                                workingLocationLabels,
                              )
                        }
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
                        <EventStatusIcon event={event} className="shrink-0" />
                        <span className="truncate">
                          {getWorkingLocationChipLabel(
                            event,
                            workingLocationLabels,
                          )}
                        </span>
                        {event.ownerColor && (
                          <span
                            aria-hidden="true"
                            className="absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full ring-1 ring-background/70"
                            style={{ backgroundColor: event.ownerColor }}
                          />
                        )}
                      </button>
                    </EventDetailPopover>
                  );
                })}
              </div>
            </div>
          )}
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
          data-calendar-create-surface="true"
          className="absolute inset-0 ml-[40px] mr-2 sm:ml-[56px] sm:mr-4"
          onPointerDown={(e) => {
            // Only start a create-drag from empty space, not on an event or its resize handles
            if ((e.target as HTMLElement).closest("button")) return;
            if (
              !onClickTimeSlot ||
              e.button !== 0 ||
              shouldSuppressCreatePointerDown()
            )
              return;
            startCreateDrag(e, 0);
          }}
          onClick={(e) => {
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
              Math.floor(((y / HOUR_HEIGHT) * 60) / 15) * 15 + START_HOUR * 60;
            const endMinutes = totalMinutes + 60;
            onClickTimeSlot(
              date,
              minutesToTimeString(totalMinutes),
              minutesToTimeString(endMinutes),
            );
          }}
        >
          {/* Live drag-to-create ghost */}
          {createGhost && (
            <DayCreateGhost
              top={createGhost.top}
              height={createGhost.height}
              label={formatEventTime(
                minutesToDate(date, createGhost.startMinutes),
                minutesToDate(date, createGhost.endMinutes),
              )}
            />
          )}

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

          {/* Native Google out-of-office context sits behind meetings. */}
          {!isLoading &&
            outOfOfficeEvents.map((event, markerIndex) => {
              const isBeingDragged = dragEventId === event.id;
              const overrides = getDragOverrides(event.id);
              return (
                <OutOfOfficeEvent
                  key={event._tempId ?? event.id}
                  event={event}
                  day={date}
                  hourHeight={HOUR_HEIGHT}
                  color={
                    getEventDisplayColor(event, prefs) ?? "hsl(var(--primary))"
                  }
                  label={t("eventForm.outOfOffice")}
                  markerIndex={markerIndex}
                  canDrag={canDrag}
                  isBeingDragged={isBeingDragged}
                  isDragging={isDragging}
                  isDragTargetDay={isBeingDragged}
                  overrideTop={overrides?.top ?? null}
                  overrideHeight={overrides?.height ?? null}
                  onMovePointerDown={(pointerEvent, startsOnDay) =>
                    handleEventPointerDown(pointerEvent, event, startsOnDay)
                  }
                  onResizeTopPointerDown={(pointerEvent) =>
                    handleResizeTopPointerDown(pointerEvent, event.id)
                  }
                  onResizeBottomPointerDown={(pointerEvent) =>
                    handleResizeBottomPointerDown(pointerEvent, event.id)
                  }
                  shouldSuppressClick={shouldSuppressClick}
                  onDelete={onDeleteEvent}
                  isDraft={draftEventIds.includes(event.id)}
                  defaultOpen={quickEditEventId === event.id}
                  onTitleSave={onQuickEditSave}
                  onDismissNew={onQuickEditCancel}
                  onDraftUpdate={onDraftUpdate}
                  onDraftCreate={onDraftCreate}
                  onDraftDiscard={onDraftDiscard}
                  onOpenChange={(open) =>
                    handleEventPopoverOpenChange(event, open)
                  }
                />
              );
            })}

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
              const isBeingDragged = dragEventId === event.id;
              const overrides = getDragOverrides(event.id);
              return (
                <DayEventCard
                  key={event._tempId ?? event.id}
                  event={event}
                  date={date}
                  layout={layout}
                  now={now}
                  prefs={prefs}
                  focusedEventId={focusedEventId}
                  isBeingDragged={isBeingDragged}
                  isDragging={isDragging}
                  overrideTop={overrides?.top ?? null}
                  overrideHeight={overrides?.height ?? null}
                  canDrag={canDrag}
                  onPointerDownEvent={handleEventPointerDown}
                  onResizeTopPointerDown={handleResizeTopPointerDown}
                  onResizeBottomPointerDown={handleResizeBottomPointerDown}
                  shouldSuppressClick={shouldSuppressClick}
                  onDeleteEvent={onDeleteEvent}
                  isDraft={draftEventIds.includes(event.id)}
                  defaultOpen={quickEditEventId === event.id}
                  onQuickEditSave={onQuickEditSave}
                  onQuickEditCancel={onQuickEditCancel}
                  onDraftUpdate={onDraftUpdate}
                  onDraftCreate={onDraftCreate}
                  onDraftDiscard={onDraftDiscard}
                  onPopoverOpenChange={handleEventPopoverOpenChange}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
});
