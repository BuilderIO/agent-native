import { describe, expect, it } from "vitest";

import { unknownPanelConfigKeys } from "./panel-render-contract";

describe("config.columns on save", () => {
  it("rejects an object keyed by column name", () => {
    const issues = unknownPanelConfigKeys({
      id: "p",
      title: "Rates",
      sql: "SELECT 1",
      source: "bigquery",
      chartType: "table",
      width: 6,
      config: { columns: { discount_rate: { format: "percent" } } },
    });
    expect(issues).toEqual([
      expect.objectContaining({ kind: "invalid-value", key: "columns" }),
    ]);
  });
});
