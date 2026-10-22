import { useEffect, type RefObject } from "react";

/**
 * Pinch and ctrl/cmd+wheel over anything drawn on top of the canvas but not
 * inside its scroll container (selection handles portaled to the document, the
 * floating toolbar) would fall through to browser page zoom. Hand those events
 * to the container, where `usePinchZoom` turns them into canvas zoom.
 */
export function useForwardCanvasZoom(
  containerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const forward = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const container = containerRef.current;
      const target = event.target;
      if (!container || !(target instanceof Element)) return;
      if (container.contains(target)) return;
      if (target.closest("[role='menu'], [role='dialog'], [role='listbox']")) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }
      event.preventDefault();
      container.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    };
    window.addEventListener("wheel", forward, {
      passive: false,
      capture: true,
    });
    return () =>
      window.removeEventListener("wheel", forward, { capture: true });
  }, [containerRef]);
}
