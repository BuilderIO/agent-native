import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "../utils.js";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

/**
 * Opens on keyboard focus, but not when a closing menu, popover or dialog
 * hands focus back to the trigger after a click: Radix opens on any focus,
 * so the tooltip would pop up after every such close.
 */
const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onFocus, ...props }, ref) => (
  <TooltipPrimitive.Trigger
    ref={ref}
    onFocus={(event) => {
      onFocus?.(event);
      // Radix skips its own open-on-focus for a default-prevented event.
      if (!event.currentTarget.matches(":focus-visible")) {
        event.preventDefault();
      }
    }}
    {...props}
  />
));
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

function normalizeTooltipText(text: string): string {
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return decoded.replace(
    /\b([A-Za-z][A-Za-z ]*?)\((?=(?:⌘|⌃|⌥|⇧|Ctrl|Alt|Shift|Cmd))/g,
    (_match, label) => `${label.charAt(0).toUpperCase()}${label.slice(1)} (`,
  );
}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    container?: React.ComponentPropsWithoutRef<
      typeof TooltipPrimitive.Portal
    >["container"];
  }
>(({ className, sideOffset = 6, children, container, ...props }, ref) => {
  const normalizedChildren =
    typeof children === "string" ? normalizeTooltipText(children) : children;
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        data-agent-native-tooltip="true"
        className={cn(
          "z-[500] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md origin-[var(--radix-tooltip-content-transform-origin)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=delayed-open]:duration-150 motion-reduce:data-[state=delayed-open]:zoom-in-100",
          className,
        )}
        {...props}
      >
        {normalizedChildren}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  normalizeTooltipText,
};
