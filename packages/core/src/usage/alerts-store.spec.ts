import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { __resetSchemaSnapshotForTests } from "../db/ddl-guard.js";
import { USAGE_ALERT_MIGRATIONS } from "./migrations.js";
import { builderCreditsFromCostCents } from "./store.js";

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
  USAGE_ALERT_DEFAULT_DAILY_USD,
  USAGE_ALERT_DEFAULT_MONTHLY_USD,
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

const { __resetStoreLedgerSnapshotForTests } =
  await import("../db/store-registry.js");

beforeEach(async () => {
  __resetSchemaSnapshotForTests();
  pglite = await createTestPglite();
  __resetStoreLedgerSnapshotForTests();
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
  it("moves defaults still at $100 a day once, and leaves other limits alone", async () => {
    const move = async () => {
      const migration = USAGE_ALERT_MIGRATIONS.find((m) => m.version === 4);
      await pglite.exec(migration!.sql as string);
    };
    const [rule] = await listUsageAlerts({ scope: "user" }, access);

    await pglite.exec(
      "UPDATE usage_alert_rules SET limit_value = 10000, period = 'day', dismissed_window_start = 1",
    );
    await move();
    expect((await listUsageAlerts({ scope: "user" }, access))[0]).toMatchObject(
      {
        limit: 20,
        period: "month",
      },
    );
    expect(
      await (
        await pglite.prepare(
          "SELECT dismissed_window_start FROM usage_alert_rules",
        )
      ).get(),
    ).toMatchObject({ dismissed_window_start: null });

    await pglite.exec(
      "UPDATE usage_alert_rules SET is_default = 0, limit_value = 10000, period = 'day'",
    );
    await move();
    expect((await listUsageAlerts({ scope: "user" }, access))[0]).toMatchObject(
      {
        limit: 100,
        period: "day",
      },
    );

    await pglite.exec("UPDATE usage_alert_rules SET is_default = 1");
    await saveUsageAlert(
      { scope: "user", ruleId: rule!.id, limit: 50, period: "day" },
      access,
    );
    await move();
    expect((await listUsageAlerts({ scope: "user" }, access))[0]).toMatchObject(
      {
        limit: 50,
        period: "day",
      },
    );
  });

  it("keeps the deprecated daily export at its old value", () => {
    expect(USAGE_ALERT_DEFAULT_DAILY_USD).toBe(100);
    expect(USAGE_ALERT_DEFAULT_MONTHLY_USD).toBe(20);
  });

  it("gives a new alert the monthly default for its unit", async () => {
    const save = (unit: "usd" | "builder-credits" | "tokens") =>
      saveUsageAlert({ scope: "user", appId: `app-${unit}`, unit }, access);

    expect((await save("usd")).rule).toMatchObject({
      unit: "usd",
      period: "month",
      limit: USAGE_ALERT_DEFAULT_MONTHLY_USD,
    });
    expect((await save("builder-credits")).rule.limit).toBe(
      builderCreditsFromCostCents(USAGE_ALERT_DEFAULT_MONTHLY_USD * 100),
    );
    await expect(save("tokens")).rejects.toThrow(
      "Usage alert limit must be greater than zero.",
    );
  });

  it("keeps the $20 monthly default durable and maps $20 to 200,000 raw centicents", async () => {
    await insertUsage({
      id: 1,
      app: "agent-native-factory",
      cost: 200_000,
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
      limit: 20,
      period: "month",
      current: 20,
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
