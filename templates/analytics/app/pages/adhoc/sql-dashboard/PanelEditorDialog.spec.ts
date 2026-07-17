import { describe, expect, it } from "vitest";

import {
  extensionOptionsWithSelectedFallback,
  formToPanel,
  panelToForm,
  type PanelFormValues,
} from "./PanelEditorDialog";
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
        config: { extensionId: "old-extension" },
      },
      "Untitled panel",
      "dashboard/1",
    );

    expect(panel.config).toMatchObject({
      extensionSlotId:
        "analytics.dashboard.dashboard%2F1.panel.pipeline-widget",
    });
    expect(panel.config).not.toHaveProperty("extensionId");
  });
});
