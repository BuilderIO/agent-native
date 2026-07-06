import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface MetricCardProps {
  title: string;
  value: string | number | null;
  icon?: React.ComponentType<Record<string, unknown>>;
  description?: string;
  isLoading?: boolean;
  error?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  isLoading,
  error,
}: MetricCardProps) {
  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="flex items-center gap-1">
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
              {typeof value === "number"
                ? value.toLocaleString()
                : (value ?? "-")}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
