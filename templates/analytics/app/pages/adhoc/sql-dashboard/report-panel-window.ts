import type { SqlPanel } from "./types";

export function listReportablePanelIds(panels: SqlPanel[]): string[] {
  return panels
    .filter((panel) => panel.chartType !== "section")
    .map((panel) => panel.id);
}
