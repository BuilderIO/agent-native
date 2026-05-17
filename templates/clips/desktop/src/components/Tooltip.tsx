import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * shadcn-style Tooltip for the Tauri tray app.
 *
 * Mirrors shadcn/ui's tooltip API (Tooltip / TooltipTrigger / TooltipContent),
 * but styled with the desktop app's plain-CSS theme tokens instead of Tailwind
 * — this app has no Tailwind/shadcn build. Radix gives us a portaled,
 * collision-aware tooltip so it never gets clipped by the small scrollable
 * settings popover (a hand-rolled `position:absolute` tooltip would), plus
 * keyboard focus support and an instant show that the slow native
 * `title="..."` attribute can't provide.
 */

function TooltipProvider({
  delayDuration = 150,
  skipDelayDuration = 300,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip(
  props: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>,
) {
  // Each Tooltip bundles its own provider so callers don't have to mount one
  // at the app root (matches shadcn's current tooltip.tsx).
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root {...props} />
    </TooltipProvider>
  );
}

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={["tooltip-content", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="tooltip-arrow" width={10} height={5} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
