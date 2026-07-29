import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute }),
}));

import {
  normalizeAnalyticsTimestamp,
  queryFirstPartyAnalytics,
  resolveAnalyticsEventDimensions,
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";

beforeEach(() => {
  execute.mockReset();
});

describe("resolveAnalyticsEventDimensions", () => {
  it("promotes signup tracking attribution into queryable app/template columns", () => {
    expect(
      resolveAnalyticsEventDimensions({
        properties: {
          agent_native_app: "chat",
          agent_native_template: "plan",
        },
        context: {},
        hostname: null,
      }),
    ).toEqual({ app: "chat", template: "plan" });
  });

  it("keeps explicit app/template values ahead of compatibility aliases", () => {
    expect(
      resolveAnalyticsEventDimensions({
        properties: {
          app: "analytics",
          template: "docs",
          agent_native_app: "chat",
          agent_native_template: "plan",
        },
        context: {},
        hostname: "mail.agent-native.com",
      }),
    ).toEqual({ app: "analytics", template: "docs" });
  });
});

describe("validateFirstPartyAnalyticsSql", () => {
  it("rejects PostgreSQL-style bind placeholders outside string literals", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT COUNT(*) AS count FROM analytics_events WHERE timestamp >= $1",
      ),
    ).toThrow("Bind placeholders are not supported in dashboard SQL");
  });

  it("allows literal strings that mention a placeholder-like token", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT '$1' AS replacement_token FROM analytics_events",
      ),
    ).not.toThrow();
  });

  it("allows scoped session recording summary queries", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT app, COUNT(*) AS recordings FROM session_recordings WHERE owner_email = 'alice@example.com' GROUP BY app",
      ),
    ).not.toThrow();
  });

  it("rejects direct replay chunk queries", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "SELECT COUNT(*) AS chunks FROM session_replay_chunks",
      ),
    ).toThrow("session replay chunks");
  });

  it("rejects replay chunk names even as CTEs", () => {
    expect(() =>
      validateFirstPartyAnalyticsSql(
        "WITH session_replay_chunks AS (SELECT id FROM analytics_events) SELECT COUNT(*) FROM session_replay_chunks",
      ),
    ).toThrow("session replay chunks");
  });
});

describe("normalizeAnalyticsTimestamp", () => {
  it("clamps future client timestamps to the server receive time", () => {
    expect(
      normalizeAnalyticsTimestamp(
        "2026-07-05T12:00:00.000Z",
        "2026-07-01T13:00:00.000Z",
      ),
    ).toBe("2026-07-01T13:00:00.000Z");
  });

  it("keeps valid past timestamps", () => {
    expect(
      normalizeAnalyticsTimestamp(
        "2026-06-30T12:00:00.000Z",
        "2026-07-01T13:00:00.000Z",
      ),
    ).toBe("2026-06-30T12:00:00.000Z");
  });
});

describe("scopedAnalyticsSql", () => {
  it("adds tenant and freshness guards around analytics event reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT event_date, COUNT(*) AS count FROM analytics_events GROUP BY event_date",
      { userEmail: "alice@example.com", orgId: "org_123" },
      "2026-07-01",
    );

    expect(scoped.sql).toContain("FROM analytics_events WHERE");
    expect(scoped.sql).toContain(
      "(org_id = ? OR (org_id IS NULL AND owner_email = ?))",
    );
    expect(scoped.sql).toContain(
      "COALESCE(NULLIF(event_date, ''), substr(timestamp, 1, 10)) <= ?",
    );
    expect(scoped.args).toEqual(["org_123", "alice@example.com", "2026-07-01"]);
  });

  it("adds freshness guards around session recording reads", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT COUNT(*) AS recordings FROM session_recordings",
      { userEmail: "alice@example.com", orgId: null },
      "2026-07-01",
    );

    expect(scoped.sql).toContain("substr(started_at, 1, 10) <= ?");
    expect(scoped.args).toEqual(["alice@example.com", "2026-07-01"]);
  });
});

describe("queryFirstPartyAnalytics", () => {
  it("keeps ad-hoc first-party reads uncached", async () => {
    execute.mockResolvedValue({ rows: [{ count: "1" }], rowsAffected: 0 });

    await queryFirstPartyAnalytics(
      "SELECT COUNT(*) AS count FROM analytics_events",
      { userEmail: "alice@example.com", orgId: null },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 45_000,
        maxAttempts: 1,
      }),
    );
  });

  it("caches dashboard-panel reads only when explicitly requested", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    execute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("first_party_analytics_cache")
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ count: "1" }], rowsAffected: 0 },
    );

    try {
      const query = "SELECT COUNT(*) AS count FROM analytics_events";
      const scope = { userEmail: "cached@example.com", orgId: null };
      await queryFirstPartyAnalytics(query, scope, { cache: true });
      await queryFirstPartyAnalytics(query, scope, { cache: true });
    } finally {
      random.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("first_party_analytics_cache"),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(1_000);
    expect(execute.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("ON CONFLICT(key) DO UPDATE"),
        maxAttempts: 1,
      }),
    );
    expect(execute.mock.calls[2][0].timeoutMs).toBeLessThanOrEqual(1_000);
  });

  it("shares one deadline between the cache read and panel query", async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        now += 125;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    try {
      await queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        { userEmail: "deadline@example.com", orgId: null },
        { cache: true, timeoutMs: 500 },
      );
    } finally {
      dateNow.mockRestore();
    }

    expect(execute.mock.calls[0][0]).toEqual(
      expect.objectContaining({ timeoutMs: 500, maxAttempts: 1 }),
    );
    expect(execute.mock.calls[1][0]).toEqual(
      expect.objectContaining({ timeoutMs: 375, maxAttempts: 1 }),
    );
    expect(execute.mock.calls[2][0]).toEqual(
      expect.objectContaining({ timeoutMs: 375, maxAttempts: 1 }),
    );
  });

  it("does not start the panel query after the shared deadline expires", async () => {
    let now = 2_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        now += 500;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    try {
      await expect(
        queryFirstPartyAnalytics(
          "SELECT COUNT(*) AS count FROM analytics_events",
          { userEmail: "expired-deadline@example.com", orgId: null },
          { cache: true, timeoutMs: 500 },
        ),
      ).rejects.toThrow("First-party analytics query timed out after 500ms");
    } finally {
      dateNow.mockRestore();
    }

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not hold a successful panel response on the cache write", async () => {
    execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT result FROM first_party_analytics_cache")) {
        return { rows: [], rowsAffected: 0 };
      }
      if (sql.includes("ON CONFLICT(key) DO UPDATE")) {
        return await new Promise(() => {});
      }
      return { rows: [{ count: "1" }], rowsAffected: 0 };
    });

    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) AS count FROM analytics_events",
        { userEmail: "nonblocking-cache@example.com", orgId: null },
        { cache: true },
      ),
    ).resolves.toEqual({
      rows: [{ count: "1" }],
      schema: [{ name: "count", type: "string" }],
    });
  });
});
