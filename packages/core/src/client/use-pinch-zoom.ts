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

    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      const currentZoom = zoomRef.current;
      const clampedDelta = Math.max(-50, Math.min(50, e.deltaY));
      const factor = Math.exp(-clampedDelta * 0.01);
      const nextZoom = clamp(currentZoom * factor);

      if (nextZoom === currentZoom) return;

      if (zoomToCursor) {
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left + container.scrollLeft;
        const cy = e.clientY - rect.top + container.scrollTop;
        const ratio = nextZoom / currentZoom;
        const dx = cx * (ratio - 1);
        const dy = cy * (ratio - 1);
        setZoomRef.current(nextZoom);
        requestAnimationFrame(() => {
          container.scrollLeft += dx;
          container.scrollTop += dy;
        });
      } else {
        setZoomRef.current(nextZoom);
      }
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
        if (nextZoom !== zoomRef.current) {
          setZoomRef.current(nextZoom);
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
    };
  }, [containerRef, enabled, min, max, zoomToCursor]);
}
