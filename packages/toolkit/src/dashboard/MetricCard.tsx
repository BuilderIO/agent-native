import type { ComponentType } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Skeleton } from "../ui/skeleton.js";

export interface MetricCardProps {
  title: string;
  value: string | number | null;
  icon?: ComponentType<{ className?: string }>;
  description?: string;
  loading?: boolean;
  error?: string;
}

/** A compact, data-source-agnostic dashboard metric. */
export function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  loading,
  error,
}: MetricCardProps) {
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <>
            <div className="text-2xl font-bold">
              {typeof value === "number"
                ? value.toLocaleString()
                : (value ?? "-")}
            </div>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
