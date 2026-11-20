import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";

const KEY_STEP_PX = 8;
const KEY_SHIFT_STEP_PX = 40;

export function SidebarResizeHandle({
  edge,
  label,
  width,
  minWidth,
  maxWidth,
  onPointerDown,
  onWidthChange,
  onReset,
}: {
  edge: "end" | "start";
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWidthChange: (width: number) => void;
  onReset: () => void;
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_SHIFT_STEP_PX : KEY_STEP_PX;
    const growKey = edge === "end" ? "ArrowRight" : "ArrowLeft";
    const shrinkKey = edge === "end" ? "ArrowLeft" : "ArrowRight";
    let next: number | null = null;
    if (event.key === growKey) next = width + step;
    else if (event.key === shrinkKey) next = width - step;
    else if (event.key === "Home") next = minWidth;
    else if (event.key === "End") next = maxWidth;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      data-design-sidebar-resize-handle={edge}
      className={cn(
        "absolute top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent outline-none transition-colors hover:bg-[var(--design-editor-selection-color)] focus-visible:bg-[var(--design-focus-ring-color)]",
        edge === "end" ? "right-[-2px]" : "left-[-2px]",
      )}
      onPointerDown={onPointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
    />
  );
}
