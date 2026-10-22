import { describe, expect, it } from "vitest";

import {
  extensionOptionsWithSelectedFallback,
  formToPanel,
  panelToForm,
  type PanelFormValues,
} from "./PanelEditorDialog";
import { mergeUnchangedPanelFields } from "./types";
import type { SqlPanel } from "./types";

const baseForm: PanelFormValues = {
  title: "Pipeline Widget",
  chartType: "extension",
  source: "bigquery",
  width: 1,
  columns: 2,
  sql: "SELECT should_not_survive",
  description: "Current pipeline",
  extensionMode: "shared",
  extensionId: "extension-123",
  extensionSlotId: "",
};

describe("dashboard extension panel editor values", () => {
  it("defaults new and direct-extension panels to shared embedding", () => {
    expect(panelToForm(null).extensionMode).toBe("shared");

    const panel: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "extension",
      source: "bigquery",
      width: 1,
      height: 3,
      sql: "",
      config: { extensionId: "extension-123" },
    };
    expect(panelToForm(panel)).toMatchObject({
      extensionMode: "shared",
      extensionId: "extension-123",
    });
  });

  it("keeps a stale or hidden selected extension editable in the picker", () => {
    expect(
      extensionOptionsWithSelectedFallback(
        [{ id: "visible", name: "Visible extension" }],
        "hidden-extension",
      ),
    ).toEqual([
      { id: "hidden-extension", name: "hidden-extension" },
      { id: "visible", name: "Visible extension" },
    ]);
    expect(
      extensionOptionsWithSelectedFallback(
        [{ id: "visible", name: "Visible extension" }],
        "visible",
      ),
    ).toHaveLength(1);
  });

  it("serializes shared embeds with extensionId and removes slot state", () => {
    const existing: SqlPanel = {
      id: "pipeline-widget",
      title: "Old widget",
      chartType: "extension",
      source: "bigquery",
      width: 1,
      height: 3,
      sql: "",
      config: {
        extensionSlotId:
          "analytics.dashboard.dashboard-1.panel.pipeline-widget",
      },
    };

    expect(
      formToPanel(baseForm, existing, "Untitled panel", "dashboard-1"),
    ).toMatchObject({
      id: "pipeline-widget",
      height: 3,
      sql: "",
      config: {
        description: "Current pipeline",
        extensionId: "extension-123",
      },
    });
    expect(
      formToPanel(baseForm, existing, "Untitled panel", "dashboard-1").config,
    ).not.toHaveProperty("extensionSlotId");
  });

  it("serializes per-viewer slots only when explicitly selected", () => {
    const panel = formToPanel(
      {
        ...baseForm,
        extensionMode: "slot",
        extensionSlotId: "",
      },
      {
        id: "pipeline-widget",
        title: "Pipeline Widget",
        chartType: "extension",
        source: "bigquery",
        width: 1,
        sql: "",
        config: {
          extensionId: "old-extension",
          customBlock: {
            authoredBy: "agent",
            intent: "one-off",
            scope: "dashboard",
            nativeGapReason: "custom-visualization",
          },
        },
      },
      "Untitled panel",
      "dashboard/1",
    );

    expect(panel.config).toMatchObject({
      extensionSlotId:
        "analytics.dashboard.dashboard%2F1.panel.pipeline-widget",
    });
    expect(panel.config).not.toHaveProperty("extensionId");
    expect(panel.config).not.toHaveProperty("customBlock");
  });

  it("drops a saved height when changing a chart to a section", () => {
    const panel = formToPanel(
      { ...baseForm, chartType: "section", columns: 4, sql: "" },
      {
        id: "pipeline-widget",
        title: "Pipeline Widget",
        chartType: "table",
        source: "bigquery",
        width: 2,
        height: 3,
        sql: "SELECT 1",
      },
      "Untitled panel",
      "dashboard-1",
    );
    const original: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      height: 3,
      sql: "SELECT 1",
    };
    const merged = mergeUnchangedPanelFields(panel, original, {
      ...original,
      height: 4,
    });

    expect(panel).toMatchObject({ chartType: "section", columns: 4 });
    expect(panel).not.toHaveProperty("height");
    expect(merged).not.toHaveProperty("height");
  });

  it("keeps the latest persisted height when saving unrelated panel fields", () => {
    const original: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      height: 2,
      sql: "SELECT 1",
    };
    const edited = formToPanel(
      { ...baseForm, chartType: "table", title: "Updated title", width: 2 },
      original,
      "Untitled panel",
      "dashboard-1",
    );
    const current = { ...original, width: 3, height: 4 };

    expect(mergeUnchangedPanelFields(edited, original, current)).toMatchObject({
      title: "Updated title",
      width: 3,
      height: 4,
    });
  });

  it("preserves concurrent optional fields absent from the editor baseline", () => {
    const original: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      sql: "SELECT 1",
    };
    const edited = { ...original, title: "Updated title" };
    const current = { ...original, height: 4, columns: 3 };

    expect(mergeUnchangedPanelFields(edited, original, current)).toMatchObject({
      title: "Updated title",
      height: 4,
      columns: 3,
    });
  });

  it("keeps an intentional optional-field removal when its value was undefined", () => {
    const original: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      height: undefined,
      sql: "SELECT 1",
    };
    const edited = { ...original, title: "Updated title" };
    delete edited.height;
    const current = { ...original, height: 4 };

    const merged = mergeUnchangedPanelFields(edited, original, current);

    expect(merged).not.toHaveProperty("height");
  });

  it("keeps a concurrent SQL edit when the editor changes only the title", () => {
    const original: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      sql: "SELECT 1",
      config: { description: "Original", columns: [{ key: "value" }] },
    };
    const edited: SqlPanel = {
      ...original,
      title: "Updated title",
      config: { ...original.config },
    };
    const current: SqlPanel = {
      ...original,
      sql: "SELECT 2",
      config: {
        ...original.config,
        description: "Updated elsewhere",
        columns: [{ key: "value", width: 240 }],
      },
    };

    expect(mergeUnchangedPanelFields(edited, original, current)).toMatchObject({
      title: "Updated title",
      sql: "SELECT 2",
      config: {
        description: "Updated elsewhere",
        columns: [{ key: "value", width: 240 }],
      },
    });
  });

  it("keeps dimension edits made in the panel editor", () => {
    const original: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      height: 2,
      sql: "SELECT 1",
    };
    const edited = { ...original, width: 4, height: 5 };
    const current = { ...original, width: 3, height: 6 };

    expect(mergeUnchangedPanelFields(edited, original, current)).toMatchObject({
      width: 4,
      height: 5,
    });
  });

  it("clears a stale fixed height when the latest panel is auto-height", () => {
    const edited: SqlPanel = {
      id: "pipeline-widget",
      title: "Updated title",
      chartType: "table",
      source: "bigquery",
      width: 2,
      height: 4,
      sql: "SELECT 1",
    };
    const current: SqlPanel = {
      id: "pipeline-widget",
      title: "Pipeline Widget",
      chartType: "table",
      source: "bigquery",
      width: 2,
      sql: "SELECT 1",
    };

    expect(
      mergeUnchangedPanelFields(edited, edited, current),
    ).not.toHaveProperty("height");
  });
});
