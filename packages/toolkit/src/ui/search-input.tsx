import { IconSearch, IconX } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "../utils.js";

export interface SearchInputProps extends Omit<
  React.ComponentPropsWithoutRef<"input">,
  "onChange" | "type" | "value"
> {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name for the clear button. Callers own the localized copy. */
  clearLabel: string;
  containerClassName?: string;
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onValueChange,
      clearLabel,
      className,
      containerClassName,
      onKeyDown,
      ...props
    },
    ref,
  ) => (
    <div className={cn("relative", containerClassName)}>
      <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onValueChange("");
          }
          onKeyDown?.(event);
        }}
        className={cn(
          "h-8 w-full rounded-md border border-border bg-background ps-8 pe-7 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40",
          // WebKit paints its own cancel button inside `type="search"`, which
          // renders a second "x" beside the one below. Both must never ship.
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
          className,
        )}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
          className="absolute end-1.5 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <IconX className="size-3.5" />
        </button>
      ) : null}
    </div>
  ),
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
