import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/db", () => ({ getDbExec: () => ({ execute }) }));
const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import {
  BIGQUERY_USAGE_MIGRATION_SQL,
  newBigQueryJobUsage,
  observeBigQueryJobUsage,
  persistBigQueryJobUsage,
  usageBytes,
  withBigQueryUsageAttribution,
} from "./bigquery-usage";

const ctx = { userEmail: "caller@example.test", orgId: "org-1" };
const makeUsage = () =>
  newBigQueryJobUsage(
    "test-project",
    "job-1",
    "SELECT 'private SQL text'",
    ctx,
  );
const metadata = (
  query: Record<string, unknown>,
  status: Record<string, unknown> = { state: "DONE" },
) => ({
  jobReference: { projectId: "test-project", jobId: "job-1", location: "EU" },
  status,
  statistics: { query },
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("warehouse job observations", () => {
  it("keeps exact billed bytes separate from processed bytes and provider cache provenance", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(
        metadata({
          totalBytesProcessed: "123",
          totalBytesBilled: "10485760",
          cacheHit: false,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await observeBigQueryJobUsage(
      { ...makeUsage(), location: "EU" },
      "fake-token",
    );
    expect(result).toMatchObject({
      bytesProcessed: "123",
      bytesBilled: "10485760",
      providerCacheHit: false,
      outcome: "succeeded",
      usageStatus: "complete",
    });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/bigquery/v2/projects/test-project/jobs/job-1");
    expect(url.searchParams.get("location")).toBe("EU");
    expect(url.searchParams.get("fields")).toContain("totalBytesBilled");
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("body");
  });

  it("preserves a reported provider cache hit and explicit zero billed bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          metadata({
            totalBytesProcessed: "90",
            totalBytesBilled: "0",
            cacheHit: true,
          }),
        ),
      ),
    );
    expect(await observeBigQueryJobUsage(makeUsage(), "fake")).toMatchObject({
      bytesProcessed: "90",
      bytesBilled: "0",
      providerCacheHit: true,
      usageStatus: "complete",
    });
  });

  it.each([undefined, null, -1, 2.5, "-1", "nan", "1e3", "1.5"])(
    "keeps malformed byte value %s unknown",
    (value) => {
      expect(usageBytes(value)).toBeNull();
    },
  );
  it("does not round byte counts larger than JS safe integers", () =>
    expect(usageBytes("9007199254740999")).toBe("9007199254740999"));

  it.each(["missing", "http", "throw", "different-job"])(
    "keeps %s metadata unknown without replacing known processed bytes with zero",
    async (mode) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (mode === "throw") throw new Error("network");
          if (mode === "http") return new Response("", { status: 403 });
          if (mode === "different-job")
            return json({
              ...metadata({ totalBytesBilled: "99" }),
              jobReference: { jobId: "other", projectId: "test-project" },
            });
          return json(metadata({}));
        }),
      );
      const result = await observeBigQueryJobUsage(
        { ...makeUsage(), bytesProcessed: "123", providerCacheHit: false },
        "fake",
      );
      expect(result.bytesProcessed).toBe("123");
      expect(result.bytesBilled).toBeNull();
      expect(result.usageStatus).not.toBe("complete");
    },
  );

  it.each([
    ["RUNNING", undefined, null],
    ["DONE", "stopped", "cancelled"],
    ["DONE", "invalidQuery", "failed"],
  ])(
    "observes provider state %s without assuming cancellation is free",
    async (state, reason, outcome) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json(
            metadata(
              {},
              { state, ...(reason ? { errorResult: { reason } } : {}) },
            ),
          ),
        ),
      );
      expect(await observeBigQueryJobUsage(makeUsage(), "fake")).toMatchObject({
        providerState: state,
        outcome,
        bytesBilled: null,
        usageStatus: "partial",
      });
    },
  );

  it("isolates concurrent server-owned dashboard provenance and never stores SQL", async () => {
    const records = await Promise.all(
      ["a", "b"].map((dashboardId) =>
        withBigQueryUsageAttribution(
          { workload: "dashboard-report", dashboardId, panelId: "p" },
          async () => {
            await Promise.resolve();
            return makeUsage();
          },
        ),
      ),
    );
    expect(records.map((r) => r.dashboardId)).toEqual(["a", "b"]);
    expect(records[0]).toMatchObject({
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
      workload: "dashboard-report",
      panelId: "p",
      queryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(records)).not.toContain("private SQL text");
    expect(makeUsage()).toMatchObject({
      workload: "unattributed",
      dashboardId: null,
      panelId: null,
    });
  });
});

describe("durable warehouse ledger", () => {
  let client: Awaited<ReturnType<typeof PGlite.create>>;
  beforeEach(async () => {
    client = await PGlite.create("memory://");
    await client.exec(BIGQUERY_USAGE_MIGRATION_SQL);
    execute
      .mockReset()
      .mockImplementation(({ sql, args }) => client.query(sql, args));
  });
  afterEach(async () => {
    await client.close();
  });

  it("upserts observations of one job once, preserves exact bytes and cannot regress complete usage", async () => {
    const usage = makeUsage();
    await persistBigQueryJobUsage(usage);
    const complete = {
      ...usage,
      usageStatus: "complete" as const,
      bytesProcessed: "9007199254740999",
      bytesBilled: "10485760",
      providerCacheHit: false,
    };
    await persistBigQueryJobUsage(complete);
    await persistBigQueryJobUsage(complete);
    await persistBigQueryJobUsage(usage);
    const rows = (await client.query("SELECT * FROM analytics_bigquery_usage"))
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bytes_processed: "9007199254740999",
      bytes_billed: "10485760",
      usage_status: "complete",
      provider_cache_hit: false,
    });
    await persistBigQueryJobUsage({ ...complete, jobId: "retry-new-job" });
    expect(
      (
        await client.query(
          "SELECT COUNT(*)::integer AS n FROM analytics_bigquery_usage",
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it("keeps abandoned and incomplete jobs visible as unknown rather than zero", async () => {
    await persistBigQueryJobUsage(makeUsage());
    expect(
      (await client.query("SELECT * FROM analytics_bigquery_usage")).rows[0],
    ).toMatchObject({
      usage_status: "pending",
      bytes_billed: null,
      bytes_processed: null,
      outcome: null,
    });
    expect(
      await persistBigQueryJobUsage({
        ...makeUsage(),
        usageStatus: "unavailable",
      }),
    ).toBe(true);
  });

  it("reports a persistence failure without throwing a successful query into a retry", async () => {
    execute.mockRejectedValueOnce(new Error("database unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await persistBigQueryJobUsage(makeUsage())).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("usage is unknown"),
      expect.objectContaining({ jobId: "job-1" }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private SQL text");
  });
});
