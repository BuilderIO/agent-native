import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeProviderApiRequest: vi.fn() }));

vi.mock("../provider-api", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

import {
  inspectSigmaWorkbook,
  listSigmaWorkbooks,
  summarizeSigmaWorkbookInspection,
} from "./sigma-adapter";

const CONNECTION_ID = "workspace-sigma-connection";
const WORKBOOK_ID = "workbook-123";

function apiResponse(json: unknown, extras: Record<string, unknown> = {}) {
  return {
    response: {
      ok: true,
      status: 200,
      truncated: false,
      json,
      ...extras,
    },
  };
}

function representation() {
  return {
    workbookId: WORKBOOK_ID,
    name: "Migration sample",
    documentVersion: 3,
    latestVersion: 4,
    updatedAt: "2026-10-01T00:00:00Z",
    contents: {
      schemaVersion: 1,
      kind: "workbook",
      pages: [{ id: "page-1", name: "Overview" }],
      layout:
        '<Page type="grid" id="page-1"><Element elementId="table-1" gridColumn="1 / 13" gridRow="1 / 9"/><Element elementId="chart-1" gridColumn="13 / 25" gridRow="1 / 9"/><Element elementId="plugin-1" gridColumn="1 / 25" gridRow="9 / 18"/></Page>',
      elements: [
        {
          id: "table-1",
          kind: "table",
          source: {
            connectionId: "warehouse-1",
            kind: "warehouse-table",
            path: ["EXAMPLE_DB", "PUBLIC", "ORDERS"],
          },
          columns: [
            { id: "column-date", formula: "[ORDER_DATE]" },
            { id: "column-revenue", formula: "Sum([REVENUE])" },
          ],
          order: ["column-date", "column-revenue"],
        },
        {
          id: "chart-1",
          kind: "bar-chart",
          name: "Revenue by date",
          source: { elementId: "table-1", kind: "table" },
          columns: [
            { id: "column-date", formula: "[ORDER_DATE]" },
            { id: "column-revenue", formula: "Sum([REVENUE])" },
          ],
          xAxis: { columnId: "column-date" },
          yAxis: { columnIds: ["column-revenue"] },
        },
        {
          id: "plugin-1",
          kind: "plugin",
          name: "Custom widget",
          source: { elementId: "table-1", kind: "table" },
        },
      ],
    },
  };
}

describe("Sigma read-only migration adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists one cursor page and uses the workspace connection", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      apiResponse({
        entries: [
          {
            workbookId: WORKBOOK_ID,
            name: "Migration sample",
            path: "My Documents/Examples",
            updatedAt: "2026-10-01T00:00:00Z",
            latestVersion: 4,
            isArchived: false,
            ownerId: "omitted-owner-metadata",
          },
        ],
        nextPage: "cursor-2",
        total: 15,
      }),
    );

    await expect(
      listSigmaWorkbooks({
        connectionId: CONNECTION_ID,
        page: "cursor-1",
        limit: 50,
      }),
    ).resolves.toEqual({
      workbooks: [
        {
          workbookId: WORKBOOK_ID,
          name: "Migration sample",
          path: "My Documents/Examples",
          updatedAt: "2026-10-01T00:00:00Z",
          latestVersion: 4,
          isArchived: false,
        },
      ],
      nextPage: "cursor-2",
      total: 15,
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith({
      provider: "sigma",
      method: "GET",
      path: "/v2/workbooks",
      query: { limit: 50, page: "cursor-1" },
      connectionId: CONNECTION_ID,
      timeoutMs: 30_000,
      maxBytes: 4 * 1024 * 1024,
    });
  });

  it("normalizes table and chart elements, source types, layout, and server-only SQL", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        return apiResponse(representation());
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ connectionId: "warehouse-1", type: "bigQuery" });
      }
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
        return apiResponse({
          entries: [
            {
              elementId: "chart-1",
              name: "Revenue query",
              sql: "SELECT ORDER_DATE, SUM(REVENUE) FROM EXAMPLE_DB.PUBLIC.ORDERS GROUP BY 1",
              error: "",
            },
          ],
          nextPage: null,
          total: 1,
        });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: true,
    });
    const table = inspection.elements.find(
      (element) => element.id === "table-1",
    );
    const chart = inspection.elements.find(
      (element) => element.id === "chart-1",
    );
    const unsupported = inspection.elements.find(
      (element) => element.id === "plugin-1",
    );

    expect(table).toMatchObject({
      kind: "panel",
      chartType: "table",
      pageId: "page-1",
      tab: "Overview",
      placement: { gridColumn: "1 / 13", gridRow: "1 / 9" },
      source: {
        connectionId: "warehouse-1",
        sigmaType: "bigquery",
        targetProviderCandidate: "bigquery",
        path: ["EXAMPLE_DB", "PUBLIC", "ORDERS"],
      },
    });
    expect(chart).toMatchObject({
      kind: "panel",
      chartType: "bar",
      title: "Revenue by date",
      pageId: "page-1",
      tab: "Overview",
      placement: { gridColumn: "13 / 25", gridRow: "1 / 9" },
      source: {
        elementId: "table-1",
        connectionId: "warehouse-1",
        sigmaType: "bigquery",
        targetProviderCandidate: "bigquery",
      },
      axes: {
        x: { columnId: "column-date", formula: "[ORDER_DATE]" },
        y: [{ columnId: "column-revenue", formula: "Sum([REVENUE])" }],
      },
    });
    expect(unsupported).toMatchObject({
      kind: "unsupported",
      sigmaKind: "plugin",
      pageId: "page-1",
      placement: { gridColumn: "1 / 25", gridRow: "9 / 18" },
    });
    expect(inspection.sourceConnections).toEqual([
      {
        connectionId: "warehouse-1",
        sigmaType: "bigquery",
        targetProviderCandidate: "bigquery",
      },
    ]);
    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sigma_element_unsupported",
          elementId: "plugin-1",
          sigmaKind: "plugin",
        }),
        expect.objectContaining({
          code: "sigma_bigquery_source_requires_target_mapping",
          connectionId: "warehouse-1",
        }),
        expect.objectContaining({
          code: "sigma_beta_representation_may_omit_features",
        }),
      ]),
    );
    expect(inspection.sqlQueries).toHaveLength(1);
    expect(inspection.sqlQueries[0]?.sql).toContain("SELECT ORDER_DATE");

    const safeSummary = summarizeSigmaWorkbookInspection(inspection);
    expect(safeSummary).toMatchObject({
      queryCount: 1,
      queriesWithSqlCount: 1,
      sourceConnections: [{ sigmaType: "bigquery" }],
    });
    expect(JSON.stringify(safeSummary)).not.toContain("SELECT ORDER_DATE");
    expect(safeSummary).not.toHaveProperty("sqlQueries");
  });

  it("skips SQL query listing when the caller only needs a preview", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        return apiResponse(representation());
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ connectionId: "warehouse-1", type: "bigQuery" });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: false,
    });

    expect(inspection.sqlQueries).toEqual([]);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(2);
  });

  it("preserves malformed elements as unsupported review items", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        const payload = representation();
        (payload.contents.elements as unknown[]).push(
          null,
          { id: "missing-kind", name: "Half parsed element" },
          { kind: "plugin", name: "Missing element ID" },
          {
            id: "unrecognized-element-6",
            kind: "plugin",
            name: "Reserved fallback ID",
          },
        );
        return apiResponse(payload);
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ connectionId: "warehouse-1", type: "bigQuery" });
      }
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
        return apiResponse({ entries: [], nextPage: null, total: 0 });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: false,
    });

    expect(inspection.elements).toHaveLength(7);
    expect(inspection.elements).toEqual(
      expect.arrayContaining([
        {
          kind: "unsupported",
          id: "unrecognized-element-4",
          title: "Unrecognized Sigma element 4",
          sigmaKind: "unknown",
        },
        {
          kind: "unsupported",
          id: "missing-kind",
          title: "Half parsed element",
          sigmaKind: "unknown",
        },
        {
          kind: "unsupported",
          id: "unrecognized-element-6-1",
          title: "Missing element ID",
          sigmaKind: "plugin",
        },
        {
          kind: "unsupported",
          id: "unrecognized-element-6",
          title: "Reserved fallback ID",
          sigmaKind: "plugin",
        },
      ]),
    );
    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sigma_element_invalid",
          elementId: "unrecognized-element-4",
        }),
        expect.objectContaining({
          code: "sigma_element_identity_missing",
          elementId: "missing-kind",
        }),
      ]),
    );
  });

  it("marks unsupported Sigma data platforms and never promotes them to BigQuery", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        return apiResponse(representation());
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ connectionId: "warehouse-1", type: "snowflake" });
      }
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
        return apiResponse({ entries: [], nextPage: null, total: 0 });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: false,
    });

    expect(inspection.sourceConnections[0]).toEqual({
      connectionId: "warehouse-1",
      sigmaType: "snowflake",
      targetProviderCandidate: null,
    });
    expect(
      inspection.elements.find((element) => element.id === "chart-1"),
    ).toMatchObject({
      kind: "panel",
      source: { sigmaType: "snowflake", targetProviderCandidate: null },
    });
    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sigma_source_connection_unsupported",
          connectionId: "warehouse-1",
        }),
      ]),
    );
  });

  it("maps combo, funnel, and KPI axes to Analytics panel roles", async () => {
    const workbook = representation();
    const contents = workbook.contents as Record<string, unknown>;
    contents.elements = [
      {
        id: "table-1",
        kind: "table",
        source: { connectionId: "warehouse-1", kind: "warehouse-table" },
        columns: [
          { id: "stage", formula: "[STAGE]" },
          { id: "value", formula: "Sum([VALUE])" },
          { id: "other-value", formula: "Count([ID])" },
        ],
      },
      {
        id: "combo-1",
        kind: "combo-chart",
        source: { elementId: "table-1", kind: "table" },
        columns: [
          { id: "stage", formula: "[STAGE]" },
          { id: "value", formula: "Sum([VALUE])" },
          { id: "other-value", formula: "Count([ID])" },
        ],
        xAxis: { columnId: "stage" },
        yAxis: {
          columnIds: ["value", { columnId: "other-value", type: "line" }],
        },
      },
      {
        id: "funnel-1",
        kind: "funnel-chart",
        source: { elementId: "table-1", kind: "table" },
        columns: [
          { id: "stage", formula: "[STAGE]" },
          { id: "value", formula: "Sum([VALUE])" },
        ],
        stage: { columnId: "stage" },
        series: { columnId: "value" },
      },
      {
        id: "kpi-1",
        kind: "kpi-chart",
        source: { elementId: "table-1", kind: "table" },
        columns: [{ id: "value", formula: "Sum([VALUE])" }],
        value: { columnId: "value" },
      },
    ];
    contents.layout =
      '<Page type="grid" id="page-1"><Element elementId="table-1"/><Element elementId="combo-1"/><Element elementId="funnel-1"/><Element elementId="kpi-1"/></Page>';
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        return apiResponse(workbook);
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ connectionId: "warehouse-1", type: "bigQuery" });
      }
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
        return apiResponse({ entries: [], nextPage: null, total: 0 });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: false,
    });

    expect(
      inspection.elements.find((element) => element.id === "combo-1"),
    ).toMatchObject({
      chartType: "combo",
      axes: {
        x: { columnId: "stage" },
        y: [{ columnId: "value" }, { columnId: "other-value", type: "line" }],
      },
    });
    expect(
      inspection.elements.find((element) => element.id === "funnel-1"),
    ).toMatchObject({
      chartType: "funnel",
      axes: { x: { columnId: "stage" }, y: [{ columnId: "value" }] },
    });
    expect(
      inspection.elements.find((element) => element.id === "kpi-1"),
    ).toMatchObject({
      chartType: "metric",
      axes: { y: [{ columnId: "value" }] },
    });
  });

  it.each([403, 404])(
    "marks permanently inaccessible source connections as unavailable (%i)",
    async (status) => {
      mocks.executeProviderApiRequest.mockImplementation(async (args) => {
        if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
          return apiResponse(representation());
        }
        if (args.path === "/v2/connections/warehouse-1") {
          return apiResponse({ entries: [] }, { ok: false, status });
        }
        if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
          return apiResponse({ entries: [], nextPage: null, total: 0 });
        }
        throw new Error(`Unexpected synthetic path: ${args.path}`);
      });

      const inspection = await inspectSigmaWorkbook({
        connectionId: CONNECTION_ID,
        workbookId: WORKBOOK_ID,
        includeSqlQueries: false,
      });

      expect(inspection.sourceConnections[0]).toEqual({
        connectionId: "warehouse-1",
        sigmaType: null,
        targetProviderCandidate: null,
      });
      expect(
        inspection.elements.find((element) => element.id === "chart-1"),
      ).toMatchObject({
        source: { sigmaType: null, targetProviderCandidate: null },
      });
      expect(inspection.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "sigma_source_connection_unavailable",
            severity: "warning",
          }),
        ]),
      );
    },
  );

  it("keeps transient source connection failures retryable", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        return apiResponse(representation());
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ entries: [] }, { ok: false, status: 503 });
      }
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
        return apiResponse({ entries: [], nextPage: null, total: 0 });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: false,
    });

    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sigma_source_connection_lookup_failed",
          severity: "error",
        }),
      ]),
    );
  });

  it("rejects truncated provider responses instead of using partial JSON", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      apiResponse({ entries: [], nextPage: null }, { truncated: true }),
    );

    await expect(
      listSigmaWorkbooks({ connectionId: CONNECTION_ID }),
    ).rejects.toThrow("no partial result was used");
  });

  it("rejects missing pagination metadata instead of treating it as complete", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      apiResponse({ entries: [] }),
    );

    await expect(
      listSigmaWorkbooks({ connectionId: CONNECTION_ID }),
    ).rejects.toThrow("valid nextPage");
  });

  it("rejects empty pagination cursors instead of treating them as the last page", async () => {
    mocks.executeProviderApiRequest.mockResolvedValue(
      apiResponse({ entries: [], nextPage: "   " }),
    );

    await expect(
      listSigmaWorkbooks({ connectionId: CONNECTION_ID }),
    ).rejects.toThrow("empty nextPage cursor");
  });

  it("omits oversized SQL with a diagnostic and safe summary count", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async (args) => {
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}`) {
        return apiResponse(representation());
      }
      if (args.path === "/v2/connections/warehouse-1") {
        return apiResponse({ connectionId: "warehouse-1", type: "bigQuery" });
      }
      if (args.path === `/v2/workbooks/${WORKBOOK_ID}/queries`) {
        return apiResponse({
          entries: [
            {
              elementId: "chart-1",
              sql: "x".repeat(64_001),
              error: "",
            },
          ],
          nextPage: null,
          total: 1,
        });
      }
      throw new Error(`Unexpected synthetic path: ${args.path}`);
    });

    const inspection = await inspectSigmaWorkbook({
      connectionId: CONNECTION_ID,
      workbookId: WORKBOOK_ID,
      includeSqlQueries: true,
    });
    expect(inspection.sqlQueries[0]).toMatchObject({
      sqlOmittedReason: "query-too-large",
      hasError: false,
    });
    expect(inspection.sqlQueries[0]).not.toHaveProperty("sql");
    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "sigma_sql_query_too_large" }),
      ]),
    );
    expect(
      summarizeSigmaWorkbookInspection(inspection).queriesOmittedCount,
    ).toBe(1);
  });
});
