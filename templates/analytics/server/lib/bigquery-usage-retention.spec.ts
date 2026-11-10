import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/db", () => ({ getDbExec: () => ({ execute }) }));
vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () => undefined,
  platformWaitUntil: () => undefined,
}));
const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { BIGQUERY_USAGE_MIGRATION_SQL } from "./bigquery-usage";
import { pruneBigQueryUsage } from "./bigquery-usage-retention";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const CUTOFF = "2026-08-08T12:00:00.000Z";
describe("daily job record expiry", () => {
  let db: Awaited<ReturnType<typeof PGlite.create>>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
    db = await PGlite.create("memory://");
    await db.exec(BIGQUERY_USAGE_MIGRATION_SQL);
    execute
      .mockReset()
      .mockImplementation(({ sql, args }) => db.query(sql, args));
  });
  afterEach(async () => {
    expect(fetch).not.toHaveBeenCalled();
    await db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function seed(
    count: number,
    start = "2026-01-01T00:00:00.000Z",
    project = "project",
  ) {
    await db.query(
      `INSERT INTO analytics_bigquery_usage
      (project_id, job_id, owner_email, org_id, credential_scope, workload, started_at, observed_at, submission_state, usage_status)
      SELECT $1, n::text, 'user@example.test', CASE WHEN n % 2 = 0 THEN 'org' ELSE NULL END,
        'default', 'unattributed', $2, $3, 'accepted',
        CASE n % 4 WHEN 0 THEN 'complete' WHEN 1 THEN 'pending' WHEN 2 THEN 'partial' ELSE 'unavailable' END
      FROM generate_series(1, $4::integer) AS n`,
      [project, start, new Date(NOW).toISOString(), count],
    );
  }
  it("expires every status and tenant by original UTC start, keeping exact cutoff and newer rows", async () => {
    await seed(4, new Date(Date.parse(CUTOFF) - 1).toISOString());
    await seed(1, CUTOFF, "boundary");
    await seed(1, new Date(Date.parse(CUTOFF) + 1).toISOString(), "newer");
    const result = await pruneBigQueryUsage();
    expect(result).toMatchObject({
      cutoff: CUTOFF,
      deleted: 4,
      expiredRemaining: "0",
    });
    expect(
      (
        await db.query(
          "SELECT project_id FROM analytics_bigquery_usage ORDER BY project_id",
        )
      ).rows,
    ).toEqual([{ project_id: "boundary" }, { project_id: "newer" }]);
  });
  it("uses multiple batches and composite job identity, and repeated/concurrent sweeps converge", async () => {
    await seed(1001);
    await seed(1, new Date(NOW).toISOString(), "other-project");
    const results = await Promise.all([
      pruneBigQueryUsage(),
      pruneBigQueryUsage(),
    ]);
    expect(results.reduce((n, result) => n + result.deleted, 0)).toBe(1001);
    expect(results.every((result) => result.expiredRemaining === "0")).toBe(
      true,
    );
    expect(await pruneBigQueryUsage()).toMatchObject({
      deleted: 0,
      expiredRemaining: "0",
    });
    expect(
      (
        await db.query(
          "SELECT project_id, job_id FROM analytics_bigquery_usage",
        )
      ).rows,
    ).toEqual([{ project_id: "other-project", job_id: "1" }]);
  });
  it("reports a failed sweep and can retry after partial deletion", async () => {
    await seed(1001);
    let calls = 0;
    execute.mockImplementation(({ sql, args }) => {
      if (++calls === 2) throw new Error("database unavailable");
      return db.query(sql, args);
    });
    await expect(pruneBigQueryUsage()).rejects.toThrow("database unavailable");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Sweep failed"),
      expect.objectContaining({ deleted: 1000 }),
    );
    execute.mockImplementation(({ sql, args }) => db.query(sql, args));
    expect(await pruneBigQueryUsage()).toMatchObject({
      deleted: 1,
      expiredRemaining: "0",
    });
  });
  it("stops at its time budget and exposes expired backlog instead of claiming expiry completed", async () => {
    await seed(1001);
    execute.mockImplementation(async ({ sql, args }) => {
      const result = await db.query(sql, args);
      vi.setSystemTime(NOW + 20_000);
      return result;
    });
    expect(await pruneBigQueryUsage()).toMatchObject({
      cutoff: CUTOFF,
      deleted: 1000,
      batches: 1,
      expiredRemaining: "1",
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("backlog remains"),
      expect.objectContaining({ expiredRemaining: "1" }),
    );
  });
  it("fails visibly when the final backlog read fails instead of claiming zero expired rows", async () => {
    execute
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("backlog read failed"));
    await expect(pruneBigQueryUsage()).rejects.toThrow("backlog read failed");
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Sweep failed"),
      expect.objectContaining({ deleted: 0, batches: 1 }),
    );
  });

  it("caps batches even when time does not advance", async () => {
    let calls = 0;
    execute.mockImplementation(async () =>
      ++calls <= 100
        ? { rows: Array(1000).fill({ job_id: "job" }) }
        : { rows: [{ remaining: "123" }] },
    );
    expect(await pruneBigQueryUsage()).toMatchObject({
      deleted: 100_000,
      batches: 100,
      expiredRemaining: "123",
    });
    expect(execute).toHaveBeenCalledTimes(101);
    expect(
      execute.mock.calls.every(
        ([call]) => call.timeoutMs === 1500 && call.maxAttempts === 1,
      ),
    ).toBe(true);
  });
});
