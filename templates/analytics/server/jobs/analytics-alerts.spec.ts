import { getRequestContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seed: vi.fn(),
  list: vi.fn(),
  claim: vi.fn(),
  notify: vi.fn(),
  error: vi.fn(),
  backend: vi.fn(),
  query: vi.fn(),
}));
vi.mock("../lib/analytics-alerts", async (original) => ({
  ...(await original<typeof import("../lib/analytics-alerts")>()),
  ensureDefaultAnalyticsAlertRules: mocks.seed,
  listEnabledAnalyticsAlertRules: mocks.list,
  claimAnalyticsAlertRuleEvaluation: mocks.claim,
  evaluateAndNotifyAnalyticsAlertRule: mocks.notify,
  markAnalyticsAlertRuleError: mocks.error,
}));
vi.mock("../lib/first-party-analytics-backend.js", () => ({
  getFirstPartyAnalyticsBackend: mocks.backend,
}));
vi.mock("../lib/first-party-analytics.js", () => ({
  queryFirstPartyAnalytics: mocks.query,
}));

import type { AnalyticsAlertRule } from "../lib/analytics-alerts";
import { runAnalyticsAlertsOnce } from "./analytics-alerts";

const now = new Date("2026-10-09T12:00:00.000Z");
function rule(
  id: string,
  patch: Partial<AnalyticsAlertRule> = {},
): AnalyticsAlertRule {
  return {
    id,
    name: id,
    description: "",
    eventName: id,
    filters: [],
    thresholdMode: "event_count",
    distinctBy: null,
    threshold: 2,
    windowMinutes: 10,
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
    ...patch,
  };
}
const targetRules = () => [
  rule("agent_run_terminal", {
    filters: [
      { field: "properties.status", value: "errored" },
      { field: "hostname", op: "contains", value: "beta." },
    ],
  }),
  rule("agent_chat_stuck_detected", {
    windowMinutes: 5,
    thresholdMode: "distinct_count",
    distinctBy: "properties.runId",
  }),
  rule("http.response", {
    filters: [{ field: "properties.status_class", value: "5xx" }],
    windowMinutes: 30,
  }),
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.seed.mockResolvedValue({ checked: 0, created: 0 });
  mocks.claim.mockResolvedValue(true);
  mocks.list.mockResolvedValue(targetRules());
  mocks.backend.mockImplementation(async (scope) => {
    expect(getRequestContext()).toMatchObject({
      userEmail: scope.userEmail,
      ...(scope.orgId ? { orgId: scope.orgId } : {}),
    });
    return { sink: "bigquery" };
  });
  mocks.query.mockImplementation(async (sql: string, scope) => {
    expect(getRequestContext()).toMatchObject({
      userEmail: scope.userEmail,
      ...(scope.orgId ? { orgId: scope.orgId } : {}),
    });
    const row: Record<string, unknown> = {};
    for (const match of sql.matchAll(/AS count_(\d+)/g)) {
      row[`count_${match[1]}`] = "0";
      row[`samples_${match[1]}`] = "null";
    }
    for (const match of sql.matchAll(/AS distinct_(\d+)/g))
      row[`distinct_${match[1]}`] = "null";
    return { rows: [row], schema: [] };
  });
  mocks.notify.mockImplementation(async (rule, _now, evaluation) => ({
    ruleId: rule.id,
    status: "ok",
    ...evaluation,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("analytics alert sweep batching", () => {
  it("claims all three before one query with fresh leases and one frozen evaluation window", async () => {
    const claimedAt: Date[] = [];
    mocks.claim.mockImplementation(async (_rule, time = new Date()) => {
      expect(mocks.query).not.toHaveBeenCalled();
      claimedAt.push(time);
      vi.advanceTimersByTime(1000);
      return true;
    });
    expect(await runAnalyticsAlertsOnce()).toEqual({
      processed: 3,
      triggered: 0,
      failed: 0,
      remaining: 0,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledTimes(3);
    expect(claimedAt.map((time) => time.toISOString())).toEqual([
      "2026-10-09T12:00:00.000Z",
      "2026-10-09T12:00:01.000Z",
      "2026-10-09T12:00:02.000Z",
    ]);
    for (const call of mocks.notify.mock.calls) expect(call[1]).toEqual(now);
    expect(mocks.query.mock.calls[0][0]).toContain("2026-10-09T12:00:00.000Z");
    for (const call of mocks.notify.mock.calls)
      expect(call[2]).toEqual({
        triggered: false,
        observedValue: 0,
        eventCount: 0,
        sampleEvents: [],
      });
  });

  it("separates exact owners, orgs, and personal scopes", async () => {
    mocks.list.mockResolvedValue([
      rule("a"),
      rule("b"),
      rule("c", { ownerEmail: "Owner@example.test" }),
      rule("d", { orgId: "other-org" }),
      rule("e", { orgId: null }),
    ]);
    expect((await runAnalyticsAlertsOnce()).processed).toBe(5);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.query.mock.calls.map((call) => call[1])).toEqual([
      { userEmail: "owner@example.test", orgId: "org" },
      { userEmail: "Owner@example.test", orgId: "org" },
      { userEmail: "owner@example.test", orgId: "other-org" },
      { userEmail: "owner@example.test", orgId: null },
    ]);
  });

  it("leaves later batches and individual rules unclaimed while a query is pending", async () => {
    const claimedAt = new Map<string, Date>();
    mocks.claim.mockImplementation(async (rule, time = new Date()) => {
      claimedAt.set(rule.id, time);
      return true;
    });
    mocks.list.mockResolvedValue([
      ...targetRules(),
      rule("other", { ownerEmail: "other@example.test" }),
      rule("individual", { thresholdMode: "distinct_count" }),
    ]);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queryEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementationOnce(async (...args) => {
      entered();
      await pending;
      return query(...args);
    });
    const sweep = runAnalyticsAlertsOnce();
    await queryEntered;
    expect(mocks.claim.mock.calls.map((call) => call[0].id)).toEqual(
      targetRules().map((rule) => rule.id),
    );
    expect(mocks.notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16 * 60 * 1000);
    release();
    expect((await sweep).processed).toBe(5);
    expect(mocks.claim.mock.calls.map((call) => call[0].id)).toEqual([
      ...targetRules().map((rule) => rule.id),
      "other",
      "individual",
    ]);
    for (const id of ["other", "individual"])
      expect(claimedAt.get(id)).toEqual(new Date("2026-10-09T12:16:00.000Z"));
    for (const call of mocks.notify.mock.calls) expect(call[1]).toEqual(now);
    for (const call of mocks.query.mock.calls)
      expect(call[0]).toContain("2026-10-09T12:00:00.000Z");
  });

  it("splits a large scope into batches of three and claims only the current chunk", async () => {
    mocks.list.mockResolvedValue([
      ...targetRules(),
      rule("a"),
      rule("b"),
      rule("c"),
      rule("d"),
    ]);
    const query = mocks.query.getMockImplementation()!;
    const claimsAtQuery: number[] = [];
    mocks.query.mockImplementation(async (...args) => {
      claimsAtQuery.push(mocks.claim.mock.calls.length);
      return query(...args);
    });
    expect((await runAnalyticsAlertsOnce()).processed).toBe(7);
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(claimsAtQuery).toEqual([3, 6, 7]);
    expect(
      mocks.query.mock.calls.map(
        (call) => [...call[0].matchAll(/AS count_\d+/g)].length,
      ),
    ).toEqual([3, 3, 1]);
    for (const target of targetRules())
      expect(mocks.query.mock.calls[0][0]).toContain(`'${target.eventName}'`);
    expect(mocks.notify).toHaveBeenCalledTimes(7);
  });

  it("keeps JSON IN rules on the individual path beside the three-rule batch", async () => {
    mocks.list.mockResolvedValue([
      ...targetRules(),
      rule("json-in", {
        filters: [
          { field: "properties.status_class", op: "in", value: ["5xx"] },
        ],
      }),
    ]);
    expect(await runAnalyticsAlertsOnce()).toEqual({
      processed: 4,
      triggered: 0,
      failed: 0,
      remaining: 0,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).not.toContain("json-in");
    expect(
      mocks.notify.mock.calls.find((call) => call[0].id === "json-in")?.[2],
    ).toBeUndefined();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("excludes failed and lost claims from all queries", async () => {
    mocks.claim
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("claim failed"));
    expect(await runAnalyticsAlertsOnce()).toEqual({
      processed: 1,
      triggered: 0,
      failed: 1,
      remaining: 0,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).toContain("'http.response'");
    expect(mocks.query.mock.calls[0][0]).not.toContain("agent_run_terminal");
    expect(mocks.query.mock.calls[0][0]).not.toContain(
      "agent_chat_stuck_detected",
    );
    expect(mocks.error).toHaveBeenCalledWith(
      "agent_chat_stuck_detected",
      expect.any(Error),
    );
  });

  it("marks each shared-query failure without individual retries and continues other scopes", async () => {
    mocks.list.mockResolvedValue([
      ...targetRules(),
      rule("other", { ownerEmail: "other@example.test" }),
    ]);
    mocks.query.mockRejectedValueOnce(new Error("warehouse unavailable"));
    expect(await runAnalyticsAlertsOnce()).toEqual({
      processed: 4,
      triggered: 0,
      failed: 3,
      remaining: 0,
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.error.mock.calls.map((call) => call[0])).toEqual(
      targetRules().map((rule) => rule.id),
    );
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0][0].id).toBe("other");
    expect(mocks.notify.mock.calls[0][2]).toBeDefined();
  });

  it("isolates backend and rule validation errors", async () => {
    mocks.list.mockResolvedValue([
      rule("invalid", { windowMinutes: NaN }),
      ...targetRules(),
    ]);
    mocks.backend.mockRejectedValueOnce(new Error("credential unavailable"));
    expect((await runAnalyticsAlertsOnce()).failed).toBe(2);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).not.toContain("'invalid'");
    expect(mocks.query.mock.calls[0][0]).not.toContain("agent_run_terminal");
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it("isolates malformed per-rule aggregates", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          count_0: "bad",
          samples_0: "null",
          count_1: 0,
          distinct_1: "null",
          samples_1: "null",
          count_2: 0,
          samples_2: "null",
        },
      ],
      schema: [],
    });
    expect((await runAnalyticsAlertsOnce()).failed).toBe(1);
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledWith(
      "agent_run_terminal",
      expect.any(Error),
    );
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("isolates thrown and undelivered notification failures and still counts triggers", async () => {
    mocks.notify
      .mockRejectedValueOnce(new Error("delivery failed"))
      .mockResolvedValueOnce({ status: "error" })
      .mockResolvedValueOnce({ status: "triggered" });
    expect(await runAnalyticsAlertsOnce()).toEqual({
      processed: 3,
      triggered: 1,
      failed: 2,
      remaining: 0,
    });
    expect(mocks.notify).toHaveBeenCalledTimes(3);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it("continues even when recording a failed rule's status fails", async () => {
    mocks.notify.mockRejectedValueOnce(new Error("delivery failed"));
    mocks.error.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await runAnalyticsAlertsOnce()).failed).toBe(1);
    expect(mocks.notify).toHaveBeenCalledTimes(3);
  });

  it("uses the old evaluator for unsupported rules and SQL backends", async () => {
    mocks.list.mockResolvedValue([
      rule("distinct", { thresholdMode: "distinct_count" }),
      rule("json", {
        filters: [{ field: "properties.x", op: "contains", value: "x" }],
      }),
      rule("sql"),
      rule("bq"),
    ]);
    mocks.backend
      .mockResolvedValueOnce({ sink: "sql" })
      .mockResolvedValueOnce({ sink: "bigquery" });
    expect((await runAnalyticsAlertsOnce()).processed).toBe(4);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const calls = new Map(
      mocks.notify.mock.calls.map((call) => [call[0].id, call[2]]),
    );
    expect(calls.get("bq")).toBeDefined();
    for (const id of ["distinct", "json", "sql"])
      expect(calls.get(id)).toBeUndefined();
    expect(mocks.backend).toHaveBeenCalledTimes(2);
  });
});
