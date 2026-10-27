import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "../utils.js";

type SwitchProps = React.ComponentPropsWithoutRef<
  typeof SwitchPrimitives.Root
> & {
  size?: "sm" | "default";
};

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, size = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    data-size={size}
    // A TooltipTrigger asChild overwrites the root's data-state, so the track keys off aria-checked.
    // The after: layer gives the short track a 24px tall hit area without changing its size.
    className={cn(
      "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors after:absolute after:-inset-x-px after:top-1/2 after:h-6 after:-translate-y-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-checked:bg-primary aria-[checked=false]:bg-input",
      size === "sm" ? "h-3.5 w-6" : "h-[1.15rem] w-8",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className="pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
