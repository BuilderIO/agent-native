import { IconX } from "@tabler/icons-react";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const INSPECTOR_CONTROL_POPOVER_WIDTH_PX = 256;

export function InspectorControlPopoverContent({
  title,
  icon,
  titleAccessory,
  headerActions,
  onClose,
  children,
  footer,
  className,
  bodyClassName,
  side = "left",
  align = "start",
  sideOffset = 8,
}: {
  title: string;
  icon?: ReactNode;
  titleAccessory?: ReactNode;
  headerActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  return (
    <PopoverContent
      side={side}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "w-[min(256px,calc(100vw-2rem))] overflow-hidden rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-0 text-foreground shadow-xl",
        className,
      )}
    >
      <div className="grid h-10 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--design-editor-control-border)] px-4">
        <span className="flex size-6 items-center justify-center text-muted-foreground">
          {icon}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate !text-[12px] font-medium">{title}</span>
          {titleAccessory}
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 rounded-md"
            aria-label={"Close property controls" /* i18n-ignore */}
            onClick={onClose}
          >
            <IconX className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className={cn("grid gap-2 p-4", bodyClassName)}>{children}</div>
      {footer ? (
        <div className="flex min-h-12 items-center border-t border-[var(--design-editor-control-border)] px-4 py-2">
          {footer}
        </div>
      ) : null}
    </PopoverContent>
  );
}

/**
 * Canonical property row inside an inspector control popover. The 256px shell
 * has 16px insets, leaving 224px: exactly 28 8px columns. Labels consume nine
 * columns, the gutter one, and controls the remaining eighteen.
 */
export function InspectorControlField({
  label,
  children,
  className,
  labelClassName,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div
      className={cn(
        "design-inspector-popover-field grid min-h-6 items-center gap-2",
        className,
      )}
    >
      <span
        className={cn(
          "truncate !text-[11px] text-muted-foreground",
          labelClassName,
        )}
      >
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
