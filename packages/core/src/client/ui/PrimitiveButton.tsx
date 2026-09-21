import {
  Button as ToolkitButton,
  type ButtonEmphasis,
  type ButtonProps,
} from "@agent-native/toolkit/ui/button";
import * as React from "react";

import { cn } from "../utils.js";

export type PrimitiveButtonProps = ButtonProps;

/**
 * Resolves the effective semantic emphasis for PrimitiveButton.
 * Matches the toolkit's design-system resolution:
 * - If `emphasis` is explicitly passed, it is respected.
 * - Otherwise, derives emphasis from `variant` if supplied.
 * - Defaults to "ghost" when neither emphasis nor a non-ghost variant is specified.
 */
export function resolvePrimitiveButtonEmphasis(
  emphasis?: ButtonEmphasis,
  variant?: ButtonProps["variant"],
): ButtonEmphasis {
  if (emphasis !== undefined) {
    return emphasis;
  }
  if (variant === "outline") {
    return "outline";
  }
  if (variant === "ghost" || variant === "ghost-inset" || variant === "link") {
    return "ghost";
  }
  if (variant !== undefined) {
    return "solid";
  }
  return "ghost";
}

/**
 * Returns true when the button's resolved visual emphasis is a ghost variant.
 * Only ghost buttons receive the transparent background and inherit-text hover reset.
 */
export function isGhostEmphasis(
  emphasis?: ButtonEmphasis,
  variant?: ButtonProps["variant"],
): boolean {
  const resolved = resolvePrimitiveButtonEmphasis(emphasis, variant);
  return resolved === "ghost" || resolved === "ghost-inset";
}

export const PrimitiveButton = React.forwardRef<
  HTMLButtonElement,
  PrimitiveButtonProps
>(({ className, variant, emphasis, ...props }, ref) => {
  const isGhost = isGhostEmphasis(emphasis, variant);

  return (
    <ToolkitButton
      ref={ref}
      variant={variant ?? "ghost"}
      emphasis={emphasis}
      className={cn(
        "h-auto p-0 active:scale-100 [&_svg]:!size-auto",
        isGhost && "hover:bg-transparent hover:text-inherit",
        className,
      )}
      {...props}
    />
  );
});
PrimitiveButton.displayName = "PrimitiveButton";
