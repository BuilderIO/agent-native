import { Card, CardContent } from "@agent-native/toolkit/ui/card";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";

interface InlineMetricProps {
  title: string;
  value: string | number;
  isLoading?: boolean;
  className?: string;
}

export function InlineMetric({
  title,
  value,
  isLoading,
  className,
}: InlineMetricProps) {
  return (
    <Card className={`bg-card border-border/50 ${className || ""}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">{title}</p>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <p className="text-2xl font-bold tabular-nums truncate">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
