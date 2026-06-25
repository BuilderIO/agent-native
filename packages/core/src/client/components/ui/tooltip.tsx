import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "../../utils.js";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

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
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => {
  const normalizedChildren =
    typeof children === "string" ? normalizeTooltipText(children) : children;
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        data-agent-native-tooltip="true"
        className={cn(
          "z-[300] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md animate-in fade-in-0 zoom-in-95",
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
