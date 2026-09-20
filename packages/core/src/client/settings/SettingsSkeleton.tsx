import { Skeleton } from "@agent-native/toolkit/design-system";
import type { HTMLAttributes } from "react";

import { cn } from "../utils.js";

const LABEL_WIDTHS = ["w-36", "w-40", "w-32"] as const;
const DESCRIPTION_WIDTHS = ["w-3/5", "w-2/3", "w-1/2"] as const;
const CONTROL_WIDTHS = ["w-28", "w-24", "w-20"] as const;

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
        <div
          key={index}
          className="flex min-h-20 items-start justify-between gap-4 rounded-lg border border-border/60 bg-card px-5 py-4 sm:min-h-24 sm:px-6"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton
              data-shape="label"
              className={cn("h-3.5 max-w-[65%]", LABEL_WIDTHS[index % 3])}
            />
            <Skeleton
              data-shape="description"
              className={cn("h-3 max-w-[80%]", DESCRIPTION_WIDTHS[index % 3])}
            />
          </div>
          <Skeleton
            data-shape="control"
            className={cn(
              "h-10 shrink-0 border border-border bg-muted-foreground/10",
              CONTROL_WIDTHS[index % 3],
            )}
          />
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
        "flex min-h-20 items-start justify-between gap-4 rounded-lg border border-border/60 bg-card px-5 py-4 sm:min-h-24 sm:px-6",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading setting"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton data-shape="label" className="h-3.5 w-40 max-w-[65%]" />
        <Skeleton data-shape="description" className="h-3 w-3/4 max-w-96" />
      </div>
      <div className="flex shrink-0 items-center gap-2" aria-hidden="true">
        {Array.from({ length: controlCount }, (_, index) => (
          <Skeleton
            key={index}
            data-shape="control"
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
