import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  resolveConnection: vi.fn(),
  inspectWorkbook: vi.fn(),
  hasBigQuery: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("../server/lib/bi-migration/sigma-adapter.js", () => ({
  inspectSigmaWorkbook: mocks.inspectWorkbook,
}));
vi.mock("../server/lib/bi-migration/sigma-connections.js", () => ({
  resolveSigmaConnectionSelection: mocks.resolveConnection,
}));
vi.mock("../server/lib/bi-migration/sigma-migration.js", () => ({
  hasAnalyticsBigQuerySource: mocks.hasBigQuery,
  requireSigmaMigrationContext: mocks.requireContext,
  sigmaMigrationSetupLink: () => "/data-sources?source=bigquery",
}));

const { default: inspectSigmaWorkbook } =
  await import("./inspect-sigma-workbook.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue({
    email: "alice@example.com",
    userEmail: "alice@example.com",
    orgId: "org-1",
  });
  mocks.resolveConnection.mockResolvedValue({
    selected: { id: "connection_1", label: "Sigma", status: "connected" },
  });
  mocks.inspectWorkbook.mockResolvedValue({
    workbook: { workbookId: "workbook_1", name: "Revenue" },
    pages: [],
    elements: [],
    sourceConnections: [],
    sqlQueries: [],
    diagnostics: [],
  });
  mocks.hasBigQuery.mockResolvedValue(true);
});

describe("inspect-sigma-workbook action", () => {
  it("keeps unverified BigQuery workbooks in the preview-only state", async () => {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId: "workbook_1", name: "Revenue" },
      pages: [],
      elements: [
        {
          kind: "panel",
          id: "element_1",
          title: "Revenue table",
          chartType: "table",
          source: {
            connectionId: "source_1",
            targetProviderCandidate: "bigquery",
          },
          columns: [],
        },
      ],
      sourceConnections: [
        {
          connectionId: "source_1",
          sigmaType: "bigquery",
          targetProviderCandidate: "bigquery",
        },
      ],
      sqlQueries: [],
      diagnostics: [],
    });

    await expect(
      inspectSigmaWorkbook.run({
        workbookId: "workbook_1",
        connectionId: "connection_1",
      }),
    ).resolves.toMatchObject({
      importableCount: 0,
      sourceMappingRequiredCount: 1,
      elements: [{ importable: false, reason: "source_mapping_required" }],
    });
    expect(mocks.inspectWorkbook).toHaveBeenCalledWith({
      connectionId: "connection_1",
      workbookId: "workbook_1",
      includeSqlQueries: false,
    });
  });

  it("fails preview when Sigma source connection metadata cannot be read", async () => {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId: "workbook_1", name: "Revenue" },
      pages: [],
      elements: [],
      sourceConnections: [],
      sqlQueries: [],
      diagnostics: [
        {
          code: "sigma_source_connection_lookup_failed",
          severity: "error",
          message: "Connection metadata could not be verified.",
          connectionId: "source_1",
        },
      ],
    });

    await expect(
      inspectSigmaWorkbook.run({
        workbookId: "workbook_1",
        connectionId: "connection_1",
      }),
    ).rejects.toMatchObject({
      errorCode: "sigma_source_inspection_failed",
      statusCode: 503,
    });
    expect(mocks.hasBigQuery).not.toHaveBeenCalled();
  });
});
