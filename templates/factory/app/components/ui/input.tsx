import { Input as ToolkitInput } from "@agent-native/toolkit/ui/input";
import { cn } from "@agent-native/toolkit/utils";
import * as React from "react";

type InputProps = React.ComponentProps<typeof ToolkitInput>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <ToolkitInput ref={ref} className={cn("bg-card", className)} {...props} />
  ),
);
Input.displayName = "Input";

export { Input };
export type { InputProps };
