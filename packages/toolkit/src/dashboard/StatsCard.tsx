import type { ComponentType } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { cn } from "../utils.js";

export interface StatsCardProps {
  title: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  trend?: { value: number; label?: string };
}

/** A metric card with an optional positive/negative percentage trend. */
export function StatsCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
}: StatsCardProps) {
  return (
    <Card className="border-border/50 bg-card shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {trend && (
            <span
              className={cn(
                "mr-1 font-medium",
                trend.value > 0 ? "text-foreground" : "text-destructive",
              )}
            >
              {trend.value > 0 ? "+" : ""}
              {trend.value}%{trend.label ? ` ${trend.label}` : ""}
            </span>
          )}
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
