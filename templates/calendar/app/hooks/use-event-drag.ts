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
  event: CalendarEvent;
  startPointerY: number;
  startPointerX: number;
  originalTop: number;
  originalHeight: number;
  pointerOffset: number;
  startDayIndex: number;
  currentTop: number;
  currentHeight: number;
  currentDayIndex: number;
  hasMoved: boolean;
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
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  days?: Date[];
  onEventTimeChange: EventTimeChangeHandler;
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
  const justDraggedRef = useRef(false);
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

  const pxToMinutes = useCallback(
    (px: number): number => {
      const raw = (px / hourHeight) * 60;
      return Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    },
    [hourHeight],
  );

  const getDayIndexFromX = useCallback(
    (clientX: number): number => {
      if (!days || !scrollContainerRef.current) return 0;
      const container = scrollContainerRef.current;
      const rect = container.getBoundingClientRect();
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
      if (e.button !== 0) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      const gridTop = getGridTop();
      const scrollTop = getScrollTop();
      const pointerYInGrid = e.clientY - gridTop + scrollTop;

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

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    [days, scrollContainerRef, getGridTop, getScrollTop, hourHeight, timezone],
  );

  const computeNextDragState = useCallback(
    (state: DragState, e: PointerEvent): DragState => {
      const gridTop = getGridTop();
      const scrollTop = getScrollTop();
      const pointerYInGrid = e.clientY - gridTop + scrollTop;

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
        const rawBottom = pointerYInGrid;
        const rawHeight = rawBottom - state.originalTop;
        const snappedDuration = Math.max(SNAP_MINUTES, pxToMinutes(rawHeight));
        newHeight = (snappedDuration / 60) * hourHeight;
        newTop = state.originalTop;
      } else {
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
      requestAnimationFrame(() => {
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      });

      const topMinutes = pxToMinutes(state.currentTop);
      const heightMinutes = Math.max(
        SNAP_MINUTES,
        pxToMinutes(state.currentHeight),
      );

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

  const isDragging = dragState !== null && dragState.hasMoved;

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
