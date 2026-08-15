import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: {},
}));

import {
  countFirstPartyAnalyticsPostgresRows,
  purgeFirstPartyAnalyticsPostgresRows,
} from "./first-party-analytics-purge.js";

const scope = { orgId: "org-1", userEmail: "admin@example.com" };
const window = {
  startReceivedAt: "2026-07-01T00:00:00.000Z",
  startEventDate: "2026-07-01",
};

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({ rows: [{ row_count: "1" }] });
});

describe("countFirstPartyAnalyticsPostgresRows", () => {
  it("uses bounded parameterized counts for each scoped source", async () => {
    await expect(
      countFirstPartyAnalyticsPostgresRows(scope, false, window),
    ).resolves.toEqual({ eventRows: 1, dailyRollupRows: 1, userDayRows: 1 });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sql: expect.stringMatching(
          /FROM analytics_events[\s\S]*event_name IS DISTINCT FROM 'http\.response'/,
        ),
        args: ["org-1", "2026-07-01T00:00:00.000Z"],
        timeoutMs: 5_000,
        maxAttempts: 1,
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sql: expect.stringContaining("FROM analytics_event_daily_rollups"),
        args: ["org-1", "2026-07-01"],
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        sql: expect.stringContaining("FROM analytics_user_days"),
        args: ["org-1", "2026-07-01"],
      }),
    );
  });

  it("keeps legacy-owner rows explicitly scoped when requested", async () => {
    await countFirstPartyAnalyticsPostgresRows(scope, true, window);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "(org_id = ? OR (org_id IS NULL AND owner_email = ?))",
        ),
        args: ["org-1", "admin@example.com", expect.any(String)],
      }),
    );
  });

  it("rejects an unreadable count instead of treating it as zero", async () => {
    execute.mockResolvedValue({ rows: [{}] });

    await expect(
      countFirstPartyAnalyticsPostgresRows(scope, false, window),
    ).rejects.toThrow("invalid value");
  });
});

describe("purgeFirstPartyAnalyticsPostgresRows", () => {
  it("deletes each scoped table in bounded returning batches", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ row_count: "5" }] })
      .mockResolvedValueOnce({ rows: [{ row_count: "1" }] })
      .mockResolvedValueOnce({ rows: [{ row_count: "1" }] })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 5_000 }, () => ({ id: "id" })),
      })
      .mockResolvedValueOnce({ rows: [{ id: "last" }] })
      .mockResolvedValueOnce({ rows: [{ id: "rollup" }] })
      .mockResolvedValueOnce({ rows: [{ id: "user-day" }] });

    await expect(
      purgeFirstPartyAnalyticsPostgresRows(scope, false, window),
    ).resolves.toEqual({ eventRows: 5, dailyRollupRows: 1, userDayRows: 1 });

    expect(execute).toHaveBeenCalledTimes(7);
    expect(execute).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        sql: expect.stringMatching(
          /WITH candidates[\s\S]*LIMIT \?[\s\S]*DELETE FROM analytics_events[\s\S]*RETURNING id/,
        ),
        args: ["org-1", "2026-07-01T00:00:00.000Z", 5_000],
        timeoutMs: 30_000,
        maxAttempts: 1,
      }),
    );
  });
});
