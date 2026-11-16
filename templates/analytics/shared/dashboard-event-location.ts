export function dashboardIdFromPath(path: string | null): string | null {
  const pathname = path ?? "";
  const match = pathname.match(/(?:^|\/)(?:dashboards|adhoc)\/([^/?#]+)/);
  if (!match) return null;
  // A route template (`/dashboards/:id`) names the page, not the dashboard.
  if (match[1] === "explorer-dashboard" || match[1].startsWith(":")) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function dashboardIdFromEventLocation(
  path: string | null,
  url: string | null,
): string | null {
  const direct = dashboardIdFromPath(path);
  if (direct) return direct;
  const raw = url || path;
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "https://analytics.local");
    const parsedDashboardId = dashboardIdFromPath(parsed.pathname);
    if (parsedDashboardId) return parsedDashboardId;
    if (
      /(?:^|\/)(?:dashboards|adhoc)\/explorer-dashboard$/.test(parsed.pathname)
    ) {
      const id = parsed.searchParams.get("id");
      return id && id.trim() ? id : null;
    }
  } catch {
    // Fall through to regex below for malformed relative strings.
  }
  const match = raw.match(
    /(?:^|\/)(?:dashboards|adhoc)\/explorer-dashboard(?:\?[^#]*)?[?&]id=([^&#]+)/,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return match[1];
  }
}
