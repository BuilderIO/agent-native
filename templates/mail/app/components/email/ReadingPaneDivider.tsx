import { useT } from "@agent-native/core/client/i18n";
import { useRef, useState, type RefObject } from "react";

import {
  clampListWidth,
  READING_PANE_LIST_DEFAULT_WIDTH,
} from "@/lib/reading-pane";
import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 16;

export function ReadingPaneDivider({
  listRef,
  width,
  minWidth,
  maxWidth,
  onCommit,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  width: number;
  minWidth: number;
  maxWidth: number;
  onCommit: (width: number) => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    width: number;
    direction: 1 | -1;
  } | null>(null);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    delete document.documentElement.dataset.mailResizing;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit(drag.width);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("mail.readingPane.resizeList")}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.dataset.mailResizing = "";
        dragRef.current = {
          startX: event.clientX,
          startWidth: width,
          width,
          direction:
            getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        drag.width = clampListWidth(
          drag.startWidth + (event.clientX - drag.startX) * drag.direction,
          maxWidth,
        );
        if (listRef.current) listRef.current.style.width = `${drag.width}px`;
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onCommit(READING_PANE_LIST_DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        const forward =
          getComputedStyle(event.currentTarget).direction === "rtl"
            ? "ArrowLeft"
            : "ArrowRight";
        let next: number;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          next =
            width + (event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP);
        } else if (event.key === "Home") {
          next = minWidth;
        } else if (event.key === "End") {
          next = maxWidth;
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onCommit(next);
      }}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none"
    >
      <div
        className={cn(
          "absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-border/40 transition-colors group-hover:bg-primary/40 group-focus-visible:w-0.5 group-focus-visible:bg-primary rtl:translate-x-1/2",
          dragging && "bg-primary/60",
        )}
      />
    </div>
  );
}
