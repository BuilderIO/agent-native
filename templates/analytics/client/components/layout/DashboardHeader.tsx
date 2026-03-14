import { User, Calendar } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { dashboards, adHocAnalyses } from "@/pages/adhoc/registry";

interface DashboardHeaderProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

export function DashboardHeader({ title, description, actions }: DashboardHeaderProps) {
  const { id } = useParams<{ id: string }>();

  const metadata = useMemo(() => {
    const allDashboards = [...dashboards, ...adHocAnalyses];
    return allDashboards.find((d) => d.id === id);
  }, [id]);

  const displayTitle = title || metadata?.name || "Dashboard";

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight truncate">
            {displayTitle}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>

      {metadata && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {metadata.author && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              <span>{metadata.author}</span>
            </div>
          )}
          {metadata.lastUpdated && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Updated {formatDate(metadata.lastUpdated)}</span>
            </div>
          )}
          {metadata.dateCreated && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Created {formatDate(metadata.dateCreated)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
