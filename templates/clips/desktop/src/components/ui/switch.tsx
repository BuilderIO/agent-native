import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const switchVariants = cva(
  "peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
  {
    variants: {
      size: {
        default: "h-[1.15rem] w-8",
        sm: "h-3.5 w-6",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

const switchThumbVariants = cva(
  "pointer-events-none block rounded-full bg-background shadow-sm ring-1 ring-foreground/20 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground",
);

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> &
    VariantProps<typeof switchVariants>
>(({ className, size = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    data-size={size}
    className={cn(switchVariants({ size, className }))}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className={cn(switchThumbVariants())}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
