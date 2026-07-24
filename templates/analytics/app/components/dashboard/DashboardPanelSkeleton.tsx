import type { ComponentProps } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function DashboardPanelSkeleton({
  className,
  ...props
}: ComponentProps<typeof Skeleton>) {
  return (
    <Skeleton
      {...props}
      className={cn(
        "dashboard-panel-skeleton bg-muted-foreground/18",
        className,
      )}
    />
  );
}
