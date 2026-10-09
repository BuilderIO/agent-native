import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Figma's `Editor/Select`: 24px tall, 6px radius, 8px left and 4px right
// padding around a 12/16 label and a chevron.
export const TOP_BAR_SELECT_TRIGGER_CLASS =
  "h-6 w-auto min-w-0 gap-1 rounded-md border-border py-0 pl-2 pr-1 text-xs font-normal text-foreground shadow-none";
export const TOP_BAR_ICON_BUTTON_CLASS =
  "size-6 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:opacity-35";

/**
 * Figma's `Editor/Status dot`: 6px, fully round, in the app's positive color
 * (the same emerald the review panel uses for a good state). It is static
 * until a route has a status to report.
 */
export function TopBarStatusDot() {
  return (
    <span
      aria-hidden="true"
      data-design-status-dot
      className="size-1.5 shrink-0 rounded-full bg-emerald-500"
    />
  );
}

/** A page as Figma's route controls read it: its name, then its route muted. */
export function TopBarRouteLabel({
  title,
  route,
}: {
  title: string;
  route: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span data-design-route-title className="truncate font-medium">
        {title}
      </span>
      <span
        data-design-route-path
        className="min-w-0 truncate font-normal text-muted-foreground"
      >
        {route}
      </span>
    </span>
  );
}

/** A 24px icon button with a tooltip, as the top bar's centre controls use. */
export function TopBarIconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          className={TOP_BAR_ICON_BUTTON_CLASS}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
