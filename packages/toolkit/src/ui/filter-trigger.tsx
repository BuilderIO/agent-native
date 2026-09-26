import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface FilterTriggerIndicatorProps {
  active: boolean;
  children: ReactNode;
  className?: string;
  dotClassName?: string;
}

export function FilterTriggerIndicator({
  active,
  children,
  className,
  dotClassName,
}: FilterTriggerIndicatorProps) {
  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      data-filter-active={active ? "true" : "false"}
    >
      {children}
      {active ? (
        <span
          aria-hidden="true"
          data-filter-active-dot=""
          className={cn(
            "pointer-events-none absolute -end-1 -top-1 size-1.5 rounded-full bg-primary",
            dotClassName,
          )}
        />
      ) : null}
    </span>
  );
}
