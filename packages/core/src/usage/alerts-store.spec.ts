import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { __resetSchemaSnapshotForTests } from "../db/ddl-guard.js";

const mockNotifyWithDelivery = vi.hoisted(() => vi.fn());
const mockDeleteNotification = vi.hoisted(() => vi.fn());

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const args = (input.args ?? []) as unknown[];
    const statement = await pglite.prepare(input.sql);
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await statement.all(...args), rowsAffected: 0 };
    }
    const result = await statement.run(...args);
    return { rows: [], rowsAffected: result.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "BIGINT",
  isProductionServerlessFunctionRuntime: () => false,
}));

vi.mock("../notifications/index.js", () => ({
  deleteNotification: mockDeleteNotification,
  notifyWithDelivery: mockNotifyWithDelivery,
}));

const {
  _resetUsageAlertStoreForTests,
  _waitForUsageAlertEvaluationsForTests,
  dismissUsageAlert,
  enqueueUsageAlertEvaluation,
  listUsageAlerts,
  saveUsageAlert,
  USAGE_ALERT_UNIT_SCALE,
} = await import("./alerts-store.js");

const access = { ownerEmail: "alice@example.com" };

async function insertUsage(values: {
  id: number;
  app: string;
  cost: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  orgId?: string | null;
}) {
  await (
    await pglite.prepare(
      `INSERT INTO token_usage (
        id, owner_email, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, cost_cents_x100, app, org_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
  ).run(
    values.id,
    access.ownerEmail,
    values.input ?? 0,
    values.output ?? 0,
    values.cacheRead ?? 0,
    values.cacheWrite ?? 0,
    values.cost,
    values.app,
    values.orgId ?? null,
    Date.now(),
  );
}

beforeEach(async () => {
  __resetSchemaSnapshotForTests();
  pglite = await createTestPglite();
  await pglite.exec(`CREATE TABLE token_usage (
    id BIGINT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    cost_cents_x100 BIGINT NOT NULL DEFAULT 0,
    app TEXT NOT NULL DEFAULT '',
    org_id TEXT,
    created_at BIGINT NOT NULL
  )`);
  mockNotifyWithDelivery.mockResolvedValue({
    notification: { id: "notification-1" },
    deliveredChannels: ["inbox"],
  });
  mockDeleteNotification.mockResolvedValue(true);
});

afterEach(async () => {
  _resetUsageAlertStoreForTests();
  await pglite.close();
  __resetSchemaSnapshotForTests();
  vi.clearAllMocks();
});

describe("usage alerts", () => {
  it("keeps the $100 default durable and maps $100 to 1,000,000 raw centicents", async () => {
    await insertUsage({
      id: 1,
      app: "agent-native-factory",
      cost: 1_000_000,
      orgId: "org-1",
    });

    const rules = await listUsageAlerts(
      { scope: "user", appId: "factory" },
      access,
    );

    expect(USAGE_ALERT_UNIT_SCALE.usd).toBe(100);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      isDefault: true,
      limit: 100,
      current: 100,
      status: "triggered",
      channels: ["in-app", "email"],
    });
    expect(
      await (
        await pglite.prepare("SELECT is_default FROM usage_alert_rules")
      ).get(),
    ).toMatchObject({ is_default: 1 });
  });

  it("counts cache read and write tokens and matches app aliases", async () => {
    await insertUsage({
      id: 1,
      app: "agent-native-factory",
      cost: 0,
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    });

    const result = await saveUsageAlert(
      {
        scope: "user",
        appId: "factory",
        unit: "tokens",
        period: "day",
        limit: 10,
        channels: ["in-app"],
      },
      access,
    );

    expect(result.rule).toMatchObject({
      appId: "factory",
      current: 10,
      status: "triggered",
    });
  });

  it("deduplicates threshold notifications and removes the inbox item on dismiss", async () => {
    await insertUsage({ id: 1, app: "factory", cost: 1_000_000, input: 1 });
    enqueueUsageAlertEvaluation({
      ownerEmail: access.ownerEmail,
      app: "factory",
      inputTokens: 1,
      outputTokens: 0,
      costCentsX100: 1_000_000,
    });
    enqueueUsageAlertEvaluation({
      ownerEmail: access.ownerEmail,
      app: "factory",
      inputTokens: 1,
      outputTokens: 0,
      costCentsX100: 1_000_000,
    });
    await _waitForUsageAlertEvaluationsForTests();

    expect(mockNotifyWithDelivery).toHaveBeenCalledTimes(1);
    const event = (await (
      await pglite.prepare("SELECT notification_id FROM usage_alert_events")
    ).get()) as { notification_id: string };
    expect(event.notification_id).toBe("notification-1");

    const [rule] = await listUsageAlerts(
      { scope: "user", appId: "factory" },
      access,
    );
    await dismissUsageAlert(rule!.id, "user", access);

    expect(mockDeleteNotification).toHaveBeenCalledWith(
      "notification-1",
      access.ownerEmail,
    );
  });
});
