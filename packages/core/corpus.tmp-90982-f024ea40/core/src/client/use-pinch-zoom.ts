import { useEffect, useRef } from "react";

export interface UsePinchZoomOptions {
  /** Scrolling viewport that receives the gesture. The scaled content should
   *  live inside this element. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Current zoom as a percentage (100 = 100%). */
  zoom: number;
  /** Setter for the zoom value (called with the next percentage). */
  setZoom: (next: number) => void;
  /** Minimum zoom percentage. Default 25. */
  min?: number;
  /** Maximum zoom percentage. Default 400. */
  max?: number;
  /** When true (default), adjusts container scroll so the point under the
   *  cursor stays under the cursor during wheel-zoom. Assumes the scaled
   *  content uses `transform-origin: top left` (or equivalent — e.g. resizing
   *  the inner container's width proportionally to zoom). Disable for layouts
   *  with `transform-origin: center center`. */
  zoomToCursor?: boolean;
  /** Disable the hook entirely without unmounting it. */
  enabled?: boolean;
}

/**
 * Pinch-to-zoom for canvas-style editors. Wires the trackpad pinch / Cmd+scroll
 * wheel gesture and 2-pointer touchscreen pinch onto a scrolling container.
 *
 * Trackpad pinch is detected via `wheel` events with `ctrlKey: true` — browsers
 * have synthesized that since ~2015 specifically so web apps can intercept the
 * gesture. `metaKey` is also accepted so Cmd+scroll on Mac feels native.
 *
 * The hook only calls `setZoom(next)` — it doesn't render anything. Templates
 * decide how to translate the zoom percentage into visual scaling (CSS
 * `transform: scale()`, width/height, etc.).
 */
export function usePinchZoom({
  containerRef,
  zoom,
  setZoom,
  min = 25,
  max = 400,
  zoomToCursor = true,
  enabled = true,
}: UsePinchZoomOptions) {
  const zoomRef = useRef(zoom);
  const setZoomRef = useRef(setZoom);
  zoomRef.current = zoom;
  setZoomRef.current = setZoom;

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const clamp = (n: number) => Math.max(min, Math.min(max, n));

    // rAF coalescing: multiple wheel/pointermove events can fire per frame
    // (trackpad pinch and touch pinch both deliver many events between
    // paints). Instead of calling setZoom() synchronously per event — which
    // schedules a React re-render per event — stash the latest pending zoom
    // (and its cursor-anchored scroll delta) in a ref and flush once per
    // animation frame with the last-wins value. This preserves the exact
    // zoom-to-cursor math; it just applies it at most once per frame.
    //
    // Within a burst the DOM's real scrollLeft/scrollTop do NOT move until
    // flush() runs, so per-event math must not read them directly — every
    // event after the first in the same frame would anchor against the
    // pre-burst scroll position instead of where the (not-yet-committed)
    // previous events in the burst would have scrolled to. Track a simulated
    // running scroll position (`simScrollLeft`/`simScrollTop`, seeded from the
    // real scroll position when a new burst starts) and use that as the
    // anchor base, so each event's math composes exactly as if the prior
    // events in the burst had already been applied — matching the
    // pre-coalescing, one-setZoom-per-event behavior.
    let pendingZoom: number | null = null;
    let pendingScrollDelta: { dx: number; dy: number } | null = null;
    let simScrollLeft = 0;
    let simScrollTop = 0;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      if (pendingZoom === null) return;
      const nextZoom = pendingZoom;
      const scrollDelta = pendingScrollDelta;
      pendingZoom = null;
      pendingScrollDelta = null;
      setZoomRef.current(nextZoom);
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
      e.preventDefault();

      // Use the latest not-yet-applied zoom (if a flush is pending) so rapid
      // wheel events within the same frame compound correctly instead of
      // each computing off the last-committed React state.
      const currentZoom = pendingZoom ?? zoomRef.current;
      const clampedDelta = Math.max(-50, Math.min(50, e.deltaY));
      const factor = Math.exp(-clampedDelta * 0.01);
      const nextZoom = clamp(currentZoom * factor);

      if (nextZoom === currentZoom) return;

      if (zoomToCursor) {
        // Starting a new burst (nothing pending yet): seed the simulated
        // scroll position from the container's real, currently-committed
        // scroll offset.
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
        // Advance the simulated scroll position so the next event in this
        // same burst anchors against where this event would have left it.
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
          // Touch pinch has no cursor-anchoring math, so last-wins is simply
          // the newest zoom value — no scroll delta to accumulate.
          pendingZoom = nextZoom;
          scheduleFlush();
        }
        e.preventDefault();
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
      pendingZoom = null;
      pendingScrollDelta = null;
    };
  }, [containerRef, enabled, min, max, zoomToCursor]);
}
