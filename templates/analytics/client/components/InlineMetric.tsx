import { Card, CardContent } from "@/components/ui/card";
import { MetricValidationButton } from "@/components/MetricValidationButton";
import { Skeleton } from "@/components/ui/skeleton";

interface InlineMetricProps {
  title: string;
  value: string | number;
  isLoading?: boolean;
  className?: string;
  showValidation?: boolean;
}

export function InlineMetric({
  title,
  value,
  isLoading,
  className,
  showValidation = true,
}: InlineMetricProps) {
  return (
    <Card className={`bg-card border-border/50 ${className || ""}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{title}</p>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold tabular-nums truncate">
                {value}
              </p>
            )}
          </div>
          {showValidation && !isLoading && (
            <MetricValidationButton
              metricName={title}
              metricValue={typeof value === "string" ? value : value}
              variant="ghost"
              size="icon"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
