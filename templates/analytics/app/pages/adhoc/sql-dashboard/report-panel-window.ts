import type { SqlPanel } from "@agent-native/toolkit/dashboard/sql-dashboard-types";

export function listReportablePanelIds(panels: SqlPanel[]): string[] {
  return panels
    .filter((panel) => panel.chartType !== "section")
    .map((panel) => panel.id);
}
