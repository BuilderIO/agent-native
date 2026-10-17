import * as React from "react";

import { cn } from "../utils.js";

// `size` is the control height, matching SelectTrigger. The native `size`
// attribute (a width in characters) is not supported; use a width class.
type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "sm" | "default";
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        data-size={size}
        className={cn(
          "flex w-full rounded-md border border-input bg-background px-3 py-1 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
          size === "sm" ? "h-8" : "h-9",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
