import { useRef, useState, type RefObject } from "react";

import { cn } from "@/lib/utils";

interface HandPanLayerProps {
  scrollRef: RefObject<HTMLElement | null>;
}

/**
 * Covers the canvas while the Hand tool is armed so no pointer event reaches
 * the slide, and turns a drag into scrolling of the canvas container.
 */
export function HandPanLayer({ scrollRef }: HandPanLayerProps) {
  const [panning, setPanning] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      data-hand-pan-layer="true"
      className={cn(
        "absolute inset-0 z-10 touch-none",
        panning ? "cursor-grabbing" : "cursor-grab",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        lastPoint.current = { x: event.clientX, y: event.clientY };
        setPanning(true);
      }}
      onPointerMove={(event) => {
        const last = lastPoint.current;
        const scroll = scrollRef.current;
        if (!last || !scroll) return;
        scroll.scrollLeft -= event.clientX - last.x;
        scroll.scrollTop -= event.clientY - last.y;
        lastPoint.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={() => {
        lastPoint.current = null;
        setPanning(false);
      }}
      onPointerCancel={() => {
        lastPoint.current = null;
        setPanning(false);
      }}
      onWheel={(event) => {
        // Ctrl/cmd-wheel is canvas zoom, handled elsewhere.
        if (event.ctrlKey || event.metaKey) return;
        const scroll = scrollRef.current;
        if (!scroll) return;
        const unitX =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? scroll.clientWidth
              : 1;
        const unitY =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? scroll.clientHeight
              : 1;
        scroll.scrollBy(event.deltaX * unitX, event.deltaY * unitY);
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
