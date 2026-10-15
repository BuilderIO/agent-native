import type { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";

import {
  isStaleFetchTime,
  msUntilStale,
  type SqlQueryFreshness,
} from "@/lib/sql-query-freshness";

/** How long a panel's own successful refresh says so before the text goes. */
export const REFRESH_CONFIRMATION_MS = 3000;

// setTimeout stores its delay in 32 bits; a longer one fires immediately.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

type Translate = ReturnType<typeof useT>;
type Formatters = Pick<ReturnType<typeof useFormatters>, "formatDate">;

/** The time alone for today's fetch, with the date once it is older. */
function fetchedTimeFormat(fetchedAt: string): Intl.DateTimeFormatOptions {
  const fetched = new Date(fetchedAt);
  const now = new Date();
  const today =
    fetched.getFullYear() === now.getFullYear() &&
    fetched.getMonth() === now.getMonth() &&
    fetched.getDate() === now.getDate();
  return today
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
}

/**
 * "Fetched 5:20 PM · Cached", or the full timestamp for the clock's tooltip.
 * A missing fetch time or cache state says so instead of being left out.
 */
export function describeFreshnessText(
  t: Translate,
  formatters: Formatters,
  { fetchedAt, cache }: SqlQueryFreshness,
  detail: "compact" | "full",
): string {
  const parts = [
    fetchedAt
      ? t("sqlDashboard.fetchedAt", {
          time: formatters.formatDate(
            fetchedAt,
            detail === "full"
              ? { dateStyle: "long", timeStyle: "medium" }
              : fetchedTimeFormat(fetchedAt),
          ),
        })
      : t("sqlDashboard.fetchTimeUnknown"),
  ];
  if (cache === "app-cache") parts.push(t("sqlDashboard.cacheApp"));
  else if (cache === "provider-cache")
    parts.push(t("sqlDashboard.cacheProvider"));
  else if (cache === "restored") parts.push(t("sqlDashboard.cacheRestored"));
  else if (cache === "unknown") parts.push(t("sqlDashboard.cacheUnknown"));
  return parts.join(" · ");
}

/**
 * Whether the shown result is older than the cutoff, read from the clock on
 * every render. A result that is not yet that old schedules one timeout for
 * the moment it will be, so an idle panel still turns stale without polling,
 * a shared timer, or a request; the timeout re-renders only this panel, once.
 */
export function useIsStaleResult(fetchedAt: string | undefined): boolean {
  const [tick, setTick] = useState(0);
  const stale = isStaleFetchTime(fetchedAt, Date.now());
  useEffect(() => {
    if (stale) return;
    const delay = msUntilStale(fetchedAt, Date.now());
    if (delay === undefined) return;
    const timer = setTimeout(
      () => setTick((count) => count + 1),
      Math.min(delay, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(timer);
  }, [fetchedAt, stale, tick]);
  return stale;
}

interface RefreshConfirmationInput {
  /** Rises each time the user asks this panel to refresh. */
  requestToken: number;
  /** Changes when the panel's query does, so its refresh can no longer land. */
  scopeKey: string;
  /** The request whose own forced fetch just succeeded, from `useSqlQuery`. */
  completedToken: number | undefined;
}

/**
 * True for `REFRESH_CONFIRMATION_MS` after the fetch of this panel's latest
 * manual refresh request succeeds. Only a completion for exactly the current
 * request counts: an automatic revalidation, a cancelled, failed or replaced
 * request, or a token the panel mounted with never reports one.
 */
export function useRefreshConfirmation(input: RefreshConfirmationInput) {
  const { requestToken, scopeKey, completedToken } = input;
  const [confirmedIdentity, setConfirmedIdentity] = useState<string>();
  const processedIdentity = useRef<string>();
  const context = useRef({ requestToken, scopeKey });
  const completionIdentity =
    completedToken === requestToken
      ? JSON.stringify([requestToken, scopeKey, completedToken])
      : undefined;

  // A completion already present during a request or scope change belongs to
  // the old context. Consume it so it cannot be adopted by the new panel state.
  if (
    context.current.requestToken !== requestToken ||
    context.current.scopeKey !== scopeKey
  ) {
    if (completionIdentity) processedIdentity.current = completionIdentity;
    context.current = { requestToken, scopeKey };
  }

  useEffect(() => {
    if (!completionIdentity) {
      setConfirmedIdentity(undefined);
      return;
    }
    if (processedIdentity.current === completionIdentity) return;
    processedIdentity.current = completionIdentity;
    setConfirmedIdentity(completionIdentity);
  }, [completionIdentity]);

  const confirmed =
    completionIdentity !== undefined &&
    confirmedIdentity === completionIdentity;
  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(
      () => setConfirmedIdentity(undefined),
      REFRESH_CONFIRMATION_MS,
    );
    return () => clearTimeout(timer);
  }, [confirmed]);

  return confirmed;
}
