export const DEMO_NODE_EXPORTER_DEFAULT_TAB = "App / Overview";

export function demoNodeExporterDashboardPath(
  dashboardId: string,
  options: { intro?: boolean } = {},
): string {
  const params = new URLSearchParams({
    tab: DEMO_NODE_EXPORTER_DEFAULT_TAB,
  });
  if (options.intro) params.set("demoIntro", "1");
  return `/dashboards/${dashboardId}?${params.toString()}`;
}

export function withDemoIntro(path: string): string {
  const [withoutHash, hash = ""] = path.split("#");
  const [pathname, rawSearch = ""] = withoutHash.split("?");
  const params = new URLSearchParams(rawSearch);
  params.set("demoIntro", "1");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}
