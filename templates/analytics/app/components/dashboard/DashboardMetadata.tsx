import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconCalendar, IconClock, IconUser } from "@tabler/icons-react";

interface DashboardMetadataProps {
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

function MetadataRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconCalendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-foreground/80">{value}</span>
    </div>
  );
}

export function DashboardMetadata({
  createdAt,
  createdBy,
  updatedAt,
  updatedBy,
}: DashboardMetadataProps) {
  const t = useT();
  const { formatDate } = useFormatters();

  function formatMetadataDate(value: string | null): string {
    if (!value) return t("agents.notTracked");
    try {
      return formatDate(value, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return value;
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <MetadataRow
        icon={IconCalendar}
        label={t("agents.dashboardMetadataCreated")}
        value={formatMetadataDate(createdAt)}
      />
      <MetadataRow
        icon={IconUser}
        label={t("agents.dashboardMetadataCreatedBy")}
        value={createdBy || t("agents.notTracked")}
      />
      <MetadataRow
        icon={IconClock}
        label={t("agents.dashboardMetadataUpdated")}
        value={formatMetadataDate(updatedAt)}
      />
      <MetadataRow
        icon={IconUser}
        label={t("agents.dashboardMetadataUpdatedBy")}
        value={updatedBy || t("agents.notTracked")}
      />
    </div>
  );
}
