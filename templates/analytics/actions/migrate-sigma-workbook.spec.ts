import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  resolveConnection: vi.fn(),
  hasBigQuery: vi.fn(),
  inspectWorkbook: vi.fn(),
  createMigration: vi.fn(),
  claimMigration: vi.fn(),
  listMigrations: vi.fn(),
  completeMigration: vi.fn(),
  failMigration: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  assignToFolder: vi.fn(),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  proveSql: vi.fn(),
  verifyPanels: vi.fn(),
  abandonImport: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/analytics/adhoc/dashboard",
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
  sigmaMigrationSetupLink: () => "/dispatch",
}));
vi.mock("../server/lib/bi-migration/external-dashboards-store.js", () => ({
  boundExternalDashboardDiagnostics: (diagnostics: unknown[]) => ({
    elementDiagnostics: diagnostics,
    flaggedCount: diagnostics.length,
  }),
  claimExternalDashboard: mocks.claimMigration,
  completeExternalDashboard: mocks.completeMigration,
  createExternalDashboard: mocks.createMigration,
  failExternalDashboard: mocks.failMigration,
  listExternalDashboards: mocks.listMigrations,
}));
vi.mock("../server/lib/dashboard-folders-store.js", () => ({
  assignDashboardToFolder: mocks.assignToFolder,
  createDashboardFolder: mocks.createFolder,
  listDashboardFolders: mocks.listFolders,
}));
vi.mock("../server/lib/dashboards-store.js", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));
vi.mock("../server/lib/bi-migration/sigma-sql-proof.js", () => ({
  proveSigmaPanelSql: mocks.proveSql,
}));
vi.mock("../server/lib/bi-migration/unfinished-import.js", () => ({
  abandonSigmaImport: mocks.abandonImport,
}));
vi.mock("../server/lib/dashboard-panel-verification.js", () => ({
  verifyDashboardPanels: mocks.verifyPanels,
}));
const { default: migrateSigmaWorkbook, sigmaDashboardName } =
  await import("./migrate-sigma-workbook.js");

const context = {
  email: "alice@example.com",
  userEmail: "alice@example.com",
  orgId: "org-1",
};
const workbookId = "workbook_1";
const panel = {
  kind: "panel",
  id: "element_1",
  title: "Revenue",
  chartType: "table",
  source: { connectionId: "connection_1" },
  columns: [],
};
const bigQuerySource = {
  connectionId: "connection_1",
  sigmaType: "bigquery",
  targetProviderCandidate: "bigquery",
};

function panelElement(id: string, title: string) {
  return { ...panel, id, title };
}

function workbookWith(elements: unknown[]) {
  mocks.inspectWorkbook.mockResolvedValue({
    workbook: { workbookId, name: "Revenue" },
    elements,
    sourceConnections: [bigQuerySource],
    sqlQueries: [],
    diagnostics: [],
  });
}

function claimed(targetDashboardId: string | null = null) {
  mocks.claimMigration.mockResolvedValue({
    claimed: true,
    claimToken: "token_1",
    record: { targetDashboardId },
  });
  // The dashboard reads back as written once the upsert has run.
  mocks.getDashboard.mockImplementation(async (id: string) => {
    const call = mocks.upsertDashboard.mock.calls.at(-1);
    if (!call) return null;
    return {
      id,
      kind: "sql",
      title: call[2].name,
      config: call[2],
      visibility: "private",
      ownerEmail: context.userEmail,
      orgId: context.orgId,
    };
  });
}

function verifiedPanels(
  statuses: Record<string, string> = {},
): (config: { panels: { id: string }[] }, ids: string[]) => unknown {
  return (_config, ids) => ({
    verified: true,
    blocking: false,
    filterState: "defaults",
    budgetMs: 12_000,
    ms: 1,
    panels: ids.map((panelId) => ({
      panelId,
      status: statuses[panelId] ?? "ok",
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue(context);
  mocks.resolveConnection.mockResolvedValue({
    selected: { id: "connection_1", label: "Sigma", status: "connected" },
    connections: [],
  });
  mocks.hasBigQuery.mockResolvedValue(true);
  mocks.inspectWorkbook.mockResolvedValue({
    workbook: { workbookId, name: "Revenue" },
    elements: [],
    sourceConnections: [],
    sqlQueries: [],
    diagnostics: [],
  });
  mocks.createMigration.mockResolvedValue({});
  mocks.claimMigration.mockResolvedValue({
    claimed: false,
    reason: "in_progress",
  });
  mocks.listMigrations.mockResolvedValue([]);
  mocks.listFolders.mockResolvedValue([]);
  mocks.createFolder.mockResolvedValue({ id: "sigma-folder" });
  mocks.assignToFolder.mockResolvedValue(undefined);
  mocks.getDashboard.mockResolvedValue(null);
  mocks.upsertDashboard.mockResolvedValue(undefined);
  mocks.completeMigration.mockResolvedValue({});
  mocks.failMigration.mockResolvedValue({});
  mocks.proveSql.mockResolvedValue(new Map());
  mocks.verifyPanels.mockImplementation(verifiedPanels());
  mocks.abandonImport.mockResolvedValue(undefined);
});

describe("migrate-sigma-workbook", () => {
  async function expectNoImportableMigration(elements: unknown[]) {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId, name: "Revenue" },
      elements,
      sourceConnections: [],
      sqlQueries: [],
      diagnostics: [],
    });
    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({ errorCode: "sigma_no_importable_elements" });

    expect(mocks.createMigration).not.toHaveBeenCalled();
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  }

  it("rejects an empty workbook before creating a migration", async () => {
    await expectNoImportableMigration([]);
  });

  it("rejects a workbook with only unsupported elements", async () => {
    await expectNoImportableMigration([
      {
        kind: "unsupported",
        id: "element_1",
        title: "Unsupported",
        sigmaKind: "unsupported_visualization",
      },
    ]);
  });

  it("refuses a workbook whose panels all fail the dry run, before claiming", async () => {
    workbookWith([panelElement("element_1", "Revenue")]);
    mocks.proveSql.mockResolvedValue(
      new Map([
        ["element_1", { ok: false, reason: "bigquery_dry_run_failed" }],
      ]),
    );

    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({
      errorCode: "sigma_no_runnable_panels",
      statusCode: 422,
      details: {
        elements: [
          {
            id: "element_1",
            name: "Revenue",
            reason: "bigquery_dry_run_failed",
          },
        ],
      },
    });
    expect(mocks.inspectWorkbook).toHaveBeenCalledWith({
      connectionId: "connection_1",
      workbookId,
      includeSqlQueries: true,
    });
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  });

  it("keeps a workbook retryable when BigQuery could not check its panels", async () => {
    workbookWith([
      panelElement("element_1", "Revenue"),
      panelElement("element_2", "Pipeline"),
    ]);
    mocks.proveSql.mockResolvedValue(
      new Map([
        ["element_1", { ok: false, reason: "bigquery_dry_run_failed" }],
        ["element_2", { ok: false, reason: "bigquery_dry_run_unavailable" }],
      ]),
    );

    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({
      errorCode: "bigquery_dry_run_unavailable",
      statusCode: 503,
    });
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  });

  it("does not ask for a retry that would skip the same panels again", async () => {
    workbookWith([
      panelElement("element_1", "Revenue"),
      panelElement("element_2", "Pipeline"),
    ]);
    mocks.proveSql.mockResolvedValue(
      new Map([
        ["element_1", { ok: false, reason: "too_expensive" }],
        [
          "element_2",
          {
            ok: false,
            reason: "bigquery_dry_run_unavailable",
            skipped: true,
          },
        ],
      ]),
    );

    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({
      errorCode: "sigma_no_runnable_panels",
      statusCode: 422,
    });
  });

  it("stops dry runs early and refuses to claim without time to write", async () => {
    workbookWith([panelElement("element_1", "Revenue")]);
    const startedAt = 1_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    mocks.proveSql.mockImplementation(async () => {
      // An in-flight dry run ran past the proof deadline.
      now.mockReturnValue(startedAt + 50_000);
      return new Map([
        [
          "element_1",
          { ok: true, sql: "SELECT 1 AS revenue", estimatedBytes: 1 },
        ],
      ]);
    });

    try {
      await expect(
        migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
      ).rejects.toMatchObject({
        errorCode: "bigquery_dry_run_unavailable",
        statusCode: 503,
      });
      expect(mocks.proveSql).toHaveBeenCalledWith(
        expect.anything(),
        ["element_1"],
        { deadline: startedAt + 35_000 },
      );
      expect(mocks.claimMigration).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("imports proven panels and turns the rest into flagged callouts", async () => {
    workbookWith([
      panelElement("element_1", "Revenue"),
      panelElement("element_2", "Pipeline"),
      panelElement("element_3", "Churn"),
      {
        kind: "unsupported",
        id: "element_4",
        title: "Region filter",
        sigmaKind: "control-filter",
      },
      panelElement("element_5", "Bookings"),
    ]);
    mocks.proveSql.mockResolvedValue(
      new Map([
        [
          "element_1",
          { ok: true, sql: "SELECT 1 AS revenue", estimatedBytes: 100 },
        ],
        ["element_2", { ok: false, reason: "unsafe_sql" }],
        ["element_3", { ok: false, reason: "too_expensive" }],
        [
          "element_5",
          { ok: true, sql: "SELECT 5 AS bookings", estimatedBytes: 500 },
        ],
      ]),
    );
    claimed();
    mocks.verifyPanels.mockImplementation((config, ids) =>
      verifiedPanels({ [ids[1]]: "unverified" })(config, ids),
    );

    const result = await migrateSigmaWorkbook.run({
      workbookId,
      connectionId: "connection_1",
    });

    expect(mocks.proveSql).toHaveBeenCalledWith(
      expect.anything(),
      ["element_1", "element_2", "element_3", "element_5"],
      { deadline: expect.any(Number) },
    );
    const [, , config] = mocks.upsertDashboard.mock.calls[0];
    expect(
      config.panels.map((p: { chartType: string }) => p.chartType),
    ).toEqual(["table", "callout", "callout", "callout", "table"]);
    expect(config.panels[0].sql).toBe("SELECT 1 AS revenue");
    expect(config.panels[1].sql).toContain("not a single read-only query");
    expect(config.panels[2].sql).toContain("more than 50 GiB");
    const [, verifiedIds] = mocks.verifyPanels.mock.calls[0];
    expect(verifiedIds).toEqual([config.panels[0].id, config.panels[4].id]);
    expect(mocks.verifyPanels.mock.calls[0][2]).toMatchObject({
      dryRun: false,
    });
    expect(mocks.completeMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken: "token_1",
        flaggedCount: 4,
        elementDiagnostics: [
          expect.objectContaining({
            id: "element_2",
            status: "red",
            reason: "unsafe_sql",
          }),
          expect.objectContaining({
            id: "element_3",
            status: "red",
            reason: "too_expensive",
          }),
          expect.objectContaining({
            id: "element_4",
            status: "red",
            reason: "unsupported_filter",
          }),
          expect.objectContaining({
            id: "element_5",
            status: "yellow",
            reason: "not_verified",
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      status: "completed",
      importedCount: 2,
      unsupportedCount: 3,
      flaggedCount: 4,
    });
  });

  it("flags panels that dry-run but fail, return nothing, or were not run", async () => {
    workbookWith([
      panelElement("element_1", "Revenue"),
      panelElement("element_2", "Pipeline"),
      panelElement("element_3", "Churn"),
    ]);
    mocks.proveSql.mockResolvedValue(
      new Map([
        ["element_1", { ok: true, sql: "SELECT 1", estimatedBytes: 1 }],
        ["element_2", { ok: true, sql: "SELECT 2", estimatedBytes: 1 }],
        ["element_3", { ok: true, sql: "SELECT 3", estimatedBytes: 1 }],
      ]),
    );
    claimed();
    mocks.verifyPanels.mockImplementation((config, ids) =>
      verifiedPanels({
        [ids[0]]: "empty",
        [ids[1]]: "query-error",
        [ids[2]]: "unverified",
      })(config, ids),
    );

    const result = await migrateSigmaWorkbook.run({
      workbookId,
      connectionId: "connection_1",
    });

    expect(mocks.upsertDashboard).toHaveBeenCalled();
    expect(mocks.completeMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        elementDiagnostics: [
          expect.objectContaining({ status: "yellow", reason: "no_rows" }),
          expect.objectContaining({ status: "red", reason: "query_failed" }),
          expect.objectContaining({
            status: "yellow",
            reason: "not_verified",
          }),
        ],
      }),
    );
    expect(result).toMatchObject({ status: "completed", flaggedCount: 3 });
  });

  it("turns a panel BigQuery stopped at the byte cap into a callout", async () => {
    workbookWith([
      panelElement("element_1", "Revenue"),
      panelElement("element_2", "Pipeline"),
    ]);
    mocks.proveSql.mockResolvedValue(
      new Map([
        ["element_1", { ok: true, sql: "SELECT 1", estimatedBytes: 1 }],
        ["element_2", { ok: true, sql: "SELECT 2", estimatedBytes: 1 }],
      ]),
    );
    claimed();
    mocks.verifyPanels.mockImplementation((_config, ids: string[]) => ({
      verified: false,
      blocking: false,
      filterState: "defaults",
      budgetMs: 12_000,
      ms: 1,
      panels: [
        { panelId: ids[0], status: "ok" },
        { panelId: ids[1], status: "unverified", note: "too_expensive" },
      ],
    }));

    const result = await migrateSigmaWorkbook.run({
      workbookId,
      connectionId: "connection_1",
    });

    const [, , config] = mocks.upsertDashboard.mock.calls[0];
    expect(
      config.panels.map((p: { chartType: string }) => p.chartType),
    ).toEqual(["table", "callout"]);
    expect(config.panels[1].sql).toContain("more than 50 GiB");
    expect(mocks.completeMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        elementDiagnostics: [
          expect.objectContaining({
            id: "element_2",
            status: "red",
            reason: "too_expensive",
          }),
        ],
      }),
    );
    expect(result).toMatchObject({ importedCount: 1, unsupportedCount: 1 });
  });

  it("cleans up through the claim when a step after the claim fails", async () => {
    workbookWith([panelElement("element_1", "Revenue")]);
    mocks.proveSql.mockResolvedValue(
      new Map([["element_1", { ok: true, sql: "SELECT 1 AS revenue" }]]),
    );
    claimed();
    const writeError = new Error("folder write failed");
    mocks.assignToFolder.mockRejectedValue(writeError);

    await expect(
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toBe(writeError);
    expect(mocks.abandonImport).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken: "token_1",
        wroteDashboard: true,
        previousDashboardId: null,
        failureCode: "dashboard_write_failed",
      }),
    );
    expect(mocks.completeMigration).not.toHaveBeenCalled();
  });

  it("keeps source lookup failures retryable before claiming", async () => {
    mocks.inspectWorkbook.mockResolvedValue({
      workbook: { workbookId, name: "Revenue" },
      elements: [panel],
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
      migrateSigmaWorkbook.run({ workbookId, connectionId: "connection_1" }),
    ).rejects.toMatchObject({
      errorCode: "sigma_source_inspection_failed",
      statusCode: 503,
    });

    expect(mocks.inspectWorkbook).toHaveBeenCalledTimes(1);
    expect(mocks.proveSql).not.toHaveBeenCalled();
    expect(mocks.createMigration).not.toHaveBeenCalled();
    expect(mocks.claimMigration).not.toHaveBeenCalled();
  });

  it("uses a stable source suffix to distinguish same-named workbooks", () => {
    const first = sigmaDashboardName("Revenue", "workbook_1");
    const second = sigmaDashboardName("Revenue", "workbook_2");

    expect(first).toBe(sigmaDashboardName("Revenue", "workbook_1"));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^Sigma: Revenue · [a-f0-9]{20}$/);
  });
});
