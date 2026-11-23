export function dashboardIdFromPath(path: string | null): string | null {
  const pathname = path ?? "";
  const id = pathname.match(/(?:^|\/)(?:dashboards|adhoc)\/([^/?#]+)/)?.[1];
  if (!id) return null;
  // A route template (`/dashboards/:id`) names the page, not the dashboard.
  if (id === "explorer-dashboard" || id.startsWith(":")) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
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
    // coercion-ok: a malformed URL falls through to the regex below.
  }
  const encodedId = raw.match(
    /(?:^|\/)(?:dashboards|adhoc)\/explorer-dashboard(?:\?[^#]*)?[?&]id=([^&#]+)/,
  )?.[1];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId.replace(/\+/g, " "));
  } catch {
    return encodedId;
  }
}
