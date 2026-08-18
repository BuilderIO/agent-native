import {
  Textarea as ToolkitTextarea,
  type TextareaProps as ToolkitTextareaProps,
} from "@agent-native/toolkit/ui/textarea";
import { cn } from "@agent-native/toolkit/utils";
import * as React from "react";

const Textarea = React.forwardRef<HTMLTextAreaElement, ToolkitTextareaProps>(
  ({ className, ...props }, ref) => (
    <ToolkitTextarea
      ref={ref}
      className={cn("bg-card", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
export type { ToolkitTextareaProps as TextareaProps };
