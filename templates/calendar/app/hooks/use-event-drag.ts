import type { CalendarEvent } from "@shared/api";
import { parseISO, startOfDay } from "date-fns";
import { useState, useRef, useCallback, useEffect } from "react";

import {
  addCalendarDays,
  dateKeyToDate,
  dateKeyToTimezoneIso,
  dateToCalendarDateKey,
  getBrowserTimezone,
  getEventDateKey,
  getEventSegmentForCalendarDay,
} from "@/lib/calendar-timezone";

import { findCalendarEventForSelection } from "./event-list-cache";

const SNAP_MINUTES = 15;

interface DragState {
  mode: "move" | "resize" | "resize-top";
  /** The event being dragged (snapshot at drag start) */
  event: CalendarEvent;
  /** Pointer Y relative to scroll container at drag start */
  startPointerY: number;
  /** Pointer X at drag start (for cross-day detection) */
  startPointerX: number;
  /** Original top in px at drag start */
  originalTop: number;
  /** Original height in px at drag start */
  originalHeight: number;
  /** Offset from pointer to event top (for move mode) */
  pointerOffset: number;
  /** Day index at drag start (week view) */
  startDayIndex: number;
  /** Current override top */
  currentTop: number;
  /** Current override height */
  currentHeight: number;
  /** Current day index (week view cross-day move) */
  currentDayIndex: number;
  /** Whether we've moved enough to count as a drag (vs click) */
  hasMoved: boolean;
  /** Keep the final preview visible while confirmation or the write is pending. */
  isCommitting: boolean;
}

export interface DragOverrides {
  top: number;
  height: number;
  dayIndex: number;
}

export interface EventTimeChangeHandler {
  (
    event: CalendarEvent,
    newStart: Date,
    newEnd: Date,
  ): void | PromiseLike<void>;
}

export interface UseEventDragOptions {
  hourHeight: number;
  startHour: number;
  /** Reference to the scroll container for computing offsets */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Days array (for week view cross-day dragging) */
  days?: Date[];
  /** Called when drag completes with new start/end times */
  onEventTimeChange: EventTimeChangeHandler;
  /** IANA timezone used by the visible calendar grid */
  timezone?: string;
}

export function useEventDrag({
  hourHeight,
  startHour,
  scrollContainerRef,
  days,
  onEventTimeChange,
  timezone = getBrowserTimezone(),
}: UseEventDragOptions) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  /** Tracks if a drag just ended - used to suppress popover click */
  const justDraggedRef = useRef(false);
  /** Latest native pointermove event, flushed to state at most once per frame */
  const pendingMoveEventRef = useRef<PointerEvent | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const getScrollTop = useCallback(() => {
    return scrollContainerRef.current?.scrollTop ?? 0;
  }, [scrollContainerRef]);

  const getGridTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    return container.getBoundingClientRect().top;
  }, [scrollContainerRef]);

  /** Convert a pixel Y position (relative to grid top) to snapped minutes from startHour */
  const pxToMinutes = useCallback(
    (px: number): number => {
      const raw = (px / hourHeight) * 60;
      return Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    },
    [hourHeight],
  );

  /** Get the day column index from clientX */
  const getDayIndexFromX = useCallback(
    (clientX: number): number => {
      if (!days || !scrollContainerRef.current) return 0;
      const container = scrollContainerRef.current;
      // Find the day columns area (after the gutter)
      const rect = container.getBoundingClientRect();
      // Gutter width is the first child's width
      const gutter = container.querySelector("[class*='shrink-0']");
      const gutterWidth = gutter ? gutter.getBoundingClientRect().width : 60;
      const columnsLeft = rect.left + gutterWidth;
      const columnsWidth = rect.width - gutterWidth;
      const colWidth = columnsWidth / days.length;
      const idx = Math.floor((clientX - columnsLeft) / colWidth);
      return Math.max(0, Math.min(days.length - 1, idx));
    },
    [days, scrollContainerRef],
  );

  const startDrag = useCallback(
    (
      e: React.PointerEvent,
      event: CalendarEvent,
      mode: "move" | "resize" | "resize-top",
      dayIndex: number,
    ) => {
      // Only handle left mouse button
      if (e.button !== 0) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      const gridTop = getGridTop();
      const scrollTop = getScrollTop();
      const pointerYInGrid = e.clientY - gridTop + scrollTop;

      // Compute current event position
      const evStart = parseISO(event.start);
      const evEnd = parseISO(event.end);
      const eventDateKey =
        getEventDateKey(event, timezone) ?? dateToCalendarDateKey(evStart);
      const eventDay = days?.[dayIndex] ?? dateKeyToDate(eventDateKey);
      const segment = getEventSegmentForCalendarDay(event, eventDay, timezone);
      const startMinutes =
        segment?.startMinutes ??
        (evStart.getTime() - startOfDay(evStart).getTime()) / 60000;
      const durationMinutes = (evEnd.getTime() - evStart.getTime()) / 60000;

      const originalTop = Math.max(0, (startMinutes / 60) * hourHeight);
      const originalHeight = Math.max(
        (15 / 60) * hourHeight,
        (durationMinutes / 60) * hourHeight,
      );

      const pointerOffset = mode === "move" ? pointerYInGrid - originalTop : 0;

      const state: DragState = {
        mode,
        event,
        startPointerY: pointerYInGrid,
        startPointerX: e.clientX,
        originalTop,
        originalHeight,
        pointerOffset,
        startDayIndex: dayIndex,
        currentTop: originalTop,
        currentHeight: originalHeight,
        currentDayIndex: dayIndex,
        hasMoved: false,
        isCommitting: false,
      };

      dragStateRef.current = state;
      setDragState(state);

      // Capture pointer for smooth tracking
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    [days, scrollContainerRef, getGridTop, getScrollTop, hourHeight, timezone],
  );

  /** Pure computation from the latest pointer event + current drag state to the next drag state */
  const computeNextDragState = useCallback(
    (state: DragState, e: PointerEvent): DragState => {
      const gridTop = getGridTop();
      const scrollTop = getScrollTop();
      const pointerYInGrid = e.clientY - gridTop + scrollTop;

      // Check if we've moved enough to count as a drag
      const dx = e.clientX - state.startPointerX;
      const dy = pointerYInGrid - state.startPointerY;
      const hasMoved = state.hasMoved || Math.abs(dx) > 3 || Math.abs(dy) > 3;

      let newTop = state.currentTop;
      let newHeight = state.currentHeight;
      let newDayIndex = state.currentDayIndex;

      if (state.mode === "move") {
        const rawTop = pointerYInGrid - state.pointerOffset;
        const snappedMinutes = pxToMinutes(rawTop);
        newTop = Math.max(0, (snappedMinutes / 60) * hourHeight);
        newHeight = state.originalHeight;
        if (days) {
          newDayIndex = getDayIndexFromX(e.clientX);
        }
      } else if (state.mode === "resize") {
        // resize bottom - change bottom edge
        const rawBottom = pointerYInGrid;
        const rawHeight = rawBottom - state.originalTop;
        const snappedDuration = Math.max(SNAP_MINUTES, pxToMinutes(rawHeight));
        newHeight = (snappedDuration / 60) * hourHeight;
        newTop = state.originalTop;
      } else {
        // resize-top - change top edge, bottom stays fixed
        const originalBottom = state.originalTop + state.originalHeight;
        const rawTop = pointerYInGrid;
        const snappedTopMinutes = pxToMinutes(rawTop);
        const candidateTop = Math.max(0, (snappedTopMinutes / 60) * hourHeight);
        const rawHeight = originalBottom - candidateTop;
        const snappedDuration = Math.max(SNAP_MINUTES, pxToMinutes(rawHeight));
        newHeight = (snappedDuration / 60) * hourHeight;
        newTop = originalBottom - newHeight;
      }

      return {
        ...state,
        currentTop: newTop,
        currentHeight: newHeight,
        currentDayIndex: newDayIndex,
        hasMoved,
      };
    },
    [getGridTop, getScrollTop, pxToMinutes, hourHeight, days, getDayIndexFromX],
  );

  /** Flush the latest pending pointer event into drag state — runs at most once per animation frame */
  const flushPendingMove = useCallback(() => {
    rafIdRef.current = null;
    const pending = pendingMoveEventRef.current;
    pendingMoveEventRef.current = null;
    const state = dragStateRef.current;
    if (!pending || !state) return;

    const updated = computeNextDragState(state, pending);
    dragStateRef.current = updated;
    setDragState(updated);
  }, [computeNextDragState]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragStateRef.current || dragStateRef.current.isCommitting) return;
      pendingMoveEventRef.current = e;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushPendingMove);
      }
    },
    [flushPendingMove],
  );

  /** Cancel any scheduled rAF flush and apply the latest pending pointer position synchronously */
  const flushAndCancelPendingMove = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const pending = pendingMoveEventRef.current;
    pendingMoveEventRef.current = null;
    const state = dragStateRef.current;
    if (pending && state) {
      const updated = computeNextDragState(state, pending);
      dragStateRef.current = updated;
      setDragState(updated);
    }
  }, [computeNextDragState]);

  const onPointerUp = useCallback(() => {
    if (dragStateRef.current?.isCommitting) return;
    flushAndCancelPendingMove();
    const state = dragStateRef.current;
    if (!state) return;

    if (state.hasMoved) {
      justDraggedRef.current = true;
      // Reset after a tick so click events can check it
      requestAnimationFrame(() => {
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      });

      // Compute new start/end from final position
      const topMinutes = pxToMinutes(state.currentTop);
      const heightMinutes = Math.max(
        SNAP_MINUTES,
        pxToMinutes(state.currentHeight),
      );

      // Determine the base day in the visible calendar timezone.
      const originalStart = parseISO(state.event.start);
      const baseDay =
        days && state.currentDayIndex !== state.startDayIndex
          ? days[state.currentDayIndex]
          : dateKeyToDate(
              getEventDateKey(state.event, timezone) ??
                dateToCalendarDateKey(originalStart),
            );
      const baseDate = dateToCalendarDateKey(baseDay);
      const startTotalMinutes = startHour * 60 + topMinutes;
      const endTotalMinutes = startTotalMinutes + heightMinutes;
      const toZonedIso = (totalMinutes: number) => {
        const dayOffset = Math.floor(totalMinutes / (24 * 60));
        const minuteOfDay = totalMinutes - dayOffset * 24 * 60;
        const hour = Math.floor(minuteOfDay / 60);
        const minute = Math.round(minuteOfDay % 60);
        const normalizedMinute = minute === 60 ? 0 : minute;
        const normalizedHour = minute === 60 ? hour + 1 : hour;
        const time =
          normalizedHour >= 24
            ? "00:00"
            : `${String(normalizedHour).padStart(2, "0")}:${String(
                normalizedMinute,
              ).padStart(2, "0")}`;
        return dateKeyToTimezoneIso(
          addCalendarDays(baseDate, dayOffset),
          time,
          timezone,
        );
      };
      const newStart = new Date(toZonedIso(startTotalMinutes));
      const newEnd = new Date(toZonedIso(endTotalMinutes));

      let completion: void | PromiseLike<void>;
      try {
        completion = onEventTimeChange(state.event, newStart, newEnd);
      } catch (error) {
        dragStateRef.current = null;
        setDragState(null);
        throw error;
      }

      if (
        completion &&
        typeof (completion as PromiseLike<void>).then === "function"
      ) {
        const committingState = { ...state, isCommitting: true };
        dragStateRef.current = committingState;
        setDragState(committingState);
        const clearPreview = () => {
          if (dragStateRef.current !== committingState) return;
          dragStateRef.current = null;
          setDragState(null);
        };
        void Promise.resolve(completion).then(clearPreview, clearPreview);
        return;
      }
    }

    dragStateRef.current = null;
    setDragState(null);
  }, [
    flushAndCancelPendingMove,
    pxToMinutes,
    days,
    startHour,
    onEventTimeChange,
    timezone,
  ]);

  const cancelDrag = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingMoveEventRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
  }, []);

  // Attach global listeners when dragging
  useEffect(() => {
    if (!dragState || dragState.isCommitting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDrag();
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingMoveEventRef.current = null;
    };
  }, [dragState, onPointerMove, onPointerUp, cancelDrag]);

  /** Get position overrides for an event during drag */
  const getDragOverrides = useCallback(
    (event: CalendarEvent): DragOverrides | null => {
      if (
        !dragState ||
        !findCalendarEventForSelection([event], dragState.event)
      ) {
        return null;
      }
      return {
        top: dragState.currentTop,
        height: dragState.currentHeight,
        dayIndex: dragState.currentDayIndex,
      };
    },
    [dragState],
  );

  const isDraggingEvent = useCallback(
    (event: CalendarEvent) =>
      !!dragState && !!findCalendarEventForSelection([event], dragState.event),
    [dragState],
  );

  /** Whether a drag is currently in progress */
  const isDragging = dragState !== null && dragState.hasMoved;

  /** Check if a click should be suppressed (because a drag just ended) */
  const shouldSuppressClick = useCallback(() => {
    return justDraggedRef.current;
  }, []);

  return {
    startDrag,
    getDragOverrides,
    isDraggingEvent,
    isDragging,
    draggedEvent: dragState?.event ?? null,
    shouldSuppressClick,
    dragMode: dragState?.mode ?? null,
  };
}
