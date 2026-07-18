import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => settingsMocks);
vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: dbMocks.getDb,
}));

import {
  deleteAnalyticsAlertRule,
  evaluateAnalyticsAlertRuleRows,
  ensureDefaultAnalyticsAlertRules,
  getAnalyticsAlertRuleDefaults,
  rememberAnalyticsAlertRuleDefaults,
  type AnalyticsAlertEventRow,
} from "./analytics-alerts";

function defaultAlertDb(
  scopes: Array<{ ownerEmail: string; orgId: string | null }>,
) {
  const inserted = new Map<string, Record<string, unknown>>();
  const db = {
    select(projection?: Record<string, unknown>) {
      const selectingScopes = Boolean(projection && "ownerEmail" in projection);
      return {
        from() {
          if (selectingScopes) {
            return {
              where() {
                return { groupBy: async () => scopes };
              },
            };
          }
          return {
            where: async () =>
              projection && "id" in projection
                ? [...inserted.keys()].map((id) => ({ id }))
                : [...inserted.values()],
          };
        },
      };
    },
    insert() {
      return {
        values(rows: Array<Record<string, unknown>>) {
          return {
            onConflictDoNothing() {
              return {
                returning: async () => {
                  const created: Array<{ id: string }> = [];
                  for (const row of rows) {
                    const id = String(row.id);
                    if (inserted.has(id)) continue;
                    inserted.set(id, row);
                    created.push({ id });
                  }
                  return created;
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: async () => {
              for (const [id, row] of inserted) {
                inserted.set(id, { ...row, ...values });
              }
            },
          };
        },
      };
    },
    delete() {
      return {
        where: async () => inserted.clear(),
      };
    },
  };
  return { db, inserted };
}

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
    dbMocks.getDb.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("emits a Netlify scheduled uptime monitor sweep", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/emit-netlify-dashboard-report-cron.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const uptimeTriggerIndex = source.indexOf(
      "function emitUptimeScheduledTrigger",
    );
    const uptimeSource = source.slice(uptimeTriggerIndex);

    expect(source).toContain('const UPTIME_SCHEDULE = "* * * * *";');
    expect(source).toContain(
      'const UPTIME_ROUTE_PATH = "/api/uptime-monitors/run";',
    );
    expect(source).toContain("emitUptimeScheduledTrigger(uptimeToken)");
    expect(source).toContain("emitUptimeBackgroundWorker(uptimeToken)");
    expect(uptimeSource).toContain("async function readScheduledInvocation");
    expect(uptimeSource).toContain(
      '"x-agent-native-uptime-monitor-cron": CRON_TOKEN',
    );
    expect(uptimeSource).toContain(
      "globalThis.__AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__ = true",
    );
  });

  it("compares the uptime monitor cron bearer secret safely", () => {
    const source = readFileSync(
      new URL("../routes/api/uptime-monitors/run.post.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import { timingSafeEqual } from "node:crypto";');
    expect(source).toContain("timingSafeEqual(Buffer.from(value)");
    expect(source).not.toContain("return header ===");
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

  it("seeds hosted default alerts in one idempotent pass before evaluating rules", () => {
    const source = readFileSync(
      new URL("./analytics-alerts.ts", import.meta.url),
      "utf8",
    );
    const jobSource = readFileSync(
      new URL("../jobs/analytics-alerts.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("ensureDefaultAnalyticsAlertRules");
    expect(source).toContain("Hosted app HTTP 5xx spike");
    expect(source).toContain("properties.status_class");
    expect(source).toContain("Hosted agent chat stuck spike");
    expect(source).toContain('"default-agent-chat-stuck-spike"');
    expect(source).toContain('eventName: "agent_chat_stuck_detected"');
    expect(source).toContain(
      '"ANALYTICS_DEFAULT_AGENT_CHAT_STUCK_ALERT_ENABLED"',
    );
    expect(source).toContain(
      '"ANALYTICS_DEFAULT_AGENT_CHAT_STUCK_ALERT_THRESHOLD"',
    );
    expect(source).toContain(
      '"ANALYTICS_DEFAULT_AGENT_CHAT_STUCK_ALERT_WINDOW_MINUTES"',
    );
    expect(source).toContain(
      '"ANALYTICS_DEFAULT_AGENT_CHAT_STUCK_ALERT_COOLDOWN_MINUTES"',
    );
    expect(source).toContain(
      "const DEFAULT_AGENT_CHAT_STUCK_ALERT_THRESHOLD = 3;",
    );
    expect(source).toContain(
      "const DEFAULT_AGENT_CHAT_STUCK_ALERT_WINDOW_MINUTES = 10;",
    );
    expect(source).toContain(
      "const DEFAULT_AGENT_CHAT_STUCK_ALERT_COOLDOWN_MINUTES = 60;",
    );
    expect(source.match(/await defaultAnalyticsAlertScopes\(\)/g)).toHaveLength(
      1,
    );
    expect(source).toContain(".onConflictDoNothing()");
    expect(source).toContain(".values(rowChunk)");
    expect(source).toContain(
      "defaultAlertId(definition.idPrefix, scope.email, scope.orgId)",
    );
    const seedSource = source.slice(
      source.indexOf("export async function ensureDefaultAnalyticsAlertRules"),
      source.indexOf("export async function listEnabledAnalyticsAlertRules"),
    );
    expect(seedSource).toContain('channels: JSON.stringify(["inbox"])');
    expect(seedSource).toContain("emailRecipients: JSON.stringify([])");
    expect(seedSource).toContain("ownerEmail: scope.email");
    expect(seedSource).toContain("orgId: scope.orgId");
    expect(seedSource).not.toContain("slackWebhookUrl");
    expect(seedSource).not.toContain("webhookUrl");
    expect(jobSource).toContain("ensureDefaultAnalyticsAlertRules()");
    const seedCallIndex = jobSource.indexOf(
      "await ensureDefaultAnalyticsAlertRules()",
    );
    const listRulesIndex = jobSource.indexOf(
      "rules = await listEnabledAnalyticsAlertRules",
    );
    expect(seedCallIndex).toBeGreaterThan(-1);
    expect(listRulesIndex).toBeGreaterThan(-1);
    expect(seedCallIndex).toBeLessThan(listRulesIndex);
  });

  it("creates each hosted default once per scope and counts distinct stuck runs", async () => {
    vi.stubEnv("URL", "https://analytics.agent-native.com");
    const { db, inserted } = defaultAlertDb([
      { ownerEmail: "owner@example.test", orgId: "org_123" },
    ]);
    dbMocks.getDb.mockReturnValue(db);

    await expect(ensureDefaultAnalyticsAlertRules()).resolves.toEqual({
      checked: 2,
      created: 2,
    });
    await expect(ensureDefaultAnalyticsAlertRules()).resolves.toEqual({
      checked: 2,
      created: 0,
    });

    const rows = [...inserted.values()];
    const http = rows.find((row) => row.eventName === "http.response");
    const stuck = rows.find(
      (row) => row.eventName === "agent_chat_stuck_detected",
    );
    expect(http).toMatchObject({
      thresholdMode: "event_count",
      distinctBy: null,
      ownerEmail: "owner@example.test",
      orgId: "org_123",
    });
    expect(String(http?.id)).toMatch(/^default-http-5xx-spike-/);
    expect(stuck).toMatchObject({
      thresholdMode: "distinct_count",
      distinctBy: "properties.runId",
      threshold: 3,
      windowMinutes: 10,
      cooldownMinutes: 60,
      channels: JSON.stringify(["inbox"]),
      emailRecipients: JSON.stringify([]),
      ownerEmail: "owner@example.test",
      orgId: "org_123",
    });
  });

  it("seeds defaults for more than one thousand distinct tenant scopes", async () => {
    vi.stubEnv("URL", "https://analytics.agent-native.com");
    const scopes = Array.from({ length: 1_001 }, (_, index) => ({
      ownerEmail: `owner-${index}@example.test`,
      orgId: `org_${index}`,
    }));
    const { db, inserted } = defaultAlertDb(scopes);
    dbMocks.getDb.mockReturnValue(db);

    await expect(ensureDefaultAnalyticsAlertRules()).resolves.toEqual({
      checked: 2_002,
      created: 2_002,
    });
    expect(inserted).toHaveLength(2_002);
  });

  it("keeps a deleted hosted default disabled across later seed sweeps", async () => {
    vi.stubEnv("URL", "https://analytics.agent-native.com");
    const { db, inserted } = defaultAlertDb([
      { ownerEmail: "owner@example.test", orgId: "org_123" },
    ]);
    dbMocks.getDb.mockReturnValue(db);
    await ensureDefaultAnalyticsAlertRules();
    const stuckId = [...inserted.entries()].find(
      ([, row]) => row.eventName === "agent_chat_stuck_detected",
    )?.[0];
    expect(stuckId).toBeTruthy();

    await deleteAnalyticsAlertRule(stuckId!, {
      email: "owner@example.test",
      orgId: "org_123",
    });
    expect(inserted.get(stuckId!)?.enabled).toBe(false);
    await expect(ensureDefaultAnalyticsAlertRules()).resolves.toEqual({
      checked: 2,
      created: 0,
    });
    expect(inserted.get(stuckId!)?.enabled).toBe(false);
  });

  it("honors independent enable switches for hosted default alerts", async () => {
    vi.stubEnv("URL", "https://analytics.agent-native.com");
    vi.stubEnv("ANALYTICS_DEFAULT_AGENT_CHAT_STUCK_ALERT_ENABLED", "false");
    const httpOnly = defaultAlertDb([
      { ownerEmail: "owner@example.test", orgId: null },
    ]);
    dbMocks.getDb.mockReturnValue(httpOnly.db);
    await expect(ensureDefaultAnalyticsAlertRules()).resolves.toEqual({
      checked: 1,
      created: 1,
    });
    expect([...httpOnly.inserted.values()].map((row) => row.eventName)).toEqual(
      ["http.response"],
    );

    vi.stubEnv("ANALYTICS_DEFAULT_HTTP_5XX_ALERT_ENABLED", "false");
    vi.stubEnv("ANALYTICS_DEFAULT_AGENT_CHAT_STUCK_ALERT_ENABLED", "true");
    const stuckOnly = defaultAlertDb([
      { ownerEmail: "owner@example.test", orgId: null },
    ]);
    dbMocks.getDb.mockReturnValue(stuckOnly.db);
    await expect(ensureDefaultAnalyticsAlertRules()).resolves.toEqual({
      checked: 1,
      created: 1,
    });
    expect(
      [...stuckOnly.inserted.values()].map((row) => row.eventName),
    ).toEqual(["agent_chat_stuck_detected"]);
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
