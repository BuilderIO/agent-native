import { useT } from "@agent-native/core/client/i18n";
import { IconInfoCircle } from "@tabler/icons-react";

import { ActionQueryError } from "./action-query-error";
import { type ProviderMetricsResult } from "./transactional-email-metrics";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export interface EmailActivityEntry {
  msgId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  status: string;
  opensCount: number;
  clicksCount: number;
  lastEventTime: string;
}

/**
 * Renders one email's activity feed. Used both inline on the detail page and
 * inside the list page's activity dialog, so the "unavailable" and "empty"
 * states only need to be written once.
 */
export function ActivityTable({
  result,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  result: ProviderMetricsResult<EmailActivityEntry[]> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const t = useT();

  if (isError) {
    return <ActionQueryError error={error} onRetry={onRetry} />;
  }
  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (result && !result.available) {
    return (
      <Alert>
        <IconInfoCircle className="size-4" />
        <AlertTitle>
          {t("dispatch.transactionalEmail.activityUnavailable")}
        </AlertTitle>
        <AlertDescription>{result.reason}</AlertDescription>
      </Alert>
    );
  }
  if (result && result.data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
        {t("dispatch.transactionalEmail.activityEmpty")}
      </div>
    );
  }
  if (!result) return null;

  return (
    <div className="max-h-96 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("dispatch.transactionalEmail.recipient")}</TableHead>
            <TableHead>{t("dispatch.transactionalEmail.subject")}</TableHead>
            <TableHead>{t("dispatch.transactionalEmail.status")}</TableHead>
            <TableHead>{t("dispatch.transactionalEmail.opens")}</TableHead>
            <TableHead>{t("dispatch.transactionalEmail.lastEvent")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((entry) => (
            <TableRow key={entry.msgId}>
              <TableCell className="text-xs">{entry.toEmail}</TableCell>
              <TableCell className="text-xs">{entry.subject}</TableCell>
              <TableCell className="text-xs">{entry.status}</TableCell>
              <TableCell className="text-xs tabular-nums">
                {entry.opensCount}
              </TableCell>
              <TableCell className="text-xs">{entry.lastEventTime}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
