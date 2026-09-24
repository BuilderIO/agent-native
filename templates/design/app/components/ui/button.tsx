import {
  Button as ToolkitButton,
  type ButtonProps,
} from "@agent-native/toolkit/ui/button";
import * as React from "react";

import { cn } from "@/lib/utils";

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, ...props }, ref) => (
    <ToolkitButton
      ref={ref}
      variant={variant}
      className={cn(
        variant === "outline" &&
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button };
export type { ButtonProps };
