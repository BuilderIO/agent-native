export type PrefetchSnapshot<T> = {
  data: T;
  syncVersion: number;
};

export type DashboardCacheSession = {
  userId?: string | null;
  email?: string | null;
  orgId?: string | null;
};

/**
 * Dashboard payloads are access-scoped. Keep the principal and active org in
 * every client cache key so a session change cannot adopt another caller's
 * private dashboard as placeholder or prefetch data.
 */
export function dashboardCacheScope(
  session: DashboardCacheSession | null | undefined,
): string {
  const principal = session?.userId ?? session?.email ?? "anonymous";
  const org = session?.orgId ?? "personal";
  return `${encodeURIComponent(principal)}:${encodeURIComponent(org)}`;
}

export function preserveScopedDashboardPlaceholder<T>(
  previous: T | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
  scope: string,
): T | undefined {
  return previousQuery?.queryKey[1] === scope ? previous : undefined;
}

export const sqlDashboardPrefetchKey = (
  id: string,
  scope = "anonymous:personal",
) => ["data", "sql-dashboard-prefetch", scope, id] as const;

export const analysisDetailPrefetchKey = (id: string) =>
  ["analysis-detail-prefetch", id] as const;
