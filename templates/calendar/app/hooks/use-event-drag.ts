import { useState, useRef, useCallback, useEffect } from "react";
import { parseISO, startOfDay, set, addMinutes, addDays } from "date-fns";
import type { CalendarEvent } from "@shared/api";

const SNAP_MINUTES = 15;

interface DragState {
  eventId: string;
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
}

export interface DragOverrides {
  top: number;
  height: number;
  dayIndex: number;
}

export interface UseEventDragOptions {
  hourHeight: number;
  startHour: number;
  /** Reference to the scroll container for computing offsets */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Days array (for week view cross-day dragging) */
  days?: Date[];
  /** Called when drag completes with new start/end times */
  onEventTimeChange: (eventId: string, newStart: Date, newEnd: Date) => void;
  /** All events (to find the event being dragged) */
  events: CalendarEvent[];
}

export function useEventDrag({
  hourHeight,
  startHour,
  scrollContainerRef,
  days,
  onEventTimeChange,
  events,
}: UseEventDragOptions) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  /** Tracks if a drag just ended - used to suppress popover click */
  const justDraggedRef = useRef(false);

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
      eventId: string,
      mode: "move" | "resize" | "resize-top",
      dayIndex: number,
    ) => {
      const event = events.find((ev) => ev.id === eventId);
      if (!event) return;

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
      const dayStart = set(startOfDay(evStart), {
        hours: startHour,
      });
      const startMinutes = (evStart.getTime() - dayStart.getTime()) / 60000;
      const durationMinutes = (evEnd.getTime() - evStart.getTime()) / 60000;

      const originalTop = Math.max(0, (startMinutes / 60) * hourHeight);
      const originalHeight = Math.max(
        (15 / 60) * hourHeight,
        (durationMinutes / 60) * hourHeight,
      );

      const pointerOffset = mode === "move" ? pointerYInGrid - originalTop : 0;

      const state: DragState = {
        eventId,
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
      };

      dragStateRef.current = state;
      setDragState(state);

      // Capture pointer for smooth tracking
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    [
      events,
      scrollContainerRef,
      getGridTop,
      getScrollTop,
      startHour,
      hourHeight,
    ],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

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

      const updated: DragState = {
        ...state,
        currentTop: newTop,
        currentHeight: newHeight,
        currentDayIndex: newDayIndex,
        hasMoved,
      };
      dragStateRef.current = updated;
      setDragState(updated);
    },
    [getGridTop, getScrollTop, pxToMinutes, hourHeight, days, getDayIndexFromX],
  );

  const onPointerUp = useCallback(() => {
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

      // Determine the base day
      const originalStart = parseISO(state.event.start);
      let baseDay: Date;
      if (days && state.currentDayIndex !== state.startDayIndex) {
        baseDay = days[state.currentDayIndex];
      } else {
        baseDay = startOfDay(originalStart);
      }

      const newStart = addMinutes(
        set(baseDay, { hours: startHour, minutes: 0, seconds: 0 }),
        topMinutes,
      );
      const newEnd = addMinutes(newStart, heightMinutes);

      onEventTimeChange(state.eventId, newStart, newEnd);
    }

    dragStateRef.current = null;
    setDragState(null);
  }, [pxToMinutes, days, startHour, onEventTimeChange]);

  // Attach global listeners when dragging
  useEffect(() => {
    if (!dragState) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, onPointerMove, onPointerUp]);

  /** Get position overrides for an event during drag */
  const getDragOverrides = useCallback(
    (eventId: string): DragOverrides | null => {
      if (!dragState || dragState.eventId !== eventId) return null;
      return {
        top: dragState.currentTop,
        height: dragState.currentHeight,
        dayIndex: dragState.currentDayIndex,
      };
    },
    [dragState],
  );

  /** Whether a drag is currently in progress */
  const isDragging = dragState !== null && dragState.hasMoved;

  /** The event ID being dragged */
  const dragEventId = dragState?.eventId ?? null;

  /** Check if a click should be suppressed (because a drag just ended) */
  const shouldSuppressClick = useCallback(() => {
    return justDraggedRef.current;
  }, []);

  return {
    startDrag,
    getDragOverrides,
    isDragging,
    dragEventId,
    shouldSuppressClick,
    dragMode: dragState?.mode ?? null,
  };
}
