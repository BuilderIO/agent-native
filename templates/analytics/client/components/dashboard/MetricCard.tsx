import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, type LucideIcon } from "lucide-react";
import { MetricValidationButton } from "@/components/MetricValidationButton";

interface MetricCardProps {
  title: string;
  value: string | number | null;
  icon?: LucideIcon;
  description?: string;
  isLoading?: boolean;
  error?: string;
  sql?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  isLoading,
  error,
  sql,
}: MetricCardProps) {
  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="flex items-center gap-1">
          <MetricValidationButton
            metricName={title}
            metricValue={value}
            variant="ghost"
            size="icon"
          />
          {sql && (
            <Link
              to={`/query?sql=${encodeURIComponent(sql)}`}
              className="text-muted-foreground/50 hover:text-foreground transition-colors p-1"
              title="Open in Query Explorer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <>
            <div className="text-2xl font-bold">
              {typeof value === "number" ? value.toLocaleString() : value ?? "-"}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
