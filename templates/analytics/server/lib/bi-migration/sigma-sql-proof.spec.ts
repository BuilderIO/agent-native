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
  const actual =
    await vi.importActual<typeof import("../bigquery.js")>("../bigquery.js");
  return {
    BigQueryDryRunPreparationError,
    dryRunQuerySchema: mocks.dryRun,
    classifyDryRunFailure: actual.classifyDryRunFailure,
  };
});
vi.mock("../dashboard-panel-verification.js", () => ({
  DEFAULT_MAX_BYTES_TO_EXECUTE: 50 * 1024 ** 3,
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
      .mockResolvedValueOnce({
        error: "Not found: Table p:d.t was not found",
        status: 404,
      })
      .mockResolvedValueOnce({ error: "timed out", timedOut: true })
      .mockResolvedValueOnce({ error: "backend error", status: 503 })
      .mockResolvedValueOnce({ error: "quota exceeded", status: 429 })
      .mockResolvedValueOnce({
        error: "Quota exceeded",
        status: 403,
        reason: "quota_exceeded",
      })
      .mockResolvedValueOnce({
        error: "Access Denied: Table p:d.t: User does not have permission",
        status: 403,
        reason: "access_denied",
      })
      .mockResolvedValueOnce({
        error: "Job timed out",
        status: 400,
        reason: "timeout",
      })
      .mockResolvedValueOnce({ error: "Teapot", status: 418 });

    const proofs = await proveSigmaPanelSql(
      inspectionWith([
        { elementId: "rejected", sql: "SELECT 1", hasError: false },
        { elementId: "slow", sql: "SELECT 2", hasError: false },
        { elementId: "outage", sql: "SELECT 3", hasError: false },
        { elementId: "throttled", sql: "SELECT 4", hasError: false },
        { elementId: "quota", sql: "SELECT 5", hasError: false },
        { elementId: "denied", sql: "SELECT 6", hasError: false },
        { elementId: "jobTimeout", sql: "SELECT 7", hasError: false },
        { elementId: "unknown", sql: "SELECT 8", hasError: false },
      ]),
      [
        "rejected",
        "slow",
        "outage",
        "throttled",
        "quota",
        "denied",
        "jobTimeout",
        "unknown",
      ],
    );

    expect(Object.fromEntries(proofs)).toEqual({
      rejected: { ok: false, reason: "bigquery_dry_run_failed" },
      slow: { ok: false, reason: "bigquery_dry_run_unavailable" },
      outage: { ok: false, reason: "bigquery_dry_run_unavailable" },
      throttled: { ok: false, reason: "bigquery_dry_run_unavailable" },
      quota: { ok: false, reason: "bigquery_dry_run_unavailable" },
      denied: { ok: false, reason: "bigquery_dry_run_failed" },
      jobTimeout: { ok: false, reason: "bigquery_dry_run_unavailable" },
      unknown: { ok: false, reason: "bigquery_dry_run_unavailable" },
    });
  });

  it("refuses SQL that would scan more than the execution cap", async () => {
    mocks.dryRun.mockResolvedValue({
      error: null,
      totalBytesProcessed: 68 * 1024 ** 3,
    });

    const proofs = await proveSigmaPanelSql(
      inspectionWith([{ elementId: "a", sql: "SELECT 1", hasError: false }]),
      ["a"],
    );

    expect(proofs.get("a")).toEqual({ ok: false, reason: "too_expensive" });
  });

  it("refuses SQL whose dry run reports no byte estimate", async () => {
    mocks.dryRun.mockResolvedValue({ error: null });

    const proofs = await proveSigmaPanelSql(
      inspectionWith([{ elementId: "a", sql: "SELECT 1", hasError: false }]),
      ["a"],
    );

    expect(proofs.get("a")).toEqual({ ok: false, reason: "cost_unknown" });
  });

  it("stops dry-running once the run's deadline has passed", async () => {
    const proofs = await proveSigmaPanelSql(
      inspectionWith([{ elementId: "a", sql: "SELECT 1", hasError: false }]),
      ["a"],
      { deadline: Date.now() - 1 },
    );

    expect(proofs.get("a")).toEqual({
      ok: false,
      reason: "bigquery_dry_run_unavailable",
      skipped: true,
    });
    expect(mocks.dryRun).not.toHaveBeenCalled();
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

  it("fails the whole check when the credential cannot run queries", async () => {
    mocks.dryRun.mockResolvedValue({
      error:
        "Access Denied: Project p: User does not have bigquery.jobs.create permission in project p.",
      status: 403,
      reason: "access_denied",
    });

    await expect(
      proveSigmaPanelSql(
        inspectionWith([{ elementId: "a", sql: "SELECT 1", hasError: false }]),
        ["a"],
      ),
    ).rejects.toMatchObject({
      errorCode: "analytics_bigquery_permission_denied",
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
