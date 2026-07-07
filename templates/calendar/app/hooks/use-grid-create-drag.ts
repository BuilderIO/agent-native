import { useState, useRef, useCallback, useEffect } from "react";

export const CREATE_DRAG_SNAP_MINUTES = 15;

interface CreateDragState {
  /** Day/column index the drag started in (week view cross-day drags are not supported — stays put) */
  dayIndex: number;
  /** Pointer Y relative to grid top at drag start */
  startPointerY: number;
  /** Snapped minutes (from grid start hour) at the current pointer position */
  startMinutes: number;
  /** Snapped minutes (from grid start hour) at the current pointer position */
  currentMinutes: number;
  /** Whether we've moved enough to count as a drag (vs a plain click) */
  hasMoved: boolean;
}

export interface CreateDragGhost {
  dayIndex: number;
  /** Top of the ghost block in px, relative to the grid */
  top: number;
  /** Height of the ghost block in px */
  height: number;
  /** Snapped range, in minutes from the grid's start hour */
  startMinutes: number;
  endMinutes: number;
}

export interface UseGridCreateDragOptions {
  hourHeight: number;
  startHour: number;
  /** Reference to the scroll container for computing offsets */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Called when a drag (movement past the threshold) completes, with the snapped range in minutes from startHour */
  onCreate: (
    dayIndex: number,
    startMinutes: number,
    endMinutes: number,
  ) => void;
  /** Minutes to snap to; defaults to the same increment use-event-drag uses */
  snapMinutes?: number;
}

/**
 * Pointer-down-drag-up on empty grid background to draw a live ghost block
 * and commit the dragged range on release. A plain click (no movement past
 * the threshold) never calls onCreate — callers keep their existing
 * fixed-duration click-to-create handler for that case.
 */
export function useGridCreateDrag({
  hourHeight,
  startHour,
  scrollContainerRef,
  onCreate,
  snapMinutes = CREATE_DRAG_SNAP_MINUTES,
}: UseGridCreateDragOptions) {
  const [dragState, setDragState] = useState<CreateDragState | null>(null);
  const dragStateRef = useRef<CreateDragState | null>(null);
  /** Tracks if a create-drag just ended — used to suppress the trailing click */
  const justCreatedRef = useRef(false);
  const pendingMoveEventRef = useRef<PointerEvent | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const getGridTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    return container.getBoundingClientRect().top;
  }, [scrollContainerRef]);

  const getScrollTop = useCallback(() => {
    return scrollContainerRef.current?.scrollTop ?? 0;
  }, [scrollContainerRef]);

  const pxToMinutes = useCallback(
    (px: number): number => {
      const raw = (px / hourHeight) * 60;
      return Math.round(raw / snapMinutes) * snapMinutes;
    },
    [hourHeight, snapMinutes],
  );

  const startCreateDrag = useCallback(
    (e: React.PointerEvent, dayIndex: number) => {
      if (e.button !== 0) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const gridTop = getGridTop();
      const scrollTop = getScrollTop();
      const pointerYInGrid = e.clientY - gridTop + scrollTop;
      const startMinutes = Math.max(0, pxToMinutes(pointerYInGrid));

      const state: CreateDragState = {
        dayIndex,
        startPointerY: pointerYInGrid,
        startMinutes,
        currentMinutes: startMinutes,
        hasMoved: false,
      };

      dragStateRef.current = state;
      setDragState(state);
    },
    [scrollContainerRef, getGridTop, getScrollTop, pxToMinutes],
  );

  const computeNextDragState = useCallback(
    (state: CreateDragState, e: PointerEvent): CreateDragState => {
      const gridTop = getGridTop();
      const scrollTop = getScrollTop();
      const pointerYInGrid = e.clientY - gridTop + scrollTop;
      const dy = pointerYInGrid - state.startPointerY;
      const hasMoved = state.hasMoved || Math.abs(dy) > 3;
      const currentMinutes = Math.max(0, pxToMinutes(pointerYInGrid));

      return { ...state, currentMinutes, hasMoved };
    },
    [getGridTop, getScrollTop, pxToMinutes],
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
      if (!dragStateRef.current) return;
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
      dragStateRef.current = computeNextDragState(state, pending);
    }
  }, [computeNextDragState]);

  const onPointerUp = useCallback(() => {
    flushAndCancelPendingMove();
    const state = dragStateRef.current;
    dragStateRef.current = null;
    setDragState(null);
    if (!state) return;

    if (state.hasMoved) {
      justCreatedRef.current = true;
      requestAnimationFrame(() => {
        setTimeout(() => {
          justCreatedRef.current = false;
        }, 0);
      });

      const rangeStart = Math.min(state.startMinutes, state.currentMinutes);
      const rangeEnd = Math.max(
        rangeStart + snapMinutes,
        Math.max(state.startMinutes, state.currentMinutes),
      );
      onCreate(state.dayIndex, rangeStart, rangeEnd);
    }
  }, [flushAndCancelPendingMove, onCreate, snapMinutes]);

  const cancelCreateDrag = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingMoveEventRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
  }, []);

  useEffect(() => {
    if (!dragState) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelCreateDrag();
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
  }, [dragState, onPointerMove, onPointerUp, cancelCreateDrag]);

  /** The live ghost to render, or null when not actively dragging (past the move threshold) */
  const ghost: CreateDragGhost | null =
    dragState && dragState.hasMoved
      ? {
          dayIndex: dragState.dayIndex,
          top:
            (Math.min(dragState.startMinutes, dragState.currentMinutes) / 60) *
            hourHeight,
          height:
            (Math.max(
              snapMinutes,
              Math.abs(dragState.currentMinutes - dragState.startMinutes),
            ) /
              60) *
            hourHeight,
          startMinutes: Math.min(
            dragState.startMinutes,
            dragState.currentMinutes,
          ),
          endMinutes: Math.max(
            Math.min(dragState.startMinutes, dragState.currentMinutes) +
              snapMinutes,
            Math.max(dragState.startMinutes, dragState.currentMinutes),
          ),
        }
      : null;

  const isCreateDragging = dragState !== null && dragState.hasMoved;

  const shouldSuppressClick = useCallback(() => {
    return justCreatedRef.current;
  }, []);

  return {
    startCreateDrag,
    ghost,
    isCreateDragging,
    shouldSuppressClick,
    cancelCreateDrag,
  };
}
