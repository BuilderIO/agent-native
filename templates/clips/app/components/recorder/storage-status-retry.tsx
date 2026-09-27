import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function StorageStatusRetry({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm"
      role="alert"
    >
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <IconAlertTriangle className="size-4 shrink-0" />
        <span>{t("meetingsRoute.calendarStatusUnavailable")}</span>
      </span>
      <Button type="button" variant="outline" onClick={onRetry}>
        {t("meetingDetail.retry")}
      </Button>
    </div>
  );
}
