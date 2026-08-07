import { Skeleton } from "@agent-native/toolkit/design-system";
import type { HTMLAttributes } from "react";

import { cn } from "../utils.js";

const LABEL_WIDTHS = ["w-1/3", "w-full", "w-3/5"] as const;

export interface SettingsSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
  label?: string;
}

/** Layout-matching placeholder for settings fields while their data loads. */
export function SettingsSkeleton({
  lines = 3,
  label = "Loading settings",
  className,
  ...props
}: SettingsSkeletonProps) {
  return (
    <div
      {...props}
      className={cn("space-y-3", className)}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className={cn("h-3", LABEL_WIDTHS[index % 3])} />
          {index < 2 && (
            <Skeleton className="h-9 w-full border border-border bg-muted-foreground/5" />
          )}
        </div>
      ))}
    </div>
  );
}

export interface SettingsLoadingRowProps extends HTMLAttributes<HTMLDivElement> {
  controlCount?: number;
}

/** Layout-matching placeholder for a single settings row while it loads. */
export function SettingsLoadingRow({
  controlCount = 1,
  className,
  ...props
}: SettingsLoadingRowProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex items-center justify-between gap-4 px-5 py-4 sm:px-6",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading setting"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-3/4 max-w-64" />
      </div>
      <div className="flex shrink-0 items-center gap-2" aria-hidden="true">
        {Array.from({ length: controlCount }, (_, index) => (
          <Skeleton
            key={index}
            className={cn(
              "h-9 border border-border bg-muted-foreground/10",
              index === 0 ? "w-28" : "w-20",
            )}
          />
        ))}
      </div>
    </div>
  );
}
