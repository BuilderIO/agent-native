import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dryRun: vi.fn(),
}));

vi.mock("../bigquery.js", async () => {
  class BigQueryDryRunPreparationError extends Error {
    readonly notConfigured: boolean;
    constructor(options: { notConfigured?: boolean } = {}) {
      super("BigQuery dry-run request preparation failed");
      this.notConfigured = options.notConfigured === true;
    }
  }
  return { BigQueryDryRunPreparationError, dryRunQuerySchema: mocks.dryRun };
});
vi.mock("../dashboard-panel-verification.js", () => ({
  runPool: async <T, R>(items: T[], _limit: number, fn: (item: T) => R) =>
    Promise.all(items.map(fn)),
}));

const { BigQueryDryRunPreparationError } = await import("../bigquery.js");
const { proveSigmaPanelSql } = await import("./sigma-sql-proof.js");

function inspectionWith(sqlQueries: unknown[]) {
  return {
    workbook: { workbookId: "workbook_1", name: "Revenue" },
    pages: [],
    elements: [],
    sourceConnections: [],
    sqlQueries,
    diagnostics: [],
  } as unknown as Parameters<typeof proveSigmaPanelSql>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dryRun.mockResolvedValue({ error: null, totalBytesProcessed: 2048 });
});

describe("proveSigmaPanelSql", () => {
  it("proves SQL that is read-only and dry-runs on BigQuery", async () => {
    const proofs = await proveSigmaPanelSql(
      inspectionWith([
        { elementId: "a", sql: "SELECT 1 AS revenue", hasError: false },
      ]),
      ["a"],
    );

    expect(proofs.get("a")).toEqual({
      ok: true,
      sql: "SELECT 1 AS revenue",
      estimatedBytes: 2048,
    });
    expect(mocks.dryRun).toHaveBeenCalledWith("SELECT 1 AS revenue", {
      wrapPreparationErrors: true,
    });
  });

  it("names why SQL cannot be imported without dry-running it", async () => {
    const proofs = await proveSigmaPanelSql(
      inspectionWith([
        { elementId: "split", sql: "SELECT 1", hasError: false },
        { elementId: "split", sql: "SELECT 2", hasError: false },
        {
          elementId: "big",
          sqlOmittedReason: "query-too-large",
          hasError: false,
        },
        {
          elementId: "broken",
          sqlOmittedReason: "query-error",
          hasError: true,
        },
        { elementId: "unsafe", sql: "DELETE FROM target", hasError: false },
      ]),
      ["split", "big", "broken", "unsafe", "missing"],
    );

    expect(Object.fromEntries(proofs)).toEqual({
      split: { ok: false, reason: "query_unavailable" },
      big: { ok: false, reason: "sql_too_large" },
      broken: { ok: false, reason: "query_unavailable" },
      unsafe: { ok: false, reason: "unsafe_sql" },
      missing: { ok: false, reason: "query_unavailable" },
    });
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });

  it("tells SQL BigQuery rejected from a check that could not finish", async () => {
    mocks.dryRun
      .mockResolvedValueOnce({ error: "Table not found", status: 404 })
      .mockResolvedValueOnce({ error: "timed out", timedOut: true })
      .mockResolvedValueOnce({ error: "backend error", status: 503 });

    const proofs = await proveSigmaPanelSql(
      inspectionWith([
        { elementId: "rejected", sql: "SELECT 1", hasError: false },
        { elementId: "slow", sql: "SELECT 2", hasError: false },
        { elementId: "outage", sql: "SELECT 3", hasError: false },
      ]),
      ["rejected", "slow", "outage"],
    );

    expect(Object.fromEntries(proofs)).toEqual({
      rejected: { ok: false, reason: "bigquery_dry_run_failed" },
      slow: { ok: false, reason: "bigquery_dry_run_unavailable" },
      outage: { ok: false, reason: "bigquery_dry_run_unavailable" },
    });
  });

  it("fails the whole check when BigQuery is not connected", async () => {
    mocks.dryRun.mockRejectedValue(
      new BigQueryDryRunPreparationError({ notConfigured: true }),
    );

    await expect(
      proveSigmaPanelSql(
        inspectionWith([{ elementId: "a", sql: "SELECT 1", hasError: false }]),
        ["a"],
      ),
    ).rejects.toMatchObject({
      errorCode: "analytics_bigquery_required",
      statusCode: 409,
    });
  });

  it("fails the whole check when BigQuery cannot be reached", async () => {
    mocks.dryRun.mockRejectedValue(new BigQueryDryRunPreparationError());

    await expect(
      proveSigmaPanelSql(
        inspectionWith([{ elementId: "a", sql: "SELECT 1", hasError: false }]),
        ["a"],
      ),
    ).rejects.toMatchObject({
      errorCode: "bigquery_dry_run_unavailable",
      statusCode: 503,
    });
  });
});
