import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  cropCanvasToRect,
  isUsableSelection,
  mapRectToSource,
  rectFromPoints,
  type Point,
  type Rect,
} from "@/lib/screenshot-region";
import { cn } from "@/lib/utils";

export interface ScreenshotRegionOverlayProps {
  /** The frozen capture to select within. */
  canvas: HTMLCanvasElement;
  /** Receives the cropped canvas, or the original when nothing was selected. */
  onConfirm: (canvas: HTMLCanvasElement) => void;
  onCancel: () => void;
}

/**
 * Drag a region out of a frozen screen capture.
 *
 * The frame is already captured and sharing has stopped by the time this
 * appears, so the picture cannot move under the selection — a menu or hover
 * state the user wanted stays exactly where it was when they picked the
 * screen. Dragging is optional: confirming without a selection keeps the whole
 * frame.
 */
export function ScreenshotRegionOverlay({
  canvas,
  onConfirm,
  onCancel,
}: ScreenshotRegionOverlayProps) {
  const t = useT();
  const holderRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Mount the captured canvas itself rather than re-encoding it to an <img>:
  // a 4K frame costs ~200ms to turn into a data URL, which would be a visible
  // stall between the picker closing and this appearing.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    canvas.className = "block max-h-full max-w-full select-none object-contain";
    canvas.draggable = false;
    holder.appendChild(canvas);
    return () => {
      if (canvas.parentNode === holder) holder.removeChild(canvas);
    };
  }, [canvas]);

  const pointAt = useCallback((event: React.PointerEvent): Point | null => {
    const bounds = holderRef.current
      ?.querySelector("canvas")
      ?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    };
  }, []);

  const confirm = useCallback(() => {
    const displayed = holderRef.current
      ?.querySelector("canvas")
      ?.getBoundingClientRect();
    const sourceRect =
      selection && displayed
        ? mapRectToSource(
            selection,
            { width: displayed.width, height: displayed.height },
            { width: canvas.width, height: canvas.height },
          )
        : null;
    onConfirm(sourceRect ? cropCanvasToRect(canvas, sourceRect) : canvas);
  }, [canvas, onConfirm, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Enter") {
        // Enter on a focused button means that button — Cancel included —
        // so leave it to the button's own click rather than saving.
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, textarea, select")) return;
        event.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirm, onCancel]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const point = pointAt(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = point;
    setIsDragging(true);
    setSelection(null);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const point = pointAt(event);
    if (!point) return;
    setSelection(rectFromPoints(start, point));
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
    setIsDragging(false);
    setSelection((current) => (isUsableSelection(current) ? current : null));
  };

  // Rendered into <body>, never in place. This is invoked from the library's
  // header action group, which sizes its children (`[&>*]:h-9`) and would
  // otherwise crush a full-screen overlay into a 36px band — and any ancestor
  // with a transform or backdrop-filter would re-anchor `fixed` to itself.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-background/95 backdrop-blur-sm">
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          ref={holderRef}
          className="relative flex max-h-full max-w-full cursor-crosshair items-center justify-center"
        >
          {selection ? (
            <div
              className={cn(
                "pointer-events-none absolute border border-primary",
                "shadow-[0_0_0_9999px_hsl(var(--background)/0.72)]",
              )}
              style={{
                left: selection.x,
                top: selection.y,
                width: selection.width,
                height: selection.height,
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Positioned above the selection's dimming shadow, which spreads far
          enough to cover the viewport. */}
      <div className="relative z-10 flex items-center justify-between gap-3 border-t bg-background px-6 py-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {selection
            ? `${Math.round(selection.width)} × ${Math.round(selection.height)}`
            : isDragging
              ? null
              : t("screenshot.dragToSelect")}
        </span>
        <Button onClick={confirm}>
          {selection
            ? t("screenshot.saveSelection")
            : t("screenshot.saveWholeScreen")}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
