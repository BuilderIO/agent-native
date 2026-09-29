import { useEffect, useRef } from "react";

import {
  clampZoomFactor,
  normalizeWheelDeltaPx,
  resolveZoomGestureDevice,
  zoomFactorForWheelDelta,
  type ZoomGestureDevice,
} from "./zoom-gesture.js";

export interface UsePinchZoomOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  zoom: number;
  setZoom: (next: number) => void;
  onZoomFrame?: (next: number) => void;
  onZoomEnd?: (next: number) => void;
  min?: number;
  max?: number;
  zoomToCursor?: boolean;
  enabled?: boolean;
}

export function usePinchZoom({
  containerRef,
  zoom,
  setZoom,
  min = 25,
  max = 400,
  zoomToCursor = true,
  enabled = true,
  onZoomFrame,
  onZoomEnd,
}: UsePinchZoomOptions) {
  const zoomRef = useRef(zoom);
  const imperativeZoomRef = useRef<number | null>(null);
  const setZoomRef = useRef(setZoom);
  const onZoomFrameRef = useRef(onZoomFrame);
  const onZoomEndRef = useRef(onZoomEnd);
  const zoomPropRef = useRef(zoom);
  const zoomGestureGenerationRef = useRef(0);
  if (zoomPropRef.current !== zoom) {
    zoomPropRef.current = zoom;
    if (imperativeZoomRef.current !== zoom) {
      imperativeZoomRef.current = null;
      zoomRef.current = zoom;
      zoomGestureGenerationRef.current += 1;
    }
  }
  if (imperativeZoomRef.current === zoom) {
    imperativeZoomRef.current = null;
  }
  zoomRef.current = imperativeZoomRef.current ?? zoom;
  setZoomRef.current = setZoom;
  onZoomFrameRef.current = onZoomFrame;
  onZoomEndRef.current = onZoomEnd;

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const clamp = (n: number) => Math.max(min, Math.min(max, n));

    let pendingZoom: number | null = null;
    let pendingScrollDelta: { dx: number; dy: number } | null = null;
    let simScrollLeft = 0;
    let simScrollTop = 0;
    let rafId: number | null = null;
    let settleTimerId: number | null = null;
    let gestureDevice: ZoomGestureDevice | null = null;

    const scheduleGestureEnd = () => {
      if (!onZoomFrameRef.current && !onZoomEndRef.current) return;
      if (settleTimerId !== null) window.clearTimeout(settleTimerId);
      const generation = zoomGestureGenerationRef.current;
      const expectedZoom = zoomRef.current;
      settleTimerId = window.setTimeout(() => {
        settleTimerId = null;
        if (
          generation !== zoomGestureGenerationRef.current ||
          zoomRef.current !== expectedZoom
        ) {
          return;
        }
        onZoomEndRef.current?.(zoomRef.current);
      }, 120);
    };

    const flush = () => {
      rafId = null;
      if (pendingZoom === null) return;
      const nextZoom = pendingZoom;
      const scrollDelta = pendingScrollDelta;
      pendingZoom = null;
      pendingScrollDelta = null;
      zoomRef.current = nextZoom;
      if (onZoomFrameRef.current) {
        imperativeZoomRef.current = nextZoom;
        onZoomFrameRef.current(nextZoom);
        scheduleGestureEnd();
      } else {
        setZoomRef.current(nextZoom);
      }
      if (scrollDelta) {
        container.scrollLeft += scrollDelta.dx;
        container.scrollTop += scrollDelta.dy;
      }
    };

    const scheduleFlush = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(flush);
    };

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.cancelable) e.preventDefault();

      gestureDevice = resolveZoomGestureDevice({
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        atMs: e.timeStamp,
        previous: gestureDevice,
      });
      const currentZoom = pendingZoom ?? zoomRef.current;
      const factor = clampZoomFactor(
        zoomFactorForWheelDelta(
          normalizeWheelDeltaPx(e.deltaY, e.deltaMode),
          gestureDevice.pinch,
        ),
      );
      const nextZoom = clamp(currentZoom * factor);

      if (nextZoom === currentZoom) return;

      if (zoomToCursor) {
        if (pendingScrollDelta === null) {
          simScrollLeft = container.scrollLeft;
          simScrollTop = container.scrollTop;
        }
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left + simScrollLeft;
        const cy = e.clientY - rect.top + simScrollTop;
        const ratio = nextZoom / currentZoom;
        const dx = cx * (ratio - 1);
        const dy = cy * (ratio - 1);
        simScrollLeft += dx;
        simScrollTop += dy;
        pendingZoom = nextZoom;
        const prevDelta = pendingScrollDelta;
        pendingScrollDelta = {
          dx: (prevDelta?.dx ?? 0) + dx,
          dy: (prevDelta?.dy ?? 0) + dy,
        };
      } else {
        pendingZoom = nextZoom;
      }
      scheduleFlush();
    };

    const activePointers = new Map<number, { x: number; y: number }>();
    let initialDistance = 0;
    let initialZoom = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const [p1, p2] = Array.from(activePointers.values());
        initialDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        initialZoom = zoomRef.current;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2 && initialDistance > 0) {
        const [p1, p2] = Array.from(activePointers.values());
        const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const nextZoom = clamp(initialZoom * (distance / initialDistance));
        if (nextZoom !== (pendingZoom ?? zoomRef.current)) {
          pendingZoom = nextZoom;
          scheduleFlush();
        }
        if (e.cancelable) e.preventDefault();
      }
    };

    const handlePointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) initialDistance = 0;
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    container.addEventListener("pointerup", handlePointerEnd);
    container.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerEnd);
      container.removeEventListener("pointercancel", handlePointerEnd);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimerId !== null) window.clearTimeout(settleTimerId);
      pendingZoom = null;
      pendingScrollDelta = null;
      imperativeZoomRef.current = null;
    };
  }, [containerRef, enabled, min, max, zoomToCursor]);
}
