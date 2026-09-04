import * as React from "react";

import { Switch as UiSwitch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<
  React.ComponentPropsWithoutRef<typeof UiSwitch>,
  "aria-label" | "checked" | "onChange" | "onCheckedChange"
> {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof UiSwitch>,
  SwitchProps
>(({ on, onChange, label, disabled = false, className, ...props }, ref) => {
  // TooltipTrigger and Switch both expose `data-state` when composed with
  // `asChild`. The switch owns this attribute; forwarding the tooltip value
  // would replace `checked` with `instant-open` and erase its active styling.
  const switchProps = { ...props } as typeof props & { "data-state"?: string };
  delete switchProps["data-state"];

  return (
    <UiSwitch
      ref={ref}
      {...switchProps}
      checked={on}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      data-tw-surface
      className={cn(
        "data-[state=checked]:border-success data-[state=checked]:bg-success data-[state=unchecked]:border-border",
        className,
      )}
    />
  );
});
Switch.displayName = "Switch";
