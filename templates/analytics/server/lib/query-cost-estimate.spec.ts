import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dryRun: vi.fn(),
  renderFirstParty: vi.fn(),
  PreparationError: class BigQueryDryRunPreparationError extends Error {
    notConfigured: boolean;
    constructor(options: { notConfigured?: boolean } = {}) {
      super("prep failed");
      this.notConfigured = options.notConfigured === true;
    }
  },
}));

vi.mock("./bigquery.js", () => ({
  dryRunQuerySchema: mocks.dryRun,
  BigQueryDryRunPreparationError: mocks.PreparationError,
}));

vi.mock("./dashboard-panel-runner.js", () => ({
  describeError: (error: unknown) =>
    `redacted:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("./first-party-analytics.js", () => ({
  renderFirstPartyAnalyticsBigQueryEstimateSql: mocks.renderFirstParty,
}));

import {
  costFromBytes,
  estimateBigQuerySql,
  estimateFirstPartySql,
  estimateResolvedPanel,
  MIN_BILLED_BYTES_PER_QUERY,
  totalCost,
  usdForBytes,
} from "./query-cost-estimate.js";

const GIB = 1024 ** 3;
const TIB = 1024 ** 4;
const scope = { userEmail: "caller@example.test", orgId: "org-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("query cost math", () => {
  it("prices bytes at on-demand $6.25 per TiB", () => {
    expect(usdForBytes(TIB)).toBe(6.25);
    // Kyle's Oct 9 alert poll: ~190 GiB is about $1.16.
    expect(usdForBytes(190 * GIB)).toBeCloseTo(1.16, 2);
  });

  it("applies the 10 MiB minimum but charges nothing for zero bytes", () => {
    expect(usdForBytes(1)).toBe(usdForBytes(MIN_BILLED_BYTES_PER_QUERY));
    expect(usdForBytes(0)).toBe(0);
  });

  it("flags runs over $1 and months over $50", () => {
    const cheap = costFromBytes(10 * GIB, 30);
    expect(cheap).toMatchObject({
      overPerRunThreshold: false,
      overPerMonthThreshold: false,
      runsPerMonth: 30,
    });
    const alert = costFromBytes(190 * GIB, 8640);
    expect(alert.overPerRunThreshold).toBe(true);
    expect(alert.overPerMonthThreshold).toBe(true);
    expect(alert.usdPerMonth).toBeGreaterThan(9000);
  });

  it("has no monthly figure without a schedule", () => {
    expect(costFromBytes(GIB, null)).toMatchObject({
      usdPerMonth: null,
      overPerMonthThreshold: false,
    });
  });

  it("totals only estimated queries", () => {
    expect(
      totalCost([
        costFromBytes(TIB, 30),
        costFromBytes(TIB, null),
        { status: "not_bigquery", reason: "ga4" },
      ]),
    ).toEqual({ estimatedBytes: 2 * TIB, usdPerRun: 12.5, usdPerMonth: 187.5 });
  });
});

describe("estimateBigQuerySql", () => {
  it("dry-runs the SQL and returns bytes and dollars", async () => {
    mocks.dryRun.mockResolvedValueOnce({
      error: null,
      totalBytesProcessed: 2 * TIB,
    });
    const signal = new AbortController().signal;

    const estimate = await estimateBigQuerySql("SELECT 1", 30, signal);

    expect(mocks.dryRun).toHaveBeenCalledWith("SELECT 1", {
      signal,
      wrapPreparationErrors: true,
    });
    expect(estimate).toMatchObject({
      status: "estimated",
      estimatedBytes: 2 * TIB,
      usdPerRun: 12.5,
      usdPerMonth: 375,
    });
  });

  it("refuses write statements without a dry run", async () => {
    const estimate = await estimateBigQuerySql(
      "DELETE FROM t WHERE true",
      null,
    );
    expect(estimate).toMatchObject({
      status: "failed",
      failure: "invalid_sql",
    });
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });

  it("reports BigQuery's SQL error and timeouts", async () => {
    mocks.dryRun.mockResolvedValueOnce({ error: "Unrecognized name: x" });
    await expect(estimateBigQuerySql("SELECT x", null)).resolves.toEqual({
      status: "failed",
      failure: "invalid_sql",
      error: "redacted:Unrecognized name: x",
    });
    mocks.dryRun.mockResolvedValueOnce({ error: "timed out", timedOut: true });
    await expect(estimateBigQuerySql("SELECT 1", null)).resolves.toMatchObject({
      failure: "timeout",
    });
  });

  it("keeps provider failures apart from invalid SQL", async () => {
    mocks.dryRun.mockResolvedValueOnce({
      error: "Syntax error: Unexpected keyword",
      status: 400,
    });
    await expect(
      estimateBigQuerySql("SELECT 1 FROM", null),
    ).resolves.toMatchObject({
      failure: "invalid_sql",
    });
    for (const status of [403, 429, 503]) {
      mocks.dryRun.mockResolvedValueOnce({ error: "quota", status });
      await expect(
        estimateBigQuerySql("SELECT 1", null),
      ).resolves.toMatchObject({ failure: "no_estimate" });
    }
  });

  it("treats a missing byte count as no estimate, never as free", async () => {
    mocks.dryRun.mockResolvedValueOnce({ error: null });
    await expect(estimateBigQuerySql("SELECT 1", null)).resolves.toMatchObject({
      status: "failed",
      failure: "no_estimate",
    });
  });

  it("says BigQuery isn't connected only when credentials are missing", async () => {
    mocks.dryRun.mockRejectedValueOnce(
      new mocks.PreparationError({ notConfigured: true }),
    );
    await expect(estimateBigQuerySql("SELECT 1", null)).resolves.toMatchObject({
      status: "failed",
      failure: "not_connected",
    });
    mocks.dryRun.mockRejectedValueOnce(new mocks.PreparationError());
    await expect(estimateBigQuerySql("SELECT 1", null)).resolves.toMatchObject({
      status: "failed",
      failure: "no_estimate",
    });
  });

  it("hides unexpected error details", async () => {
    mocks.dryRun.mockRejectedValueOnce(new Error("private token detail"));
    const estimate = await estimateBigQuerySql("SELECT 1", null);
    expect(estimate).toMatchObject({ failure: "no_estimate" });
    expect(JSON.stringify(estimate)).not.toContain("private token detail");
  });

  it("rethrows cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.dryRun.mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );
    await expect(
      estimateBigQuerySql("SELECT 1", null, controller.signal),
    ).rejects.toThrow("Aborted");
  });
});

describe("estimateFirstPartySql", () => {
  it("dry-runs the rendered BigQuery SQL", async () => {
    mocks.renderFirstParty.mockResolvedValueOnce({
      target: "bigquery",
      sql: "SELECT rendered",
    });
    mocks.dryRun.mockResolvedValueOnce({
      error: null,
      totalBytesProcessed: GIB,
    });

    const estimate = await estimateFirstPartySql(
      "SELECT count(*) FROM analytics_events",
      scope,
      null,
    );

    expect(mocks.renderFirstParty).toHaveBeenCalledWith(
      "SELECT count(*) FROM analytics_events",
      scope,
      undefined,
    );
    expect(mocks.dryRun.mock.calls[0][0]).toBe("SELECT rendered");
    expect(estimate).toMatchObject({
      status: "estimated",
      estimatedBytes: GIB,
    });
  });

  it("reports SQL the first-party policy rejects as invalid", async () => {
    mocks.renderFirstParty.mockResolvedValueOnce({
      target: "invalid",
      error: new Error("Only read-only SELECT queries are allowed"),
    });
    await expect(
      estimateFirstPartySql("DROP TABLE analytics_events", scope, null),
    ).resolves.toMatchObject({ failure: "invalid_sql" });
  });

  it("hides backend load failures behind a generic message", async () => {
    mocks.renderFirstParty.mockRejectedValueOnce(
      new Error("connection to private-db-host refused"),
    );
    const estimate = await estimateFirstPartySql("SELECT 1", scope, null);
    expect(estimate).toMatchObject({ failure: "no_estimate" });
    expect(JSON.stringify(estimate)).not.toContain("private-db-host");
  });

  it("costs nothing when the query stays in the SQL store", async () => {
    mocks.renderFirstParty.mockResolvedValueOnce({ target: "sql-store" });
    await expect(
      estimateFirstPartySql("SELECT 1 FROM session_recordings", scope, null),
    ).resolves.toMatchObject({ status: "not_bigquery" });
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });
});

describe("estimateResolvedPanel", () => {
  it("skips non-BigQuery sources and reports unresolved panels", async () => {
    await expect(
      estimateResolvedPanel(
        { panelId: "p1", title: "GA", source: "ga4", query: "{}" },
        scope,
        null,
      ),
    ).resolves.toMatchObject({ panelId: "p1", status: "not_bigquery" });
    await expect(
      estimateResolvedPanel(
        { panelId: "p2", title: "Bad", source: "bigquery", error: "no filter" },
        scope,
        null,
      ),
    ).resolves.toMatchObject({
      panelId: "p2",
      status: "failed",
      failure: "invalid_sql",
      error: "redacted:no filter",
    });
    await expect(
      estimateResolvedPanel(
        { panelId: "p3", title: "Program", source: "program", query: "{}" },
        scope,
        null,
      ),
    ).resolves.toMatchObject({ panelId: "p3", status: "not_estimated" });
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });
});
