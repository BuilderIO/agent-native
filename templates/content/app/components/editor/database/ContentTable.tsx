import { DataGrid, type DataGridProps } from "@agent-native/toolkit/data-grid";
import {
  IconCheck,
  IconDots,
  IconMinus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  DatabaseTableColumnOrder,
  DatabaseTableLayout,
} from "./DatabaseTableGrid";

export function ContentTableSurface<Row>({
  columnOrder,
  frozenThroughColumnId,
  viewportWidth,
  onViewportWidthChange,
  contentClassName,
  scrollContainerProps,
  horizontalOverflowAffordance = "edges",
  ...props
}: DataGridProps<Row> & {
  columnOrder: readonly string[];
  frozenThroughColumnId?: string | null;
  viewportWidth?: number;
  onViewportWidthChange?: (width: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>();

  useLayoutEffect(() => {
    if (
      !frameRef.current ||
      (viewportWidth !== undefined && !onViewportWidthChange)
    )
      return;
    const updateWidth = (width: number) => {
      if (viewportWidth === undefined) setMeasuredWidth(width);
      onViewportWidthChange?.(width);
    };
    updateWidth(frameRef.current.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [onViewportWidthChange, viewportWidth]);

  return (
    <DatabaseTableLayout.Provider
      value={{
        frozenThroughColumnId,
        viewportWidth: viewportWidth ?? measuredWidth,
      }}
    >
      <DatabaseTableColumnOrder.Provider value={columnOrder}>
        <div
          ref={frameRef}
          data-content-table-surface=""
          className="min-h-0 min-w-0 max-w-full flex-1"
        >
          <DataGrid
            {...props}
            horizontalOverflowAffordance={horizontalOverflowAffordance}
            contentClassName={cn("min-w-[720px]", contentClassName)}
            scrollContainerProps={{
              "data-database-scroll-surface": "table",
              tabIndex: 0,
              ...scrollContainerProps,
              className: cn("overflow-auto", scrollContainerProps?.className),
            }}
          />
        </div>
      </DatabaseTableColumnOrder.Provider>
    </DatabaseTableLayout.Provider>
  );
}

export function ContentTableToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 max-w-full flex-wrap items-center justify-end gap-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const ContentTableToolbarButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof Button>, "children"> & {
    label: string;
    active?: boolean;
    count?: number;
    children: ReactNode;
  }
>(function ContentTableToolbarButton(
  { label, active = false, count, children, className, ...props },
  ref,
) {
  const ariaLabel =
    props["aria-label"] ?? (count ? `${count} ${label}` : label);
  return (
    <Button
      {...props}
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      title={label}
      className={cn(
        "relative h-7 w-7 p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-45",
        active && "bg-muted text-foreground",
        className,
      )}
    >
      {children}
      {count ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-foreground px-1 text-[9px] leading-none text-background">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  );
});

export function ContentTableSearch({
  open,
  value,
  label,
  placeholder,
  closeLabel,
  onOpenChange,
  onValueChange,
}: {
  open: boolean;
  value: string;
  label: string;
  placeholder: string;
  closeLabel: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
}) {
  const close = () => {
    onValueChange("");
    onOpenChange(false);
  };
  return open ? (
    <div className="flex h-7 w-52 items-center gap-1 rounded border border-border bg-background px-2">
      <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
      />
      <button
        type="button"
        aria-label={closeLabel}
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={close}
      >
        <IconX className="size-3.5" />
      </button>
    </div>
  ) : (
    <ContentTableToolbarButton
      label={label}
      active={Boolean(value)}
      onClick={() => onOpenChange(true)}
    >
      <IconSearch className="size-3.5" />
    </ContentTableToolbarButton>
  );
}

export function ContentTableConstraintBar({
  children,
  trailing,
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1.5 overflow-x-auto text-xs",
        className,
      )}
    >
      {children}
      {trailing ? (
        <div className="ms-auto flex items-center gap-1 ps-2">{trailing}</div>
      ) : null}
    </div>
  );
}

export function ContentTableConstraintChip({
  icon,
  label,
  removeLabel,
  onRemove,
}: {
  icon?: ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-7 max-w-72 shrink-0 items-center gap-1.5 rounded border border-border bg-muted/40 px-2 text-foreground">
      {icon ? (
        <span className="shrink-0 text-muted-foreground">{icon}</span>
      ) : null}
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onRemove}
      >
        <IconX className="size-3.5" />
      </button>
    </span>
  );
}

export function ContentTableSelectionControl({
  checked,
  indeterminate = false,
  disabled = false,
  quietUntilHover = false,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  quietUntilHover?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const quiet = quietUntilHover && !checked && !indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        (checked || indeterminate) && "text-foreground",
        quiet &&
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-hover/name:opacity-100 group-focus-within/name:opacity-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 items-center justify-center rounded border",
          checked || indeterminate
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 bg-background text-transparent",
        )}
      >
        {indeterminate ? (
          <IconMinus className="size-3" />
        ) : checked ? (
          <IconCheck className="size-3" />
        ) : null}
      </span>
    </button>
  );
}

export function ContentTableSelectionBar({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-y border-border/45 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground">
      <span className="shrink-0 font-medium whitespace-nowrap text-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {children}
      </div>
    </div>
  );
}

export const ContentTableRowActionButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<"button">, "children"> & { label: string }
>(function ContentTableRowActionButton({ label, className, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
        className,
      )}
    >
      <IconDots className="size-4" />
    </button>
  );
});
