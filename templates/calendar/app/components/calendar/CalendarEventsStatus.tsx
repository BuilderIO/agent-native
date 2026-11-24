import { useT } from "@agent-native/core/client/i18n";

import { GoogleConnectBanner } from "./GoogleConnectBanner";

export function CalendarEventsStatus({
  error,
  retrying,
  authRequired,
  onRetry,
}: {
  error:
    | (Error & { code?: string; details?: { authRequired?: boolean } })
    | null;
  retrying?: boolean;
  authRequired?: boolean;
  onRetry?: () => void;
}) {
  const t = useT();
  if (!error) return null;
  return (
    <>
      {error.code === "calendar_auth_required" ||
      error.details?.authRequired ||
      authRequired ? (
        <GoogleConnectBanner />
      ) : null}
      <div
        role="status"
        className="shrink-0 border-b border-destructive/20 bg-destructive/[0.06] px-4 py-1.5 text-xs text-destructive/70"
      >
        {error.code === "calendar_rate_limited"
          ? t("common.calendarRateLimited")
          : error.message}
        {error.code === "calendar_rate_limited" && !retrying && onRetry ? (
          <button type="button" className="ml-2 underline" onClick={onRetry}>
            {t("common.retry")}
          </button>
        ) : null}
      </div>
    </>
  );
}
