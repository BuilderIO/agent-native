import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RoomHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional action node rendered on the right (buttons, filters, etc.). */
  right?: ReactNode;
  /** Optional secondary metadata row (e.g. counts, last refresh time). */
  meta?: ReactNode;
  className?: string;
}

/**
 * Reusable header for Workbench room top sections.
 *
 * Consistent across Queue, PRs, Runs, Tools, and Settings: title +
 * subtitle on the left, action cluster on the right. Use the optional
 * `meta` slot for tertiary info (counts, "updated 5s ago") that should
 * sit below the subtitle.
 */
export function RoomHeader({
  title,
  subtitle,
  right,
  meta,
  className,
}: RoomHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border px-6 py-5",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
        {meta ? (
          <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {right ? (
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      ) : null}
    </div>
  );
}
