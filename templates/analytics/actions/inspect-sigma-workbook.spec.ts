import { describe, expect, it } from "vitest";

import type { SigmaWorkbookInspection } from "../server/lib/bi-migration/sigma-adapter.js";
import { summarizeSigmaElementReview } from "./inspect-sigma-workbook.js";

describe("summarizeSigmaElementReview", () => {
  it("blocks BigQuery SQL until the Sigma source is mapped to Analytics", () => {
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
        importable: false,
        visualizationPreserved: false,
        reason: "source_mapping_required",
      },
    ]);
  });
});
