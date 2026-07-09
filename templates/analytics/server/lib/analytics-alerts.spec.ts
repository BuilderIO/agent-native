import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => settingsMocks);

import {
  evaluateAnalyticsAlertRuleRows,
  getAnalyticsAlertRuleDefaults,
  rememberAnalyticsAlertRuleDefaults,
  type AnalyticsAlertEventRow,
} from "./analytics-alerts";

function event(
  id: string,
  overrides: Partial<AnalyticsAlertEventRow> = {},
): AnalyticsAlertEventRow {
  return {
    id,
    eventName: "clips_upload_failed",
    userKey: `user_${id}`,
    sessionId: `session_${id}`,
    timestamp: "2026-07-01T12:00:00.000Z",
    app: "clips",
    template: "clips",
    properties: "{}",
    context: "{}",
    ...overrides,
  };
}

describe("analytics alert evaluation", () => {
  beforeEach(() => {
    settingsMocks.getUserSetting.mockReset();
    settingsMocks.putUserSetting.mockReset();
  });

  it("matches generic columns and nested properties", () => {
    const result = evaluateAnalyticsAlertRuleRows(
      {
        threshold: 2,
        thresholdMode: "event_count",
        distinctBy: null,
        filters: [
          { field: "app", value: "clips" },
          { field: "properties.stage", value: "final_chunk" },
          { field: "properties.status", op: "in", value: [504, "timeout"] },
        ],
      },
      [
        event("1", {
          properties: JSON.stringify({ stage: "final_chunk", status: 504 }),
        }),
        event("2", {
          properties: JSON.stringify({
            stage: "final_chunk",
            status: "timeout",
          }),
        }),
        event("3", {
          properties: JSON.stringify({ stage: "thumbnail", status: 504 }),
        }),
      ],
    );

    expect(result.triggered).toBe(true);
    expect(result.observedValue).toBe(2);
    expect(result.eventCount).toBe(2);
    expect(result.sampleEvents).toHaveLength(2);
  });

  it("can threshold on distinct field values", () => {
    const result = evaluateAnalyticsAlertRuleRows(
      {
        threshold: 2,
        thresholdMode: "distinct_count",
        distinctBy: "user_key",
        filters: [{ field: "event_name", value: "clips_upload_failed" }],
      },
      [
        event("1", { userKey: "alice" }),
        event("2", { userKey: "alice" }),
        event("3", { userKey: "bob" }),
      ],
    );

    expect(result.triggered).toBe(true);
    expect(result.observedValue).toBe(2);
    expect(result.eventCount).toBe(3);
  });

  it("matches the default HTTP 5xx response status telemetry filter", () => {
    const result = evaluateAnalyticsAlertRuleRows(
      {
        threshold: 2,
        thresholdMode: "event_count",
        distinctBy: null,
        filters: [{ field: "properties.status_class", value: "5xx" }],
      },
      [
        event("1", {
          eventName: "http.response",
          properties: JSON.stringify({ status_code: 500, status_class: "5xx" }),
        }),
        event("2", {
          eventName: "http.response",
          properties: JSON.stringify({ status_code: 504, status_class: "5xx" }),
        }),
        event("3", {
          eventName: "http.response",
          properties: JSON.stringify({ status_code: 200, status_class: "2xx" }),
        }),
      ],
    );

    expect(result.triggered).toBe(true);
    expect(result.observedValue).toBe(2);
  });

  it("keeps sweep ordering fair instead of cycling only recently evaluated rules", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "case when ${table.lastEvaluatedAt} is null then 0 else 1 end",
    );
    expect(source).toContain("asc(table.lastEvaluatedAt)");
    expect(source).toContain("asc(table.createdAt)");
    expect(source).not.toContain(".orderBy(desc(table.updatedAt))");
    expect(source).toContain(".set(patch)");
    expect(source).not.toContain(".set({ ...patch, updatedAt: nowIso() })");
  });

  it("pages through the full alert window before evaluating filters", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("analyticsAlertEventBatchSize()");
    expect(source).toContain("while (true)");
    expect(source).toContain(".orderBy(desc(table.timestamp), desc(table.id))");
    expect(source).toContain("rows.push(...page)");
    expect(source).toContain("if (page.length < batchSize) break");
    expect(source).not.toContain(".limit(maxCandidateEventsPerRule())");
    expect(source).not.toContain("function maxCandidateEventsPerRule");
  });

  it("claims alert rules before evaluating so parallel sweeps cannot double-send", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );
    const jobSource = readFileSync(
      new URL("../jobs/analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "export async function claimAnalyticsAlertRuleEvaluation",
    );
    expect(source).toContain('lastStatus: "running"');
    expect(source).toContain("alertRuleNotRunningWhere(now)");
    expect(source).toContain("alertRulePreviousEvaluationWhere(rule)");
    expect(source).toContain(".returning({ id: table.id })");
    expect(jobSource).toContain("claimAnalyticsAlertRuleEvaluation(rule)");
    expect(
      jobSource.indexOf("claimAnalyticsAlertRuleEvaluation(rule)"),
    ).toBeLessThan(
      jobSource.indexOf("evaluateAndNotifyAnalyticsAlertRule(rule)"),
    );
  });

  it("keeps triggered rules retryable only when no notification channel delivered", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );
    const noDeliveryIndex = source.indexOf(
      "if (delivery.deliveredChannels.length === 0)",
    );
    const incidentIndex = source.indexOf("recordIncident(rule");

    expect(source).toContain("notifyWithDelivery");
    expect(source).toContain("ensureInboxNotificationChannel(rule.channels)");
    expect(source).toContain("delivery.deliveredChannels.length === 0");
    expect(source).toContain("Analytics alert notification was not delivered.");
    expect(source).toContain('lastStatus: "error"');
    expect(noDeliveryIndex).toBeGreaterThan(-1);
    expect(noDeliveryIndex).toBeLessThan(incidentIndex);
    expect(source).toContain("notificationId: delivery.notification?.id");
    expect(source).not.toContain("if (!stored?.id)");
  });

  it("requires Netlify scheduled invocation payload before forwarding alert cron token", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/emit-netlify-dashboard-report-cron.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const alertTriggerIndex = source.indexOf(
      "function emitAlertScheduledTrigger",
    );
    const alertSource = source.slice(alertTriggerIndex);

    expect(alertSource).toContain("async function readScheduledInvocation");
    expect(alertSource).toContain('request.method !== "POST"');
    expect(alertSource).toContain("body?.next_run");
    expect(alertSource).toContain(
      'if (!scheduled) return new Response("Not Found", { status: 404 });',
    );
    expect(
      alertSource.indexOf("readScheduledInvocation(request)"),
    ).toBeLessThan(
      alertSource.indexOf('"x-agent-native-analytics-alert-cron": CRON_TOKEN'),
    );
  });

  it("does not let a failed rule listing crash the whole sweep", () => {
    const jobSource = readFileSync(
      new URL("../jobs/analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    const tryIndex = jobSource.indexOf("try {\n      rules = await");
    const catchIndex = jobSource.indexOf(
      "Failed to list enabled alert rules; skipping this sweep",
    );
    const listCallIndex = jobSource.indexOf(
      "rules = await listEnabledAnalyticsAlertRules(",
    );

    expect(tryIndex).toBeGreaterThan(-1);
    expect(catchIndex).toBeGreaterThan(-1);
    expect(listCallIndex).toBeGreaterThan(tryIndex);
    expect(catchIndex).toBeGreaterThan(listCallIndex);
    expect(jobSource).toContain("listRulesFailureLogged");
    expect(jobSource).toContain(
      "return { processed: 0, triggered: 0, failed: 0, remaining: 0 };",
    );
  });

  it("seeds the default HTTP 5xx alert before evaluating rules", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );
    const jobSource = readFileSync(
      new URL("../jobs/analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("ensureDefaultHttp5xxSpikeAlertRules");
    expect(source).toContain("Hosted app HTTP 5xx spike");
    expect(source).toContain("properties.status_class");
    expect(jobSource).toContain("ensureDefaultHttp5xxSpikeAlertRules()");
    const seedCallIndex = jobSource.indexOf(
      "await ensureDefaultHttp5xxSpikeAlertRules()",
    );
    const listRulesIndex = jobSource.indexOf(
      "rules = await listEnabledAnalyticsAlertRules",
    );
    expect(seedCallIndex).toBeGreaterThan(-1);
    expect(listRulesIndex).toBeGreaterThan(-1);
    expect(seedCallIndex).toBeLessThan(listRulesIndex);
  });

  it("reads user-scoped alert recipient defaults for the active org", async () => {
    settingsMocks.getUserSetting.mockResolvedValue({
      emailRecipients: [
        "Ops@Example.test",
        "alerts@example.test",
        "ops@example.test",
        "",
        42,
      ],
    });

    await expect(
      getAnalyticsAlertRuleDefaults({
        email: "owner@example.test",
        orgId: "org_123",
      }),
    ).resolves.toEqual({
      emailRecipients: ["ops@example.test", "alerts@example.test"],
    });
    expect(settingsMocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "analytics-alert-rule-defaults:org_123",
    );
  });

  it("stores non-empty alert recipient defaults per user and personal scope", async () => {
    settingsMocks.putUserSetting.mockResolvedValue(undefined);

    await rememberAnalyticsAlertRuleDefaults(
      {
        emailRecipients: [
          "Ops@Example.test",
          "alerts@example.test",
          "ops@example.test",
        ],
      },
      { email: "owner@example.test", orgId: null },
    );

    expect(settingsMocks.putUserSetting).toHaveBeenCalledTimes(1);
    expect(settingsMocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "analytics-alert-rule-defaults:personal",
      expect.objectContaining({
        emailRecipients: ["ops@example.test", "alerts@example.test"],
      }),
    );
  });

  it("keeps existing alert recipient defaults when a save has no recipients", async () => {
    await rememberAnalyticsAlertRuleDefaults(
      { emailRecipients: [] },
      { email: "owner@example.test", orgId: null },
    );

    expect(settingsMocks.putUserSetting).not.toHaveBeenCalled();
  });
});
