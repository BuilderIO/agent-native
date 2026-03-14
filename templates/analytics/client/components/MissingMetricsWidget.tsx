import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Users, Eye, Calendar } from "lucide-react";
import { getIdToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

interface MissingMetric {
  metricName: string;
  viewCount: number;
  uniqueViewers: number;
  dashboards: string[];
  lastViewed: string | null;
}

interface MissingMetricsResponse {
  missingMetrics: MissingMetric[];
  totalDefinedMetrics: number;
  lookbackDays: number;
}

async function fetchMissingMetrics(): Promise<MissingMetricsResponse> {
  const token = await getIdToken();
  const response = await fetch("/api/data-dictionary/missing-metrics?limit=10", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error("Failed to fetch missing metrics");
  }

  return response.json();
}

interface MissingMetricsWidgetProps {
  onDefineMetric?: (metricName: string) => void;
}

export function MissingMetricsWidget({ onDefineMetric }: MissingMetricsWidgetProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["missing-metrics"],
    queryFn: fetchMissingMetrics,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Unknown";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Card className="border-orange-500/30 bg-orange-500/5">
        <CardHeader>
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return null; // Silently fail - this is a nice-to-have widget
  }

  if (!data || data.missingMetrics.length === 0) {
    return null; // Don't show widget if no missing metrics
  }

  return (
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <AlertCircle className="h-5 w-5" />
              Metrics Needing Definitions
            </CardTitle>
            <CardDescription className="mt-2">
              These metrics are frequently viewed in dashboards but don't have Data Dictionary entries yet.
              Help the team by defining them!
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 border-orange-500/50 text-orange-600 dark:text-orange-400">
            Last {data.lookbackDays} days
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.missingMetrics.slice(0, 5).map((metric, idx) => (
            <div
              key={metric.metricName}
              className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border/50 bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex items-start gap-3">
                  <Badge variant="secondary" className="shrink-0">
                    #{idx + 1}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm break-words">
                      {metric.metricName}
                    </h4>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        <span>{metric.viewCount} views</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span>{metric.uniqueViewers} viewers</span>
                      </div>
                      {metric.lastViewed && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(metric.lastViewed)}</span>
                        </div>
                      )}
                    </div>
                    {metric.dashboards.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                        <Eye className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          Used in: {metric.dashboards.slice(0, 2).join(", ")}
                          {metric.dashboards.length > 2 && ` +${metric.dashboards.length - 2} more`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDefineMetric?.(metric.metricName)}
                className="shrink-0 border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
              >
                Define This
              </Button>
            </div>
          ))}
        </div>

        {data.missingMetrics.length > 5 && (
          <div className="mt-4 pt-4 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              + {data.missingMetrics.length - 5} more undefined metrics
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
