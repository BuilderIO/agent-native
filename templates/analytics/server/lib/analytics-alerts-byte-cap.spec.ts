import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  query: vi.fn(),
  patches: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("./analytics-alerts", async (original) => ({
  ...(await original<typeof import("./analytics-alerts")>()),
  ensureDefaultAnalyticsAlertRules: async () => ({ checked: 0, created: 0 }),
  listEnabledAnalyticsAlertRules: mocks.list,
  claimAnalyticsAlertRuleEvaluation: async () => true,
}));
vi.mock("./first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: mocks.query,
}));
vi.mock("./first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: async () => ({ sink: "bigquery" }),
}));
vi.mock("@agent-native/core/notifications", () => ({
  notifyWithDelivery: mocks.notify,
}));
vi.mock("../db/index.js", async (original) => ({
  ...(await original<typeof import("../db/index.js")>()),
  getDb: () => ({
    update: () => ({
      set: (patch: unknown) => ({ where: () => mocks.patches(patch) }),
    }),
  }),
}));

import { runAnalyticsAlertsOnce } from "../jobs/analytics-alerts";
import type { AnalyticsAlertRule } from "./analytics-alerts";
import { BigQueryMaximumBytesBilledError } from "./bigquery";

const now = new Date("2026-10-16T00:05:00.000Z");
function rule(id: string, batched: boolean): AnalyticsAlertRule {
  return {
    id,
    name: id,
    description: "",
    eventName: "agent_run_terminal",
    filters: batched
      ? [{ field: "properties.status", value: "errored" }]
      : [{ field: "properties.status", op: "exists", value: true }],
    thresholdMode: "event_count",
    distinctBy: null,
    threshold: 1,
    windowMinutes: 1440,
    cooldownMinutes: 30,
    severity: "critical",
    channels: ["inbox"],
    emailRecipients: [],
    slackWebhookUrl: null,
    webhookUrl: null,
    enabled: true,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ownerEmail: "owner@example.test",
    orgId: "org",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network access is forbidden in alert byte-cap tests");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("analytics alert byte cap", () => {
  it.each([true, false])(
    "persists cap failures as errors without retrying (batched: %s)",
    async (batched) => {
      const rules = batched
        ? [rule("a", true), rule("b", true), rule("c", true)]
        : [rule("a", false)];
      mocks.list.mockResolvedValue(rules);
      const failure = new BigQueryMaximumBytesBilledError(400);
      mocks.query.mockRejectedValue(failure);

      await expect(runAnalyticsAlertsOnce()).resolves.toEqual({
        processed: rules.length,
        triggered: 0,
        failed: rules.length,
        remaining: 0,
      });

      expect(mocks.query).toHaveBeenCalledTimes(1);
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining("event_date >="),
        { userEmail: "owner@example.test", orgId: "org" },
        { eventsSource: "raw", maxBytesBilled: 50_000_000_000 },
      );
      expect(mocks.query.mock.calls[0][0]).toContain(
        "2026-10-15T00:05:00.000Z",
      );
      expect(mocks.query.mock.calls[0][0]).toContain(
        "2026-10-16T00:05:00.000Z",
      );
      expect(mocks.patches.mock.calls).toEqual(
        rules.map(() => [
          {
            lastEvaluatedAt: now.toISOString(),
            lastStatus: "error",
            lastError:
              "BigQuery query exceeded its configured billed-byte limit",
          },
        ]),
      );
      expect(console.error).toHaveBeenCalledTimes(rules.length);
      for (const call of vi.mocked(console.error).mock.calls) {
        expect(call[1]).toBe(failure);
      }
      expect(mocks.notify).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
