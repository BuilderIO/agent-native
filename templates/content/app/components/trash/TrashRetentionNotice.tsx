import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { CONTENT_TRASH_RETENTION_DAYS } from "@shared/content-trash-retention";

export function TrashRetentionNotice() {
  const t = useT();
  const { formatDate } = useFormatters();
  const retention = useActionQuery(
    "get-content-trash-retention",
    {},
    { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false },
  );
  const deletionsBeginAt = retention.data?.deletionsBeginAt;
  const upcoming =
    deletionsBeginAt && Date.parse(deletionsBeginAt) > Date.now()
      ? new Date(deletionsBeginAt)
      : null;
  return (
    <p className="shrink-0 px-3 py-2 text-xs text-muted-foreground sm:px-5">
      {upcoming
        ? t("trashRetention.autoDeleteStarting", {
            days: CONTENT_TRASH_RETENTION_DAYS,
            date: formatDate(upcoming, { dateStyle: "medium" }),
          })
        : t("trashRetention.autoDelete", {
            days: CONTENT_TRASH_RETENTION_DAYS,
          })}
    </p>
  );
}
