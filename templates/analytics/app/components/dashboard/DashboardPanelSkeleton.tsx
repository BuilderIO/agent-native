import type { ComponentProps } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export function DashboardPanelSkeleton({
  className,
  ...props
}: ComponentProps<typeof Skeleton>) {
  return <Skeleton {...props} className={className} />;
}
