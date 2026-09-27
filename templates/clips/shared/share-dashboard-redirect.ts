const FORWARDED_PARAMS = ["t", "at", "panel"] as const;

export interface DashboardRedirectInput {
  recordingId: string | null | undefined;
  canOpenDashboard: boolean;
  search: string;
}

export function resolveDashboardRedirect(
  input: DashboardRedirectInput,
): string | null {
  if (!input.canOpenDashboard || !input.recordingId) return null;

  const params = new URLSearchParams(input.search);
  const forwarded = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = params.get(key);
    if (value) forwarded.set(key, value);
  }

  const query = forwarded.toString();
  return `/r/${encodeURIComponent(input.recordingId)}${query ? `?${query}` : ""}`;
}
