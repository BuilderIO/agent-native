import type { CSSProperties } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardSkeletonProps {
  columns?: number;
  count?: number;
}

export function DashboardSkeleton({
  columns = 2,
  count = 2,
}: DashboardSkeletonProps) {
  return (
    <div className="dashboard-grid-container space-y-4">
      <div
        className="dashboard-grid"
        style={{ "--dash-cols": columns } as CSSProperties}
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="dashboard-grid-cell h-full">
            <Card className="flex h-full flex-col overflow-visible">
              <CardHeader className="pb-2 shrink-0">
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col pt-0">
                <Skeleton className="w-full flex-1 min-h-[250px]" />
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
