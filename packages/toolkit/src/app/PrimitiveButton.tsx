import {
  Button as ToolkitButton,
  type ButtonEmphasis,
  type ButtonProps,
} from "@agent-native/toolkit/ui/button";
import { cn } from "@agent-native/toolkit/utils";
import * as React from "react";

export type PrimitiveButtonProps = ButtonProps;

function isGhostEmphasis(
  emphasis?: ButtonEmphasis,
  variant?: ButtonProps["variant"],
): boolean {
  if (emphasis !== undefined) {
    return emphasis === "ghost" || emphasis === "ghost-inset";
  }
  return (
    variant === undefined ||
    variant === "ghost" ||
    variant === "ghost-inset" ||
    variant === "link"
  );
}

export const PrimitiveButton = React.forwardRef<
  HTMLButtonElement,
  PrimitiveButtonProps
>(({ className, variant, emphasis, ...props }, ref) => (
  <ToolkitButton
    ref={ref}
    variant={variant ?? "ghost"}
    emphasis={emphasis}
    className={cn(
      "h-auto p-0 active:scale-100 [&_svg]:!size-auto",
      isGhostEmphasis(emphasis, variant) &&
        "hover:bg-transparent hover:text-inherit",
      className,
    )}
    {...props}
  />
));
PrimitiveButton.displayName = "PrimitiveButton";
