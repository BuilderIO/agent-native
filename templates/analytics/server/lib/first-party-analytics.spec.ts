import { describe, expect, it } from "vitest";

import {
  normalizeAnalyticsTimestamp,
  resolveAnalyticsEventDimensions,
  scopedAnalyticsSql,
  validateFirstPartyAnalyticsSql,
} from "./first-party-analytics";

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
