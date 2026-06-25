import { useFormatters, useT } from "@agent-native/core/client";
import { IconUser, IconCalendar } from "@tabler/icons-react";
import { useMemo } from "react";
import { useParams } from "react-router";

import { dashboards } from "@/pages/adhoc/registry";

interface DashboardHeaderProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

export function DashboardHeader({
  title,
  description,
  actions,
}: DashboardHeaderProps) {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { formatDate } = useFormatters();

  const metadata = useMemo(() => {
    return dashboards.find((d) => d.id === id);
  }, [id]);

  const displayTitle = title || metadata?.name || t("navigation.dashboard");
  const dateFormat: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  function formatMetadataDate(value: string): string {
    try {
      return formatDate(value, dateFormat);
    } catch {
      return value;
    }
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight truncate">
            {displayTitle}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>

      {metadata && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {metadata.author && (
            <div className="flex items-center gap-1.5">
              <IconUser className="h-3.5 w-3.5" />
              <span>{metadata.author}</span>
            </div>
          )}
          {metadata.lastUpdated && (
            <div className="flex items-center gap-1.5">
              <IconCalendar className="h-3.5 w-3.5" />
              <span>
                {t("dashboardHeader.updated", {
                  date: formatMetadataDate(metadata.lastUpdated),
                })}
              </span>
            </div>
          )}
          {metadata.dateCreated && (
            <div className="flex items-center gap-1.5">
              <IconCalendar className="h-3.5 w-3.5" />
              <span>
                {t("dashboardHeader.created", {
                  date: formatMetadataDate(metadata.dateCreated),
                })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
