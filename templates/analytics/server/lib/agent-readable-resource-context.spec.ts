import { describe, expect, it } from "vitest";

import {
  buildDashboardAgentContext,
  fitDashboardScreenContext,
} from "./agent-readable-resource-context";
import type {
  DashboardAnnotationSummary,
  DataNoteSummary,
  KeyDateSetSummary,
} from "./dashboard-annotation-summary";
import type { DashboardRecord } from "./dashboards-store";

const MAX_CHARS = 6_000;
const length = (value: unknown) => JSON.stringify(value, null, 2).length;

function screenContext(
  config: Record<string, unknown>,
  annotationSummary: DashboardAnnotationSummary,
) {
  const dashboard: DashboardRecord = {
    id: "dash-1",
    kind: "sql",
    title: "Weekly",
    config: { name: "Weekly", ...config },
    ownerEmail: "owner@example.test",
    orgId: "org-1",
    visibility: "org",
    createdAt: "2026-06-24T00:00:00.000Z",
    createdBy: "owner@example.test",
    updatedAt: "2026-06-25T00:00:00.000Z",
    updatedBy: "owner@example.test",
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  };
  return fitDashboardScreenContext(
    buildDashboardAgentContext(dashboard, {
      forAgent: true,
      annotationSummary,
    }),
    MAX_CHARS,
  );
}

const linePanels = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `panel-${index}`,
    title: `Panel number ${index}`,
    chartType: "line",
    width: 1,
    sql: "SELECT week, value FROM warehouse.weekly_totals",
    config: { xKey: "week", yKeys: ["value"] },
  }));

const notes = (count: number): DataNoteSummary[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `note-${index}`,
    kind: "data",
    title: `Signups undercounted, case ${index}`,
    status: "open",
    startDate: "2026-10-02",
    panelIds: ["panel-0", "panel-1", "panel-2"],
  }));

const sets = (count: number): KeyDateSetSummary[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `set-${index}`,
    name: `Launch set ${index}`,
    shown: true,
    dateCount: 1,
    recentDates: [{ date: "2026-10-14", label: "Product Hunt live" }],
  }));

describe("fitDashboardScreenContext", () => {
  it("sheds data notes and key-date sets the way it sheds panels, and counts each", () => {
    const fitted = screenContext(
      { panels: linePanels(30) },
      { keyDateSets: sets(50), dataNotes: notes(60) },
    );

    expect(length(fitted)).toBeLessThanOrEqual(MAX_CHARS);
    expect(fitted.trimmed).toBe(true);
    for (const [key, countKey, total] of [
      ["panels", "omittedPanelCount", 30],
      ["dataNotes", "omittedDataNoteCount", 60],
      ["keyDateSets", "omittedKeyDateSetCount", 50],
    ] as const) {
      const kept = fitted[key] as unknown[];
      expect(kept.length, key).toBeGreaterThan(0);
      expect(fitted[countKey], countKey).toBe(total - kept.length);
    }
    expect((fitted.dataNotes as DataNoteSummary[])[0].id).toBe("note-0");
  });

  it("drops a field too large to fit on its own rather than every panel", () => {
    const hiddenDataNotes = Array.from({ length: 500 }, (_, index) => ({
      noteId: `note-${index}`,
      panelId: `panel-${index % 20}`,
    }));

    const fitted = screenContext(
      { panels: linePanels(20), annotations: { hiddenDataNotes } },
      { keyDateSets: [], dataNotes: [] },
    );

    expect(length(fitted)).toBeLessThanOrEqual(MAX_CHARS);
    expect(fitted).not.toHaveProperty("annotations");
    expect(fitted.omittedKeys).toEqual(["annotations"]);
    expect(fitted.panels).toHaveLength(20);
    expect(fitted).not.toHaveProperty("omittedPanelCount");
  });
});
