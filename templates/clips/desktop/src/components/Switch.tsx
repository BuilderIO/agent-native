import * as React from "react";

import { Switch as UiSwitch } from "./ui/switch";

interface SwitchProps extends Omit<
  React.ComponentPropsWithoutRef<typeof UiSwitch>,
  "aria-label" | "checked" | "onCheckedChange"
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof UiSwitch>,
  SwitchProps
>(({ checked, onCheckedChange, label, className, ...props }, ref) => {
  const switchProps = { ...props } as typeof props & { "data-state"?: string };
  delete switchProps["data-state"];

  return (
    <UiSwitch
      ref={ref}
      {...switchProps}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      data-tw-surface
      className={className}
    />
  );
});
Switch.displayName = "Switch";
