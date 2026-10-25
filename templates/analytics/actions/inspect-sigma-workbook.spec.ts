import { describe, expect, it } from "vitest";

import type { SigmaWorkbookInspection } from "../server/lib/bi-migration/sigma-adapter.js";
import { summarizeSigmaElementReview } from "./inspect-sigma-workbook.js";

describe("summarizeSigmaElementReview", () => {
  it("marks a BigQuery panel importable", () => {
    const inspection: SigmaWorkbookInspection = {
      workbook: { workbookId: "workbook_1", name: "Revenue" },
      pages: [],
      elements: [
        {
          kind: "panel",
          id: "element_1",
          title: "Revenue table",
          chartType: "table",
          source: { connectionId: "sigma-bq" },
          columns: [],
        },
      ],
      sourceConnections: [
        {
          connectionId: "sigma-bq",
          sigmaType: "bigquery",
          targetProviderCandidate: "bigquery",
        },
      ],
      sqlQueries: [
        { elementId: "element_1", sql: "SELECT 1", hasError: false },
      ],
      diagnostics: [],
    };

    expect(
      summarizeSigmaElementReview({
        inspection,
      }),
    ).toEqual([
      {
        id: "element_1",
        name: "Revenue table",
        type: "table",
        importable: true,
        visualizationPreserved: false,
      },
    ]);
  });

  it("leaves data-model panels to the dry run but skips non-BigQuery sources", () => {
    const inspection: SigmaWorkbookInspection = {
      workbook: { workbookId: "workbook_1", name: "Revenue" },
      pages: [],
      elements: [
        {
          kind: "panel",
          id: "model_panel",
          title: "ARR by quarter",
          chartType: "bar",
          source: { kind: "data-model" },
          columns: [],
        },
        {
          kind: "panel",
          id: "snowflake_panel",
          title: "Snowflake table",
          chartType: "table",
          source: { connectionId: "sigma-sf" },
          columns: [],
        },
      ],
      sourceConnections: [
        {
          connectionId: "sigma-sf",
          sigmaType: "snowflake",
          targetProviderCandidate: null,
        },
      ],
      sqlQueries: [],
      diagnostics: [],
    };

    expect(summarizeSigmaElementReview({ inspection })).toEqual([
      expect.objectContaining({ id: "model_panel", importable: true }),
      expect.objectContaining({
        id: "snowflake_panel",
        importable: false,
        reason: "unsupported_source",
      }),
    ]);
  });
});
