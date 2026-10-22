import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/** A data pane with nothing in it: what is missing, what would fill it, and the next action. */
export function EmptyData({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 py-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}

/** Rows at their final height, while the items are read. */
export function DataSkeleton() {
  return (
    <div className="space-y-2" aria-busy>
      <Skeleton className="h-9.5 w-full" />
      <Skeleton className="h-9.5 w-full" />
      <Skeleton className="h-9.5 w-3/4" />
    </div>
  );
}
