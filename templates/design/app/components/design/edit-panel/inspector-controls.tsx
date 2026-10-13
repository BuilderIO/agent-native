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
      {/* The span carries the hover, not the Button: a disabled Button stops
          pointer events, so a disabled control would silently lose the very
          tooltip that explains why it is disabled. */}
      <TooltipTrigger asChild>
        <span className="flex shrink-0">
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
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SectionIconToggle({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
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
          disabled={disabled}
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

export function nextRowDragOverIndex(
  hoverIndex: number,
  dragIndex: number,
): number | null {
  return hoverIndex === dragIndex ? null : hoverIndex;
}

export function resolveRowDrop(
  from: number | null,
  to: number,
  count: number,
): { from: number; to: number } | null {
  if (from == null || from === to) return null;
  if (from < 0 || from >= count || to < 0 || to >= count) return null;
  return { from, to };
}

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
  disabled,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            "h-6 min-w-6 flex-1 cursor-pointer rounded-none border-r border-border/50 text-muted-foreground first:rounded-l-md last:rounded-r-md last:border-r-0 hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
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

export function InspectorSegment({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-fit max-w-full min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
