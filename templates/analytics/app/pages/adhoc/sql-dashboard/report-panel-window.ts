import type { SqlPanel } from "./types";

export const REPORT_PANEL_CHUNK_SIZE = 8;

export function parseReportPanelWindow(
  offsetRaw: string | null,
  limitRaw: string | null,
): { offset: number; limit: number } | null {
  if (!offsetRaw || !limitRaw) return null;
  const offset = Number.parseInt(offsetRaw, 10);
  const limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return { offset, limit: Math.min(REPORT_PANEL_CHUNK_SIZE, limit) };
}

export function countReportablePanels(panels: SqlPanel[]): number {
  return panels.filter((panel) => panel.chartType !== "section").length;
}

/**
 * A report chunk is indexed by chart panels, not section headers. When a
 * chunk starts inside a section, repeat that section header so each image is
 * readable on its own while preserving the dashboard's panel order.
 */
export function windowReportPanels(
  panels: SqlPanel[],
  window: { offset: number; limit: number } | null,
): SqlPanel[] {
  if (!window) return panels;

  const end = window.offset + window.limit;
  let chartIndex = 0;
  let activeSection: SqlPanel | null = null;
  let includedFirstChart = false;
  const selected: SqlPanel[] = [];

  for (const panel of panels) {
    if (panel.chartType === "section") {
      activeSection = panel;
      if (includedFirstChart && chartIndex < end) selected.push(panel);
      continue;
    }

    const include = chartIndex >= window.offset && chartIndex < end;
    if (include) {
      if (!includedFirstChart && activeSection) selected.push(activeSection);
      selected.push(panel);
      includedFirstChart = true;
    }
    chartIndex++;
    if (chartIndex >= end) break;
  }

  return selected;
}
