import {
  getOrCreateRequestDbPool,
  retainRequestDbPoolScope,
  runWithRequestDbPoolScope,
} from "@agent-native/core/db/request-pool-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runResolvedPanel } from "./dashboard-panel-runner";

const mocks = vi.hoisted(() => ({
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("./first-party-analytics", () => ({
  queryFirstPartyAnalytics: mocks.queryFirstPartyAnalytics,
}));

import { runDashboardPanelQuery } from "./dashboard-panel-query";
import { FirstPartyAnalyticsUnsupportedSqlError } from "./first-party-analytics-backend";

const ctx = { userEmail: "alice@example.com", orgId: "org-1" };

describe("dashboard-panel-query: first-party source", () => {
  beforeEach(() => {
    mocks.queryFirstPartyAnalytics.mockReset();
  });

  it.each([false, true])(
    "returns first-party execution metadata unchanged on cache hit %s",
    async (cached) => {
      const response = {
        rows: [{ count: 1 }],
        schema: [{ name: "count", type: "INTEGER" }],
        bytesProcessed: 4096,
        cached,
        providerCacheHit: false,
        fetchedAt: "2026-10-14T12:00:00.000Z",
        truncated: false,
      };
      mocks.queryFirstPartyAnalytics.mockResolvedValueOnce(response);
      await expect(
        runDashboardPanelQuery({
          source: "first-party",
          query: "SELECT COUNT(*) AS count FROM analytics_events",
          ctx,
        }),
      ).resolves.toEqual(response);
      expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledTimes(1);
      expect(mocks.queryFirstPartyAnalytics.mock.calls[0]?.[2]).toEqual({
        cache: true,
      });
    },
  );

  it.each(["deadline", "caller"])(
    "propagates %s cancellation through the first-party dispatcher and releases the pool",
    async (cause) => {
      const caller = new AbortController();
      let seenSignal: AbortSignal | undefined;
      let providerWork: Promise<never> | undefined;
      let announceStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        announceStarted = resolve;
      });
      const ended = vi.fn(async () => {});
      mocks.queryFirstPartyAnalytics.mockImplementation(
        (_query, _scope, options: { signal?: AbortSignal }) => {
          seenSignal = options.signal;
          providerWork = retainRequestDbPoolScope(
            new Promise<never>((_resolve, reject) => {
              options.signal?.addEventListener(
                "abort",
                () => reject(new Error("provider cancelled")),
                { once: true },
              );
            }),
          );
          announceStarted();
          return providerWork;
        },
      );
      const result = await runWithRequestDbPoolScope(
        true,
        undefined,
        async () => {
          getOrCreateRequestDbPool("first-party-cancellation-fixture", () => ({
            end: ended,
          }));
          const panel = runResolvedPanel({
            source: "first-party",
            query: "SELECT COUNT(*) FROM analytics_events",
            ctx,
            timeoutMs: cause === "deadline" ? 20 : 500,
            signal: caller.signal,
          });
          await started;
          if (cause === "caller") caller.abort();
          return panel;
        },
      );
      expect(result).toMatchObject({ status: "query-failed", timedOut: true });
      expect(seenSignal?.aborted).toBe(true);
      await expect(providerWork).rejects.toThrow("provider cancelled");
      expect(ended).toHaveBeenCalledOnce();
    },
  );

  it("uses the report panel timeout for the scoped cached query", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [{ count: 1 }],
      schema: [{ name: "count", type: "number" }],
    });

    await runDashboardPanelQuery({
      source: "first-party",
      query: "SELECT COUNT(*) AS count FROM analytics_events",
      ctx: { userEmail: "alice@example.com", orgId: "org-1" },
      timeoutMs: 147,
    });

    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      "SELECT COUNT(*) AS count FROM analytics_events",
      {
        userEmail: "alice@example.com",
        orgId: "org-1",
      },
      {
        cache: true,
        timeoutMs: 147,
      },
    );
  });

  it("does not mix the reviewer identity into a cross-org first-party query", async () => {
    mocks.queryFirstPartyAnalytics.mockResolvedValue({
      rows: [{ count: 1 }],
      schema: [{ name: "count", type: "number" }],
    });

    await runDashboardPanelQuery({
      source: "first-party",
      query: "SELECT COUNT(*) AS count FROM analytics_events",
      ctx: {
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      },
    });

    expect(mocks.queryFirstPartyAnalytics).toHaveBeenCalledWith(
      "SELECT COUNT(*) AS count FROM analytics_events",
      {
        userEmail: "admin@example.com",
        orgId: "customer-org",
        credentialScope: "org",
      },
      { cache: true },
    );
  });

  it("returns a typed unsupported-backend state that is not an empty result", async () => {
    mocks.queryFirstPartyAnalytics.mockRejectedValue(
      new FirstPartyAnalyticsUnsupportedSqlError(
        "date_trunc('month', ...)",
        "First-party BigQuery query only supports PostgreSQL date_trunc('week', ...) expressions",
      ),
    );

    const result = (await runDashboardPanelQuery({
      source: "first-party",
      query:
        "SELECT date_trunc('month', event_date) AS d FROM analytics_events",
      ctx,
    })) as unknown as Record<string, unknown>;

    expect(result.error).toBe("unsupported_by_backend");
    expect(result.backend).toBe("bigquery");
    expect(result.construct).toBe("date_trunc('month', ...)");
    expect(result.message).toContain("date_trunc('month', ...)");
    expect(result).not.toHaveProperty("rows");
  });

  it("still throws every other first-party query failure", async () => {
    mocks.queryFirstPartyAnalytics.mockRejectedValue(
      new Error("statement timeout"),
    );

    await expect(
      runDashboardPanelQuery({
        source: "first-party",
        query: "SELECT COUNT(*) AS count FROM analytics_events",
        ctx,
      }),
    ).rejects.toThrow("statement timeout");
  });
});
