import type { CrmDashboardPanelConfig } from "./types";

export function dashboardDataPanelId(
  panels: CrmDashboardPanelConfig[],
  panel: CrmDashboardPanelConfig,
): string {
  return (
    panels.find(
      (candidate) =>
        candidate.source === panel.source && candidate.query === panel.query,
    )?.id ?? panel.id
  );
}
