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
 * until a screen has a status to report.
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

/** A screen by its name alone, as the Interact screen picker reads it. */
export function TopBarScreenLabel({ title }: { title: string }) {
  return (
    <span data-design-screen-title className="min-w-0 truncate font-medium">
      {title}
    </span>
  );
}

/**
 * A URL screen as the Design top bar reads it: its name, then the path its app
 * is serving, muted. Only a screen backed by a running app has one.
 */
export function TopBarRouteLabel({
  title,
  route,
}: {
  title: string;
  route: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <TopBarScreenLabel title={title} />
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
