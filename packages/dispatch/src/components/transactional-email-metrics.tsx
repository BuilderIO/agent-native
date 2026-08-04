import { useT } from "@agent-native/core/client/i18n";

import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Shared between the transactional email list and detail pages so both
 * render the same "unknown vs. zero" and provider-availability rules.
 */

export interface EmailEngagement {
  templateId: string;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  /** null when nothing was delivered in the window, so there is no rate yet. */
  openRate: number | null;
}

export type ProviderMetricsResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

/**
 * Renders a metric the backend could not read. "Unknown" and "zero" must stay
 * visibly different — a dash with a reason is the only honest rendering.
 */
export function UnknownMetric({ reason }: { reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
          —
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  );
}

export function SendsCell({
  sent,
  failed,
}: {
  sent: number | null;
  failed: number | null;
}) {
  const t = useT();
  if (sent === null) {
    return (
      <UnknownMetric reason={t("dispatch.transactionalEmail.sendLogUnread")} />
    );
  }
  return (
    <span className="tabular-nums">
      {sent}
      {failed !== null && failed > 0 ? (
        <span className="ml-2 text-xs text-destructive">
          {t("dispatch.transactionalEmail.failedCount", { count: failed })}
        </span>
      ) : null}
      {failed === null ? (
        <span className="ml-2 text-xs text-muted-foreground">
          {t("dispatch.transactionalEmail.failuresUnknown")}
        </span>
      ) : null}
    </span>
  );
}

export function OpenRateCell({
  engagement,
  unavailableReason,
  loading,
}: {
  engagement: EmailEngagement | undefined;
  unavailableReason: string | null;
  loading: boolean;
}) {
  const t = useT();
  if (unavailableReason) {
    return <UnknownMetric reason={unavailableReason} />;
  }
  if (loading) return <Skeleton className="h-4 w-10" />;
  if (!engagement) {
    return (
      <UnknownMetric
        reason={t("dispatch.transactionalEmail.noProviderRecord")}
      />
    );
  }
  if (engagement.openRate === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("dispatch.transactionalEmail.noDeliveredMail")}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {`${(engagement.openRate * 100).toFixed(1)}%`}
    </span>
  );
}

export function LastSentCell({ lastSentAt }: { lastSentAt: number | null }) {
  const t = useT();
  if (lastSentAt === null) {
    return (
      <UnknownMetric
        reason={t("dispatch.transactionalEmail.lastSentUnknown")}
      />
    );
  }
  return <>{new Date(lastSentAt).toLocaleString()}</>;
}
