import { Skeleton } from "@/components/ui/skeleton";
import { startupAnchor } from "@/lib/startup-timing";
import { cn } from "@/lib/utils";

export const DATABASE_VIEW_CLASS_NAME = "mt-4 min-w-0 w-full max-w-full";

export const DATABASE_VIEW_TABS_ROW_CLASS_NAME =
  "mb-1 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1";

export const DATABASE_VIEW_CONSTRAINTS_ROW_CLASS_NAME =
  "min-h-8 gap-1 py-0.5 text-muted-foreground";

const STARTUP_CONSTRAINTS_ROW_CLASS_NAME =
  "hidden [html[data-content-page-shape=database-constrained]_&]:flex";

const PLACEHOLDER_ROW_WIDTHS = ["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-2/5"];

// A collection draws these boxes until its saved view and that view's first
// rows are in, so the tabs, the sort and filter row, and the table sit where
// the view will draw them. Rows from before the saved order arrives would
// draw in stored order and then jump.
export function DatabaseViewSkeleton({
  constraints,
  anchored = true,
}: {
  constraints: boolean | "startup";
  anchored?: boolean;
}) {
  return (
    <div className={DATABASE_VIEW_CLASS_NAME}>
      <div
        {...(anchored ? startupAnchor("database-tabs") : {})}
        className={DATABASE_VIEW_TABS_ROW_CLASS_NAME}
      >
        <Skeleton className="h-5 w-24" />
        <div className="flex min-h-8 items-center justify-end gap-1">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-7 w-14 rounded-md" />
        </div>
      </div>
      {constraints ? (
        <div
          className={cn(
            "flex min-w-0 items-center",
            DATABASE_VIEW_CONSTRAINTS_ROW_CLASS_NAME,
            constraints === "startup" && STARTUP_CONSTRAINTS_ROW_CLASS_NAME,
          )}
        >
          <Skeleton className="h-7 w-28 rounded" />
          <Skeleton className="h-7 w-32 rounded" />
        </div>
      ) : null}
      <div
        {...(anchored ? startupAnchor("database-table") : {})}
        className="w-full min-w-0 border-t border-border/35"
      >
        <div className="flex h-8 items-center gap-6 border-b border-border/35 px-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        {PLACEHOLDER_ROW_WIDTHS.map((width, index) => (
          <div
            key={index}
            className="flex h-9 items-center border-b border-border/35 px-2"
          >
            <Skeleton className={cn("h-3.5", width)} />
          </div>
        ))}
      </div>
    </div>
  );
}
