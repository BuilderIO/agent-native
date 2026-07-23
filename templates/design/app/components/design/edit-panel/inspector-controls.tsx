import { IconGripVertical } from "@tabler/icons-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SectionIconButton({
  label,
  onClick,
  children,
  activateOnPointerDown = false,
  disabled = false,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  activateOnPointerDown?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const pointerActivatedRef = useRef(false);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed",
            className,
          )}
          disabled={disabled}
          onPointerDown={(event) => {
            if (!activateOnPointerDown || disabled || event.button !== 0) {
              return;
            }
            pointerActivatedRef.current = true;
            event.preventDefault();
            event.stopPropagation();
            onClick?.();
          }}
          onClick={() => {
            if (pointerActivatedRef.current) {
              pointerActivatedRef.current = false;
              return;
            }
            onClick?.();
          }}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Section-header toggle icon (the design editor's right-aligned section actions, e.g. the
 * auto-layout ⊞ toggle). Highlights with the accent color when active.
 */
export function SectionIconToggle({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground",
            active &&
              "bg-[var(--design-editor-accent-color)]/15 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Compute the next `overIndex` for a dragover event on `hoverIndex`, given the
 * index of the row currently being dragged. Hovering back over the dragged
 * row itself has no meaningful drop position (dropping there is always a
 * no-op — see `resolveRowDrop`), so this returns `null` to clear the
 * indicator rather than echoing back `hoverIndex`, which would otherwise
 * render a stray "before" drop-indicator line on the dragged row itself.
 *
 * Pure — exported for tests.
 */
export function nextRowDragOverIndex(
  hoverIndex: number,
  dragIndex: number,
): number | null {
  return hoverIndex === dragIndex ? null : hoverIndex;
}

/**
 * Resolve a drop into a `{ from, to }` pair, or `null` for a no-op drop.
 *
 * Both `from` (the row that started the drag) and `to` (the row dropped on)
 * are re-validated against `count` — the CURRENT live row count at drop time
 * — rather than trusted from the drag-start snapshot. The underlying array
 * can shrink mid-drag (e.g. an external update removes rows while the
 * pointer is still down); re-checking only `to` and not `from` would let a
 * stale drag-start index (captured before the shrink) reach the caller's
 * `onReorder` out of bounds.
 *
 * Pure — exported for tests.
 */
export function resolveRowDrop(
  from: number | null,
  to: number,
  count: number,
): { from: number; to: number } | null {
  if (from == null || from === to) return null;
  if (from < 0 || from >= count || to < 0 || to >= count) return null;
  return { from, to };
}

/**
 * Minimal pointer-based reorder for a flat row list (fill layers, shadow
 * layers). Deliberately not shared with LayersPanel.tsx's tree-drag logic —
 * that implementation is coupled to nested/multi-select layer nodes, while
 * this only ever needs "move index A to index B" over a flat array.
 *
 * Reads live in a ref (not React state) so a fast pointermove sequence never
 * reorders against a stale `count`/`onReorder` closure, mirroring why
 * ScrubInput tracks its draft in a ref alongside state.
 */
export function useRowDragReorder(
  count: number,
  onReorder: (from: number, to: number) => void,
) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const liveRef = useRef({ count, onReorder });
  liveRef.current = { count, onReorder };

  const getRowProps = (index: number) => ({
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (dragIndex == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const next = nextRowDragOverIndex(index, dragIndex);
      if (next !== overIndex) setOverIndex(next);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const from = dragIndex;
      setDragIndex(null);
      setOverIndex(null);
      const resolved = resolveRowDrop(from, index, liveRef.current.count);
      if (!resolved) return;
      liveRef.current.onReorder(resolved.from, resolved.to);
    },
  });

  const getHandleProps = (index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLSpanElement>) => {
      // Firefox requires setData to be called for the drag to start at all.
      event.dataTransfer.setData("text/plain", String(index));
      event.dataTransfer.effectAllowed = "move";
      setDragIndex(index);
    },
    onDragEnd: () => {
      setDragIndex(null);
      setOverIndex(null);
    },
  });

  return {
    dragIndex,
    overIndex,
    getRowProps,
    getHandleProps,
  };
}

/** Drag handle + before/after drop-indicator line for a reorderable row.
 * Grip is hover-revealed (Figma convention); the row itself uses always-visible
 * eye/remove buttons per this file's existing convention, so only the grip
 * gets the opacity treatment. */
export function RowDragHandle({
  label,
  dropIndicator,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  dropIndicator?: "before" | "after" | null;
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      role="button"
      aria-label={label}
      className="relative flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
    >
      <IconGripVertical className="size-3.5" />
      {dropIndicator === "before" ? (
        <span className="pointer-events-none absolute -top-[3px] left-0 right-0 h-px bg-[var(--design-editor-accent-color)]" />
      ) : null}
      {dropIndicator === "after" ? (
        <span className="pointer-events-none absolute -bottom-[3px] left-0 right-0 h-px bg-[var(--design-editor-accent-color)]" />
      ) : null}
    </span>
  );
}

export function InspectorIconButton({
  label,
  active,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** Optional keyboard-shortcut hint (e.g. "⌥A") appended to the tooltip only — aria-label stays plain text. */
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 min-w-6 cursor-pointer rounded-none border-r border-border/50 text-muted-foreground first:rounded-l-md last:rounded-r-md last:border-r-0 hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground disabled:cursor-not-allowed",
            active &&
              "bg-[var(--design-editor-panel-bg)] text-[var(--design-editor-accent-color)] shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]",
          )}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {shortcut ? `${label}  ${shortcut}` : label}
      </TooltipContent>
    </Tooltip>
  );
}

export function InspectorSegment({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-fit max-w-full min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
      {children}
    </div>
  );
}
